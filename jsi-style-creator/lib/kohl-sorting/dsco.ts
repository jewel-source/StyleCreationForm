import * as XLSX from 'xlsx'

export type DscoShape = 'shipping-import' | 'line-item-detail'

export interface ParsedDsco {
  shape: DscoShape
  /** Distinct po_number / Reference1 values, in first-occurrence file order. */
  poOrder: string[]
  /** Every row of the uploaded file, keyed by its original header names. */
  rows: Record<string, any>[]
}

const SHIPPING_IMPORT_MARKER = 'Reference1'
const LINE_ITEM_DETAIL_MARKER = 'po_number'

/**
 * Reads a DSCO row field, trimmed. DSCO's export writes the literal text
 * "null" into some genuinely-blank cells (confirmed 2026-07-23 against a
 * real file — e.g. a blank `ship_address_2`) instead of leaving them empty,
 * so that gets normalized to '' too.
 */
export function dscoField(row: Record<string, any>, key: string): string {
  const s = String(row[key] ?? '').trim()
  return s.toLowerCase() === 'null' ? '' : s
}

export function parseDscoFile(buf: Buffer, filename: string): ParsedDsco {
  const workbook = XLSX.read(buf, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error(`${filename}: no sheets found`)
  const sheet = workbook.Sheets[sheetName]
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  if (rows.length === 0) throw new Error(`${filename}: no data rows found`)

  const headers = Object.keys(rows[0])
  let shape: DscoShape
  let poField: string
  if (headers.includes(LINE_ITEM_DETAIL_MARKER)) {
    shape = 'line-item-detail'
    poField = LINE_ITEM_DETAIL_MARKER
  } else if (headers.includes(SHIPPING_IMPORT_MARKER)) {
    shape = 'shipping-import'
    poField = SHIPPING_IMPORT_MARKER
  } else {
    throw new Error(
      `${filename}: couldn't detect DSCO export shape — expected a ` +
      `"${LINE_ITEM_DETAIL_MARKER}" or "${SHIPPING_IMPORT_MARKER}" column, found: ${headers.join(', ')}`
    )
  }

  const seen = new Set<string>()
  const poOrder: string[] = []
  for (const row of rows) {
    const po = String(row[poField] ?? '').trim()
    if (!po || seen.has(po)) continue
    seen.add(po)
    poOrder.push(po)
  }

  return { shape, poOrder, rows }
}
