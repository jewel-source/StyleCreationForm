import { NextRequest, NextResponse } from 'next/server'
import { fetchAll, createRow, patchRow, SC_BASE, SC_TABLE, UID_BASE, UID_TABLES, CATEGORY_MAP } from '@/lib/nocodb'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      stoneTypeId, categoryId, metalId, sizeId,
      colorstoneId, ctw, uidNumber, styleNum,
      catName, vendorName, vendorStyle,
    } = body

    const payload: any = {
      'Stone Type': { Id: stoneTypeId },
      'Category':   { Id: categoryId },
      'Metal':      { Id: metalId },
      'Size':       { Id: sizeId },
      'UID':        String(uidNumber),
    }
    if (ctw)          payload['CTW']        = parseFloat(ctw)
    if (colorstoneId) payload['Colorstone'] = { Id: parseInt(colorstoneId) }

    const styleRes    = await createRow(SC_BASE, SC_TABLE, payload)
    const styleResult = await styleRes.json()
    if (!styleRes.ok) throw new Error(JSON.stringify(styleResult))

    const uidTableId = UID_TABLES[catName]
    if (uidTableId && styleNum) {
      const catFilter = CATEGORY_MAP[catName] || catName.toUpperCase()
      const existing  = await fetchAll(
        UID_BASE, uidTableId, 'Id,JSI Style#',
        `(JSI Style#,eq,${uidNumber})`
      )
      if (existing.length > 0) {
        await patchRow(UID_BASE, uidTableId, existing[0].Id, {
          'Vendor':        vendorName  || '',
          'Vendor Style#': vendorStyle || '',
          'Category':      catFilter,
          'Our Style#':    styleNum,
        })
      } else {
        await createRow(UID_BASE, uidTableId, {
          'Vendor':        vendorName  || '',
          'Vendor Style#': vendorStyle || '',
          'Category':      catFilter,
          'JSI Style#':    String(uidNumber),
          'Our Style#':    styleNum,
        })
      }
    }

    return NextResponse.json({ success: true, styleNum })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}