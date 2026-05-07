import { useState, useEffect, useCallback } from 'react'
import type { ResiRow } from './types'
import { parsePdfFile, buildRow, isLibraryReady } from './lib/parser'
import { exportCSV, copyTSV } from './lib/export'
import { useToast } from './hooks/useToast'

import Logo from './components/Logo'
import Toast from './components/Toast'
import DropZone from './components/DropZone'
import StatsBar from './components/StatsBar'
import ResultTable from './components/ResultTable'

const BTN_BASE: React.CSSProperties = {
  border: '1px solid var(--color-border-strong)',
  background: 'rgba(255,255,255,0.06)',
  color: 'var(--color-text)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  transition: 'background 0.15s, border-color 0.15s',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const BTN_PRIMARY: React.CSSProperties = {
  ...BTN_BASE,
  background: 'var(--color-primary)',
  border: '1px solid transparent',
  color: '#fff',
}

const BTN_SUCCESS: React.CSSProperties = {
  ...BTN_BASE,
  background: 'rgba(34,197,94,0.15)',
  border: '1px solid rgba(34,197,94,0.30)',
  color: 'var(--color-success)',
}

const PANEL: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-xl)',
  padding: '24px',
}

export default function App() {
  const [files, setFiles] = useState<File[]>([])
  const [rows, setRows] = useState<ResiRow[]>([])
  const [status, setStatus] = useState('Menunggu file…')
  const [progress, setProgress] = useState(0)
  const [parsing, setParsing] = useState(false)
  const [search, setSearch] = useState('')
  const [merge, setMerge] = useState(true)
  const [ocrText, setOcrText] = useState('')
  const [libOk, setLibOk] = useState(false)
  const { toasts, toast, dismiss } = useToast()

  useEffect(() => {
    setLibOk(isLibraryReady())
  }, [])

  const handleFiles = useCallback((chosen: File[]) => {
    const pdfs = chosen.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    if (!pdfs.length) { toast('Hanya file PDF yang diterima.', 'warn'); return }
    setFiles(pdfs)
    toast(`${pdfs.length} file PDF siap.`, 'info')
  }, [toast])

  const handleParse = async () => {
    if (!files.length) { toast('Pilih file dulu.', 'warn'); return }
    if (!libOk) { toast('PDF.js gagal dimuat. Coba refresh halaman.', 'err'); return }

    setParsing(true)
    setProgress(0)
    const newRows: ResiRow[] = []

    for (let i = 0; i < files.length; i++) {
      setStatus(`Memproses ${i + 1}/${files.length}: ${files[i].name}`)
      setProgress(Math.round((i / files.length) * 100))
      try {
        const result = await parsePdfFile(files[i])
        if (result.length) newRows.push(...result)
        else toast(`Tidak ada resi ditemukan: ${files[i].name}`, 'warn')
      } catch (err) {
        console.error(err)
        toast(`Gagal parse: ${files[i].name}`, 'err')
      }
    }

    setProgress(100)
    setRows(r => merge ? [...r, ...newRows] : newRows)
    setStatus(`Selesai! ${newRows.length} resi ditemukan.`)
    toast(`${newRows.length} resi berhasil diparsing.`, 'ok')
    setParsing(false)
  }

  const handleParseText = () => {
    const raw = ocrText.trim()
    if (!raw) { toast('Teks kosong.', 'warn'); return }
    const row = buildRow(raw, 'teks-manual', 0)
    setRows(r => merge ? [...r, row] : [row])
    setOcrText('')
    toast('Berhasil diparsing dari teks.', 'ok')
  }

  const handleClear = () => {
    setRows([])
    setFiles([])
    setStatus('Menunggu file…')
    setProgress(0)
    toast('Data dibersihkan.', 'info')
  }

  const handleCopyTSV = () => {
    if (!rows.length) { toast('Tidak ada data untuk disalin.', 'warn'); return }
    copyTSV(rows)
    toast('TSV berhasil disalin ke clipboard.', 'ok')
  }

  const handleExportCSV = () => {
    if (!rows.length) { toast('Tidak ada data untuk diekspor.', 'warn'); return }
    exportCSV(rows)
    toast('File CSV sedang diunduh.', 'ok')
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'radial-gradient(ellipse 900px 500px at 10% 10%, rgba(1,184,194,0.07), transparent 60%), var(--color-bg)',
      }}
    >
      {/* Header */}
      <header
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'rgba(15,17,23,0.85)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 20px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Logo />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em' }}>Resi PDF Parser</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Hans Logistik</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={BTN_BASE} onClick={handleClear}>Hapus semua</button>
            <button style={BTN_SUCCESS} onClick={handleExportCSV}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Export CSV
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stats */}
        <StatsBar rows={rows} fileCount={files.length} libOk={libOk} />

        {/* Two-column upload layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>

          {/* Left: Upload */}
          <div style={PANEL}>
            <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Upload PDF Resi</h2>

            <DropZone files={files} onFiles={handleFiles} disabled={parsing} />

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                <input
                  type="checkbox"
                  checked={merge}
                  onChange={e => setMerge(e.target.checked)}
                  style={{ accentColor: 'var(--color-primary)', width: 14, height: 14 }}
                />
                Append ke data yang ada
              </label>
              <button
                style={parsing ? { ...BTN_BASE, opacity: 0.6 } : BTN_PRIMARY}
                onClick={handleParse}
                disabled={parsing}
              >
                {parsing ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    Memproses…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Parse PDF
                  </>
                )}
              </button>
            </div>

            {/* Progress */}
            {parsing && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  <span>{status}</span>
                  <span>{progress}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 2,
                      background: 'var(--color-primary)',
                      width: `${progress}%`,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Status (non-parsing) */}
            {!parsing && status !== 'Menunggu file…' && (
              <p style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>{status}</p>
            )}
          </div>

          {/* Right: OCR input */}
          <div style={PANEL}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 14, fontWeight: 600 }}>Teks OCR</h2>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>Paste teks dari PDF scan</p>
              </div>
              <button style={BTN_BASE} onClick={handleParseText} disabled={!ocrText.trim()}>
                Parse
              </button>
            </div>
            <textarea
              value={ocrText}
              onChange={e => setOcrText(e.target.value)}
              placeholder="Paste hasil OCR di sini…"
              style={{
                width: '100%',
                minHeight: 160,
                resize: 'vertical',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '12px',
                color: 'var(--color-text)',
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                outline: 'none',
                lineHeight: 1.7,
              }}
            />
            <p style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-faint)', lineHeight: 1.6 }}>
              Gunakan untuk PDF scan yang tidak bisa dibaca otomatis.
            </p>
          </div>
        </div>

        {/* Results */}
        <div id="hasil" style={PANEL}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Hasil Parsing</h2>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {rows.length > 0 ? `${rows.length} resi · Double-click sel untuk edit` : 'Belum ada data'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative' }}>
                <svg
                  width="14" height="14"
                  viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" strokeWidth="2"
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                >
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  placeholder="Cari resi…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '7px 12px 7px 32px',
                    color: 'var(--color-text)',
                    fontSize: 13,
                    outline: 'none',
                    width: 200,
                    transition: 'border-color 0.15s',
                  }}
                />
              </div>
              <button style={BTN_BASE} onClick={handleCopyTSV}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                Copy TSV
              </button>
              <button style={BTN_SUCCESS} onClick={handleExportCSV}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Export CSV
              </button>
            </div>
          </div>

          <ResultTable rows={rows} search={search} />
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-text-faint)', paddingBottom: 16 }}>
          Resi PDF Parser · Hans Logistik
        </p>
      </main>

      {/* Spin animation for loading icon */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
