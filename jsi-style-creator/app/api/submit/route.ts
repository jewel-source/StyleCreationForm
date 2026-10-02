import { NextRequest, NextResponse } from 'next/server'
import { fetchAll, findFieldKey, pickField, createRow, patchRow, SUBMIT_BASE, SUBMIT_TABLE, UID_BASE, UID_TABLES, CATEGORY_MAP, PREFIX } from '@/lib/nocodb'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      stoneTypeId, categoryId, metalId, sizeId,
      colorstoneId, ctw, uidNumber, styleNum,
      catName, stName, vendorName, vendorStyle, manualUid,
    } = body

    if (!vendorName?.trim() || !vendorStyle?.trim()) {
      return NextResponse.json(
        { error: 'Vendor Name and Vendor Style# are required' },
        { status: 400 }
      )
    }

    if (manualUid && !(Number.isInteger(uidNumber) && uidNumber >= 0 && uidNumber <= 9999)) {
      return NextResponse.json({ error: 'Manual UID must be exactly 4 digits' }, { status: 400 })
    }

    // A hand-typed UID may already belong to another style. Refuse rather than
    // overwrite that UID row's vendor info (checked before the style row is created).
    if (manualUid) {
      const manualTableId = UID_TABLES[stName]?.[catName]
      if (manualTableId) {
        const rows = await fetchAll(UID_BASE, manualTableId)
        const taken = rows.some(r => {
          const m = String(pickField(r, 'JSI Style#') || '').trim().match(/([0-9]+)$/)
          if (!m || parseInt(m[1]) !== uidNumber) return false
          return String(pickField(r, 'Vendor') || '').trim() !== '' ||
                 String(pickField(r, 'Vendor Style #') || '').trim() !== ''
        })
        if (taken) {
          return NextResponse.json(
            { error: `UID ${String(uidNumber).padStart(4, '0')} is already in use for ${stName} / ${catName}` },
            { status: 409 }
          )
        }
      }
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