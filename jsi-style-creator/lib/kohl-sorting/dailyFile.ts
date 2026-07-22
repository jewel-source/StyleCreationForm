import ExcelJS from 'exceljs'
import type { ParsedDsco } from './dsco'
import type { LineItem, PdfPage } from './pdf'
import type { SkuCatalogEntry } from './skuCatalog'

export interface OrderGroup {
  orderNo: string
  lineItems: LineItem[]
  /** 0-based original PDF page indices belonging to this order, in original relative order. */
  pageIndices: number[]
}

/**
 * Groups the sorted PDF pages into one entry per order (merging multi-page
 * orders), in the order they first appear in the DSCO PO-order sequence.
 * This is just a grouping pass — the actual output sequence (Sr#/INV#
 * numbering, PDF page order) is decided afterward by
 * `sortOrdersForFulfillment`.
 *
 * Line items come from the DSCO export when it's the line-item-detail shape
 * (po_number + line_item_upc/qty/cost are richer/more reliable than the PDF
 * heuristic parse); otherwise they come from the PDF's own per-page parse,
 * since the shipping-import shape carries no line items of its own.
 */
export function buildOrderGroups(sortedIndices: number[], pages: PdfPage[], dsco: ParsedDsco): OrderGroup[] {
  const groups: OrderGroup[] = []
  const groupIndexByOrder = new Map<string, number>()

  const ensureGroup = (orderNo: string): OrderGroup => {
    let gi = groupIndexByOrder.get(orderNo)
    if (gi === undefined) {
      gi = groups.length
      groupIndexByOrder.set(orderNo, gi)
      groups.push({ orderNo, lineItems: [], pageIndices: [] })
    }
    return groups[gi]
  }

  if (dsco.shape === 'line-item-detail') {
    const rowsByPo = new Map<string, Record<string, any>[]>()
    for (const row of dsco.rows) {
      const po = String(row['po_number'] ?? '').trim()
      if (!po) continue
      if (!rowsByPo.has(po)) rowsByPo.set(po, [])
      rowsByPo.get(po)!.push(row)
    }

    for (const idx of sortedIndices) {
      const page = pages[idx]
      const orderNo = page.orderNo ?? `UNKNOWN_PAGE_${page.pageNo}`
      const group = ensureGroup(orderNo)
      group.pageIndices.push(idx)
      if (group.lineItems.length > 0) continue // already populated from this order's first page

      for (const row of rowsByPo.get(orderNo) ?? []) {
        const qty = parseInt(row['line_item_quantity'], 10) || 0
        group.lineItems.push({
          skuNum: String(row['line_item_sku'] ?? '').trim(),
          upc: String(row['line_item_upc'] ?? '').trim(),
          description: String(row['line_item_title'] ?? '').trim(),
          qtyOrd: qty,
          qtySent: qty,
          unitCost: parseFloat(row['line_item_expected_cost']) || 0,
        })
      }
    }
  } else {
    for (const idx of sortedIndices) {
      const page = pages[idx]
      const orderNo = page.orderNo ?? `UNKNOWN_PAGE_${page.pageNo}`
      const group = ensureGroup(orderNo)
      group.pageIndices.push(idx)
      group.lineItems.push(...page.lineItems)
    }
  }

  return groups
}

export interface SortOrdersResult {
  /** Final fulfillment sequence — empty if blocked by missingUpcs/emptyOrders. */
  sorted: OrderGroup[]
  missingUpcs: string[]
  emptyOrders: string[]
}

/**
 * Final fulfillment ordering, replacing DSCO PO order as the sequence that
 * drives Sr#/INV# numbering and the output PDF's page order: single-line-
 * item orders are sorted alphabetically by their one line's Right Click
 * Style # (grouping same-style orders together for efficient picking);
 * multi-line orders can't be sorted by a single style, so they're appended
 * at the end, keeping their relative DSCO PO order.
 */
export function sortOrdersForFulfillment(
  orders: OrderGroup[],
  skuMap: Map<string, SkuCatalogEntry>
): SortOrdersResult {
  const emptyOrders: string[] = []
  const missingUpcs = new Set<string>()
  const singleLine: { order: OrderGroup; rightClickStyle: string }[] = []
  const multiLine: OrderGroup[] = []

  for (const order of orders) {
    if (order.lineItems.length === 0) {
      emptyOrders.push(order.orderNo)
      continue
    }
    for (const item of order.lineItems) {
      if (!skuMap.get(item.upc)) missingUpcs.add(item.upc)
    }
    if (order.lineItems.length === 1) {
      const entry = skuMap.get(order.lineItems[0].upc)
      singleLine.push({ order, rightClickStyle: entry?.rightClickStyleNumber ?? '' })
    } else {
      multiLine.push(order)
    }
  }

  if (emptyOrders.length > 0 || missingUpcs.size > 0) {
    return { sorted: [], missingUpcs: [...missingUpcs], emptyOrders }
  }

  singleLine.sort((a, b) => a.rightClickStyle.localeCompare(b.rightClickStyle))
  return { sorted: [...singleLine.map(s => s.order), ...multiLine], missingUpcs: [], emptyOrders: [] }
}

/**
 * Order # -> Customer name, joined from the DSCO export. Line-item-detail
 * shape (.xls) carries `ship_first_name`/`ship_last_name` keyed by
 * `po_number`; shipping-import shape (.csv) carries `ShipToCompanyorName`
 * keyed by `Reference1`. Either way the join key matches the PDF's `Order #`.
 */
export function buildCustomerByOrder(dsco: ParsedDsco): Map<string, string> {
  const map = new Map<string, string>()

  if (dsco.shape === 'line-item-detail') {
    for (const row of dsco.rows) {
      const po = String(row['po_number'] ?? '').trim()
      if (!po || map.has(po)) continue
      const name = `${String(row['ship_first_name'] ?? '').trim()} ${String(row['ship_last_name'] ?? '').trim()}`.trim()
      if (name) map.set(po, name)
    }
  } else {
    for (const row of dsco.rows) {
      const ref = String(row['Reference1'] ?? '').trim()
      if (!ref || map.has(ref)) continue
      const name = String(row['ShipToCompanyorName'] ?? '').trim()
      if (name) map.set(ref, name)
    }
  }

  return map
}

export interface DailyFileRow {
  srNo: number
  date: Date
  customer: string
  orderNo: string
  jsStyleNo: string
  orderPcs: number
  cost: number
  price: number
  invNo: number
  customerSku: string
  rightClickStyleNo: string
}

/**
 * One row per line item per order, sequential Sr#/INV# per *order* (not per
 * line item — every row belonging to an order repeats the same Sr#/INV#).
 * `Date` is the batch's processing date, repeated on every row of this run
 * (not per-order, not per-line-item). `Price = Cost × Order Pcs.` per spec.
 *
 * `orders` must already be validated (no empty orders, no missing UPCs) via
 * `sortOrdersForFulfillment` — this only builds rows in the given sequence.
 */
export function buildDetailRows(
  orders: OrderGroup[],
  skuMap: Map<string, SkuCatalogEntry>,
  customerByOrder: Map<string, string>,
  startInvoice: number,
  processDate: Date
): DailyFileRow[] {
  const rows: DailyFileRow[] = []

  orders.forEach((order, i) => {
    const srNo = i + 1
    const invNo = startInvoice + i
    const customer = customerByOrder.get(order.orderNo) ?? ''
    for (const item of order.lineItems) {
      const entry = skuMap.get(item.upc)!
      rows.push({
        srNo,
        date: processDate,
        customer,
        orderNo: order.orderNo,
        jsStyleNo: entry.styleNumber,
        orderPcs: item.qtyOrd,
        cost: entry.cost,
        price: entry.cost * item.qtyOrd,
        invNo,
        customerSku: item.upc,
        rightClickStyleNo: entry.rightClickStyleNumber,
      })
    }
  })

  return rows
}

export interface StyleWiseSummary {
  style: string
  totalQty: number
  multipleLineQty: number
}

/**
 * Per-style Total Qty + Multiple Line Qty, feeding both Style Wise and
 * Style Wise2. Grouped and sorted by Right Click Style # (not JS Style #) —
 * same key the fulfillment sort uses, so the summary lines up with the
 * Sheet1 row order and the PDF page order. **Confirmed** rule from the
 * spec: group rows by INV # (i.e. by order) — if an order has more than one
 * row, every one of its rows counts toward Multiple Line Qty for its style;
 * single-line orders count only toward Total Qty.
 */
export function buildStyleWiseSummary(rows: DailyFileRow[]): StyleWiseSummary[] {
  const rowCountByInv = new Map<number, number>()
  for (const r of rows) {
    rowCountByInv.set(r.invNo, (rowCountByInv.get(r.invNo) ?? 0) + 1)
  }

  const byStyle = new Map<string, StyleWiseSummary>()
  for (const r of rows) {
    const key = r.rightClickStyleNo || '(unmatched)'
    if (!byStyle.has(key)) byStyle.set(key, { style: r.jsStyleNo || '(unmatched)', totalQty: 0, multipleLineQty: 0 })
    const s = byStyle.get(key)!
    s.totalQty += r.orderPcs
    if ((rowCountByInv.get(r.invNo) ?? 0) > 1) {
      s.multipleLineQty += r.orderPcs
    }
  }

  return [...byStyle.entries()]
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([, summary]) => summary)
}

const SHEET1_HEADERS = [
  'Sr #', 'Date', 'Customer', 'Order #', 'JS Style #', 'Order Pcs.', 'Cost', 'Price',
  'Service', 'Tracking #', 'INV #', 'Customer Sku', 'Right Click Style #',
]

function styleTitleAndHeader(sheet: ExcelJS.Worksheet, title: string) {
  const dateRow = sheet.addRow(['Date', new Date().toLocaleDateString('en-US')])
  dateRow.font = { bold: true }
  sheet.addRow([title]).font = { bold: true, size: 14 }
  sheet.addRow([])
}

export async function generateWorkbook(
  rows: DailyFileRow[],
  summary: StyleWiseSummary[],
  company: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()

  const sheet1 = workbook.addWorksheet('Sheet1')
  styleTitleAndHeader(sheet1, `${company} Daily File`)
  const headerRow = sheet1.addRow(SHEET1_HEADERS)
  headerRow.font = { bold: true }
  for (const r of rows) {
    sheet1.addRow([
      r.srNo, r.date.toLocaleDateString('en-US'), r.customer, r.orderNo, r.jsStyleNo,
      r.orderPcs, r.cost, r.price, '', '', r.invNo, r.customerSku, r.rightClickStyleNo,
    ])
  }
  sheet1.columns.forEach(col => { col.width = 16 })

  const styleWise = workbook.addWorksheet('Style Wise')
  styleTitleAndHeader(styleWise, `${company} Style Wise`)
  const swHeader = styleWise.addRow(['Style', 'Qty'])
  swHeader.font = { bold: true }
  let grandTotalQty = 0
  for (const s of summary) {
    styleWise.addRow([s.style, s.totalQty])
    grandTotalQty += s.totalQty
  }
  styleWise.addRow(['Grand Total', grandTotalQty]).font = { bold: true }

  styleWise.addRow([])
  styleWise.addRow(['Multiple Line Pcs.']).font = { bold: true, size: 12 }
  const mlHeader = styleWise.addRow(['Style', 'Qty'])
  mlHeader.font = { bold: true }
  let grandTotalMultiLine = 0
  for (const s of summary.filter(s => s.multipleLineQty > 0)) {
    styleWise.addRow([s.style, s.multipleLineQty])
    grandTotalMultiLine += s.multipleLineQty
  }
  styleWise.addRow(['Grand Total', grandTotalMultiLine]).font = { bold: true }
  styleWise.columns.forEach(col => { col.width = 20 })

  const styleWise2 = workbook.addWorksheet('Style Wise2')
  styleTitleAndHeader(styleWise2, `${company} Style Wise 2`)
  const sw2Header = styleWise2.addRow(['Style', 'Total Qty', 'Multiple Line Qty'])
  sw2Header.font = { bold: true }
  let sw2TotalQty = 0
  let sw2MultiLineQty = 0
  for (const s of summary) {
    styleWise2.addRow([s.style, s.totalQty, s.multipleLineQty])
    sw2TotalQty += s.totalQty
    sw2MultiLineQty += s.multipleLineQty
  }
  styleWise2.addRow(['Grand Total', sw2TotalQty, sw2MultiLineQty]).font = { bold: true }
  styleWise2.columns.forEach(col => { col.width = 20 })

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
