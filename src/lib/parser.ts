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
  if (/\bAKJNE[A-Z0-9]+\b/.test(t) || /AWB\s*:\s*AKJNE/i.test(t)) return 'JNE'
  if (/PT\.?\s*GLOBAL JET EXPRESS/i.test(t) || /www\.jet\.co\.id/i.test(t)) return 'JNT'
  if (/No\.\s*Resi\s*:\s*IDE[0-9]/i.test(t)) return 'IDE'
  if (/No\.\s*Resi\s*:\s*BLO[0-9]/i.test(t)) return 'SAP'
  if (/No\.\s*Resi\s*:/i.test(t) && /Nomor Telepon/i.test(t)) return 'IDE'
  return 'UNKNOWN'
}

// ── Date ───────────────────────────────────────────────────────────────────────
function extractDate(t: string): string {
  const trd = t.match(/TRD(\d{4})(\d{2})(\d{2})\d+/)
  if (trd) return `${trd[3]}-${trd[2]}-${trd[1]}`
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
 * JNT waybill:
 * - J&T baru: JO + 10 digit (JO0323905055)
 * - J&T lama: voting angka 10 digit terbanyak muncul (1357207478 muncul 8x)
 * - Juga cek prefix alphanumeric: AK, JD, JP
 */
function extractWaybillJNT(t: string): string {
  // J&T baru: JO + 10 digit
  const jo = t.match(/(?<![A-Z0-9])(JO\d{10})(?![0-9])/)
  if (jo) return jo[1]

  // Voting: 10-digit + alphanumeric prefix
  const counter: Record<string, number> = {}
  for (const m of t.matchAll(/\b(\d{10})\b/g)) {
    counter[m[1]] = (counter[m[1]] || 0) + 1
  }
  for (const m of t.matchAll(/\b((?:AK|JD|JP)\w{6,})\b/g)) {
    counter[m[1]] = (counter[m[1]] || 0) + 1
  }
  if (!Object.keys(counter).length) return ''
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

// ── Receiver JNT ───────────────────────────────────────────────────────────────
/**
 * Format yang ditemukan di 4 PDF:
 *   "Penerima: MBA OPY******0033"           → nama: MBA OPY
 *   "Penerima: EMMA WAHYUNI"               → nama: EMMA WAHYUNI  (tanpa HP di baris ini)
 *   "Penerima : Ratna Nuraeni, 0857265*****" → nama: Ratna Nuraeni
 *
 * Logika: ambil teks setelah "Penerima:" lalu strip HP/mask di akhir
 */
function extractReceiverJNT(t: string): string {
  for (const line of t.split('\n')) {
    const m = line.match(/Penerima\s*:\s*(.+)/)
    if (!m) continue
    let name = m[1].trim()
    // Hapus HP / mask di akhir: "081xxx", "***1234", "0857265*****"
    name = name.replace(/\s*,?\s*(?:\*+\d+|\d[\d*]{7,})\s*$/, '')
    name = norm(name)
    if (name.length >= 2) return name
  }
  return ''
}

// ── Receiver JNE ───────────────────────────────────────────────────────────────
function extractReceiverJNE(t: string): string {
  for (const line of t.split('\n')) {
    const parts = line.split(/Nama:\s*/).map(s => s.trim()).filter(Boolean)
    if (parts.length >= 2) return parts[0]
  }
  const m = t.match(/Penerima\s*:\s*([^,\n\r]{2,60}),/)
  return m ? norm(m[1]) : ''
}

// ── Receiver iD/SAP ────────────────────────────────────────────────────────────
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
 * Dari 4 PDF nyata, alamat penerima JNT punya struktur:
 *   "BEKASI, BEKASI BARAT, JL TAHIR NO 59 RT03/11 KRANJI, BEKASI BARAT KOTA BEKASI 17135"
 *   "KEDIRI, KEDIRI KOTA, JL. MAYOR BISMONO NO. 265 ..."
 *   "KEPANJEN, SUMBERMANJING WETAN, JL. MULYOSARI RT.031 ..."
 *   "Dk.Pendem RT.02 RW.05 ..., AMPEL, KABUPATEN BOYOLALI"
 *
 * Kecamatan = 2 token ALL CAPS pertama (untuk format KOTA, KECAMATAN, jl...)
 * Untuk format mixed-case dengan CAPS di akhir → tetap ambil 2 CAPS pertama
 */
function parseKecamatanJNT(alamat: string): string {
  const clean = norm(alamat)
  const parts = clean.split(',').map(s => s.trim()).filter(Boolean)

  // Filter parts yang ALL CAPS dan bermakna
  const capsParts = parts.filter(p =>
    p === p.toUpperCase() && /[A-Z]{3,}/.test(p) && p.length > 2
  )

  // Dari pola PDF: KOTA selalu di posisi pertama atau kedua
  // ambil 2 CAPS pertama (bukan terakhir)
  if (capsParts.length >= 2) {
    return `${capsParts[0]}, ${capsParts[1]}`
  }
  if (capsParts.length === 1) return capsParts[0]

  // Fallback: 2 parts pertama yang bukan jalan/RT/RW
  const meaningful = parts.filter(p =>
    !/^(JL|Jl|RT|RW|NO|GG|GANG|BLOK|Gg|Kec|Kel|Kab|Dk|Desa)\b/i.test(p.trim()) &&
    p.trim().length > 2
  )
  if (meaningful.length >= 2) return `${meaningful[0]}, ${meaningful[1]}`
  if (meaningful.length === 1) return meaningful[0]
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`
  return clean
}

/**
 * Ekstrak alamat penerima dari blok teks JNT.
 *
 * Dari PDF nyata, ada 2 pola:
 *
 * POLA A (JNT-2, JNT-3): alamat langsung mepet setelah nama+mask di baris sama
 *   "Penerima: MBA OPY******0033BEKASI, BEKASI BARAT, JL TAHIR..."
 *   → setelah strip nama+HP, sisa baris = alamat
 *
 * POLA B (JNT-4): alamat di baris berikutnya setelah "Penerima : Nama, hp"
 *   "Penerima : Ratna Nuraeni, 0857265*****"
 *   "Dk.Pendem RT.02 ... , AMPEL, KABUPATEN BOYOLALI"
 *
 * POLA C (JNT-1): alamat ALL CAPS terpisah di tempat lain di halaman
 *   "KEPANJEN, SUMBERMANJING WETAN, JL.MULYOSARI RT.031 RW.009..."
 */
function findPenerimaAddressJNT(pageText: string): string {
  const lines = pageText.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/Penerima\s*:/i.test(line)) continue

    // POLA A: cek sisa teks di baris yang sama setelah nama+HP/mask
    // strip "Penerima: NAMA ******hp" atau "Penerima: NAMA 081xxx" lalu ambil sisanya
    const inlineAddr = line.replace(/Penerima\s*:\s*/i, '')
      .replace(/^.+?(?:\*+\d+|\d[\d*]{7,})\s*/, '')  // buang nama + HP/mask
      .trim()
    if (inlineAddr.length > 5 && /,/.test(inlineAddr)) {
      return inlineAddr
    }

    // POLA B: baris berikutnya = alamat
    const addrLines: string[] = []
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const nl = lines[j].trim()
      if (/^(Pengirim\s*:|BIAYA|Notes|Syarat|Order|Lembar|PT\.|LANDMARK)/i.test(nl)) break
      if (/^(COD|DFOD|NP|EZ|BULANAN)$/i.test(nl)) break
      if (/^\d+$/.test(nl) || /^\*+\d+$/.test(nl)) continue
      if (nl.length > 3) addrLines.push(nl)
    }
    if (addrLines.length > 0 && /,/.test(addrLines.join(' '))) {
      return addrLines.join(' ')
    }
  }

  // POLA C: scan seluruh halaman cari baris ALL CAPS dengan >=2 koma
  // (bukan footer perusahaan / landmark)
  const candidates: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (
      line.length > 8 &&
      line === line.toUpperCase() &&
      line.includes(',') &&
      /[A-Z]{3,}/.test(line) &&
      !/^\d+$/.test(line) &&
      !/^(LANDMARK|PT\s|JAKARTA UTARA|DKI JAKARTA|PLUIT)/i.test(line)
    ) {
      // Gabung baris CAPS berturutan
      const block = [line]
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const nl = lines[j].trim()
        if (
          nl && nl === nl.toUpperCase() && /[A-Z]{3,}/.test(nl) &&
          !/^\d+$/.test(nl) &&
          !/^(LANDMARK|PT\s|COD|NP|EZ|DFOD|BULANAN|BIAYA)/i.test(nl)
        ) {
          block.push(nl)
        } else break
      }
      const full = block.join(' ')
      if ((full.match(/,/g) ?? []).length >= 2) candidates.push(full)
    }
  }

  if (candidates.length > 0) {
    return candidates.reduce((a, b) => b.split(',').length > a.split(',').length ? b : a)
  }

  return ''
}

// ── Kecamatan JNE ─────────────────────────────────────────────────────────────
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
    const m = lines[i].match(/^Penerima\s*:\s*.+?,\s*(.+)/)
    if (m) {
      let raw = m[1]
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
function extractKecIDESAP(t: string): string {
  const lines = t.split('\n')
  const addrParts: string[] = []
  let collecting = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
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
      const addr = findPenerimaAddressJNT(t)
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
  if (exp === 'JNE') {
    const m = t.match(/Total Ongkir\s*:\s*([\d.]+)/i)
    if (m) return Number(m[1].replace(/\./g, ''))
  }
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
  // JNE
  const jnePos = [...fullText.matchAll(/AWB\s*:\s*(AKJNE[A-Z0-9]+)/gi)].map(m => ({ pos: m.index! }))
  if (jnePos.length > 1) return buildBlocksFromPositions(fullText, jnePos)

  // J&T baru: JO + 10 digit
  const joPos = [...fullText.matchAll(/(?<![A-Z0-9])(JO\d{10})(?![0-9])/g)].map(m => ({ pos: m.index! }))
  if (joPos.length > 1) return buildBlocksFromPositions(fullText, joPos)

  // JNT lama: 10-digit voting — waybil muncul paling sering, split per kemunculan pertama
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

  // iD/SAP
  const resiPos = [...fullText.matchAll(/No\.\s*Resi\s*:/gi)].map(m => ({ pos: m.index! }))
  if (resiPos.length > 1) return buildBlocksFromPositions(fullText, resiPos)

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
    // Skip lembar pengirim (JNT)
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
