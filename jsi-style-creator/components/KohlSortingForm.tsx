'use client'

import { useState } from 'react'
import styles from './KohlSortingForm.module.css'

function downloadBase64(filename: string, base64: string, mime: string) {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type UploadStatus = 'idle' | 'uploading' | 'ready' | 'error'
type FileKind = 'pdf' | 'dsco' | 'inventory'

interface FileSlot {
  file: File | null
  status: UploadStatus
  error: string | null
  parsed: any
}

const EMPTY_SLOT: FileSlot = { file: null, status: 'idle', error: null, parsed: null }

export default function KohlSortingForm() {
  const [pdfSlot, setPdfSlot] = useState<FileSlot>(EMPTY_SLOT)
  const [dscoSlot, setDscoSlot] = useState<FileSlot>(EMPTY_SLOT)
  const [inventorySlot, setInventorySlot] = useState<FileSlot>(EMPTY_SLOT)
  const [invoiceStart, setInvoiceStart] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [toast,      setToast]      = useState<{ msg: string; type: string } | null>(null)
  const [missingUpcs, setMissingUpcs] = useState<string[]>([])

  const invoiceValid = /^\d+$/.test(invoiceStart) && parseInt(invoiceStart) > 0
  const formValid = pdfSlot.status === 'ready' && dscoSlot.status === 'ready' && inventorySlot.status === 'ready' && invoiceValid

  const showToast = (msg: string, type: string) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 6000)
  }

  // Uploads just this one file to its own parse endpoint and holds the
  // parsed result in state — nothing is written to storage server-side, the
  // raw file is parsed and the response is the end of that request. PDF
  // sort/order-matching can't happen here since it depends on the DSCO
  // export's PO order, which this endpoint doesn't have; that's deferred to
  // Process, once all three parsed pieces are together.
  const handleFileSelect = async (kind: FileKind, file: File | null, setSlot: (s: FileSlot) => void) => {
    if (!file) {
      setSlot(EMPTY_SLOT)
      return
    }
    setSlot({ file, status: 'uploading', error: null, parsed: null })
    try {
      const formData = new FormData()
      formData.append(kind, file)
      const res = await fetch(`/api/kohl-sorting/upload/${kind}`, { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed to parse ${kind}`)
      setSlot({ file, status: 'ready', error: null, parsed: data })
    } catch (e: any) {
      setSlot({ file, status: 'error', error: e.message, parsed: null })
    }
  }

  const processForm = async () => {
    if (!formValid || !pdfSlot.file) return
    setSubmitting(true)
    setMissingUpcs([])
    try {
      const formData = new FormData()
      formData.append('company', 'KOHLS')
      // The raw PDF travels again here — reordering the output PDF needs its
      // exact original page bytes, which the parsed page data from the
      // upload step can't reconstruct. DSCO/inventory don't have that
      // constraint, so they go through as their already-parsed JSON.
      formData.append('pdf', pdfSlot.file)
      formData.append('dsco', JSON.stringify(dscoSlot.parsed))
      formData.append('inventory', JSON.stringify(inventorySlot.parsed))
      formData.append('invoiceStart', invoiceStart)

      const res = await fetch('/api/kohl-sorting/process', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      if (res.status === 422 && data.missingUpcs) {
        setMissingUpcs(data.missingUpcs)
        showToast(`Processing blocked — ${data.missingUpcs.length} UPC(s) not found in the SKU catalog`, 'error')
        return
      }
      if (!res.ok) throw new Error(data.error || 'Processing failed')

      if (data.pdf && data.filenames?.pdf) {
        downloadBase64(data.filenames.pdf, data.pdf, 'application/pdf')
      }
      if (data.dailyFile && data.filenames?.dailyFile) {
        downloadBase64(data.filenames.dailyFile, data.dailyFile,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      }
      if (data.shippingCsv && data.filenames?.shippingCsv) {
        downloadBase64(data.filenames.shippingCsv, data.shippingCsv, 'text/csv')
      }
      showToast(data.message || '✓ Files generated and downloaded', 'success')

      resetForm()
    } catch (e: any) {
      showToast('Failed to process: ' + e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setPdfSlot(EMPTY_SLOT)
    setDscoSlot(EMPTY_SLOT)
    setInventorySlot(EMPTY_SLOT)
    setInvoiceStart('')
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cardTitle}>Process Packing Slips</div>

        <div className={styles.sectionLabel}>Retailer</div>
        <div className={styles.fieldGroupFull}>
          <div className={styles.field}>
            <label>Company</label>
            <input type="text" readOnly value="KOHLS" className={styles.lockedInput} />
          </div>
        </div>

        <div className={styles.divider} />
        <div className={styles.sectionLabel}>Uploads</div>

        <div className={styles.fieldGroupFull}>
          <div className={styles.field}>
            <label>Packing-Slip PDF <span className={styles.req}>*</span></label>
            <input
              type="file"
              accept="application/pdf"
              onChange={e => handleFileSelect('pdf', e.target.files?.[0] || null, setPdfSlot)}
            />
            {pdfSlot.status === 'uploading' && <span className={styles.fileStatus}>Parsing…</span>}
            {pdfSlot.status === 'ready' && pdfSlot.file && (
              <span className={styles.fileName}>{pdfSlot.file.name} — {pdfSlot.parsed.pages.length} page(s) parsed</span>
            )}
            {pdfSlot.status === 'error' && <span className={styles.fileError}>{pdfSlot.error}</span>}
          </div>
        </div>

        <div className={styles.fieldGroupFull}>
          <div className={styles.field}>
            <label>DSCO Order Export (CSV/XLS) <span className={styles.req}>*</span></label>
            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={e => handleFileSelect('dsco', e.target.files?.[0] || null, setDscoSlot)}
            />
            {dscoSlot.status === 'uploading' && <span className={styles.fileStatus}>Parsing…</span>}
            {dscoSlot.status === 'ready' && dscoSlot.file && (
              <span className={styles.fileName}>{dscoSlot.file.name} — {dscoSlot.parsed.poOrder.length} order(s) found</span>
            )}
            {dscoSlot.status === 'error' && <span className={styles.fileError}>{dscoSlot.error}</span>}
          </div>
        </div>

        <div className={styles.fieldGroupFull}>
          <div className={styles.field}>
            <label>Inventory File (CSV/XLS) <span className={styles.req}>*</span></label>
            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={e => handleFileSelect('inventory', e.target.files?.[0] || null, setInventorySlot)}
            />
            {inventorySlot.status === 'uploading' && <span className={styles.fileStatus}>Parsing…</span>}
            {inventorySlot.status === 'ready' && inventorySlot.file && (
              <span className={styles.fileName}>{inventorySlot.file.name} — {inventorySlot.parsed.balanceByStyle.length} style(s) found</span>
            )}
            {inventorySlot.status === 'error' && <span className={styles.fileError}>{inventorySlot.error}</span>}
          </div>
        </div>

        <div className={styles.divider} />
        <div className={styles.sectionLabel}>Invoicing</div>

        <div className={styles.fieldGroupFull}>
          <div className={styles.field}>
            <label>Starting Invoice # <span className={styles.req}>*</span></label>
            <input
              type="number"
              min="1"
              step="1"
              value={invoiceStart}
              onChange={e => setInvoiceStart(e.target.value)}
              placeholder="e.g. 123565"
            />
          </div>
        </div>

        {missingUpcs.length > 0 && (
          <div className={styles.missingBox}>
            <div className={styles.missingTitle}>
              Unmatched UPCs ({missingUpcs.length}) — add these to SKUDATA in NocoDB, then retry:
            </div>
            <div className={styles.missingList}>{missingUpcs.join(', ')}</div>
          </div>
        )}

        <button className={styles.submitBtn} onClick={processForm} disabled={!formValid || submitting}>
          {submitting ? 'Processing...' : 'Process'}
        </button>
      </div>

      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
          {toast.msg}
        </div>
      )}
    </>
  )
}
