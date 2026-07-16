import { NextRequest, NextResponse } from 'next/server'
import { fetchAll, UID_BASE, UID_TABLES, CATEGORY_MAP, PREFIX } from '@/lib/nocodb'

// Starting UID number per category
const START_UID: Record<string, number> = {
  Ring:      1644,
  Pendant:   507,
  Necklace:  447,
  Earrings:  928,
  Earring:   928,
  Bracelet:  241,
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const stName  = searchParams.get('stoneType') || ''
  const catName = searchParams.get('category')  || ''

  const uidTableId = UID_TABLES[catName]
  if (!uidTableId) {
    return NextResponse.json({ error: `UID table for ${catName} not configured` }, { status: 404 })
  }

  const startNum = START_UID[catName]
  if (startNum === undefined) {
    return NextResponse.json({ error: `Starting UID for ${catName} not configured` }, { status: 404 })
  }

  try {
    // Fetch everything, filter in JS to avoid whitespace/casing mismatches in the DB
    const allRecords = await fetchAll(
      UID_BASE,
      uidTableId,
      'JSI Style#,Category,Vendor,Vendor Style #'
    )

    const catFilter = (CATEGORY_MAP[catName] || catName.toUpperCase()).trim().toUpperCase()
    const records = allRecords.filter(r =>
      String(r['Category'] || '').trim().toUpperCase() === catFilter
    )

    const prefix = PREFIX[catName] ?? ''

    // Parse each row: extract its UID number and whether it's already used
    const parsed = records
      .map(r => {
        const jsi = String(r['JSI Style#'] || '').trim().toUpperCase()
        let num = 0
        if (prefix && jsi.startsWith(prefix)) {
          num = parseInt(jsi.slice(prefix.length)) || 0
        } else {
          const m = jsi.match(/(\d+)$/)
          if (m) num = parseInt(m[1])
        }
        const vendor      = String(r['Vendor'] || '').trim()
        const vendorStyle = String(r['Vendor Style #'] || '').trim()
        const isFull = vendor !== '' || vendorStyle !== ''
        return { num, isFull }
      })
      .filter(p => p.num > 0)

    // Look for the first unused (empty) slot at or after the starting number
    const openSlots = parsed
      .filter(p => p.num >= startNum && !p.isFull)
      .sort((a, b) => a.num - b.num)

    let nextNum: number
    let isNewRecord = false

    if (openSlots.length > 0) {
      // Reuse the lowest-numbered empty slot
      nextNum = openSlots[0].num
    } else {
      // No empty slots left -- mint a new UID past the current max
      const maxNum = parsed.reduce((max, p) => Math.max(max, p.num), startNum - 1)
      nextNum = maxNum + 1
      isNewRecord = true
    }

    const displayUID = prefix
      ? `${prefix}${nextNum}`
      : String(nextNum).padStart(4, '0')

    return NextResponse.json({
      nextNum,
      displayUID,
      isNewRecord,   // true if this UID doesn't exist as a row yet and submit needs to CREATE it
      count: records.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}