// @ts-ignore
import * as pdfjs from 'pdfjs-dist'
import type { ResiRow } from '../types'

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'

export function isLibraryReady(): boolean {
  try {
    return typeof pdfjs.getDocument === 'function'
  } catch {
    return false
  }
}

// ── Text normalizer ───────────────────────────────────────────────────────────
function norm(s: string): string {
  return String(s ?? '').replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

// ── Date helpers ──────────────────────────────────────────────────────────────
export function todayISO(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`
}

function extractDate(t: string): string {
  const m = t.match(
    /(?:Ship|Cetak|Tanggal|Tgl)\s*[:\-]?\s*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/i
  )
  return m ? m[1].replace(/\//g, '-') : todayISO()
}

// ── Waybill ───────────────────────────────────────────────────────────────────
function extractWaybill(t: string): string {
  // 1. Explicit label (JNE)
  const byLabel = t.match(
    /(?:No\.?\s*(?:Resi|Waybill|AWB)|AWB|Resi\s*No\.?|Waybill\s*No?\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{5,30})/i
  )
  if (byLabel) return byLabel[1].toUpperCase().replace(/^[-]+|[-]+$/g, '')

  // 2. 10-digit numeric (J&T — appears 6–8×)
  const all10 = [...t.matchAll(/\b(\d{10})\b/g)].map(m => m[1])
  if (all10.length > 0) {
    const freq: Record<string, number> = {}
    for (const n of all10) freq[n] = (freq[n] || 0) + 1
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
    return sorted[0][0]
  }

  // 3. 12-digit numeric
  const n12 = t.match(/\b(\d{12})\b/)
  if (n12) return n12[1]

  // 4. Known courier prefix
  const prefix = t.match(/\b((?:CEK|JP|JD|SIPC|IDP|GKD|PAXEL)[A-Z0-9]{6,18})\b/i)
  if (prefix) return prefix[1].toUpperCase()

  // 5. Standalone numeric line
  for (const line of t.split(/[\n\r]+/)) {
    const c = norm(line)
    if (/^\d{8,20}$/.test(c)) return c
  }

  // 6. Fallback
  const fb = t.match(/\b(\d{8,20})\b/)
  return fb ? fb[1] : ''
}

// ── Receiver ─────────────────────────────────────────────────────────────────
function extractReceiver(t: string): string {
  const m = t.match(
    /(?:Penerima|Kepada|Nama\s+Penerima|Receiver)\s*[:\-]?\s*([^\n\r]{3,80})/i
  )
  if (!m) return ''
  return norm(m[1])
    .split(/\s+/)
    .filter(w => /^[A-Za-z]+$/.test(w))
    .join(' ')
}

// ── District / Kecamatan ──────────────────────────────────────────────────────
function extractKec(t: string): string {
  const m = t.match(/Penerima\s*:\s*[^\n\r]+[\n\r]+\s*([^\n\r]{5,})/i)
  if (!m) return ''
  const parts = m[1].split(',').map(s => norm(s)).filter(Boolean)
  if (parts.length < 2) return parts[0] || ''
  return `${parts[1]} - ${parts[0]}`
}

// ── IDR ───────────────────────────────────────────────────────────────────────
export function parseIDR(t: string): number {
  const m = t.match(/(?:IDR|Rp)\.?\s*([0-9][0-9.,]*)/i)
  return m ? Number(m[1].replace(/\./g, '').replace(/,/g, '')) || 0 : 0
}

export function formatIDR(n: number): string {
  return n ? 'Rp ' + n.toLocaleString('id-ID') : '—'
}

// ── Block splitting ───────────────────────────────────────────────────────────
function buildBlocksFromPositions(
  fullText: string,
  positions: { pos: number; wb: string }[]
): string[] {
  if (positions.length === 0) return [fullText]
  const blocks: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const start = Math.max(0, positions[i].pos - 100)
    const end = i + 1 < positions.length ? positions[i + 1].pos : fullText.length
    blocks.push(fullText.slice(start, end))
  }
  return blocks
}

function splitBlocks(fullText: string, pageTexts: string[]): string[] {
  const freq: Record<string, number> = {}
  for (const m of fullText.matchAll(/\b(\d{10})\b/g)) {
    freq[m[1]] = (freq[m[1]] || 0) + 1
  }

  const waybills = Object.entries(freq)
    .filter(([, c]) => c >= 3)
    .map(([k]) => k)

  if (waybills.length <= 1) {
    const jneSplits = [...fullText.matchAll(/AWB\s*:\s*([A-Z0-9]{8,30})/gi)].map(m => ({
      pos: m.index!,
      wb: m[1],
    }))
    if (jneSplits.length > 1) {
      jneSplits.sort((a, b) => a.pos - b.pos)
      const blocks: string[] = []
      for (let i = 0; i < jneSplits.length; i++) {
        const start = Math.max(0, jneSplits[i].pos - 200)
        const end = i + 1 < jneSplits.length ? jneSplits[i + 1].pos : fullText.length
        blocks.push(fullText.slice(start, end))
      }
      return blocks
    }

    const freq12: Record<string, number> = {}
    for (const m of fullText.matchAll(/\b(\d{12})\b/g)) {
      freq12[m[1]] = (freq12[m[1]] || 0) + 1
    }
    const wb12 = Object.entries(freq12).filter(([, c]) => c >= 2).map(([k]) => k)
    if (wb12.length > 1) {
      return buildBlocksFromPositions(
        fullText,
        wb12
          .map(wb => ({ pos: fullText.indexOf(wb), wb }))
          .filter(x => x.pos !== -1)
          .sort((a, b) => a.pos - b.pos)
      )
    }
    return pageTexts.filter(p => p.trim().length > 20)
  }

  const positions = waybills
    .map(wb => ({ pos: fullText.indexOf(wb), wb }))
    .filter(x => x.pos !== -1)
    .sort((a, b) => a.pos - b.pos)

  return buildBlocksFromPositions(fullText, positions)
}

// ── Row builder ───────────────────────────────────────────────────────────────
export function buildRow(text: string, label: string, idx: number): ResiRow {
  return {
    _id: Math.random().toString(36).slice(2, 9),
    tanggal: extractDate(text),
    waybill: extractWaybill(text),
    penerima: extractReceiver(text),
    kecamatan: extractKec(text),
    biaya: parseIDR(text),
    cod: /\bCOD\b/i.test(text) ? 'Ya' : 'Tidak',
    keterangan: label + (idx > 0 ? ` #${idx + 1}` : ''),
  }
}

// ── PDF parser ────────────────────────────────────────────────────────────────
export async function parsePdfFile(file: File): Promise<ResiRow[]> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  const pageTexts: string[] = []
  let fullText = ''

  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i)
    const tc = await pg.getTextContent()
    let pt = ''
    for (const it of tc.items) {
      if ('str' in it) pt += it.str + (it.hasEOL ? '\n' : ' ')
    }
    pageTexts.push(pt)
    fullText += pt + '\n---PAGE---\n'
  }

  const blocks = splitBlocks(fullText, pageTexts)
  const rows: ResiRow[] = []
  for (let i = 0; i < blocks.length; i++) {
    const row = buildRow(blocks[i], file.name, i)
    if (row.waybill) rows.push(row)
    else if (blocks.length === 1) rows.push(row)
  }
  return rows
}
