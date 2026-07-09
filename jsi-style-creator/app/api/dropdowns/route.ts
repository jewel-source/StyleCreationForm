import { NextRequest, NextResponse } from 'next/server'
import { fetchAll, UID_BASE, UID_TABLES } from '@/lib/nocodb'

const CATEGORY_MAP: Record<string, string> = {
  Ring: 'RING', Earrings: 'EARRINGS', Earring: 'EARRINGS',
  Pendant: 'PENDANT', Necklace: 'NECKLACE', Bracelet: 'BRACELET',
  Bangle: 'BANGLE', Cufflink: 'CUFFLINK', Brooch: 'BROOCH', Set: 'SET',
}

const UID_CONFIG: Record<string, Record<string, { prefix: string; padLen: number }>> = {
  'Lab Diamond': {
    Ring:     { prefix: 'A', padLen: 0 },
    Pendant:  { prefix: 'A', padLen: 0 },
    Earrings: { prefix: 'A', padLen: 0 },
    Earring:  { prefix: 'A', padLen: 0 },
    Necklace: { prefix: 'A', padLen: 0 },
    Bracelet: { prefix: '',  padLen: 4 },
    Bangle:   { prefix: 'AABG', padLen: 3 },
    Cufflink: { prefix: 'AAC', padLen: 3 },
    Brooch:   { prefix: '',  padLen: 4 },
  },
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const stName  = searchParams.get('stoneType') || ''
  const catName = searchParams.get('category')  || ''

  const uidTableId = UID_TABLES[catName]
  if (!uidTableId) {
    return NextResponse.json({ error: `UID table for ${catName} not configured` }, { status: 404 })
  }

  try {
    const catFilter = CATEGORY_MAP[catName] || catName.toUpperCase()
    const records   = await fetchAll(UID_BASE, uidTableId, 'JSI Style#', `(Category,eq,${catFilter})`)

    const cfg    = UID_CONFIG[stName]?.[catName] ?? { prefix: '', padLen: 4 }
    const prefix = cfg.prefix
    let maxNum   = 0

    for (const r of records) {
      const jsi = String(r['JSI Style#'] || '').trim().toUpperCase()
      let num = 0
      if (prefix && jsi.startsWith(prefix)) {
        num = parseInt(jsi.slice(prefix.length)) || 0
      } else {
        const m = jsi.match(/(\d+)$/)
        if (m) num = parseInt(m[1])
      }
      if (num > maxNum) maxNum = num
    }

    const nextNum = maxNum + 1
    let displayUID = ''
    if (prefix === 'A') {
      displayUID = `A${nextNum}`
    } else if (prefix) {
      displayUID = `${prefix}${String(nextNum).padStart(cfg.padLen, '0')}`
    } else {
      displayUID = String(nextNum).padStart(cfg.padLen, '0')
    }

    return NextResponse.json({ nextNum, displayUID, count: records.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}