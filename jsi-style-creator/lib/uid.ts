import { fetchAll, pickField, UID_BASE, UID_TABLES, CATEGORY_MAP, PREFIX, START_UID } from '@/lib/nocodb'

export interface UidState {
  prefix: string
  startNum: number
  count: number              // rows in the UID table for this category
  openSlots: number[]        // existing rows (>= startNum) with no vendor info, ascending
  maxNum: number             // highest UID in use, or startNum - 1
  takenNums: Set<number>     // UIDs that already carry vendor info (any number)
}

export function formatUid(prefix: string, num: number): string {
  return prefix ? `${prefix}${num}` : String(num).padStart(4, '0')
}

// Throws with a user-facing message when the stone type / category combination
// isn't configured.
export async function getUidState(stName: string, catName: string): Promise<UidState> {
  const uidTableId = UID_TABLES[stName]?.[catName]
  if (!uidTableId) throw new Error(`UID table for ${stName} / ${catName} not configured`)

  const startNum = START_UID[stName]?.[catName]
  if (startNum === undefined) throw new Error(`Starting UID for ${stName} / ${catName} not configured`)

  const allRecords = await fetchAll(UID_BASE, uidTableId)

  const catFilter = (CATEGORY_MAP[catName] || catName.toUpperCase()).trim().toUpperCase()
  const records = allRecords.filter(r =>
    String(pickField(r, 'Category') || '').trim().toUpperCase() === catFilter
  )

  const prefix = PREFIX[stName]?.[catName] ?? ''

  const parsed = records
    .map(r => {
      const jsi = String(pickField(r, 'JSI Style#') || '').trim().toUpperCase()
      let num = 0
      if (prefix && jsi.startsWith(prefix)) {
        num = parseInt(jsi.slice(prefix.length)) || 0
      } else {
        const m = jsi.match(/(\d+)$/)
        if (m) num = parseInt(m[1])
      }
      const vendor      = String(pickField(r, 'Vendor') || '').trim()
      const vendorStyle = String(pickField(r, 'Vendor Style #') || '').trim()
      const isFull = vendor !== '' || vendorStyle !== ''
      return { num, isFull }
    })
    .filter(p => p.num > 0)

  const openSlots = parsed
    .filter(p => p.num >= startNum && !p.isFull)
    .map(p => p.num)
    .sort((a, b) => a - b)

  const maxNum = parsed.reduce((max, p) => Math.max(max, p.num), startNum - 1)

  // Mirrors the manual-UID check in /api/submit, which looks at every row
  // regardless of its Category value.
  const takenNums = new Set<number>()
  for (const r of allRecords) {
    const m = String(pickField(r, 'JSI Style#') || '').trim().match(/([0-9]+)$/)
    if (!m) continue
    const isFull = String(pickField(r, 'Vendor') || '').trim() !== '' ||
                   String(pickField(r, 'Vendor Style #') || '').trim() !== ''
    if (isFull) takenNums.add(parseInt(m[1]))
  }

  return { prefix, startNum, count: records.length, openSlots, maxNum, takenNums }
}

// Hands out the next `count` UIDs: open slots first, then numbers past the
// current max. `skip` holds numbers already claimed (e.g. manual UIDs in an upload).
export function allocateUids(state: UidState, count: number, skip: Set<number> = new Set()) {
  const out: { num: number; isNewRecord: boolean }[] = []
  for (const num of state.openSlots) {
    if (out.length >= count) break
    if (!skip.has(num)) out.push({ num, isNewRecord: false })
  }
  let next = state.maxNum + 1
  while (out.length < count) {
    if (!skip.has(next)) out.push({ num: next, isNewRecord: true })
    next++
  }
  return out
}
