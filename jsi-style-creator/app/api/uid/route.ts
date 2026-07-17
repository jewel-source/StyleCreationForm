import { NextRequest, NextResponse } from 'next/server'
import { fetchAll, UID_BASE, UID_TABLES, CATEGORY_MAP, PREFIX, START_UID } from '@/lib/nocodb'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const stName  = searchParams.get('stoneType') || ''
  const catName = searchParams.get('category')  || ''

  const uidTableId = UID_TABLES[stName]?.[catName]
  if (!uidTableId) {
    return NextResponse.json({ error: `UID table for ${stName} / ${catName} not configured` }, { status: 404 })
  }

  const startNum = START_UID[stName]?.[catName]
  if (startNum === undefined) {
    return NextResponse.json({ error: `Starting UID for ${stName} / ${catName} not configured` }, { status: 404 })
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

    const prefix = PREFIX[stName]?.[catName] ?? ''

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

    const openSlots = parsed
      .filter(p => p.num >= startNum && !p.isFull)
      .sort((a, b) => a.num - b.num)

    let nextNum: number
    let isNewRecord = false

    if (openSlots.length > 0) {
      nextNum = openSlots[0].num
    } else {
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
      isNewRecord,
      count: records.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}