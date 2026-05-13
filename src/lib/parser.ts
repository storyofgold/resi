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

// ── Expedition detector ─────────────────────────────────────────────────────────
type Expedition = 'JNE' | 'JNT' | 'IDE' | 'SAP' | 'UNKNOWN'

function detectExpedition(t: string): Expedition {
  if (/\bAKJNE[A-Z0-9]+\b/.test(t) || /AWB\s*:\s*AKJNE/i.test(t) || /AWB\s*:/i.test(t) && /Alamat Lengkap/i.test(t)) return 'JNE'
  if (/PT\.?\s*GLOBAL JET EXPRESS/i.test(t) || /www\.jet\.co\.id/i.test(t)) return 'JNT'
  if (/No\.\s*Resi\s*:\s*IDE[0-9]/i.test(t)) return 'IDE'
  if (/No\.\s*Resi\s*:\s*BLO[0-9]/i.test(t)) return 'SAP'
  // Generic iD/SAP: ada "No. Resi:" dan "Nomor Telepon:"
  if (/No\.\s*Resi\s*:/i.test(t) && /Nomor Telepon/i.test(t)) return 'IDE'
  return 'UNKNOWN'
}

// ── Date ─────────────────────────────────────────────────────────────────────────
function extractDate(t: string): string {
  // iD/SAP: No. Order: TRD20260512XXXXXX
  const trd = t.match(/TRD(\d{4})(\d{2})(\d{2})\d+/)
  if (trd) return `${trd[3]}-${trd[2]}-${trd[1]}`

  // JNE: YYYY-MM-DD
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`

  // JNT: Cetak/Ship/Tgl Dibuat: DD-MM-YYYY
  const m = t.match(/(?:Cetak|Ship|Tgl\s*Dibuat|Tanggal|Date)\s*[:\-]?\s*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/i)
  if (m) return m[1].replace(/\//g, '-')

  return todayISO()
}

// ── Waybill ───────────────────────────────────────────────────────────────────────
function extractWaybillJNE(t: string): string {
  const awb = t.match(/AWB\s*:\s*([A-Z0-9]{6,30})/i)
  if (awb) return awb[1].toUpperCase()
  const m = t.match(/\bAKJNE[A-Z0-9]{3,20}\b/)
  return m ? m[0] : ''
}

function extractWaybillJNT(t: string): string {
  // JO + 10 digit (J&T Express baru)
  const jo = t.match(/(?<![A-Z0-9])(JO\d{10})(?![0-9])/)
  if (jo) return jo[1]
  // Voting: 10-digit numeric yang paling sering muncul
  const freq: Record<string, number> = {}
  for (const m of t.matchAll(/\b(\d{10})\b/g)) {
    freq[m[1]] = (freq[m[1]] || 0) + 1
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])
  if (top.length && top[0][1] >= 2) return top[0][0]
  return ''
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

// ── Receiver name ─────────────────────────────────────────────────────────────────

/** JNT: parse nama penerima dari baris "Penerima: NAMA ***08xxx" atau tanpa mask */
function extractReceiverJNT(t: string): string {
  const lines = t.split('\n')
  for (const line of lines) {
    // Dengan mask: "Penerima: NAMA ***1234" atau "Penerima: NAMA 08xxx"
    const m1 = line.match(/Penerima\s*:\s*(.+?)\s*(?:,\s*)?\d[\d*]{6,}[*\d]+$/)
    if (m1) return norm(m1[1]).replace(/[,\s]*$/, '')
    // Tanpa mask, inline comma: "Penerima: NAMA, 08xxx"
    const m2 = line.match(/Penerima\s*:\s*([A-Za-z][A-Za-z .]{1,50}?)\s*,\s*0\d{8,}/)
    if (m2) return norm(m2[1])
  }
  return ''
}

/** JNE: "Nama: Penerima  Nama: Pengirim" muncul di 1 baris */
function extractReceiverJNE(t: string): string {
  const lines = t.split('\n')
  for (const line of lines) {
    const parts = line.split(/Nama:\s*/).map(s => s.trim()).filter(Boolean)
    if (parts.length >= 2) return parts[0]
    if (parts.length === 1 && /Penerima/i.test(lines[Math.max(0, lines.indexOf(line) - 3)])) return parts[0]
  }
  // Fallback: "Penerima: Nama, alamat..."
  const m = t.match(/Penerima\s*:\s*([^,\n\r]{2,60}),/)
  return m ? norm(m[1]) : ''
}

/** iD/SAP: "Nama: [pengirim]  Nama: [penerima]" — dua kolom di 1 baris */
function extractReceiverIDESAP(t: string): string {
  const lines = t.split('\n')
  for (const line of lines) {
    const m = line.match(/Nama:\s*(.+?)\s+Nama:\s*(.+)/)
    if (m) return norm(m[2])
  }
  // Fallback: blok "Penerima\nNama: ..."
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
      const g = t.match(/(?:Penerima|Kepada|Nama\s+Penerima|Receiver)\s*[:\-]?\s*([^\n\r]{2,60})/i)
      return g ? norm(g[1]) : ''
    }
  }
}

// ── Kecamatan ─────────────────────────────────────────────────────────────────────

/**
 * JNT: cari alamat penerima berdasarkan logika Python:
 * 1. Baris setelah "Penerima:" — stop di Pengirim/BIAYA/Notes/Syarat/Order/COD/DFOD
 * 2. Fallback: cari blok ALL CAPS dengan >=2 koma, ambil yang paling banyak koma
 */
function findAddrJNT(t: string): string {
  const lines = t.split('\n')

  // Prioritas 1: baris setelah "Penerima:"
  for (let i = 0; i < lines.length; i++) {
    if (/^Penerima\s*:/i.test(lines[i].trim())) {
      const addrLines: string[] = []
      for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
        const nl = lines[j].trim()
        if (/^(Pengirim\s*:|BIAYA|Notes|Syarat|Order|COD$|DFOD$|NP$|EZ$)/i.test(nl)) break
        if (/^\d+$/.test(nl) || /^\*+\d+$/.test(nl)) continue
        if (nl) addrLines.push(nl)
      }
      if (addrLines.length > 0) return addrLines.join(' ')
    }
  }

  // Fallback: blok ALL CAPS dengan >=2 koma
  const candidates: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (
      line && line === line.toUpperCase() &&
      line.includes(',') &&
      /[A-Z]{3,}/.test(line) &&
      line.length > 8 &&
      !/^\d+$/.test(line) &&
      !/^(LANDMARK|PT |JAKARTA UTARA|DKI JAKARTA)/.test(line)
    ) {
      const block = [line]
      let j = i + 1
      while (j < Math.min(i + 6, lines.length)) {
        const nl = lines[j].trim()
        if (
          nl && nl === nl.toUpperCase() &&
          /[A-Z]{3,}/.test(nl) &&
          !/^\d+$/.test(nl) &&
          !/^(Syarat|PT |LANDMARK|COD$|NP$|EZ$|DFOD$|BULANAN$)/i.test(nl)
        ) {
          block.push(nl)
          j++
        } else break
      }
      const full = block.join(' ')
      if ((full.match(/,/g) || []).length >= 2) candidates.push(full)
    }
    i++
  }
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => (b.split(',').length > a.split(',').length ? b : a))
  }
  return ''
}

/**
 * JNT: dari alamat_full, ambil 2 bagian ALL CAPS terakhir.
 * Python: caps_parts[-2] + caps_parts[-1]
 */
function parseKecJNT(alamat: string): string {
  const clean = alamat.replace(/\s+/g, ' ').trim()
  const parts = clean.split(',').map(s => s.trim()).filter(Boolean)
  const capsParts = parts.filter(p => p === p.toUpperCase() && /[A-Z]{3,}/.test(p) && p.length > 2)
  if (capsParts.length >= 2) return `${capsParts[capsParts.length - 2]}, ${capsParts[capsParts.length - 1]}`
  if (capsParts.length === 1) return capsParts[capsParts.length - 1]
  if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
  return clean
}

/**
 * JNE: dari "Penerima: nama, alamat..." ambil bagian alamat,
 * lalu ambil 2 bagian ALL CAPS terakhir.
 * Python: caps_parts[-2] + caps_parts[-1]
 */
function extractKecJNE(t: string): string {
  const lines = t.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^Penerima\s*:\s*.+?,\s*(.+)/)
    if (m) {
      let raw = m[1]
      // Gabung baris lanjutan
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const nl = lines[j].trim()
        if (/^(Pengirim:|JNE|Asuransi|Harap|^$)/i.test(nl)) break
        if (nl) raw += ', ' + nl
      }
      // Ambil 2 ALL CAPS terakhir
      const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
      const caps = parts.filter(p => p === p.toUpperCase() && p.length > 3)
      if (caps.length >= 2) return `${caps[caps.length - 2]}, ${caps[caps.length - 1]}`
      if (caps.length === 1) return caps[caps.length - 1]
      if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
    }
  }
  return ''
}

/**
 * iD/SAP: kumpulkan baris alamat penerima dengan state machine,
 * lalu ambil parts[-3] dan parts[-2] (hapus kodepos dulu).
 * Logika dari resi-sap-id-5.py extract_id_sap()
 */
function extractKecIDESAP(t: string): string {
  const lines = t.split('\n')
  const addrParts: string[] = []
  let collecting = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Mulai collect: "Nomor Telepon: xxx  Alamat: [penerima awal]"
    const startM = line.match(/Nomor Telepon:\s*.+?\s+Alamat:\s*(.+)/i)
    if (startM) {
      addrParts.push(startM[1].trim())
      collecting = true
      continue
    }

    if (collecting) {
      // Stop: hanya kodepos atau "Nama Produk"
      if (/^\d{5}$/.test(line.trim()) || /^Nama Produk/i.test(line.trim())) {
        collecting = false
        continue
      }
      // Baris "Alamat: [kota pgm - kodepos] [lanjutan penerima]"
      const alamatM = line.match(/^Alamat:\s*(.+)/i)
      if (alamatM) {
        const sisa = alamatM[1]
        const split2 = sisa.match(/^(.+?-\s*\d{5})\s+(.+)/)
        if (split2) addrParts.push(split2[2].trim())
        continue
      }
      // "kota - kodepos  lanjutan"
      const kotaM = line.match(/^(.+?-\s*\d{5})\s+(.+)/)
      if (kotaM) {
        addrParts.push(kotaM[2].trim())
        continue
      }
      // Baris biasa
      const nl = line.trim()
      if (nl && !/^(Nomor|Alamat|Nama|PICKUP|NON COD|[A-Z]{2,5}\d{4})/i.test(nl)) {
        addrParts.push(nl)
      }
    }
  }

  if (addrParts.length > 0) {
    const full = addrParts.join(', ').replace(/\s*-\s*$/, '').trim()
    // Hapus kodepos di akhir
    const clean = full.replace(/\s*-\s*\d{5}$/, '').trim()
    const parts = clean.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length >= 4) return `${parts[parts.length - 3]}, ${parts[parts.length - 2]}`
    if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
    return clean
  }

  // Fallback: cari "Alamat: ... - kodepos"
  const addrM = t.match(/Alamat\s*:[^\n\r]{0,200}?((?:[A-Za-z][A-Za-z ]{2,30},\s*){1,3}[A-Za-z][A-Za-z ]{2,30})\s*(?:-\s*\d{5}|,\s*\d{5}|\n)/i)
  if (addrM) {
    const parts = addrM[1].split(',').map(s => norm(s)).filter(s => s.length > 2 && !/^\d/.test(s) && !/^(jl|rt|rw|no|gg|gang|blok)/i.test(s))
    if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
    if (parts.length === 1) return parts[0]
  }
  return ''
}

function extractKec(t: string, exp: Expedition): string {
  switch (exp) {
    case 'JNE': return extractKecJNE(t)
    case 'JNT': {
      const addr = findAddrJNT(t)
      return addr ? parseKecJNT(addr) : ''
    }
    case 'IDE':
    case 'SAP': return extractKecIDESAP(t)
    default: {
      const gen = t.match(/([A-Za-z][A-Za-z ]{2,25}),\s*([A-Za-z][A-Za-z ]{2,25})\s*\d{5}/)
      return gen ? `${norm(gen[1])}, ${norm(gen[2])}` : ''
    }
  }
}

// ── COD detection ────────────────────────────────────────────────────────────────
function isCOD(t: string): boolean {
  if (/NON\s*COD/i.test(t)) return false
  return /\b(COD|DFOD|COD ONGKIR)\b/i.test(t)
}

// ── Biaya ────────────────────────────────────────────────────────────────────────
function extractBiaya(t: string, exp: Expedition): number {
  // JNE: "Total Ongkir: 10.000"
  if (exp === 'JNE') {
    const m = t.match(/Total Ongkir\s*:\s*([\d.]+)/i)
    if (m) return Number(m[1].replace(/\./g, ''))
  }
  // Generic: IDR / Rp
  return parseIDR(t)
}

// ── Block splitting ───────────────────────────────────────────────────────────────
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
  const jneMatches = [...fullText.matchAll(/AWB\s*:\s*(AKJNE[A-Z0-9]+)/gi)].map(m => ({ pos: m.index! }))
  if (jneMatches.length > 1) return buildBlocksFromPositions(fullText, jneMatches)

  // J&T: JO + 10 digit
  const joAll = [...fullText.matchAll(/(?<![A-Z0-9])(JO\d{10})(?![0-9])/g)].map(m => ({ pos: m.index! }))
  if (joAll.length > 1) return buildBlocksFromPositions(fullText, joAll)

  // JNT lama: 10-digit numeric muncul >= 2x per resi (voting)
  const freq10: Record<string, number> = {}
  for (const m of fullText.matchAll(/\b(\d{10})\b/g)) {
    freq10[m[1]] = (freq10[m[1]] || 0) + 1
  }
  const wb10 = Object.entries(freq10).filter(([, c]) => c >= 2).map(([k]) => k)
  if (wb10.length > 1) {
    const pos = wb10
      .map(wb => ({ pos: fullText.indexOf(wb) }))
      .filter(x => x.pos !== -1)
      .sort((a, b) => a.pos - b.pos)
    return buildBlocksFromPositions(fullText, pos)
  }

  // iD/SAP: split by "No. Resi:"
  const resiMatches = [...fullText.matchAll(/No\.\s*Resi\s*:/gi)].map(m => ({ pos: m.index! }))
  if (resiMatches.length > 1) return buildBlocksFromPositions(fullText, resiMatches)

  // Fallback per halaman
  return pageTexts.filter(p => p.trim().length > 20)
}

// ── Row builder ───────────────────────────────────────────────────────────────────
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

// ── PDF parser ────────────────────────────────────────────────────────────────────
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
    // Skip blok "Lembar Pengirim" untuk JNT (sesuai Python resi-pertama-3.py)
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
