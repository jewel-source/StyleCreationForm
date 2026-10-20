import { NextRequest, NextResponse } from 'next/server'
import { loadLookups, readRows, resolveRows } from '@/lib/bulkUpload'

// Parses and validates the sheet and assigns UIDs — nothing is written to
// NocoDB here. The client shows the result for confirmation and then saves
// each row through /api/submit.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'Excel file is required' }, { status: 400 })
    }

    const raw = readRows(Buffer.from(await file.arrayBuffer()), file.name)
    if (raw.length === 0) {
      return NextResponse.json({ error: `${file.name}: no style rows found` }, { status: 400 })
    }

    const rows = await resolveRows(raw, await loadLookups())
    return NextResponse.json({ rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
