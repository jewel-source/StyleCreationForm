import { NextResponse } from 'next/server'
import { loadLookups, buildTemplate } from '@/lib/bulkUpload'

// Template is generated on demand so its dropdown lists always match NocoDB.
export async function GET() {
  try {
    const buf = await buildTemplate(await loadLookups())
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="style-bulk-upload-template.xlsx"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
