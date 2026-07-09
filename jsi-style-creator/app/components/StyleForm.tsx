'use client'

import { useEffect, useState, useCallback } from 'react'
import styles from './StyleForm.module.css'

interface Option { id: number; label: string; code: string; name: string }

const NO_SIZE_CATS  = ['Earrings','Earring','Pendant','Brooch','Cufflink','Set','Anklet']
const SIZE_CATS     = ['Ring','Bracelet','Necklace','Bangle']
const GEMSTONE_TYPES = ['Natural Gemstone','Lab Gem']

function buildStyleNumber(
  stCode: string, catCode: string, midCode: string,
  mCode: string, uidNumber: number | null, sCode: string
): string | null {
  const uidPart = uidNumber ? String(uidNumber).padStart(4, '0') : ''
  if (!stCode || !catCode || !midCode || !mCode || !uidPart || !sCode) return null
  return stCode + catCode + midCode + mCode + uidPart + sCode
}

export default function StyleForm() {
  const [stoneTypes,  setStoneTypes]  = useState<Option[]>([])
  const [categories,  setCategories]  = useState<Option[]>([])
  const [colorstones, setColorstones] = useState<Option[]>([])
  const [metals,      setMetals]      = useState<Option[]>([])
  const [allSizes,    setAllSizes]    = useState<any[]>([])
  const [filteredSizes, setFilteredSizes] = useState<Option[]>([])

  const [stoneType,   setStoneType]   = useState('')
  const [category,    setCategory]    = useState('')
  const [colorstone,  setColorstone]  = useState('')
  const [metal,       setMetal]       = useState('')
  const [size,        setSize]        = useState('')
  const [ctw,         setCtw]         = useState('')
  const [vendorName,  setVendorName]  = useState('')
  const [vendorStyle, setVendorStyle] = useState('')

  const [uid,         setUid]         = useState('')
  const [uidNumber,   setUidNumber]   = useState<number | null>(null)
  const [uidNote,     setUidNote]     = useState('')
  const [uidLoading,  setUidLoading]  = useState(false)

  const [loading,     setLoading]     = useState(true)
  const [submitting,  setSubmitting]  = useState(false)
  const [toast,       setToast]       = useState<{ msg: string; type: string } | null>(null)
  const [errors,      setErrors]      = useState<Record<string, string>>({})

  const [colDisabled,  setColDisabled]  = useState(true)
  const [sizeDisabled, setSizeDisabled] = useState(false)

  // Load dropdowns
  useEffect(() => {
    fetch('/api/dropdowns')
      .then(r => r.json())
      .then(data => {
        const toOpt = (r: any, labelKey: string): Option => ({
          id:    r.Id,
          label: r[labelKey] || `ID ${r.Id}`,
          code:  r['Style # Code'] || '',
          name:  r[labelKey] || '',
        })

        setStoneTypes(data.stoneTypes.map((r: any) => toOpt(r, 'Stone Type')))
        setCategories(data.categories.map((r: any) => ({
          id:    r.Id,
          label: r['Categories'] || r['Category'] || `ID ${r.Id}`,
          code:  r['Style # Code'] || '',
          name:  r['Categories'] || r['Category'] || '',
        })))
        setColorstones(data.colorstones.map((r: any) => toOpt(r, 'Colorstone')))
        setMetals(data.metals.map((r: any) => toOpt(r, 'Metal')))
        setAllSizes(data.sizes)
      })
      .catch(e => showToast('Failed to load dropdowns: ' + e.message, 'error'))
      .finally(() => setLoading(false))
  }, [])

  // Fetch UID when stone type + category selected
  useEffect(() => {
    if (!stoneType || !category) return
    const stName  = stoneTypes.find(o => String(o.id) === stoneType)?.name  || ''
    const catName = categories.find(o => String(o.id) === category)?.name || ''
    if (!stName || !catName) return

    setUidLoading(true)
    setUid('Fetching...')
    setUidNumber(null)

    fetch(`/api/uid?stoneType=${encodeURIComponent(stName)}&category=${encodeURIComponent(catName)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setUid('')
          setUidNote(data.error)
        } else {
          setUid(data.displayUID)
          setUidNumber(data.nextNum)
          setUidNote(`✓ Auto-assigned — ${data.count} existing ${catName} styles found`)
        }
      })
      .catch(e => { setUid(''); setUidNote(e.message) })
      .finally(() => setUidLoading(false))
  }, [stoneType, category])

  // Handle stone type change
  const onStoneTypeChange = (val: string) => {
    setStoneType(val)
    setCategory('')
    setUid(''); setUidNumber(null); setUidNote('')
    const stName = stoneTypes.find(o => String(o.id) === val)?.name || ''
    setColDisabled(!GEMSTONE_TYPES.includes(stName))
    if (!GEMSTONE_TYPES.includes(stName)) setColorstone('')
  }

  // Handle category change — filter sizes
  const onCategoryChange = (val: string) => {
    setCategory(val)
    setUid(''); setUidNumber(null); setUidNote('')
    const catName = categories.find(o => String(o.id) === val)?.name || ''

    if (NO_SIZE_CATS.includes(catName)) {
      const xRec = allSizes.find((r: any) => (r['Style # Code'] || '') === 'X')
      if (xRec) {
        setFilteredSizes([{
          id: xRec.Id, label: xRec['Size Selection'] || 'X',
          code: 'X', name: xRec['Size Selection'] || 'X'
        }])
        setSize(String(xRec.Id))
      }
      setSizeDisabled(true)
    } else if (SIZE_CATS.includes(catName)) {
      const filtered = allSizes
        .filter((r: any) => {
          const label = r['Size Selection'] || r['Size'] || ''
          const code  = r['Style # Code'] || ''
          return label.includes(catName) || code === 'X'
        })
        .map((r: any) => ({
          id: r.Id, label: r['Size Selection'] || r['Size'] || `ID ${r.Id}`,
          code: r['Style # Code'] || '', name: r['Size Selection'] || ''
        }))
      setFilteredSizes(filtered)
      setSize('')
      setSizeDisabled(false)
    } else {
      setFilteredSizes(allSizes.map((r: any) => ({
        id: r.Id, label: r['Size Selection'] || r['Size'] || `ID ${r.Id}`,
        code: r['Style # Code'] || '', name: r['Size Selection'] || ''
      })))
      setSize('')
      setSizeDisabled(false)
    }
  }

  // Build preview
  const stCode  = stoneTypes.find(o  => String(o.id) === stoneType)?.code  || ''
  const catCode = categories.find(o  => String(o.id) === category)?.code   || ''
  const mCode   = metals.find(o      => String(o.id) === metal)?.code      || ''
  const sCode   = filteredSizes.find(o => String(o.id) === size)?.code     || ''
  let midCode = ''
  if (ctw && parseFloat(ctw) > 0) {
    midCode = String(Math.round(parseFloat(ctw) * 100)).padStart(4, '0')
  } else if (colorstone) {
    midCode = colorstones.find(o => String(o.id) === colorstone)?.code || ''
  }
  const styleNum = buildStyleNumber(stCode, catCode, midCode, mCode, uidNumber, sCode)
  const styleValid = styleNum?.length === 13

  const showToast = (msg: string, type: string) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 5000)
  }

  const validate = () => {
    const errs: Record<string, string> = {}
    if (!stoneType)  errs.stoneType = 'Please select a stone type'
    if (!category)   errs.category  = 'Please select a category'
    if (!metal)      errs.metal     = 'Please select a metal'
    if (!size)       errs.size      = 'Please select a size'
    if (!styleValid) errs.style     = `Style # must be 13 chars. Currently: ${styleNum?.length ?? 0}`
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const submitForm = async () => {
    if (!validate()) return
    setSubmitting(true)
    const catName = categories.find(o => String(o.id) === category)?.name || ''
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stoneTypeId:  parseInt(stoneType),
          categoryId:   parseInt(category),
          metalId:      parseInt(metal),
          sizeId:       parseInt(size),
          colorstoneId: colorstone || null,
          ctw:          ctw || null,
          uidNumber,
          styleNum,
          catName,
          vendorName,
          vendorStyle,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast(`✓ Style ${styleNum} created!`, 'success')
      resetForm()
    } catch (e: any) {
      showToast('Failed to save: ' + e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setStoneType(''); setCategory(''); setColorstone('')
    setMetal(''); setSize(''); setCtw('')
    setVendorName(''); setVendorStyle('')
    setUid(''); setUidNumber(null); setUidNote('')
    setErrors({}); setColDisabled(true); setSizeDisabled(false)
    setFilteredSizes([])
  }

  if (loading) return (
    <div className={styles.card} style={{ textAlign: 'center', padding: '48px' }}>
      <div className={styles.spinner} style={{ margin: '0 auto' }} />
      <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Loading dropdowns...</p>
    </div>
  )

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cardTitle}>New Style Entry</div>
        <div className={styles.sectionLabel}>Classification</div>

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label>Stone Type <span className={styles.req}>*</span></label>
            <select value={stoneType} onChange={e => onStoneTypeChange(e.target.value)}
              className={errors.stoneType ? styles.inputError : ''}>
              <option value="">Select...</option>
              {stoneTypes.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {errors.stoneType && <span className={styles.errorMsg}>{errors.stoneType}</span>}
          </div>

          <div className={styles.field}>
            <label>Category <span className={styles.req}>*</span></label>
            <select value={category} onChange={e => onCategoryChange(e.target.value)}
              disabled={!stoneType} className={errors.category ? styles.inputError : ''}>
              <option value="">Select category...</option>
              {categories.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {errors.category && <span className={styles.errorMsg}>{errors.category}</span>}
          </div>
        </div>

        <div className={styles.fieldGroupFull}>
          <div className={styles.field}>
            <label>UID (Auto-assigned)</label>
            <div className={styles.uidWrapper}>
              <input type="text" readOnly value={uid}
                placeholder="Select stone type & category first..."
                className={styles.uidInput} />
              {uidLoading && <div className={styles.uidLoader} />}
              {!uidLoading && uid && uid !== 'Fetching...' && (
                <span className={styles.uidLock}>🔒</span>
              )}
            </div>
            {uidNote && <div className={styles.uidNote}>{uidNote}</div>}
          </div>
        </div>

        <div className={styles.divider} />
        <div className={styles.sectionLabel}>Style Details</div>

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label>CTW</label>
            <input type="number" value={ctw} onChange={e => setCtw(e.target.value)}
              placeholder="e.g. 0.50" step="0.01" min="0" />
          </div>
          <div className={styles.field}>
            <label>Colorstone</label>
            <select value={colorstone} onChange={e => setColorstone(e.target.value)}
              disabled={colDisabled} style={{ opacity: colDisabled ? 0.5 : 1 }}>
              <option value="">None</option>
              {colorstones.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label>Metal <span className={styles.req}>*</span></label>
            <select value={metal} onChange={e => setMetal(e.target.value)}
              className={errors.metal ? styles.inputError : ''}>
              <option value="">Select...</option>
              {metals.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {errors.metal && <span className={styles.errorMsg}>{errors.metal}</span>}
          </div>
          <div className={styles.field}>
            <label>Size <span className={styles.req}>*</span></label>
            <select value={size} onChange={e => setSize(e.target.value)}
              disabled={sizeDisabled} style={{ opacity: sizeDisabled ? 0.5 : 1 }}
              className={errors.size ? styles.inputError : ''}>
              {!sizeDisabled && <option value="">Select...</option>}
              {filteredSizes.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {errors.size && <span className={styles.errorMsg}>{errors.size}</span>}
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label>Vendor Name</label>
            <input type="text" value={vendorName} onChange={e => setVendorName(e.target.value)}
              placeholder="e.g. Omnia" />
          </div>
          <div className={styles.field}>
            <label>Vendor Style#</label>
            <input type="text" value={vendorStyle} onChange={e => setVendorStyle(e.target.value)}
              placeholder="e.g. OR6094400" />
          </div>
        </div>

        {/* Live Style Preview */}
        <div className={`${styles.stylePreview} ${
          !styleNum ? styles.pending : styleValid ? styles.valid : styles.invalid
        }`}>
          <div>
            <div className={styles.stylePreviewLabel}>Generated Style #</div>
            <div className={styles.stylePreviewValue}>{styleNum || '—'}</div>
          </div>
          <div className={styles.stylePreviewBadge}>
            {!styleNum ? 'Pending' : styleValid ? `✓ 13 chars` : `✗ ${styleNum.length}/13 chars`}
          </div>
        </div>

        {errors.style && <p className={styles.errorMsg} style={{ marginBottom: '8px' }}>{errors.style}</p>}

        <button className={styles.submitBtn} onClick={submitForm}
          disabled={!styleValid || submitting}>
          {submitting ? 'Creating...' : 'Create Style'}
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