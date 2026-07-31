import { NextRequest, NextResponse } from 'next/server'
import {
  fetchAll, SUBMIT_BASE, SUBMIT_TABLE, UID_BASE, UID_TABLES, CATEGORY_MAP, PREFIX,
} from '@/lib/nocodb'

function linkName(field: any, key: string): string | null {
  return field && typeof field === 'object' ? (field[key] ?? null) : null
}

// Same JSI Style# -> numeric UID parsing used in app/api/uid/route.ts
function parseJsiNum(jsiStyle: string, prefix: string): number {
  const jsi = jsiStyle.trim().toUpperCase()
  if (prefix && jsi.startsWith(prefix)) return parseInt(jsi.slice(prefix.length)) || 0
  const m = jsi.match(/(\d+)$/)
  return m ? parseInt(m[1]) : 0
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const styleNum = (searchParams.get('styleNum') || '').trim().toUpperCase()

  if (!styleNum) {
    return NextResponse.json({ error: 'Style # is required' }, { status: 400 })
  }

  try {
    const allRows = await fetchAll(SUBMIT_BASE, SUBMIT_TABLE)
    const match = allRows.find(
      r => String(r['Style #'] || '').trim().toUpperCase() === styleNum
    )

    if (!match) {
      return NextResponse.json({ error: 'Style not found' }, { status: 404 })
    }

    const stoneType = linkName(match['Stone Type'], 'Stone Type')
    const category  = linkName(match['Category'], 'Categories')
    const metal      = linkName(match['Metal'], 'Metal')
    const colorstone = linkName(match['Colorstone'], 'Colorstone')

    const sizeCode = match['Size Code'] ?? null
    const sizeNum  = match['Size (from Sizes)']
    const size = sizeCode === 'X' ? 'N/A (no size)' : (sizeNum ?? sizeCode ?? null)
    let vendor: string | null = null
    let vendorStyle: string | null = null
    const uidTableId = stoneType && category ? UID_TABLES[stoneType]?.[category] : null
    const uidNumber = parseInt(String(match['UID'] || ''), 10)

    if (uidTableId && category && !Number.isNaN(uidNumber)) {
      const catFilter = (CATEGORY_MAP[category] || category.toUpperCase()).trim().toUpperCase()
      const prefix = (stoneType && PREFIX[stoneType]?.[category]) ?? ''
      const uidRows = await fetchAll(UID_BASE, uidTableId, 'Vendor,Vendor Style #,Category,JSI Style#')

      const uidMatch = uidRows.find(r => {
        const sameCategory = String(r['Category'] || '').trim().toUpperCase() === catFilter
        const sameNum = parseJsiNum(String(r['JSI Style#'] || ''), prefix) === uidNumber
        return sameCategory && sameNum
      })

      if (uidMatch) {
        vendor = uidMatch['Vendor'] || null
        vendorStyle = uidMatch['Vendor Style #'] || null
      }
    }

    return NextResponse.json({
      style: {
        styleNum: match['Style #'],
        stoneType,
        category,
        metal,
        size,
        ctw: match['CTW'] ?? null,
        colorstone,
        uid: match['UID'] ?? null,
        vendor,
        vendorStyle,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
