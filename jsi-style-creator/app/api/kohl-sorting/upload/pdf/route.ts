import { NextRequest, NextResponse } from 'next/server'
import { extractPdfPages } from '@/lib/kohl-sorting/pdf'

/**
 * Parse-only: extracts each page's order # + line items so the frontend can
 * show early feedback. Can't sort yet — that needs the DSCO export's PO
 * order, which only exists once /process runs with all three files. The raw
 * PDF itself is never persisted here; /process receives it fresh and
 * re-parses it from those bytes to build the reordered output PDF.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const pdf = formData.get('pdf') as File | null
    if (!pdf) {
      return NextResponse.json({ error: 'Packing-slip PDF is required' }, { status: 400 })
    }

    const pdfBuf = Buffer.from(await pdf.arrayBuffer())
    const pages = await extractPdfPages(pdfBuf)

    return NextResponse.json({ pages })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
