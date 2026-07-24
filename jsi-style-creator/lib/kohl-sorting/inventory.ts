import * as XLSX from 'xlsx'

const STYLE_HEADER = 'Style #'
const BALANCE_HEADER = 'Balance on Hand'

/** Strips the pivot-table " Total" suffix the Inventory export appends to each style's row label (e.g. "AABR100A0148 Total" -> "AABR100A0148"). */
function stripTotalSuffix(s: string): string {
  return s.replace(/\s*total\s*$/i, '').trim()
}

/**
 * Parses the team's daily Inventory file (pivot-table shaped — one row per
 * JS Style #, with a " Total" suffix on the style label) into a
 * JS Style # -> Balance On Hand map, for the negative-stock cross-check in
 * dailyFile.ts's `reorderForNegativeStock`. Confirmed 2026-07-24 against a
 * real Inventory export — "Style #" and "Balance on Hand" are the literal
 * headers, matched against JS Style # (not UPC).
 *
 * The real file (the "Kohls Inventory Master File") has a few title/banner
 * rows above the actual header row ("Starts from 1st Jan 2026", etc.), so
 * the header row isn't row 1 — it's scanned for by content instead of
 * assumed to be first.
 */
export function parseInventoryFile(buf: Buffer, filename: string): Map<string, number> {
  const workbook = XLSX.read(buf, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error(`${filename}: no sheets found`)
  const sheet = workbook.Sheets[sheetName]
  const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  const headerRowIndex = grid.findIndex(row =>
    row.some(cell => String(cell).trim() === STYLE_HEADER) &&
    row.some(cell => String(cell).trim() === BALANCE_HEADER)
  )
  if (headerRowIndex === -1) {
    throw new Error(`${filename}: couldn't find a header row containing "${STYLE_HEADER}" and "${BALANCE_HEADER}" columns`)
  }

  const headerRow = grid[headerRowIndex]
  const styleCol = headerRow.findIndex(cell => String(cell).trim() === STYLE_HEADER)
  const balanceCol = headerRow.findIndex(cell => String(cell).trim() === BALANCE_HEADER)

  const balanceByStyle = new Map<string, number>()
  for (const row of grid.slice(headerRowIndex + 1)) {
    const style = stripTotalSuffix(String(row[styleCol] ?? ''))
    if (!style) continue
    const balance = parseFloat(String(row[balanceCol] ?? '').replace(/,/g, '')) || 0
    balanceByStyle.set(style, balance)
  }

  return balanceByStyle
}
