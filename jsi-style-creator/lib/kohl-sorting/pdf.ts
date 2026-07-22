import { PDFDocument } from 'pdf-lib'

// Notebook rule: `idx = lines.index("ORDER#:"); po = lines[idx + 2]` — the
// order number sits 2 lines below the literal "ORDER#:" line (verified
// against the notebook's captured sample page text, not just its comment).
const ORDER_NUMBER_LINE_OFFSET = 2

export interface LineItem {
  skuNum: string
  upc: string
  description: string
  qtyOrd: number
  qtySent: number
  unitCost: number
}

export interface PdfPage {
  pageNo: number
  orderNo: string | null
  lineItems: LineItem[]
}

async function loadPdfjs() {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsLib
}

async function getPageLines(page: any): Promise<string[]> {
  const textContent = await page.getTextContent()
  const lines: string[] = []
  let current = ''
  for (const item of textContent.items) {
    if (typeof item.str !== 'string') continue
    current += item.str
    if (item.hasEOL) {
      const trimmed = current.trim()
      if (trimmed) lines.push(trimmed)
      current = ''
    }
  }
  const trimmed = current.trim()
  if (trimmed) lines.push(trimmed)
  return lines
}

function parseLineItems(lines: string[]): LineItem[] {
  const items: LineItem[] = []
  let i = 0
  while (i < lines.length - 1) {
    if (/^\d{6,10}$/.test(lines[i]) && /^\d{11,14}$/.test(lines[i + 1])) {
      const skuNum = lines[i]
      const upc = lines[i + 1]
      const descParts: string[] = []
      let j = i + 2
      let matchedAt = -1
      while (j < lines.length - 2) {
        const a = lines[j], b = lines[j + 1], c = lines[j + 2]
        if (/^\d{1,4}$/.test(a) && /^\d{1,4}$/.test(b) && /^\$[\d,]+(\.\d+)?$/.test(c)) {
          matchedAt = j
          break
        }
        descParts.push(lines[j])
        j++
      }
      if (matchedAt === -1) {
        i++
        continue
      }
      items.push({
        skuNum,
        upc,
        description: descParts.join(' ').trim(),
        qtyOrd: parseInt(lines[matchedAt], 10),
        qtySent: parseInt(lines[matchedAt + 1], 10),
        unitCost: parseFloat(lines[matchedAt + 2].replace(/[$,]/g, '')),
      })
      i = matchedAt + 3
    } else {
      i++
    }
  }
  return items
}

/** Loads the PDF once and extracts, per page, the order number + line-item table. */
export async function extractPdfPages(buf: Buffer): Promise<PdfPage[]> {
  const pdfjsLib = await loadPdfjs()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) })
  const doc = await loadingTask.promise
  const pages: PdfPage[] = []
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo)
    const lines = await getPageLines(page)
    const idx = lines.indexOf('ORDER#:')
    const orderNo = idx !== -1 && idx + ORDER_NUMBER_LINE_OFFSET < lines.length
      ? lines[idx + ORDER_NUMBER_LINE_OFFSET].trim()
      : null
    pages.push({ pageNo, orderNo, lineItems: parseLineItems(lines) })
  }
  await loadingTask.destroy()
  return pages
}

/**
 * Direct port of the notebook's 3-step reorder: pages whose order number
 * appears in `poOrder` are emitted in that order (all pages for a given PO,
 * in original relative order); everything else is appended at the end, in
 * original order. Returns the 0-based *original* page indices in output
 * order — shared by `reorderPdf` (to build the output PDF) and the Daily
 * File builder (to group line items into orders in the same sequence).
 */
export function computeSortedPageIndices(poOrder: string[], pages: PdfPage[]): number[] {
  const poToPageIndices = new Map<string, number[]>()
  for (const { pageNo, orderNo } of pages) {
    if (!orderNo) continue
    const idx = pageNo - 1
    if (!poToPageIndices.has(orderNo)) poToPageIndices.set(orderNo, [])
    poToPageIndices.get(orderNo)!.push(idx)
  }

  const matched = new Set<number>()
  const result: number[] = []
  for (const po of poOrder) {
    const indices = poToPageIndices.get(po)
    if (!indices) continue
    for (const idx of indices) {
      result.push(idx)
      matched.add(idx)
    }
  }

  for (let idx = 0; idx < pages.length; idx++) {
    if (!matched.has(idx)) result.push(idx)
  }

  return result
}

export async function reorderPdf(buf: Buffer, sortedIndices: number[]): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(buf)
  const destDoc = await PDFDocument.create()

  for (const idx of sortedIndices) {
    const [copied] = await destDoc.copyPages(srcDoc, [idx])
    destDoc.addPage(copied)
  }

  return Buffer.from(await destDoc.save())
}
