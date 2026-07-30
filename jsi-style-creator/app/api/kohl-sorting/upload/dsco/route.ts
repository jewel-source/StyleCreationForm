import { NextRequest, NextResponse } from 'next/server'
import { parseDscoFile, projectDscoRows } from '@/lib/kohl-sorting/dsco'
import { LINE_ITEM_DETAIL_FIELD_MAP, SHIPPING_IMPORT_COLUMNS } from '@/lib/kohl-sorting/shippingCsv'

// Every field dailyFile.ts / shippingCsv.ts read off a DSCO row, per shape —
// this is what the parsed response keeps. The line-item-detail export
// carries ~130 columns raw; almost none of them are used downstream, so
// returning the full row set here would defeat the point of parsing
// upload-side. Keep this in sync with dailyFile.ts/shippingCsv.ts if either
// starts reading a new field.
const LINE_ITEM_DETAIL_KEEP_FIELDS = [...new Set([
  'po_number',
  'line_item_sku', 'line_item_upc', 'line_item_title', 'line_item_quantity', 'line_item_expected_cost',
  'ship_first_name', 'ship_last_name', 'shipping_service_level_code',
  ...Object.values(LINE_ITEM_DETAIL_FIELD_MAP),
])]

// shipping-import shape rows are already narrow (the export's own columns
// are what buildShippingCsv passes straight through) — just the fixed
// column list plus the one extra field dailyFile.ts's buildServiceByOrder
// checks for, which isn't always present on this shape.
const SHIPPING_IMPORT_KEEP_FIELDS = [...new Set([...SHIPPING_IMPORT_COLUMNS, 'shipping_service_level_code'])]

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const dsco = formData.get('dsco') as File | null
    if (!dsco) {
      return NextResponse.json({ error: 'DSCO order export (CSV/XLS) is required' }, { status: 400 })
    }

    const dscoBuf = Buffer.from(await dsco.arrayBuffer())
    const parsed = parseDscoFile(dscoBuf, dsco.name)
    const keepFields = parsed.shape === 'line-item-detail' ? LINE_ITEM_DETAIL_KEEP_FIELDS : SHIPPING_IMPORT_KEEP_FIELDS
    const rows = projectDscoRows(parsed.rows, keepFields)

    return NextResponse.json({ shape: parsed.shape, poOrder: parsed.poOrder, rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
