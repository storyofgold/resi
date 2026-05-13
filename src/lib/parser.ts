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

// ── Helpers ────────────────────────────────────────────────────────────────────
function norm(s: string): string {
  return String(s ?? '').replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

export function todayISO(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`
}

export function parseIDR(raw: string): number {
  const m = raw.match(/(?:IDR|Rp)\.?\s*([0-9][0-9.,]*)/i)
  return m ? Number(m[1].replace(/\./g, '').replace(/,/g, '')) || 0 : 0
}

export function formatIDR(n: number): string {
  return n ? 'Rp ' + n.toLocaleString('id-ID') : '—'
}

// ── Expedition detector ────────────────────────────────────────────────────────
type Expedition = 'JNE' | 'JNT' | 'IDE' | 'SAP' | 'UNKNOWN'

function detectExpedition(t: string): Expedition {
  // JNE: harus ada AKJNE di nomor AWB
  if (/\bAKJNE[A-Z0-9]+\b/.test(t) || /AWB\s*:\s*AKJNE/i.test(t)) return 'JNE'
  // JNT: ciri khas domain/nama perusahaan
  if (/PT\.?\s*GLOBAL JET EXPRESS/i.test(t) || /www\.jet\.co\.id/i.test(t)) return 'JNT'
  // IDE / SAP: deteksi dari prefix nomor resi
  if (/No\.\s*Resi\s*:\s*IDE[0-9]/i.test(t)) return 'IDE'
  if (/No\.\s*Resi\s*:\s*BLO[0-9]/i.test(t)) return 'SAP'
  // Generic iD/SAP: ada "No. Resi:" dan "Nomor Telepon:"
  if (/No\.\s*Resi\s*:/i.test(t) && /Nomor Telepon/i.test(t)) return 'IDE'
  return 'UNKNOWN'
}

// ── Date ───────────────────────────────────────────────────────────────────────
function extractDate(t: string): string {
  // iD/SAP: No. Order: TRD20260512XXXXXX
  const trd = t.match(/TRD(\d{4})(\d{2})(\d{2})\d+/)
  if (trd) return `${trd[3]}-${trd[2]}-${trd[1]}`
  // JNE: YYYY-MM-DD
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`
  // JNT: Cetak / Ship / Tgl Dibuat: DD-MM-YYYY
  const m = t.match(/(?:Cetak|Ship|Tgl\s*Dibuat)\s*:\s*(\d{2}-\d{2}-\d{4})/i)
  if (m) return m[1]
  return todayISO()
}

// ── Waybill ────────────────────────────────────────────────────────────────────
function extractWaybillJNE(t: string): string {
  const m = t.match(/AWB\s*:\s*([A-Z0-9]{6,30})/i)
  return m ? m[1].toUpperCase() : ''
}

/**
 * JNT waybill — port dari resi-rare-2.py:
 * voting: 10-digit atau alphanumeric JO/AK/JD/JP, ambil yang paling sering muncul
 */
function extractWaybillJNT(t: string): string {
  // J&T baru: JO + 10 digit
  const jo = t.match(/(?<![A-Z0-9])(JO\d{10})(?![0-9])/)
  if (jo) return jo[1]

  // Voting: kumpulkan semua 10-digit + alphanumeric, ambil max
  const counter: Record<string, number> = {}
  for (const m of t.matchAll(/\b(\d{10})\b/g)) {
    counter[m[1]] = (counter[m[1]] || 0) + 1
  }
  for (const m of t.matchAll(/\b((?:JO|AK|JD|JP)\w{6,})\b/g)) {
    counter[m[1]] = (counter[m[1]] || 0) + 1
  }
  if (Object.keys(counter).length === 0) return ''
  return Object.entries(counter).sort((a, b) => b[1] - a[1])[0][0]
}

function extractWaybillIDESAP(t: string): string {
  const m = t.match(/No\.\s*Resi\s*:\s*([A-Z0-9]+)/i)
  return m ? m[1] : ''
}

function extractWaybill(t: string, exp: Expedition): string {
  switch (exp) {
    case 'JNE': return extractWaybillJNE(t)
    case 'JNT': return extractWaybillJNT(t)
    case 'IDE':
    case 'SAP': return extractWaybillIDESAP(t)
    default: {
      const lbl = t.match(/(?:No\.?\s*(?:Resi|Waybill|AWB)|AWB)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{5,30})/i)
      if (lbl) return lbl[1].toUpperCase()
      const fb = t.match(/\b(\d{8,20})\b/)
      return fb ? fb[1] : ''
    }
  }
}

// ── Receiver ───────────────────────────────────────────────────────────────────

/**
 * JNT receiver — port dari resi.py / resi-rare-2.py:
 * "Penerima: NAMA  ***08xxx" atau "Penerima: NAMA  0812xxxx"
 */
function extractReceiverJNT(t: string): string {
  for (const line of t.split('\n')) {
    // Format lama: Penerima: NAMA ***1234
    const m1 = line.match(/Penerima\s*:\s*(.+?)\s+\*+\d+/)
    if (m1) return norm(m1[1])
    // Format baru: Penerima: NAMA  081234... (tanpa ***)
    const m2 = line.match(/Penerima\s*:\s*(.+?)\s*(?:,\s*)?\d[\d*]{6,}[\d*]+$/)
    if (m2) return norm(m2[1]).replace(/,\s*$/, '')
  }
  return ''
}

function extractReceiverJNE(t: string): string {
  // "Nama: Penerima  Nama: Pengirim" — split by "Nama:"
  for (const line of t.split('\n')) {
    const parts = line.split(/Nama:\s*/).map(s => s.trim()).filter(Boolean)
    if (parts.length >= 2) return parts[0]
  }
  const m = t.match(/Penerima\s*:\s*([^,\n\r]{2,60}),/)
  return m ? norm(m[1]) : ''
}

function extractReceiverIDESAP(t: string): string {
  for (const line of t.split('\n')) {
    const m = line.match(/Nama:\s*(.+?)\s+Nama:\s*(.+)/)
    if (m) return norm(m[2])
  }
  const m2 = t.match(/Penerima[\s\S]{0,10}?Nama\s*:\s*([^\n\r0-9]{2,60})/i)
  return m2 ? norm(m2[1]) : ''
}

function extractReceiver(t: string, exp: Expedition): string {
  switch (exp) {
    case 'JNE': return extractReceiverJNE(t)
    case 'JNT': return extractReceiverJNT(t)
    case 'IDE':
    case 'SAP': return extractReceiverIDESAP(t)
    default: {
      const g = t.match(/(?:Penerima|Kepada|Nama\s+Penerima)\s*[:\-]?\s*([^\n\r]{2,60})/i)
      return g ? norm(g[1]) : ''
    }
  }
}

// ── Kecamatan JNT ─────────────────────────────────────────────────────────────

/**
 * parse_kecamatan — port dari resi-rare-2.py:
 * Ambil 2 bagian ALL CAPS terakhir dari alamat (caps_parts[-2], caps_parts[-1]).
 * Fallback: parts[-2], parts[-1].
 */
function parseKecamatanJNT(alamatFull: string): string {
  const clean = alamatFull.replace(/\s+/g, ' ').trim()
  const parts = clean.split(',').map(s => s.trim()).filter(Boolean)
  // Filter ALL CAPS dan bermakna (>2 char, ada huruf >=3 berturutan)
  const capsParts = parts.filter(p =>
    p === p.toUpperCase() && /[A-Z]{3,}/.test(p) && p.length > 2
  )
  if (capsParts.length >= 2) {
    return `${capsParts[capsParts.length - 2]}, ${capsParts[capsParts.length - 1]}`
  }
  if (capsParts.length === 1) return capsParts[capsParts.length - 1]
  // Fallback: 2 terakhir
  if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
  return clean
}

/**
 * find_penerima_address — port dari resi-rare-2.py:
 *
 * Prioritas 1: baris setelah "Penerima:" — stop di Pengirim/BIAYA/Notes/Syarat/Order/COD/DFOD/NP/EZ
 *   - Skip baris yang pure digit atau pure *+digit
 *
 * Fallback (resi-v2-3.py): scan semua baris ALL CAPS, cari blok berturutan,
 *   kumpulkan yang punya >=2 koma, ambil yang paling banyak koma
 */
function findPenerimaAddress(pageText: string): string {
  const lines = pageText.split('\n')

  // ── Prioritas 1: baris setelah "Penerima:" ──
  for (let i = 0; i < lines.length; i++) {
    if (/^Penerima\s*:/i.test(lines[i].trim())) {
      const addrLines: string[] = []
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const nl = lines[j].trim()
        if (/^(Pengirim\s*:|BIAYA|Notes|Syarat|Order|^(COD|DFOD|NP|EZ)$)/i.test(nl)) break
        if (/^\d+$/.test(nl) || /^\*+\d+$/.test(nl)) continue
        if (nl) addrLines.push(nl)
      }
      if (addrLines.length > 0) return addrLines.join(' ')
    }
  }

  // ── Fallback: ALL CAPS block dengan >=2 koma ──
  const candidates: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (
      line &&
      line === line.toUpperCase() &&
      line.includes(',') &&
      /[A-Z]{3,}/.test(line) &&
      line.length > 8 &&
      !/^\d+$/.test(line) &&
      !/^\*+\d+$/.test(line) &&
      !/^(LANDMARK|PT |JAKARTA UTARA|DKI JAKARTA)/.test(line)
    ) {
      const block = [line]
      let j = i + 1
      while (j < Math.min(i + 6, lines.length)) {
        const nl = lines[j].trim()
        if (
          nl &&
          nl === nl.toUpperCase() &&
          /[A-Z]{3,}/.test(nl) &&
          !/^\d+$/.test(nl) &&
          !/^(Syarat|PT |LANDMARK|COD$|NP$|EZ$|DFOD$|BULANAN$)/i.test(nl)
        ) {
          block.push(nl)
          j++
        } else break
      }
      const full = block.join(' ')
      if ((full.match(/,/g) ?? []).length >= 2) candidates.push(full)
    }
    i++
  }

  if (candidates.length > 0) {
    // Ambil yang paling banyak koma (paling detail)
    return candidates.reduce((a, b) => b.split(',').length > a.split(',').length ? b : a)
  }
  return ''
}

// ── Kecamatan JNE ─────────────────────────────────────────────────────────────
// port dari resi-jne-2.py: parse_kecamatan_jne
function parseKecamatanJNE(alamatFull: string): string {
  const clean = alamatFull.replace(/\s+/g, ' ').trim()
  const parts = clean.split(',').map(s => s.trim()).filter(Boolean)
  const capsParts = parts.filter(p => p === p.toUpperCase() && p.length > 3)
  if (capsParts.length >= 2) return `${capsParts[capsParts.length - 2]}, ${capsParts[capsParts.length - 1]}`
  if (capsParts.length === 1) return capsParts[capsParts.length - 1]
  if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
  return clean
}

function extractKecJNE(t: string): string {
  const lines = t.split('\n')
  for (let i = 0; i < lines.length; i++) {
    // "Penerima: NAMA, ALAMAT..."
    const m = lines[i].match(/^Penerima\s*:\s*.+?,\s*(.+)/)
    if (m) {
      let raw = m[1]
      // Gabung baris lanjutan
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nl = lines[j].trim()
        if (/^(Pengirim:|JNE|Asuransi|Harap|$)/i.test(nl)) break
        if (nl) raw += ', ' + nl
      }
      return parseKecamatanJNE(raw)
    }
  }
  return ''
}

// ── Kecamatan iD/SAP ──────────────────────────────────────────────────────────
// port dari resi-sap-id-5.py: parse_kecamatan_id_sap + state machine extract_id_sap
function extractKecIDESAP(t: string): string {
  const lines = t.split('\n')
  const addrParts: string[] = []
  let collecting = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Mulai collect dari: "Nomor Telepon: xxx  Alamat: [penerima awal]"
    const startM = line.match(/Nomor Telepon:\s*.+?\s+Alamat:\s*(.+)/i)
    if (startM) {
      addrParts.push(startM[1].trim())
      collecting = true
      continue
    }

    if (collecting) {
      if (/^\d{5}$/.test(line.trim()) || /^Nama Produk/i.test(line.trim())) {
        collecting = false; continue
      }
      const alamatM = line.match(/^Alamat:\s*(.+)/i)
      if (alamatM) {
        const split2 = alamatM[1].match(/^(.+?-\s*\d{5})\s+(.+)/)
        if (split2) addrParts.push(split2[2].trim())
        continue
      }
      const kotaM = line.match(/^(.+?-\s*\d{5})\s+(.+)/)
      if (kotaM) { addrParts.push(kotaM[2].trim()); continue }
      const nl = line.trim()
      if (nl && !/^(Nomor|Alamat|Nama|PICKUP|NON COD|[A-Z]{2,5}\d{4})/i.test(nl)) {
        addrParts.push(nl)
      }
    }
  }

  if (addrParts.length > 0) {
    const full = addrParts.join(', ').replace(/\s*-\s*$/, '').trim()
    const clean = full.replace(/\s*-\s*\d{5}$/, '').trim()
    const parts = clean.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length >= 4) return `${parts[parts.length - 3]}, ${parts[parts.length - 2]}`
    if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
    return clean
  }

  // Fallback regex
  const addrM = t.match(/Alamat\s*:[^\n\r]{0,200}?((?:[A-Za-z][A-Za-z ]{2,30},\s*){1,3}[A-Za-z][A-Za-z ]{2,30})\s*(?:-\s*\d{5}|,\s*\d{5}|\n)/i)
  if (addrM) {
    const parts = addrM[1].split(',').map(s => norm(s))
      .filter(s => s.length > 2 && !/^\d/.test(s) && !/^(jl|rt|rw|no|gg|gang|blok)/i.test(s))
    if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
    if (parts.length === 1) return parts[0]
  }
  return ''
}

function extractKec(t: string, exp: Expedition): string {
  switch (exp) {
    case 'JNT': {
      const addr = findPenerimaAddress(t)
      return addr ? parseKecamatanJNT(addr) : ''
    }
    case 'JNE': return extractKecJNE(t)
    case 'IDE':
    case 'SAP': return extractKecIDESAP(t)
    default: {
      const gen = t.match(/([A-Za-z][A-Za-z ]{2,25}),\s*([A-Za-z][A-Za-z ]{2,25})\s*\d{5}/)
      return gen ? `${norm(gen[1])}, ${norm(gen[2])}` : ''
    }
  }
}

// ── Biaya ──────────────────────────────────────────────────────────────────────
function extractBiaya(t: string, exp: Expedition): number {
  // JNE: Total Ongkir: 10.000
  if (exp === 'JNE') {
    const m = t.match(/Total Ongkir\s*:\s*([\d.]+)/i)
    if (m) return Number(m[1].replace(/\./g, ''))
  }
  // JNT / iD / SAP: IDR atau Rp
  return parseIDR(t)
}

// ── COD ────────────────────────────────────────────────────────────────────────
function isCOD(t: string): boolean {
  if (/NON\s*COD/i.test(t)) return false
  return /\b(COD|DFOD)\b/i.test(t)
}

// ── Block splitting ────────────────────────────────────────────────────────────
function buildBlocksFromPositions(fullText: string, positions: { pos: number }[]): string[] {
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
  // JNE: split by AWB: AKJNE
  const jnePos = [...fullText.matchAll(/AWB\s*:\s*(AKJNE[A-Z0-9]+)/gi)].map(m => ({ pos: m.index! }))
  if (jnePos.length > 1) return buildBlocksFromPositions(fullText, jnePos)

  // J&T baru: JO + 10 digit
  const joPos = [...fullText.matchAll(/(?<![A-Z0-9])(JO\d{10})(?![0-9])/g)].map(m => ({ pos: m.index! }))
  if (joPos.length > 1) return buildBlocksFromPositions(fullText, joPos)

  // JNT lama: 10-digit voting, ambil waybill yang muncul >= 2x, split by posisi kemunculan pertama
  const freq10: Record<string, number> = {}
  for (const m of fullText.matchAll(/\b(\d{10})\b/g)) {
    freq10[m[1]] = (freq10[m[1]] || 0) + 1
  }
  const candidates = Object.entries(freq10).filter(([, c]) => c >= 2).map(([k]) => k)
  if (candidates.length > 1) {
    const pos = candidates
      .map(wb => ({ pos: fullText.indexOf(wb) }))
      .filter(x => x.pos !== -1)
      .sort((a, b) => a.pos - b.pos)
    return buildBlocksFromPositions(fullText, pos)
  }

  // iD/SAP: split by "No. Resi:"
  const resiPos = [...fullText.matchAll(/No\.\s*Resi\s*:/gi)].map(m => ({ pos: m.index! }))
  if (resiPos.length > 1) return buildBlocksFromPositions(fullText, resiPos)

  // Fallback: per halaman
  return pageTexts.filter(p => p.trim().length > 20)
}

// ── Row builder ────────────────────────────────────────────────────────────────
export function buildRow(text: string, label: string, idx: number): ResiRow {
  const exp = detectExpedition(text)
  const biaya = extractBiaya(text, exp)
  return {
    _id: Math.random().toString(36).slice(2, 9),
    tanggal: extractDate(text),
    waybill: extractWaybill(text, exp),
    penerima: extractReceiver(text, exp),
    kecamatan: extractKec(text, exp),
    biaya,
    cod: isCOD(text) ? 'Ya' : 'Tidak',
    keterangan: label + (idx > 0 ? ` #${idx + 1}` : ''),
  }
}

// ── PDF parser ─────────────────────────────────────────────────────────────────
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
  const seenWaybills = new Set<string>()

  for (let i = 0; i < blocks.length; i++) {
    // Skip "Lembar Pengirim" — Python: resi-pertama-3.py
    if (/Lembar Pengirim/i.test(blocks[i])) continue

    const row = buildRow(blocks[i], file.name, i)
    if (!row.waybill) {
      if (blocks.length === 1) rows.push(row)
      continue
    }
    if (seenWaybills.has(row.waybill)) continue
    seenWaybills.add(row.waybill)
    rows.push(row)
  }
  return rows
}
