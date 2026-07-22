import { NextRequest, NextResponse } from 'next/server'
import { parseDscoFile } from '@/lib/kohl-sorting/dsco'
import { computeSortedPageIndices, extractPdfPages, reorderPdf } from '@/lib/kohl-sorting/pdf'
import { buildCustomerByOrder, buildDetailRows, buildOrderGroups, buildStyleWiseSummary, generateWorkbook, sortOrdersForFulfillment } from '@/lib/kohl-sorting/dailyFile'
import { fetchSkuCatalogMap } from '@/lib/kohl-sorting/skuCatalog'
import { buildShippingCsv } from '@/lib/kohl-sorting/shippingCsv'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const company     = formData.get('company')
    const pdf         = formData.get('pdf') as File | null
    const dsco        = formData.get('dsco') as File | null
    const invoiceStart = formData.get('invoiceStart')

    if (company !== 'KOHLS') {
      return NextResponse.json({ error: 'Company must be KOHLS' }, { status: 400 })
    }
    if (!pdf) {
      return NextResponse.json({ error: 'Packing-slip PDF is required' }, { status: 400 })
    }
    if (!dsco) {
      return NextResponse.json({ error: 'DSCO order export (CSV/XLS) is required' }, { status: 400 })
    }
    const startNum = parseInt(String(invoiceStart), 10)
    if (!Number.isInteger(startNum) || startNum <= 0) {
      return NextResponse.json({ error: 'Starting invoice number must be a positive integer' }, { status: 400 })
    }

    const dscoBuf = Buffer.from(await dsco.arrayBuffer())
    const parsedDsco = parseDscoFile(dscoBuf, dsco.name)

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
    // Click Style #, multi-line orders at the end) now drives both the
    // Daily File row/invoice sequence and the output PDF's page order.
    const fulfillmentPageIndices = sorted.flatMap(o => o.pageIndices)
    const reordered = await reorderPdf(pdfBuf, fulfillmentPageIndices)

    const customerByOrder = buildCustomerByOrder(parsedDsco)
    const processDate = new Date()
    const rows = buildDetailRows(sorted, skuMap, customerByOrder, startNum, processDate)

    const summary = buildStyleWiseSummary(rows)
    const workbookBuf = await generateWorkbook(rows, summary, String(company))
    const shippingCsv = buildShippingCsv(parsedDsco)

    const datestamp = new Date().toISOString().slice(0, 10)
    return NextResponse.json({
      message: `✓ Sorted ${pages.length} PDF page(s) into ${orders.length} order(s), ${rows.length} Daily File row(s) generated`,
      pdf: reordered.toString('base64'),
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
