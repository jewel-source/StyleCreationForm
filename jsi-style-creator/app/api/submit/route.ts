import { NextRequest, NextResponse } from 'next/server'
import { fetchAll, createRow, patchRow, SUBMIT_BASE, SUBMIT_TABLE, UID_BASE, UID_TABLES, CATEGORY_MAP, PREFIX } from '@/lib/nocodb'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      stoneTypeId, categoryId, metalId, sizeId,
      colorstoneId, ctw, uidNumber, styleNum,
      catName, vendorName, vendorStyle,
    } = body

    // Server-side required field check (frontend can be bypassed)
    if (!vendorName?.trim() || !vendorStyle?.trim()) {
      return NextResponse.json(
        { error: 'Vendor Name and Vendor Style# are required' },
        { status: 400 }
      )
    }

    const payload: any = {
      'Stone Type': { Id: stoneTypeId },
      'Category':   { Id: categoryId },
      'Metal':      { Id: metalId },
      'Size':       { Id: sizeId },
      'UID':        String(uidNumber).padStart(4, '0'),
    }
    if (ctw)          payload['CTW']        = parseFloat(ctw)
    if (colorstoneId) payload['Colorstone'] = { Id: parseInt(colorstoneId) }

    const styleRes    = await createRow(SUBMIT_BASE, SUBMIT_TABLE, payload)
    const styleResult = await styleRes.json()
    if (!styleRes.ok) throw new Error(JSON.stringify(styleResult))

    const uidTableId = UID_TABLES[catName]
    if (uidTableId && styleNum) {
      const catFilter = CATEGORY_MAP[catName] || catName.toUpperCase()
      const prefix = PREFIX[catName] ?? ''
      const jsiStyleNumber = prefix
        ? `${prefix}${uidNumber}`
        : String(uidNumber).padStart(4, '0')

      // Fetch all rows and filter in JS -- avoids whitespace/casing mismatches
      // from NocoDB's server-side eq filter, and matches on the correctly
      // formatted style number (prefixed or zero-padded depending on category)
      const allUidRows = await fetchAll(UID_BASE, uidTableId, 'Id,JSI Style#')
      const existing = allUidRows.filter(r =>
        String(r['JSI Style#'] || '').trim().toUpperCase() === jsiStyleNumber.toUpperCase()
      )

      let uidWriteRes
      if (existing.length > 0) {
        uidWriteRes = await patchRow(UID_BASE, uidTableId, existing[0].Id, {
          'Vendor':         vendorName.trim(),
          'Vendor Style #': vendorStyle.trim(),
          'Category':       catFilter,
          'Our Style#':     styleNum,
        })
      } else {
        uidWriteRes = await createRow(UID_BASE, uidTableId, {
          'Vendor':         vendorName.trim(),
          'Vendor Style #': vendorStyle.trim(),
          'Category':       catFilter,
          'JSI Style#':     jsiStyleNumber,
          'Our Style#':     styleNum,
        })
      }

      if (!uidWriteRes.ok) {
        const errText = await uidWriteRes.text()
        throw new Error(`UID table write failed: ${errText}`)
      }
    }

    return NextResponse.json({ success: true, styleNum })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}