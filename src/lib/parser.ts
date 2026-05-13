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

// ── Helpers ───────────────────────────────────────────────────────────────────
function norm(s: string): string {
  return String(s ?? '').replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

export function todayISO(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`
}

export function parseIDR(t: string): number {
  const m = t.match(/(?:IDR|Rp)\.?\s*([0-9][0-9.,]*)/i)
  return m ? Number(m[1].replace(/\./g, '').replace(/,/g, '')) || 0 : 0
}

export function formatIDR(n: number): string {
  return n ? 'Rp ' + n.toLocaleString('id-ID') : '—'
}

// ── Expedition detector ───────────────────────────────────────────────────────
type Expedition = 'JNE' | 'JNT' | 'IDE' | 'SAP' | 'UNKNOWN'

function detectExpedition(t: string): Expedition {
  if (/\bAKJNE[A-Z0-9]+\b/.test(t) || /AWB\s*:\s*AKJNE/i.test(t)) return 'JNE'
  if (/PT\.?\s*GLOBAL JET EXPRESS/i.test(t) || /www\.jet\.co\.id/i.test(t)) return 'JNT'
  if (/No\.\s*Resi\s*:\s*IDE[0-9]/i.test(t)) return 'IDE'
  if (/No\.\s*Resi\s*:\s*BLO[0-9]/i.test(t)) return 'SAP'
  return 'UNKNOWN'
}

// ── Date ──────────────────────────────────────────────────────────────────────
function extractDate(t: string): string {
  const m =
    t.match(/(?:Ship|Cetak|Tanggal|Tgl(?:\s+Dibuat)?|Date)\s*[:\-]?\s*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/i) ??
    t.match(/(\d{4}-\d{2}-\d{2})/)
  if (!m) return todayISO()
  const raw = m[1]
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, mo, d] = raw.split('-')
    return `${d}-${mo}-${y}`
  }
  return raw.replace(/\//g, '-')
}

// ── Waybill ───────────────────────────────────────────────────────────────────
function extractWaybillJNE(t: string): string {
  const m = t.match(/\bAKJNE[A-Z0-9]{3,20}\b/)
  return m ? m[0] : ''
}

function extractWaybillJNT(t: string): string {
  // J&T-4: format JO + 10 digit
  const jo = t.match(/\b(JO\d{10})\b/)
  if (jo) return jo[1]

  // J&T-1/2/3: 10-digit numeric yg muncul paling sering (>= 3x)
  const freq: Record<string, number> = {}
  for (const m of t.matchAll(/\b(\d{10})\b/g)) {
    freq[m[1]] = (freq[m[1]] || 0) + 1
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])
  if (top.length && top[0][1] >= 3) return top[0][0]
  return ''
}

function extractWaybillIDE(t: string): string {
  const m = t.match(/No\.\s*Resi\s*:\s*(IDE[0-9A-Z]+)/i)
  return m ? m[1] : ''
}

function extractWaybillSAP(t: string): string {
  const m = t.match(/No\.\s*Resi\s*:\s*(BLO[0-9A-Z]+)/i)
  return m ? m[1] : ''
}

function extractWaybill(t: string, exp: Expedition): string {
  switch (exp) {
    case 'JNE':     return extractWaybillJNE(t)
    case 'JNT':     return extractWaybillJNT(t)
    case 'IDE':     return extractWaybillIDE(t)
    case 'SAP':     return extractWaybillSAP(t)
    default: {
      const lbl = t.match(/(?:No\.?\s*(?:Resi|Waybill|AWB)|AWB)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{5,30})/i)
      if (lbl) return lbl[1].toUpperCase()
      const fb = t.match(/\b(\d{8,20})\b/)
      return fb ? fb[1] : ''
    }
  }
}

// ── Receiver name ─────────────────────────────────────────────────────────────
function extractReceiver(t: string, exp: Expedition): string {
  // IDE & SAP: blok "Penerima\nNama: ..."
  if (exp === 'IDE' || exp === 'SAP') {
    const m = t.match(/Penerima[\s\S]{0,10}?Nama\s*:\s*([^\n\r0-9]{2,60})/i)
    if (m) return norm(m[1])
  }

  // JNE: "Penerima: Nama, Jalan..." — ambil sebelum koma pertama
  if (exp === 'JNE') {
    const inline = t.match(/Penerima\s*:\s*([A-Za-z][^,\n\r]{1,50}),/)
    if (inline) return norm(inline[1])
    // blok label: "Nama: Heliyati" di sisi Penerima
    const nama = t.match(/Penerima[\s\S]{0,5}?Nama\s*:\s*([^\n\r]{2,60})/i)
    if (nama) return norm(nama[1])
  }

  // J&T: "Penerima: NAMA\n" atau "Penerima: NAMA******"
  if (exp === 'JNT') {
    const m = t.match(/Penerima\s*:\s*([A-Za-z][A-Za-z .]{1,50})(?:\n|\*{3,}|\d{4,})/i)
    if (m) return norm(m[1])
    const m2 = t.match(/Penerima\s*:\s*([^\n\r]{2,60})/i)
    if (m2) return norm(m2[1]).replace(/\*+\d*$/g, '').trim()
  }

  // Generic fallback
  const gen = t.match(/(?:Penerima|Kepada|Nama\s+Penerima|Receiver)\s*[:\-]?\s*([^\n\r]{2,60})/i)
  return gen ? norm(gen[1]) : ''
}

// ── Kecamatan — ambil 2 wilayah terbesar ─────────────────────────────────────
function extractKec(t: string, exp: Expedition): string {
  if (exp === 'JNE') {
    // "Penerima: Nama, jalan..., KEC, KOTA" — ambil 2 token terakhir dari alamat penerima
    const block = t.match(/Penerima\s*:[\s\S]{0,200}?([A-Z][A-Z ]+,\s*(?:KOTA|KAB(?:UPATEN)?)\s+[A-Z ]+)/i)
    if (block) {
      const parts = block[1].split(',').map(s => norm(s)).filter(Boolean)
      return parts.slice(-2).join(', ')
    }
    const kota = t.match(/([A-Z][A-Z ]{2,30}),\s*((?:KOTA|KAB(?:UPATEN)?)\s+[A-Z ]{3,30})/i)
    if (kota) return `${norm(kota[1])}, ${norm(kota[2])}`
    return ''
  }

  if (exp === 'JNT') {
    // Alamat J&T: "KOTA, KECAMATAN, JL. detail..."
    // Ambil 2 token uppercase sebelum detail jalan (JL/RT/No./Dk./Kel.)
    const addrMatch = t.match(
      /Penerima\s*:[^\n]*(?:\n|\*+\d*)([A-Z][A-Z ,]{5,}?)(?:,\s*JL\.?|,\s*(?:RT|RW|No\.|Dk\.|Kel\.?|Kec\.?|\d{5}))/i
    )
    if (addrMatch) {
      const parts = addrMatch[1].split(',').map(s => norm(s)).filter(s => s.length > 1)
      if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`
      if (parts.length === 1) return parts[0]
    }
    // Fallback: KABUPATEN/KOTA pola
    const kb = t.match(/([A-Z][A-Z ]{2,25}),\s*((?:KABUPATEN|KOTA)\s+[A-Z ]{2,25})/i)
    if (kb) return `${norm(kb[1])}, ${norm(kb[2])}`
    // Fallback 2: 2 token uppercase sebelum kode pos 5-digit
    const pre = t.match(/([A-Z][A-Z ]{2,25},\s*[A-Z][A-Z ]{2,25})\s+\d{5}/)
    if (pre) {
      const parts = pre[1].split(',').map(s => norm(s))
      return parts.slice(0, 2).join(', ')
    }
    return ''
  }

  if (exp === 'IDE' || exp === 'SAP') {
    // Alamat: "Jl. detail, Kel, Kec, Kota/Kab, Provinsi - kodepos"
    // Ambil 2 token terakhir sebelum provinsi/kode pos, skip token yg dimulai angka/Jl/RT/RW
    const addrM = t.match(
      /Alamat\s*:[^\n\r]{0,200}?((?:[A-Za-z][A-Za-z ]{2,30},\s*){1,3}[A-Za-z][A-Za-z ]{2,30})\s*(?:-\s*\d{5}|,\s*\d{5}|\n)/i
    )
    if (addrM) {
      const parts = addrM[1]
        .split(',')
        .map(s => norm(s))
        .filter(s => s.length > 2 && !/^\d/.test(s) && !/^(jl|rt|rw|no|gg|gang|blok)/i.test(s))
      if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
      if (parts.length === 1) return parts[0]
    }
    return ''
  }

  // Generic
  const gen = t.match(/([A-Za-z][A-Za-z ]{2,25}),\s*([A-Za-z][A-Za-z ]{2,25})\s*\d{5}/)
  return gen ? `${norm(gen[1])}, ${norm(gen[2])}` : ''
}

// ── Block splitting ───────────────────────────────────────────────────────────
function buildBlocksFromPositions(
  fullText: string,
  positions: { pos: number }[]
): string[] {
  if (!positions.length) return [fullText]
  const blocks: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const start = Math.max(0, positions[i].pos - 100)
    const end = i + 1 < positions.length ? positions[i + 1].pos : fullText.length
    blocks.push(fullText.slice(start, end))
  }
  return blocks
}

function splitBlocks(fullText: string, pageTexts: string[]): string[] {
  // 1. JNE: split by AWB: AKJNE
  const jneMatches = [...fullText.matchAll(/AWB\s*:\s*(AKJNE[A-Z0-9]+)/gi)]
    .map(m => ({ pos: m.index! }))
  if (jneMatches.length > 1) return buildBlocksFromPositions(fullText, jneMatches)

  // 2. J&T: 10-digit numeric muncul >= 3x per resi
  const freq10: Record<string, number> = {}
  for (const m of fullText.matchAll(/\b(\d{10})\b/g)) {
    freq10[m[1]] = (freq10[m[1]] || 0) + 1
  }
  const wb10 = Object.entries(freq10).filter(([, c]) => c >= 3).map(([k]) => k)
  if (wb10.length > 1) {
    const pos = wb10
      .map(wb => ({ pos: fullText.indexOf(wb) }))
      .filter(x => x.pos !== -1)
      .sort((a, b) => a.pos - b.pos)
    return buildBlocksFromPositions(fullText, pos)
  }

  // 3. J&T-4: JO + 10-digit
  const joMatches = [...fullText.matchAll(/\b(JO\d{10})\b/g)]
    .map(m => ({ pos: m.index! }))
  if (joMatches.length > 1) return buildBlocksFromPositions(fullText, joMatches)

  // 4. IDE / SAP: split by "No. Resi:"
  const resiMatches = [...fullText.matchAll(/No\.\s*Resi\s*:/gi)]
    .map(m => ({ pos: m.index! }))
  if (resiMatches.length > 1) return buildBlocksFromPositions(fullText, resiMatches)

  // 5. Fallback per halaman
  return pageTexts.filter(p => p.trim().length > 20)
}

// ── Row builder ───────────────────────────────────────────────────────────────
export function buildRow(text: string, label: string, idx: number): ResiRow {
  const exp = detectExpedition(text)
  return {
    _id: Math.random().toString(36).slice(2, 9),
    tanggal: extractDate(text),
    waybill: extractWaybill(text, exp),
    penerima: extractReceiver(text, exp),
    kecamatan: extractKec(text, exp),
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
