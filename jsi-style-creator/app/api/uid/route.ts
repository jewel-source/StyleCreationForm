import { NextRequest, NextResponse } from 'next/server'
import { fetchAll, UID_BASE, UID_TABLES, CATEGORY_MAP, PREFIX } from '@/lib/nocodb'

const START_UID: Record<string, number> = {
  Ring:      1644,
  Pendant:   507,
  Necklace:  447,
  Earrings:  928,
  Earring:   928,
  Bracelet:  241,
  Bangle:    46,
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
    const allRecords = await fetchAll(
      UID_BASE,
      uidTableId,
      'Id,JSI Style#,Category,Vendor,Vendor Style #'
    )

    const catFilter = (CATEGORY_MAP[catName] || catName.toUpperCase()).trim().toUpperCase()
    const records = allRecords.filter(r =>
      String(r['Category'] || '').trim().toUpperCase() === catFilter
    )

    const prefix = PREFIX[catName] ?? ''

    // First pass: extract number (or null if blank) and full/empty status,
    // preserving table row order (NocoDB returns rows in physical order)
    const rows = records.map(r => {
      const jsi = String(r['JSI Style#'] || '').trim().toUpperCase()
      const vendor      = String(r['Vendor'] || '').trim()
      const vendorStyle = String(r['Vendor Style #'] || '').trim()
      const isFull = vendor !== '' || vendorStyle !== ''

      if (jsi === '') {
        return { id: r.Id, num: null as number | null, isFull }
      }

      let num = 0
      if (prefix && jsi.startsWith(prefix)) {
        num = parseInt(jsi.slice(prefix.length)) || 0
      } else {
        const m = jsi.match(/(\d+)$/)
        if (m) num = parseInt(m[1])
      }
      return { id: r.Id, num: num > 0 ? num : null, isFull }
    })

    // Second pass: infer the number for blank rows based on their position
    // between the nearest numbered neighbors (assumes sequential table order)
    let runningNum = startNum - 1
    const parsed = rows.map(row => {
      if (row.num !== null) {
        runningNum = row.num
        return { ...row, inferredNum: row.num }
      } else {
        runningNum += 1
        return { ...row, inferredNum: runningNum }
      }
    })

    // Find the first open slot at or after the starting number
    const openSlots = parsed
      .filter(p => p.inferredNum >= startNum && !p.isFull)
      .sort((a, b) => a.inferredNum - b.inferredNum)

    let nextNum: number
    let isNewRecord = false

    if (openSlots.length > 0) {
      nextNum = openSlots[0].inferredNum
      // isNewRecord stays false if this blank/open row already exists as a record
      // (submit/route.ts will need to know whether to patch this row by Id,
      // even though JSI Style# was blank -- see note below)
    } else {
      const maxNum = parsed.reduce((max, p) => Math.max(max, p.inferredNum), startNum - 1)
      nextNum = maxNum + 1
      isNewRecord = true
    }

    const displayUID = prefix
      ? `${prefix}${nextNum}`
      : String(nextNum).padStart(4, '0')

    return NextResponse.json({
      nextNum,
      displayUID,
      isNewRecord,
      count: records.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}