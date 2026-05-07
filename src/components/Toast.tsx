import type { ToastItem } from '../types'

const STYLES: Record<ToastItem['type'], { border: string; text: string; bg: string; icon: string }> = {
  info: { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)', text: 'rgba(255,255,255,0.85)', icon: 'ℹ️' },
  ok:   { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.30)',  text: '#86efac', icon: '✓' },
  warn: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.30)', text: '#fcd34d', icon: '⚠' },
  err:  { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.30)',  text: '#fca5a5', icon: '✕' },
}

interface Props {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}

export default function Toast({ toasts, onDismiss }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map(t => {
        const s = STYLES[t.type]
        return (
          <div
            key={t.id}
            className="animate-fade-in"
            style={{
              pointerEvents: 'all',
              background: s.bg,
              border: `1px solid ${s.border}`,
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              fontSize: 13,
              color: s.text,
              backdropFilter: 'blur(12px)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 240,
              maxWidth: 340,
              cursor: 'pointer',
            }}
            onClick={() => onDismiss(t.id)}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{s.icon}</span>
            <span style={{ flex: 1 }}>{t.msg}</span>
          </div>
        )
      })}
    </div>
  )
}
