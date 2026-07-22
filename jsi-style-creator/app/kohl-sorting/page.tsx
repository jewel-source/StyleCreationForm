import KohlSortingForm from '@/components/KohlSortingForm'

export default function KohlSortingPage() {
  return (
    <main style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 76px)', padding: '24px'
    }}>
      <div style={{ width: '100%', maxWidth: '640px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            width: '52px', height: '52px',
            background: 'linear-gradient(135deg, #C9A84C, #E8C97A)',
            borderRadius: '14px', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: '22px', fontWeight: 700, color: '#1A1A2E', marginBottom: '12px'
          }}>KS</div>
          <h1 style={{ color: '#fff', fontSize: '22px', fontWeight: 600 }}>Kohl Sorting</h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginTop: '4px' }}>
            Packing-Slip Sort &amp; Daily File
          </p>
        </div>
        <KohlSortingForm />
      </div>
    </main>
  )
}
