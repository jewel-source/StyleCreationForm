import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import {
  fetchAll, SC_BASE,
  TBL_STONE_TYPE, TBL_CATEGORY, TBL_COLORSTONE, TBL_METAL, TBL_SIZE, TBL_VENDOR,
} from '@/lib/nocodb'
import { NO_SIZE_CATS, SIZE_CATS, GEMSTONE_TYPES, buildStyleNumber, buildMidCode } from '@/lib/styleRules'
import { getUidState, allocateUids, formatUid, type UidState } from '@/lib/uid'

// ── Template layout ─────────────────────────────────────────────────────────

export const STYLES_SHEET = 'Styles'
const LISTS_SHEET = 'Lists'
const TEMPLATE_ROWS = 500

type ColKey = 'stoneType' | 'category' | 'metal' | 'size' | 'ctw' | 'colorstone' | 'vendorName' | 'vendorStyle' | 'uid'

const COLUMNS: { key: ColKey; header: string; required: boolean; width: number; note: string }[] = [
  { key: 'stoneType',   header: 'Stone Type',     required: true,  width: 26, note: 'Pick from the list' },
  { key: 'category',    header: 'Category',       required: true,  width: 16, note: 'Pick from the list' },
  { key: 'metal',       header: 'Metal',          required: true,  width: 22, note: 'Pick from the list' },
  { key: 'size',        header: 'Size',           required: false, width: 22, note: 'Required for Ring, Bracelet, Necklace, Bangle, Band. Leave blank for other categories (X is used).' },
  { key: 'ctw',         header: 'CTW',            required: false, width: 10, note: 'Required unless the stone type is Natural Gemstone / Lab Gem. e.g. 0.50' },
  { key: 'colorstone',  header: 'Colorstone',     required: false, width: 22, note: 'Required for Natural Gemstone / Lab Gem only; leave blank otherwise.' },
  { key: 'vendorName',  header: 'Vendor Name',    required: true,  width: 24, note: 'Pick from the list' },
  { key: 'vendorStyle', header: 'Vendor Style#',  required: true,  width: 18, note: 'e.g. OR6094400' },
  { key: 'uid',         header: 'UID (optional)', required: false, width: 16, note: 'Leave blank to auto-assign. Or enter exactly 4 digits, e.g. 0123.' },
]

// ── NocoDB lookups ──────────────────────────────────────────────────────────

export interface Option { id: number; name: string; code: string; label: string; raw: any }

function toOpt(r: any, labelKey: string): Option {
  const name = String(r[labelKey] || `ID ${r.Id}`).trim()
  const code = String(r['Style # Code'] || '').trim()
  return { id: r.Id, name, code, label: code ? `${code}-${name}` : name, raw: r }
}

export interface Lookups {
  stoneTypes: Option[]
  categories: Option[]
  colorstones: Option[]
  metals: Option[]
  sizes: Option[]
  vendors: Option[]
}

export async function loadLookups(): Promise<Lookups> {
  const [stoneTypes, categories, colorstones, metals, sizes, vendors] = await Promise.all([
    fetchAll(SC_BASE, TBL_STONE_TYPE),
    fetchAll(SC_BASE, TBL_CATEGORY),
    fetchAll(SC_BASE, TBL_COLORSTONE),
    fetchAll(SC_BASE, TBL_METAL),
    fetchAll(SC_BASE, TBL_SIZE),
    fetchAll(SC_BASE, TBL_VENDOR),
  ])
  return {
    stoneTypes:  stoneTypes.map(r => toOpt(r, 'Stone Type')),
    categories:  categories.map(r => toOpt(r, r['Categories'] ? 'Categories' : 'Category')),
    colorstones: colorstones.map(r => toOpt(r, 'Colorstone')),
    metals:      metals.map(r => toOpt(r, 'Metal')),
    sizes:       sizes.map(r => toOpt(r, r['Size Selection'] ? 'Size Selection' : 'Size')),
    vendors:     vendors.map(r => toOpt(r, 'Vendor name')),
  }
}

// Same filtering the single-style form applies when a category is picked.
function sizesForCategory(sizes: Option[], catName: string): Option[] {
  if (NO_SIZE_CATS.includes(catName)) return sizes.filter(s => s.code === 'X')
  if (SIZE_CATS.includes(catName))    return sizes.filter(s => s.name.includes(catName) || s.code === 'X')
  return sizes
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

// Accepts the plain name ("Lab Diamond"), the dropdown label ("L-Lab Diamond")
// or the bare Style # code, in that order of preference.
function matchOption(list: Option[], value: string, field: string): { opt?: Option; error?: string } {
  const v = norm(value)
  const byName = list.find(o => norm(o.name) === v)
  if (byName) return { opt: byName }
  const byLabel = list.find(o => norm(o.label) === v)
  if (byLabel) return { opt: byLabel }
  const byCode = list.filter(o => o.code && norm(o.code) === v)
  if (byCode.length === 1) return { opt: byCode[0] }
  if (byCode.length > 1) return { error: `${field} "${value}" is ambiguous — use the full name` }
  return { error: `${field} "${value}" not found` }
}

// Size labels look like "7 | 7 | Ring,Band". NocoDB builds the trailing
// category list itself and its order isn't stable between requests, so sizes
// are matched on the "size | code" part only.
const sizeKey = (s: string) => norm(s.split('|').slice(0, 2).join('|').replace(/\s*\|\s*/g, '|'))

function matchSize(list: Option[], value: string): { opt?: Option; error?: string } {
  if (value.includes('|')) {
    const opt = list.find(o => sizeKey(o.name) === sizeKey(value))
    if (opt) return { opt }
  }
  return matchOption(list, value, 'Size')
}

// ── Template ────────────────────────────────────────────────────────────────

export async function buildTemplate(lookups: Lookups): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(STYLES_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] })
  const lists = wb.addWorksheet(LISTS_SHEET)
  const help = wb.addWorksheet('Instructions')

  ws.columns = COLUMNS.map(c => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }))
  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FF1A1A2E' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8C97A' } }
  header.height = 22
  COLUMNS.forEach((c, i) => { header.getCell(i + 1).note = c.note })

  // Text format so Excel keeps leading zeros on UIDs and vendor style numbers.
  ws.getColumn('uid').numFmt = '@'
  ws.getColumn('vendorStyle').numFmt = '@'

  const listCols: { key: ColKey; title: string; values: string[] }[] = [
    { key: 'stoneType',  title: 'Stone Type', values: lookups.stoneTypes.map(o => o.name) },
    { key: 'category',   title: 'Category',   values: lookups.categories.map(o => o.name) },
    { key: 'metal',      title: 'Metal',      values: lookups.metals.map(o => o.name) },
    { key: 'size',       title: 'Size',       values: lookups.sizes.map(o => o.name) },
    { key: 'colorstone', title: 'Colorstone', values: lookups.colorstones.map(o => o.name) },
    { key: 'vendorName', title: 'Vendor',     values: lookups.vendors.map(o => o.name) },
  ]
  listCols.forEach((lc, i) => {
    const col = lists.getColumn(i + 1)
    col.width = 28
    lists.getCell(1, i + 1).value = lc.title
    lists.getCell(1, i + 1).font = { bold: true }
    lc.values.forEach((v, r) => { lists.getCell(r + 2, i + 1).value = v })

    if (lc.values.length === 0) return
    const letter = col.letter
    const formula = `${LISTS_SHEET}!$${letter}$2:$${letter}$${lc.values.length + 1}`
    const wsCol = ws.getColumn(lc.key)
    for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) {
      ws.getCell(r, wsCol.number).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorTitle: `Invalid ${lc.title}`,
        error: `Pick a ${lc.title} from the list (see the ${LISTS_SHEET} sheet).`,
      }
    }
  })

  help.getColumn(1).width = 110
  const lines = [
    'How to bulk-create styles',
    '',
    `1. Fill one style per row on the "${STYLES_SHEET}" sheet. Columns marked * are required. Do not rename or reorder the headers.`,
    `2. Stone Type, Category, Metal, Size, Colorstone and Vendor Name must match a value on the "${LISTS_SHEET}" sheet (use the cell dropdowns).`,
    '3. Size: required for Ring, Bracelet, Necklace, Bangle and Band. Leave it blank for other categories — size X is used automatically.',
    '4. CTW: required for diamond / no-stone types (e.g. 0.50 becomes 0050, 2.50 becomes 0250, 250 becomes 2500 in the Style #). Colorstone: required for Natural Gemstone and Lab Gem only.',
    '5. UID: leave blank to auto-assign the next free UID (multiple rows of the same stone type + category get consecutive UIDs). To force a UID, type exactly 4 digits.',
    '6. Click "Upload Excel" on the Style Creation page. You will see every style that is about to be created, with its Style # and UID, before anything is saved.',
    '',
    'Example rows:',
    'Lab Diamond | Ring | 14K White Gold | Ring Size 7 | 0.50 |  | Acme Jewels | OR6094400 |',
    'Natural Gemstone | Pendant | 14K Yellow Gold |  |  | Sapphire | Acme Jewels | PD1100 | 0123',
  ]
  lines.forEach((l, i) => {
    const cell = help.getCell(i + 1, 1)
    cell.value = l
    if (i === 0) cell.font = { bold: true, size: 14 }
  })

  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ── Parse + resolve ─────────────────────────────────────────────────────────

export type RowInput = Record<ColKey, string>

export interface SubmitBody {
  stoneTypeId: number
  categoryId: number
  metalId: number
  sizeId: number
  colorstoneId: string | null
  ctw: string | null
  uidNumber: number
  manualUid: boolean
  styleNum: string
  stName: string
  catName: string
  vendorName: string
  vendorStyle: string
}

export interface BulkRow {
  rowNum: number                 // Excel row number, for error messages
  input: RowInput
  display: { stoneType: string; category: string; metal: string; size: string; colorstone: string; vendor: string }
  uidDisplay: string
  uidSource: 'auto' | 'manual' | ''
  isNewRecord: boolean
  styleNum: string | null
  errors: string[]
  submit: SubmitBody | null      // body for /api/submit; null when the row has errors
}

const normHeader = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase()

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

export function readRows(buf: Buffer, filename: string): { rowNum: number; input: RowInput }[] {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === STYLES_SHEET.toLowerCase()) || wb.SheetNames[0]
  if (!sheetName) throw new Error(`${filename}: no sheets found`)
  const grid: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false })

  const wanted = COLUMNS.map(c => ({ key: c.key, h: normHeader(c.header.replace('(optional)', '')) }))
  const headerIdx = grid.findIndex(row => {
    const hs = row.map(c => normHeader(String(c).replace('*', '').replace('(optional)', '')))
    return hs.includes('stonetype') && hs.includes('vendorstyle')
  })
  if (headerIdx === -1) {
    throw new Error(`${filename}: couldn't find the header row. Download the template and keep its headers.`)
  }

  const headerRow = grid[headerIdx].map(c => normHeader(String(c).replace('*', '').replace('(optional)', '')))
  const colIdx = {} as Record<ColKey, number>
  for (const w of wanted) {
    colIdx[w.key] = headerRow.indexOf(w.h)
    const col = COLUMNS.find(c => c.key === w.key)!
    if (colIdx[w.key] === -1 && col.required) {
      throw new Error(`${filename}: missing required column "${col.header}"`)
    }
  }

  const out: { rowNum: number; input: RowInput }[] = []
  grid.slice(headerIdx + 1).forEach((row, i) => {
    const input = {} as RowInput
    for (const w of wanted) input[w.key] = colIdx[w.key] === -1 ? '' : cellText(row[colIdx[w.key]])
    if (Object.values(input).every(v => v === '')) return
    out.push({ rowNum: headerIdx + i + 2, input })
  })
  return out
}

export async function resolveRows(raw: { rowNum: number; input: RowInput }[], lookups: Lookups): Promise<BulkRow[]> {
  type Work = BulkRow & {
    ids?: { st: Option; cat: Option; metal: Option; size: Option; colorstone?: Option; vendor: Option }
    midCode?: string
    manualNum?: number
  }

  const rows: Work[] = raw.map(({ rowNum, input }) => {
    const errors: string[] = []
    const need = (key: ColKey, label: string) => { if (!input[key]) errors.push(`${label} is required`) }
    need('stoneType', 'Stone Type'); need('category', 'Category'); need('metal', 'Metal')
    need('vendorName', 'Vendor Name'); need('vendorStyle', 'Vendor Style#')

    const pick = (list: Option[], key: ColKey, label: string) => {
      if (!input[key]) return undefined
      const { opt, error } = matchOption(list, input[key], label)
      if (error) errors.push(error)
      return opt
    }
    const st     = pick(lookups.stoneTypes, 'stoneType', 'Stone Type')
    const cat    = pick(lookups.categories, 'category', 'Category')
    const metal  = pick(lookups.metals, 'metal', 'Metal')
    const vendor = pick(lookups.vendors, 'vendorName', 'Vendor')

    let size: Option | undefined
    if (cat) {
      const allowed = sizesForCategory(lookups.sizes, cat.name)
      if (NO_SIZE_CATS.includes(cat.name)) {
        size = allowed[0]
        if (!size) errors.push('Size "X" record not found in NocoDB')
      } else if (!input.size) {
        errors.push(`Size is required for ${cat.name}`)
      } else {
        const { opt, error } = matchSize(allowed, input.size)
        if (error) errors.push(`${error} for ${cat.name}`)
        size = opt
      }
    }

    let colorstone: Option | undefined
    const isGem = !!st && GEMSTONE_TYPES.includes(st.name)
    if (st) {
      if (isGem) {
        if (!input.colorstone) errors.push(`Colorstone is required for ${st.name}`)
        else colorstone = pick(lookups.colorstones, 'colorstone', 'Colorstone')
      } else if (input.colorstone) {
        errors.push(`Colorstone only applies to ${GEMSTONE_TYPES.join(' / ')}`)
      }
    }

    if (input.ctw) {
      const n = Number(input.ctw)
      if (isNaN(n) || n < 0) errors.push(`CTW "${input.ctw}" is not a valid number`)
      else if (!isGem && n >= 10000) errors.push(`CTW ${input.ctw} is too large (max 9999)`)
    } else if (st && !isGem) {
      errors.push(`CTW is required for ${st.name}`)
    }

    let manualNum: number | undefined
    if (input.uid) {
      if (/^[0-9]{1,4}$/.test(input.uid)) manualNum = parseInt(input.uid, 10)
      else errors.push(`UID "${input.uid}" must be exactly 4 digits`)
    }

    const row: Work = {
      rowNum, input, errors,
      display: {
        stoneType:  st?.name     ?? input.stoneType,
        category:   cat?.name    ?? input.category,
        metal:      metal?.name  ?? input.metal,
        size:       size?.name   ?? input.size,
        colorstone: colorstone?.name ?? input.colorstone,
        vendor:     vendor?.name ?? input.vendorName,
      },
      uidDisplay: '', uidSource: '', isNewRecord: false, styleNum: null, submit: null,
      manualNum,
    }

    if (st && cat && metal && size && vendor && errors.length === 0) {
      row.ids = { st, cat, metal, size, colorstone, vendor }
      row.midCode = buildMidCode(st.name, input.ctw, colorstone?.code || '')
      // Check length with a placeholder UID so bad rows never consume a UID.
      const probe = buildStyleNumber(st.code, cat.code, row.midCode, metal.code, 0, size.code)
      if (!probe) errors.push('Missing a Style # code on one of the selected values')
      else if (probe.length !== 13) errors.push(`Style # would be ${probe.length} chars (must be 13): ${probe}`)
    }
    return row
  })

  // Assign UIDs per stone type + category, in sheet order.
  const groups = new Map<string, Work[]>()
  for (const r of rows) {
    if (!r.ids || r.errors.length) continue
    const key = `${r.ids.st.name}|${r.ids.cat.name}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  await Promise.all([...groups.values()].map(async group => {
    const { st, cat } = group[0].ids!
    let state: UidState
    try {
      state = await getUidState(st.name, cat.name)
    } catch (e: any) {
      group.forEach(r => r.errors.push(e.message))
      return
    }

    const manualSeen = new Map<number, number>()
    for (const r of group) {
      if (r.manualNum === undefined) continue
      const label = String(r.manualNum).padStart(4, '0')
      if (state.takenNums.has(r.manualNum)) {
        r.errors.push(`UID ${label} is already in use for ${st.name} / ${cat.name}`)
      } else if (manualSeen.has(r.manualNum)) {
        r.errors.push(`UID ${label} is also used on row ${manualSeen.get(r.manualNum)}`)
      } else {
        manualSeen.set(r.manualNum, r.rowNum)
      }
    }

    const autoRows = group.filter(r => r.manualNum === undefined)
    const skip = new Set([...manualSeen.keys(), ...state.takenNums])
    const allocated = allocateUids(state, autoRows.length, skip)
    autoRows.forEach((r, i) => {
      r.manualNum = allocated[i].num
      r.uidSource = 'auto'
      r.isNewRecord = allocated[i].isNewRecord
    })
    for (const r of group) {
      if (!r.uidSource) r.uidSource = 'manual'
      r.uidDisplay = formatUid(state.prefix, r.manualNum!)
      if (r.manualNum! > 9999) r.errors.push(`Next UID ${r.manualNum} exceeds 4 digits`)
    }
  }))

  const seenStyle = new Map<string, number>()
  for (const r of rows) {
    if (!r.ids || r.errors.length || r.manualNum === undefined) continue
    const { st, cat, metal, size, colorstone, vendor } = r.ids
    const styleNum = buildStyleNumber(st.code, cat.code, r.midCode!, metal.code, r.manualNum, size.code)!
    r.styleNum = styleNum
    if (seenStyle.has(styleNum)) {
      r.errors.push(`Style # ${styleNum} duplicates row ${seenStyle.get(styleNum)}`)
      continue
    }
    seenStyle.set(styleNum, r.rowNum)
    r.submit = {
      stoneTypeId:  st.id,
      categoryId:   cat.id,
      metalId:      metal.id,
      sizeId:       size.id,
      colorstoneId: colorstone ? String(colorstone.id) : null,
      ctw:          r.input.ctw || null,
      uidNumber:    r.manualNum,
      // Always on for bulk rows: /api/submit then refuses a UID that got
      // claimed by someone else between this preview and the actual save.
      manualUid:    true,
      styleNum,
      stName:       st.name,
      catName:      cat.name,
      vendorName:   vendor.name,
      vendorStyle:  r.input.vendorStyle,
    }
  }

  return rows.map(({ ids, midCode, manualNum, ...row }) => ({
    ...row,
    submit: row.errors.length ? null : row.submit,
  }))
}
