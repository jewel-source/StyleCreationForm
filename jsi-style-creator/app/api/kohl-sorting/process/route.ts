import { NextRequest, NextResponse } from 'next/server'
import type { ParsedDsco } from '@/lib/kohl-sorting/dsco'
import { computeSortedPageIndices, extractPdfPages, reorderPdf } from '@/lib/kohl-sorting/pdf'
import { buildCustomerByOrder, buildDetailRows, buildOrderGroups, buildServiceByOrder, buildStyleWiseSummary, generateWorkbook, reorderForNegativeStock, sortOrdersForFulfillment } from '@/lib/kohl-sorting/dailyFile'
import { fetchSkuCatalogMap } from '@/lib/kohl-sorting/skuCatalog'
import { buildShippingCsv } from '@/lib/kohl-sorting/shippingCsv'

/**
 * Takes the already-parsed DSCO/inventory results from the upload endpoints
 * plus the raw PDF (sent fresh — its exact bytes are needed to reorder the
 * original pages into the output PDF, which parsed page data alone can't
 * reconstruct) and runs the existing sort/match/generate pipeline. Nothing
 * here is persisted; everything lives only for the duration of the request.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const company       = formData.get('company')
    const pdf           = formData.get('pdf') as File | null
    const dscoJson      = formData.get('dsco')
    const inventoryJson = formData.get('inventory')
    const invoiceStart  = formData.get('invoiceStart')

    if (company !== 'KOHLS') {
      return NextResponse.json({ error: 'Company must be KOHLS' }, { status: 400 })
    }
    if (!pdf) {
      return NextResponse.json({ error: 'Packing-slip PDF is required' }, { status: 400 })
    }
    if (typeof dscoJson !== 'string') {
      return NextResponse.json({ error: 'Parsed DSCO result is required — upload the DSCO export first' }, { status: 400 })
    }
    if (typeof inventoryJson !== 'string') {
      return NextResponse.json({ error: 'Parsed inventory result is required — upload the inventory file first' }, { status: 400 })
    }
    const startNum = parseInt(String(invoiceStart), 10)
    if (!Number.isInteger(startNum) || startNum <= 0) {
      return NextResponse.json({ error: 'Starting invoice number must be a positive integer' }, { status: 400 })
    }

    let parsedDsco: ParsedDsco
    let balanceByStyle: Map<string, number>
    try {
      parsedDsco = JSON.parse(dscoJson)
      if (parsedDsco.shape !== 'line-item-detail' && parsedDsco.shape !== 'shipping-import') {
        throw new Error('unrecognized shape')
      }
      balanceByStyle = new Map(JSON.parse(inventoryJson))
    } catch {
      return NextResponse.json({ error: 'Parsed DSCO/inventory results were malformed — re-upload those files and try again' }, { status: 400 })
    }

    const pdfBuf = Buffer.from(await pdf.arrayBuffer())
    const pages = await extractPdfPages(pdfBuf)
    const poOrderedIndices = computeSortedPageIndices(parsedDsco.poOrder, pages)

    const orders = buildOrderGroups(poOrderedIndices, pages, parsedDsco)
    const skuMap = await fetchSkuCatalogMap()
    const { sorted, missingUpcs, emptyOrders } = sortOrdersForFulfillment(orders, skuMap)

    if (emptyOrders.length > 0) {
      return NextResponse.json({
        error: `${emptyOrders.length} order(s) had no line items detected — can't build Daily File rows for them`,
        emptyOrders,
      }, { status: 422 })
    }
    if (missingUpcs.length > 0) {
      return NextResponse.json({
        error: `${missingUpcs.length} UPC(s) not found in the SKU catalog`,
        missingUpcs,
      }, { status: 422 })
    }

    // Fulfillment order (single-line orders grouped alphabetically by Right
    // Click Style #, multi-line orders at the end), then negative-stock
    // orders pushed to the bottom on top of that — this final sequence
    // drives the Daily File row/invoice sequence and the output PDF's page
    // order alike.
    const { reordered: finalOrder, negativeStockOrders } = reorderForNegativeStock(sorted, skuMap, balanceByStyle)
    const fulfillmentPageIndices = finalOrder.flatMap(o => o.pageIndices)
    const reorderedPdf = await reorderPdf(pdfBuf, fulfillmentPageIndices)

    const customerByOrder = buildCustomerByOrder(parsedDsco)
    const serviceByOrder = buildServiceByOrder(parsedDsco)
    const processDate = new Date()
    const rows = buildDetailRows(finalOrder, skuMap, customerByOrder, serviceByOrder, startNum, processDate, negativeStockOrders)

    const summary = buildStyleWiseSummary(rows)
    const workbookBuf = await generateWorkbook(rows, summary, String(company))
    const shippingPoOrder = finalOrder.filter(o => !negativeStockOrders.has(o.orderNo)).map(o => o.orderNo)
    const shippingCsv = buildShippingCsv(parsedDsco, shippingPoOrder, String(company))

    const datestamp = new Date().toISOString().slice(0, 10)
    return NextResponse.json({
      message: `✓ Sorted ${pages.length} PDF page(s) into ${orders.length} order(s), ${rows.length} Daily File row(s) generated` +
        (negativeStockOrders.size > 0 ? `, ${negativeStockOrders.size} order(s) flagged Negative Stock` : ''),
      pdf: reorderedPdf.toString('base64'),
      dailyFile: workbookBuf.toString('base64'),
      shippingCsv: Buffer.from(shippingCsv, 'utf-8').toString('base64'),
      filenames: {
        pdf: `kohls_packing_slips_sorted_${datestamp}.pdf`,
        dailyFile: `kohls_daily_file_${datestamp}.xlsx`,
        shippingCsv: `kohls_shipping_import_${datestamp}.csv`,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
