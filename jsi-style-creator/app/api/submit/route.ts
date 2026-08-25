import { NextRequest, NextResponse } from 'next/server'
import { fetchAll, findFieldKey, pickField, createRow, patchRow, SUBMIT_BASE, SUBMIT_TABLE, UID_BASE, UID_TABLES, CATEGORY_MAP, PREFIX } from '@/lib/nocodb'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      stoneTypeId, categoryId, metalId, sizeId,
      colorstoneId, ctw, uidNumber, styleNum,
      catName, stName, vendorName, vendorStyle,
    } = body

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

    const uidTableId = UID_TABLES[stName]?.[catName]
    if (uidTableId && styleNum) {
      const catFilter = CATEGORY_MAP[catName] || catName.toUpperCase()

      const allUidRows = await fetchAll(UID_BASE, uidTableId)

      const existing = allUidRows.filter(r => {
        const jsi = String(pickField(r, 'JSI Style#') || '').trim().toUpperCase()
        const m = jsi.match(/(\d+)$/)
        const rowNum = m ? parseInt(m[1]) : null
        return rowNum === uidNumber
      })

      // Field naming for JSI Style#/Category/Vendor/Vendor Style # is not
      // consistent across UID tables (e.g. "JSI Style#" vs "JSI Style #" vs
      // "JSI STYLE #"). Resolve the real column names from a sample row so
      // writes land on the existing field instead of creating a stray one.
      const sampleRow      = allUidRows[0]
      const jsiKey          = (sampleRow && findFieldKey(sampleRow, 'JSI Style#'))     || 'JSI Style#'
      const categoryKey     = (sampleRow && findFieldKey(sampleRow, 'Category'))       || 'Category'
      const vendorKey       = (sampleRow && findFieldKey(sampleRow, 'Vendor'))         || 'Vendor'
      const vendorStyleKey  = (sampleRow && findFieldKey(sampleRow, 'Vendor Style #')) || 'Vendor Style #'

      let uidWriteRes
      if (existing.length > 0) {
        // Always (re)write Category too, filling it in if it was missing
        uidWriteRes = await patchRow(UID_BASE, uidTableId, existing[0].Id, {
          [vendorKey]:      vendorName.trim(),
          [vendorStyleKey]: vendorStyle.trim(),
          [categoryKey]:    catFilter,
          'Our Style#':     styleNum,
        })
      } else {
        const prefix = PREFIX[stName]?.[catName] ?? ''
        const jsiStyleNumber = prefix
          ? `${prefix}${uidNumber}`
          : String(uidNumber).padStart(4, '0')

        uidWriteRes = await createRow(UID_BASE, uidTableId, {
          [vendorKey]:      vendorName.trim(),
          [vendorStyleKey]: vendorStyle.trim(),
          [categoryKey]:    catFilter,
          [jsiKey]:         jsiStyleNumber,
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