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

export default function KohlSortingForm() {
  const [pdfFile,   setPdfFile]   = useState<File | null>(null)
  const [dscoFile,  setDscoFile]  = useState<File | null>(null)
  const [invoiceStart, setInvoiceStart] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [toast,      setToast]      = useState<{ msg: string; type: string } | null>(null)
  const [missingUpcs, setMissingUpcs] = useState<string[]>([])

  const invoiceValid = /^\d+$/.test(invoiceStart) && parseInt(invoiceStart) > 0
  const formValid = !!pdfFile && !!dscoFile && invoiceValid

  const showToast = (msg: string, type: string) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 6000)
  }

  const processForm = async () => {
    if (!formValid || !pdfFile || !dscoFile) return
    setSubmitting(true)
    setMissingUpcs([])
    try {
      const formData = new FormData()
      formData.append('company', 'KOHLS')
      formData.append('pdf', pdfFile)
      formData.append('dsco', dscoFile)
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
    setPdfFile(null)
    setDscoFile(null)
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
              onChange={e => setPdfFile(e.target.files?.[0] || null)}
            />
            {pdfFile && <span className={styles.fileName}>{pdfFile.name}</span>}
          </div>
        </div>

        <div className={styles.fieldGroupFull}>
          <div className={styles.field}>
            <label>DSCO Order Export (CSV/XLS) <span className={styles.req}>*</span></label>
            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={e => setDscoFile(e.target.files?.[0] || null)}
            />
            {dscoFile && <span className={styles.fileName}>{dscoFile.name}</span>}
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
