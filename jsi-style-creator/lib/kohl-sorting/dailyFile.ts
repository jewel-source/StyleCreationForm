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

/**
 * Order # -> Service, joined from the DSCO export's `shipping_service_level_code`
 * column. Same po-field-per-shape join as `buildCustomerByOrder`; falls back to
 * blank if the row has no value for it (e.g. shipping-import shape rows that
 * don't carry this field).
 */
export function buildServiceByOrder(dsco: ParsedDsco): Map<string, string> {
  const map = new Map<string, string>()
  const poField = dsco.shape === 'line-item-detail' ? 'po_number' : 'Reference1'

  for (const row of dsco.rows) {
    const po = String(row[poField] ?? '').trim()
    if (!po || map.has(po)) continue
    const service = String(row['shipping_service_level_code'] ?? '').trim()
    if (service) map.set(po, service)
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
  service: string
  invNo: number
  customerSku: string
  rightClickStyleNo: string
}

/**
 * One row per line item per order, sequential Sr# per *order* (not per line
 * item — every row belonging to an order repeats the same Sr#). `INV #` is
 * NOT per-order — it's a single invoice number for the whole file, supplied
 * by the team and repeated on every row (confirmed 2026-07-23; there is no
 * relationship between invoice number and order number). `Date` is the
 * batch's processing date, repeated on every row of this run (not per-order,
 * not per-line-item). `Price = Cost × Order Pcs.` per spec.
 *
 * `orders` must already be validated (no empty orders, no missing UPCs) via
 * `sortOrdersForFulfillment` — this only builds rows in the given sequence.
 */
export function buildDetailRows(
  orders: OrderGroup[],
  skuMap: Map<string, SkuCatalogEntry>,
  customerByOrder: Map<string, string>,
  serviceByOrder: Map<string, string>,
  invoiceNo: number,
  processDate: Date
): DailyFileRow[] {
  const rows: DailyFileRow[] = []

  orders.forEach((order, i) => {
    const srNo = i + 1
    const invNo = invoiceNo
    const customer = customerByOrder.get(order.orderNo) ?? ''
    const service = serviceByOrder.get(order.orderNo) ?? ''
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
        service,
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
 * spec: group rows by order (originally described as "by INV #", but INV #
 * is now a single file-wide value rather than per-order — `Sr #` is the
 * per-order-unique key instead) — if an order has more than one row, every
 * one of its rows counts toward Multiple Line Qty for its style; single-line
 * orders count only toward Total Qty.
 */
export function buildStyleWiseSummary(rows: DailyFileRow[]): StyleWiseSummary[] {
  const rowCountBySr = new Map<number, number>()
  for (const r of rows) {
    rowCountBySr.set(r.srNo, (rowCountBySr.get(r.srNo) ?? 0) + 1)
  }

  const byStyle = new Map<string, StyleWiseSummary>()
  for (const r of rows) {
    const key = r.rightClickStyleNo || '(unmatched)'
    if (!byStyle.has(key)) byStyle.set(key, { style: r.jsStyleNo || '(unmatched)', totalQty: 0, multipleLineQty: 0 })
    const s = byStyle.get(key)!
    s.totalQty += r.orderPcs
    if ((rowCountBySr.get(r.srNo) ?? 0) > 1) {
      s.multipleLineQty += r.orderPcs
    }
  }

  return [...byStyle.entries()]
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([, summary]) => summary)
}

const SHEET1_HEADERS = [
  'Sr #', 'Date', 'Customer', 'Order #', 'JS Style #', 'Order Pcs.', 'COST', 'Price',
  'Service', 'Tracking #', 'INV #', 'Customer Sku', 'Right Click Style #',
]
const SHEET1_COLUMN_WIDTHS = [5, 15, 28, 19, 31, 7, 13, 13, 25, 32, 11, 20, 21]
const ORDER_PCS_COL = 6

// Extracted directly from reference/daily-file-empty-template.xlsx's raw OOXML
// (xl/styles.xml + xl/theme/theme1.xml): title-block fill is theme accent-5
// (#4BACC6) tinted ~0.8 toward white; title/label text is Times New Roman
// bold, data rows are Calibri. Column-header row and data cells are NOT
// filled — only the Date/title banner is, per the real Daily File example.
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEEF4' } }
const GRAY_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFBFBF' } }
const TITLE_FONT: Partial<ExcelJS.Font> = { name: 'Times New Roman', bold: true, size: 20 }
const LABEL_FONT: Partial<ExcelJS.Font> = { name: 'Times New Roman', bold: true, size: 12 }
const HEADER_FONT: Partial<ExcelJS.Font> = { name: 'Times New Roman', bold: true, size: 12, underline: true }
const DATA_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 12 }
const BOLD_DATA_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 12, bold: true }
const CENTER: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' }

const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } }
const MEDIUM: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: 'FF000000' } }

const CURRENCY_FMT = '"$"#,##0.00'
const DATE_FMT = 'm/d/yyyy'
const TITLE_DATE_FMT = 'd-mmm-yy'

/** Thin grid over a header+data block, upgraded to medium on its outer edges and on column A's right edge (index-column divider), matching the template. */
function applyBoxBorders(sheet: ExcelJS.Worksheet, firstRow: number, lastRow: number, lastCol: number) {
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
      sheet.getRow(r).getCell(c).border = {
        top: r === firstRow ? MEDIUM : THIN,
        bottom: r === lastRow ? MEDIUM : THIN,
        left: c === 1 ? MEDIUM : THIN,
        right: (c === lastCol || c === 1) ? MEDIUM : THIN,
      }
    }
  }
}

/** Medium box border around a standalone horizontal run of cells (the Date box, the title banner). */
function boxRow(sheet: ExcelJS.Worksheet, rowNumber: number, startCol: number, endCol: number) {
  const row = sheet.getRow(rowNumber)
  for (let c = startCol; c <= endCol; c++) {
    row.getCell(c).border = {
      top: MEDIUM,
      bottom: MEDIUM,
      left: c === startCol ? MEDIUM : THIN,
      right: c === endCol ? MEDIUM : THIN,
    }
  }
}

/**
 * `Date` label/value box + a merged, centered company-title banner + a blank
 * spacer row. Both boxed elements are independent, self-contained boxes —
 * not part of the header+data table's border block below them (matches the
 * template: the Date/title boxes sit above the table, not flush with it).
 * `dateBoxCol`/`titleMergeStart`/`titleMergeEnd` let Sheet1 position these
 * like the real template (offset, not spanning the full row) while sheets
 * with no template counterpart (Style Wise/Style Wise2) default to
 * spanning the sheet's full column count.
 */
function writeTitleBlock(
  sheet: ExcelJS.Worksheet,
  title: string,
  columnCount: number,
  opts?: { dateBoxCol?: number; titleMergeStart?: number; titleMergeEnd?: number }
) {
  const dateBoxCol = opts?.dateBoxCol ?? 1
  const titleMergeStart = opts?.titleMergeStart ?? 1
  const titleMergeEnd = opts?.titleMergeEnd ?? columnCount

  const dateRow = sheet.addRow([])
  const labelCell = dateRow.getCell(dateBoxCol)
  const valueCell = dateRow.getCell(dateBoxCol + 1)
  labelCell.value = 'Date'
  valueCell.value = new Date()
  labelCell.font = LABEL_FONT
  valueCell.font = LABEL_FONT
  valueCell.numFmt = TITLE_DATE_FMT
  labelCell.alignment = CENTER
  valueCell.alignment = CENTER
  labelCell.fill = HEADER_FILL
  valueCell.fill = HEADER_FILL
  boxRow(sheet, dateRow.number, dateBoxCol, dateBoxCol + 1)

  const titleRow = sheet.addRow([])
  const titleCell = titleRow.getCell(titleMergeStart)
  titleCell.value = title
  titleCell.font = TITLE_FONT
  titleCell.alignment = CENTER
  sheet.mergeCells(titleRow.number, titleMergeStart, titleRow.number, titleMergeEnd)
  for (let c = titleMergeStart; c <= titleMergeEnd; c++) titleRow.getCell(c).fill = HEADER_FILL
  boxRow(sheet, titleRow.number, titleMergeStart, titleMergeEnd)

  sheet.addRow([])
}

export async function generateWorkbook(
  rows: DailyFileRow[],
  summary: StyleWiseSummary[],
  company: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()

  // Sheet1 — Date box + title banner positioned like the real template
  // (offset over columns I:J and C:J respectively, not spanning A:M).
  const sheet1 = workbook.addWorksheet('Sheet1')
  sheet1.views = [{ showGridLines: false }]
  writeTitleBlock(sheet1, `${company}.COM`, SHEET1_HEADERS.length, {
    dateBoxCol: 9, titleMergeStart: 3, titleMergeEnd: 10,
  })
  const headerRow = sheet1.addRow(SHEET1_HEADERS)
  headerRow.font = HEADER_FONT
  headerRow.eachCell(cell => { cell.alignment = { ...CENTER, wrapText: true } })

  for (const r of rows) {
    const row = sheet1.addRow([
      r.srNo, r.date, r.customer, r.orderNo, r.jsStyleNo,
      r.orderPcs, r.cost, r.price, r.service, '', r.invNo, r.customerSku, r.rightClickStyleNo,
    ])
    row.font = DATA_FONT
    row.eachCell(cell => { cell.alignment = CENTER })
    row.getCell(2).numFmt = DATE_FMT
    row.getCell(7).numFmt = CURRENCY_FMT
    row.getCell(8).numFmt = CURRENCY_FMT
    row.getCell(ORDER_PCS_COL).fill = GRAY_FILL
  }
  applyBoxBorders(sheet1, headerRow.number, sheet1.lastRow!.number, SHEET1_HEADERS.length)
  SHEET1_COLUMN_WIDTHS.forEach((w, i) => { sheet1.getColumn(i + 1).width = w })

  // Style Wise
  const styleWise = workbook.addWorksheet('Style Wise')
  styleWise.views = [{ showGridLines: false }]
  writeTitleBlock(styleWise, `${company} Style Wise`, 2)
  const swHeader = styleWise.addRow(['Style', 'Qty'])
  swHeader.font = HEADER_FONT
  swHeader.eachCell(cell => { cell.alignment = CENTER })

  let grandTotalQty = 0
  for (const s of summary) {
    const row = styleWise.addRow([s.style, s.totalQty])
    row.font = DATA_FONT
    row.eachCell(cell => { cell.alignment = CENTER })
    grandTotalQty += s.totalQty
  }
  const swTotalRow = styleWise.addRow(['Grand Total', grandTotalQty])
  swTotalRow.font = BOLD_DATA_FONT
  swTotalRow.eachCell(cell => { cell.alignment = CENTER })
  applyBoxBorders(styleWise, swHeader.number, swTotalRow.number, 2)

  styleWise.addRow([])
  const mlLabelRow = styleWise.addRow(['Multiple Line Pcs.'])
  mlLabelRow.getCell(1).font = LABEL_FONT
  mlLabelRow.getCell(1).alignment = CENTER
  styleWise.mergeCells(mlLabelRow.number, 1, mlLabelRow.number, 2)
  mlLabelRow.getCell(1).fill = HEADER_FILL
  mlLabelRow.getCell(2).fill = HEADER_FILL
  boxRow(styleWise, mlLabelRow.number, 1, 2)

  const mlHeader = styleWise.addRow(['Style', 'Qty'])
  mlHeader.font = HEADER_FONT
  mlHeader.eachCell(cell => { cell.alignment = CENTER })

  let grandTotalMultiLine = 0
  for (const s of summary.filter(s => s.multipleLineQty > 0)) {
    const row = styleWise.addRow([s.style, s.multipleLineQty])
    row.font = DATA_FONT
    row.eachCell(cell => { cell.alignment = CENTER })
    grandTotalMultiLine += s.multipleLineQty
  }
  const mlTotalRow = styleWise.addRow(['Grand Total', grandTotalMultiLine])
  mlTotalRow.font = BOLD_DATA_FONT
  mlTotalRow.eachCell(cell => { cell.alignment = CENTER })
  applyBoxBorders(styleWise, mlHeader.number, mlTotalRow.number, 2)

  styleWise.getColumn(1).width = 24
  styleWise.getColumn(2).width = 12

  // Style Wise2
  const styleWise2 = workbook.addWorksheet('Style Wise2')
  styleWise2.views = [{ showGridLines: false }]
  writeTitleBlock(styleWise2, `${company} Style Wise 2`, 3)
  const sw2Header = styleWise2.addRow(['Style', 'Total Qty', 'Multiple Line Qty'])
  sw2Header.font = HEADER_FONT
  sw2Header.eachCell(cell => { cell.alignment = { ...CENTER, wrapText: true } })

  let sw2TotalQty = 0
  let sw2MultiLineQty = 0
  for (const s of summary) {
    const row = styleWise2.addRow([s.style, s.totalQty, s.multipleLineQty])
    row.font = DATA_FONT
    row.eachCell(cell => { cell.alignment = CENTER })
    sw2TotalQty += s.totalQty
    sw2MultiLineQty += s.multipleLineQty
  }
  const sw2TotalRow = styleWise2.addRow(['Grand Total', sw2TotalQty, sw2MultiLineQty])
  sw2TotalRow.font = BOLD_DATA_FONT
  sw2TotalRow.eachCell(cell => { cell.alignment = CENTER })
  applyBoxBorders(styleWise2, sw2Header.number, sw2TotalRow.number, 3)

  styleWise2.getColumn(1).width = 24
  styleWise2.getColumn(2).width = 14
  styleWise2.getColumn(3).width = 18

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
