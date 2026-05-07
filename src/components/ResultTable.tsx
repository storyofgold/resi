import type { ResiRow } from '../types'
import { formatIDR } from '../lib/parser'

interface Props {
  rows: ResiRow[]
  search: string
}

const COLS = [
  { key: '#',         label: '#',             align: 'right'  },
  { key: 'tanggal',   label: 'Tanggal',       align: 'left'   },
  { key: 'waybill',   label: 'No Waybill',    align: 'left'   },
  { key: 'penerima',  label: 'Nama Penerima', align: 'left'   },
  { key: 'kecamatan', label: 'Kecamatan',     align: 'left'   },
  { key: 'biaya',     label: 'Biaya',         align: 'right'  },
  { key: 'cod',       label: 'COD',           align: 'center' },
  { key: 'keterangan',label: 'Keterangan',    align: 'left'   },
] as const

export default function ResultTable({ rows, search }: Props) {
  const filtered = rows.filter(r =>
    !search || Object.values(r).join(' ').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900, fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border-strong)' }}>
            {COLS.map(col => (
              <th
                key={col.key}
                style={{
                  textAlign: col.align,
                  padding: '10px 14px',
                  fontWeight: 600,
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td
                colSpan={COLS.length}
                style={{
                  textAlign: 'center',
                  padding: '60px 20px',
                  color: 'var(--color-text-faint)',
                  fontSize: 14,
                }}
              >
                {rows.length === 0
                  ? 'Belum ada data. Upload dan parse PDF dulu.'
                  : 'Tidak ada hasil yang cocok dengan pencarian.'}
              </td>
            </tr>
          ) : (
            filtered.map((r, i) => (
              <tr
                key={r._id}
                className="animate-fade-in"
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  transition: 'background 0.1s',
                }}
              >
                <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums', width: 40 }}>
                  {i + 1}
                </td>
                <td
                  style={{ padding: '10px 14px' }}
                  contentEditable
                  suppressContentEditableWarning
                >
                  {r.tanggal}
                </td>
                <td
                  style={{
                    padding: '10px 14px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    color: 'var(--color-primary)',
                    fontSize: 12,
                  }}
                  contentEditable
                  suppressContentEditableWarning
                >
                  {r.waybill}
                </td>
                <td style={{ padding: '10px 14px' }} contentEditable suppressContentEditableWarning>
                  {r.penerima}
                </td>
                <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }} contentEditable suppressContentEditableWarning>
                  {r.kecamatan}
                </td>
                <td
                  style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  contentEditable
                  suppressContentEditableWarning
                >
                  {formatIDR(r.biaya)}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 9px',
                      borderRadius: 'var(--radius-full, 9999px)',
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      background: r.cod === 'Ya' ? 'var(--color-success-dim)' : 'rgba(255,255,255,0.05)',
                      color: r.cod === 'Ya' ? 'var(--color-success)' : 'var(--color-text-faint)',
                      border: `1px solid ${r.cod === 'Ya' ? 'rgba(34,197,94,0.25)' : 'transparent'}`,
                    }}
                  >
                    {r.cod}
                  </span>
                </td>
                <td
                  style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-text-faint)' }}
                  contentEditable
                  suppressContentEditableWarning
                >
                  {r.keterangan}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
