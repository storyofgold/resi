import type { ResiRow } from '../types'
import { formatIDR } from '../lib/parser'

interface Props {
  rows: ResiRow[]
  fileCount: number
  libOk: boolean
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
        flex: 1,
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function StatsBar({ rows, fileCount, libOk }: Props) {
  const totalBiaya = rows.reduce((s, r) => s + r.biaya, 0)
  const codCount = rows.filter(r => r.cod === 'Ya').length

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <StatCard label="Total Resi" value={rows.length} sub={`${fileCount} file`} />
      <StatCard label="COD" value={codCount} sub={`${rows.length - codCount} non-COD`} />
      <StatCard label="Total Biaya" value={formatIDR(totalBiaya)} />
      <div
        style={{
          background: 'var(--color-surface)',
          border: `1px solid ${libOk ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
          flex: 1,
          minWidth: 120,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          PDF.js
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: libOk ? 'var(--color-success)' : 'var(--color-error)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: libOk ? 'var(--color-success)' : 'var(--color-error)',
            display: 'inline-block',
            flexShrink: 0,
          }} />
          {libOk ? 'v4.10.38 siap' : 'Gagal load'}
        </div>
      </div>
    </div>
  )
}
