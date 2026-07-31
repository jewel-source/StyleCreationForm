'use client'

import { useState } from 'react'
import styles from './StyleSearch.module.css'

interface StyleResult {
  styleNum: string
  stoneType: string | null
  category: string | null
  metal: string | null
  size: string | number | null
  ctw: number | null
  colorstone: string | null
  uid: string | null
  vendor: string | null
  vendorStyle: string | null
}

const DISPLAY_FIELDS: { key: keyof StyleResult; label: string }[] = [
  { key: 'stoneType',   label: 'Stone Type' },
  { key: 'category',    label: 'Category' },
  { key: 'metal',       label: 'Metal' },
  { key: 'size',        label: 'Size' },
  { key: 'ctw',         label: 'CTW' },
  { key: 'colorstone',  label: 'Colorstone' },
  { key: 'uid',         label: 'UID' },
  { key: 'vendor',      label: 'Vendor' },
  { key: 'vendorStyle', label: 'Vendor Style #' },
]

function show(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

export default function StyleSearch() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<StyleResult | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)

  const showToast = (msg: string, type: string) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 5000)
  }

  const runSearch = async () => {
    const styleNum = query.trim()
    if (!styleNum) {
      showToast('Enter a Style # to search', 'error')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch(`/api/style-search?styleNum=${encodeURIComponent(styleNum)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Style not found')
      setResult(data.style)
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') runSearch()
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cardTitle}>Search Style</div>

        <div className={styles.searchRow}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Enter Style # (e.g. AE0100SS0945X)"
            className={styles.searchInput}
          />
          <button className={styles.searchBtn} onClick={runSearch} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {result && (
          <>
            <div className={styles.divider} />

            <div className={styles.uidWrapper}>
              <div className={styles.styleNumDisplay}>{show(result.styleNum)}</div>
              <span className={styles.uidLock}>🔒</span>
            </div>

            <div className={styles.sectionLabel} style={{ marginTop: '20px' }}>Style Details</div>
            <div className={styles.detailGrid}>
              {DISPLAY_FIELDS.map(({ key, label }) => (
                <div className={styles.detailField} key={key}>
                  <label>{label}</label>
                  <div className={styles.readOnlyValue}>{show(result[key])}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
          {toast.msg}
        </div>
      )}
    </>
  )
}
