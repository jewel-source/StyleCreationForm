'use client'

import { useState } from 'react'
import styles from './BulkUpload.module.css'
import type { BulkRow } from '@/lib/bulkUpload'

type RowStatus = 'ready' | 'invalid' | 'creating' | 'created' | 'failed'
type Phase = 'review' | 'creating' | 'done'

interface DialogRow extends BulkRow {
  status: RowStatus
  saveError?: string
}

const STATUS_LABEL: Record<RowStatus, string> = {
  ready:    'Ready',
  invalid:  'Skipped',
  creating: 'Creating…',
  created:  '✓ Created',
  failed:   '✗ Failed',
}

export default function BulkUpload() {
  const [parsing,   setParsing]   = useState(false)
  const [rows,     setRows]      = useState<DialogRow[] | null>(null)
  const [phase,     setPhase]     = useState<Phase>('review')
  const [template,  setTemplate]  = useState(false)
  const [toast,     setToast]     = useState<{ msg: string; type: string } | null>(null)
  const [inputKey,  setInputKey]  = useState(0)

  const showToast = (msg: string, type: string) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 6000)
  }

  const downloadTemplate = async () => {
    setTemplate(true)
    try {
      const res = await fetch('/api/bulk-upload/template')
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to build template')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = 'style-bulk-upload-template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      showToast('Template download failed: ' + e.message, 'error')
    } finally {
      setTemplate(false)
    }
  }

  const parseFile = async (file: File | null) => {
    setInputKey(k => k + 1)   // lets the same file be picked again
    if (!file) return
    setParsing(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/bulk-upload/parse', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to read file')
      setRows((data.rows as BulkRow[]).map(r => ({ ...r, status: r.submit ? 'ready' : 'invalid' })))
      setPhase('review')
    } catch (e: any) {
      showToast('Excel upload failed: ' + e.message, 'error')
    } finally {
      setParsing(false)
    }
  }

  const setRowState = (idx: number, patch: Partial<DialogRow>) =>
    setRows(prev => prev && prev.map((r, i) => i === idx ? { ...r, ...patch } : r))

  // Sequential on purpose: each save re-reads the UID table, and rows in the
  // same stone type + category must land in order.
  const createAll = async () => {
    if (!rows) return
    setPhase('creating')
    let ok = 0, failed = 0
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row.submit) continue
      setRowState(i, { status: 'creating' })
      try {
        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(row.submit),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        setRowState(i, { status: 'created' })
        ok++
      } catch (e: any) {
        setRowState(i, { status: 'failed', saveError: e.message })
        failed++
      }
    }
    setPhase('done')
    showToast(
      failed ? `Created ${ok} style(s), ${failed} failed` : `✓ Created ${ok} style(s)`,
      failed ? 'error' : 'success'
    )
  }

  const closeDialog = () => {
    if (phase === 'creating') return
    setRows(null)
  }

  const readyCount   = rows?.filter(r => r.submit).length ?? 0
  const invalidCount = rows?.filter(r => !r.submit).length ?? 0
  const doneCount    = rows?.filter(r => r.status === 'created' || r.status === 'failed').length ?? 0
  const createdCount = rows?.filter(r => r.status === 'created').length ?? 0
  const failedCount  = rows?.filter(r => r.status === 'failed').length ?? 0

  return (
    <>
      <div className={styles.bar}>
        <div className={styles.barText}>
          <b>Creating many styles?</b> Upload them from Excel.
        </div>
        <div className={styles.barActions}>
          <button className={styles.linkBtn} onClick={downloadTemplate} disabled={template}>
            {template ? 'Preparing…' : '⬇ Template'}
          </button>
          <label className={`${styles.uploadBtn} ${parsing ? styles.uploadBtnBusy : ''}`}>
            {parsing ? 'Reading…' : '📤 Upload Excel'}
            <input
              key={inputKey}
              type="file"
              accept=".xlsx,.xls"
              hidden
              disabled={parsing}
              onChange={e => parseFile(e.target.files?.[0] || null)}
            />
          </label>
        </div>
      </div>

      {rows && (
        <div className={styles.overlay} onClick={closeDialog}>
          <div className={styles.dialog} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className={styles.dialogHeader}>
              <div>
                <div className={styles.dialogTitle}>
                  {phase === 'review' ? 'Review styles to be created'
                    : phase === 'creating' ? 'Creating styles…'
                    : 'Bulk upload finished'}
                </div>
                <div className={styles.dialogSub}>
                  {phase === 'review' && <>
                    <b>{readyCount}</b> ready to create
                    {invalidCount > 0 && <> · <span className={styles.errText}><b>{invalidCount}</b> with errors (will be skipped)</span></>}
                  </>}
                  {phase !== 'review' && <>
                    {doneCount} / {readyCount} processed · {createdCount} created
                    {failedCount > 0 && <> · <span className={styles.errText}>{failedCount} failed</span></>}
                  </>}
                </div>
              </div>
              {phase !== 'creating' && (
                <button className={styles.closeBtn} onClick={closeDialog} aria-label="Close">×</button>
              )}
            </div>

            {phase !== 'review' && (
              <div className={styles.progress}>
                <div className={styles.progressBar}
                  style={{ width: `${readyCount ? (doneCount / readyCount) * 100 : 0}%` }} />
              </div>
            )}

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Style #</th>
                    <th>UID</th>
                    <th>Stone Type</th>
                    <th>Category</th>
                    <th>Metal</th>
                    <th>Size</th>
                    <th>CTW / Colorstone</th>
                    <th>Vendor</th>
                    <th>Vendor Style#</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.rowNum} className={styles[`row_${r.status}`]}>
                      <td>{r.rowNum}</td>
                      <td className={styles.mono}>{r.styleNum || '—'}</td>
                      <td className={styles.mono}>
                        {r.uidDisplay || '—'}
                        {r.uidSource && <span className={styles.uidTag}>{r.uidSource}</span>}
                      </td>
                      <td>{r.display.stoneType}</td>
                      <td>{r.display.category}</td>
                      <td>{r.display.metal}</td>
                      <td>{r.display.size || '—'}</td>
                      <td>{[r.input.ctw, r.display.colorstone].filter(Boolean).join(' / ') || '—'}</td>
                      <td>{r.display.vendor}</td>
                      <td>{r.input.vendorStyle}</td>
                      <td>
                        <span className={`${styles.badge} ${styles[`badge_${r.status}`]}`}>{STATUS_LABEL[r.status]}</span>
                        {r.errors.length > 0 && (
                          <ul className={styles.rowErrors}>{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                        )}
                        {r.saveError && <div className={styles.rowErrors}>{r.saveError}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.dialogFooter}>
              {phase === 'review' && <>
                <button className={styles.secondaryBtn} onClick={closeDialog}>Cancel</button>
                <button className={styles.primaryBtn} onClick={createAll} disabled={readyCount === 0}>
                  Create {readyCount} Style{readyCount === 1 ? '' : 's'}
                </button>
              </>}
              {phase === 'creating' && (
                <button className={styles.primaryBtn} disabled>Creating {doneCount + 1} of {readyCount}…</button>
              )}
              {phase === 'done' && (
                <button className={styles.primaryBtn} onClick={closeDialog}>Done</button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
          {toast.msg}
        </div>
      )}
    </>
  )
}
