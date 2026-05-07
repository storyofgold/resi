import { useRef } from 'react'

interface Props {
  files: File[]
  onFiles: (files: File[]) => void
  disabled?: boolean
}

export default function DropZone({ files, onFiles, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const zoneRef = useRef<HTMLDivElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (disabled) return
    if (zoneRef.current) zoneRef.current.style.borderColor = 'rgba(255,255,255,0.12)'
    onFiles(Array.from(e.dataTransfer.files))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (disabled) return
    if (zoneRef.current) zoneRef.current.style.borderColor = 'var(--color-primary)'
  }

  const handleDragLeave = () => {
    if (zoneRef.current) zoneRef.current.style.borderColor = 'rgba(255,255,255,0.12)'
  }

  return (
    <div
      ref={zoneRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        border: '1.5px dashed rgba(255,255,255,0.12)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px 20px',
        transition: 'border-color 0.15s, background 0.15s',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={e => onFiles(Array.from(e.target.files ?? []))}
      />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
        {/* Icon */}
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" opacity="0.7">
          <path d="M7 2h7l5 5v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/>
          <path d="M14 2v6h6"/>
          <path d="M12 11v6M9 14l3-3 3 3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>

        {files.length === 0 ? (
          <>
            <p style={{ fontSize: 14, color: 'var(--color-text)' }}>Drag &amp; drop PDF di sini</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>atau klik untuk pilih file · Bisa multiple PDF</p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary)' }}>
              {files.length === 1 ? files[0].name : `${files.length} file dipilih`}
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Klik untuk ganti file</p>
          </>
        )}
      </div>
    </div>
  )
}
