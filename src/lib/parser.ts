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

type Expedition = 'JNE' | 'JNT' | 'IDE' | 'SAP' | 'UNKNOWN'

function detectExpedition(t: string): Expedition {
  if (/\bAKJNE[A-Z0-9]+\b/.test(t) || /AWB\s*:\s*AKJNE/i.test(t)) return 'JNE'
  if (/PT\.?\s*GLOBAL JET EXPRESS/i.test(t) || /www\.jet\.co\.id/i.test(t)) return 'JNT'
  if (/No\.\s*Resi\s*:\s*IDE[0-9]/i.test(t)) return 'IDE'
  if (/No\.\s*Resi\s*:\s*BLO[0-9]/i.test(t)) return 'SAP'
  if (/No\.\s*Resi\s*:/i.test(t) && /Nomor Telepon/i.test(t)) return 'IDE'
  return 'UNKNOWN'
}

function extractDate(t: string): string {
  const trd = t.match(/TRD(\d{4})(\d{2})(\d{2})\d+/)
  if (trd) return `${trd[3]}-${trd[2]}-${trd[1]}`
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`
  const m = t.match(/(?:Cetak|Ship|Tgl\s*Dibuat)\s*:\s*(\d{2}-\d{2}-\d{4})/i)
  if (m) return m[1]
  return todayISO()
}

function extractWaybillJNE(t: string): string {
  const m = t.match(/AWB\s*:\s*([A-Z0-9]{6,30})/i)
  return m ? m[1].toUpperCase() : ''
}

function extractWaybillJNT(t: string): string {
  const jo = t.match(/(?<![A-Z0-9])(JO\d{10})(?![0-9])/)
  if (jo) return jo[1]

  const counter13: Record<string, number> = {}
  for (const m of t.matchAll(/\b(\d{13})\b/g)) {
    counter13[m[1]] = (counter13[m[1]] || 0) + 1
  }
  const wb13 = Object.entries(counter13).filter(([, c]) => c >= 2)
  if (wb13.length > 0) return wb13.sort((a, b) => b[1] - a[1])[0][0]

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

// Token yang pasti bukan nama orang di resi J&T
const JNT_NOISE = new Set([
  'COD','DFOD','NP','EZ','BULANAN','PAKAIAN','FASHION','ELEKTRONIK',
  'MAKANAN','MINUMAN','KOSMETIK','DOKUMEN','AKSESORIS','MAINAN',
  'LANDMARK','PLUIT','JAKARTA','PENJARINGAN','DKI','BLOK',
  'PT','GLOBAL','JET','EXPRESS','BIAYA','TOTAL','IDR','PPN',
  'SYARAT','KETENTUAN','PENGIRIMAN','WEBSITE','LEMBAR','PENGIRIM',
  'MALL','STORE','SHOP','MARKET','MATAHARI','ALFAMART','INDOMARET',
  'TOKOPEDIA','SHOPEE','LAZADA','BLIBLI','BUKALAPAK','TOKO','OFFICIAL',
  'THE','PARK','MDS','TRADE','CENTER','PLAZA','SQUARE',
  'BARANG','QTY','PCS','NOTES','KG','BARAT','TIMUR','SELATAN','UTARA',
  'JAWA','SUMATERA','KALIMANTAN','SULAWESI','BALI','NUSA','PAPUA',
])

function isLikelyName(s: string): boolean {
  const words = s.trim().split(/\s+/)
  if (words.length < 1 || words.length > 4) return false
  if (s.length < 3 || s.length > 40) return false
  // Tolak jika ada angka, simbol kecuali slash (nama seperti "Nurajah / Mama N")
  if (/[^A-Za-z\s/]/.test(s)) return false
  // Tolak jika ADA satu token pun yang masuk noise
  if (words.some(w => JNT_NOISE.has(w.toUpperCase()))) return false
  return true
}

function extractReceiverJNT(t: string): string {
  const lines = t.split('\n')

  // Strategi 1: "Penerima: <nama>" inline, strip masked number
  for (const line of lines) {
    const m = line.match(/Penerima\s*:\s*(.+)/)
    if (!m) continue
    let name = m[1].trim()
    name = name.replace(/\s*,?\s*(?:\*+\d+|\d[\d*]{7,})\s*$/, '')
    name = name.replace(/^(?:\*+\d+|\d[\d*]{7,})\s*,?\s*/, '')
    name = norm(name)
    if (name.length >= 2) return name
  }

  // Strategi 2: reverse scan — nama uppercase valid TERAKHIR di dokumen.
  // Pada format lembar pengirim J&T, nama penerima selalu muncul
  // di bagian akhir teks setelah semua field lain (Notes:, PAKAIAN, dll).
  for (let i = lines.length - 1; i >= 0; i--) {
    const cand = norm(lines[i])
    if (cand === cand.toUpperCase() && isLikelyName(cand)) return cand
  }

  // Strategi 3: frequency fallback — nama muncul >=2x
  const freq: Record<string, number> = {}
  for (const line of lines) {
    const cand = norm(line)
    if (cand !== cand.toUpperCase()) continue
    if (!isLikelyName(cand)) continue
    freq[cand] = (freq[cand] || 0) + 1
  }
  const best = Object.entries(freq).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])
  if (best.length > 0) return best[0][0]

  return ''
}

function extractReceiverJNE(t: string): string {
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

function parseKecamatanJNT(alamat: string): string {
  const clean = norm(alamat)
  const parts = clean.split(',').map(s => s.trim()).filter(Boolean)
  const capsParts = parts.filter(p =>
    p === p.toUpperCase() &&
    /[A-Z]{3,}/.test(p) &&
    p.length > 2 &&
    !/^(RT|RW|JL|BLOK|GANG|GG)\b/.test(p)
  )
  if (capsParts.length >= 2) return `${capsParts[0]}, ${capsParts[1]}`
  if (capsParts.length === 1) return capsParts[0]
  const meaningful = parts.filter(p =>
    !/^(JL|Jl|RT|RW|NO|GG|GANG|BLOK|Gg|Kec|Kel|Kab|Dk|Desa)\b/i.test(p.trim()) &&
    p.trim().length > 2
  )
  if (meaningful.length >= 2) return `${meaningful[0]}, ${meaningful[1]}`
  if (meaningful.length === 1) return meaningful[0]
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`
  return clean
}

function findPenerimaAddressJNT(pageText: string): string {
  const lines = pageText.split('\n')

  // Pass 1: kumpulkan baris setelah label "Penerima:"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/Penerima\s*:/i.test(line)) continue

    // Coba ambil inline (setelah strip nama/masked)
    const afterLabel = line.replace(/Penerima\s*:\s*/i, '').trim()
    const inlineAddr = afterLabel
      .replace(/^(?:\*+\d+|\d[\d*]{7,})\s*,?\s*/, '')
      .trim()
    if (inlineAddr.length > 5 && /,/.test(inlineAddr)) return inlineAddr

    const addrLines: string[] = []
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const nl = lines[j].trim()
      if (/^(Pengirim\s*:|BIAYA|Notes\s*:|Syarat|Order|PT\.|LANDMARK|Sudah Termasuk|TOTAL BIAYA|Qty)/i.test(nl)) break
      if (/^(COD|DFOD|NP|EZ|BULANAN)$/i.test(nl)) break
      if (/^(IDR|Rp)\b/i.test(nl)) continue  // skip baris biaya
      if (/^\d+$/.test(nl) || /^\*+\d+$/.test(nl) || /^\d{10}$/.test(nl)) continue
      if (/^\d{13}$/.test(nl)) continue
      if (isLikelyName(norm(nl))) continue  // skip baris nama, bukan alamat
      if (nl.length > 3) addrLines.push(nl)
    }
    const joined = addrLines.join(' ')
    if (addrLines.length > 0 && /,/.test(joined)) return joined
  }

  // Pass 2: scan seluruh halaman — cari baris uppercase dengan koma
  // exclude: landmark/DKI/JAKARTA pengirim, baris IDR/biaya, noise
  const candidates: string[] = []
  for (const line of lines) {
    const l = line.trim()
    if (l !== l.toUpperCase()) continue
    if (!l || l.startsWith(';;')) continue
    if (/^\d+$/.test(l) || /^\*/.test(l)) continue
    if (/^(IDR|Rp)\b/i.test(l)) continue
    if (/LANDMARK|DKI JAKARTA|JAKARTA UTARA|PT GLOBAL|JAKARTA,/i.test(l)) continue
    if (l.count(',') < 1) continue   // TS workaround below
    const commaCount = (l.match(/,/g) ?? []).length
    if (commaCount < 1) continue
    if (!/[A-Z]{3,}/.test(l) || l.length <= 8) continue
    // Pastikan ada setidaknya 2 token non-noise non-angka
    const words = l.replace(/,/g, ' ').split(/\s+/)
    const nonNoise = words.filter(w => !JNT_NOISE.has(w) && !/^\d/.test(w) && w.length > 1)
    if (nonNoise.length < 2) continue
    candidates.push(l)
  }
  if (candidates.length > 0)
    return candidates.reduce((a, b) => (b.match(/,/g) ?? []).length > (a.match(/,/g) ?? []).length ? b : a)
  return ''
}

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

function extractKecIDESAP(t: string): string {
  const penerimaIdx = t.search(/\bPenerima\b/i)
  const src = penerimaIdx >= 0 ? t.slice(penerimaIdx) : t

  const lines = src.split('\n')
  const addrLines: string[] = []
  let collecting = false

  for (const line of lines) {
    const nl = norm(line)
    if (!collecting) {
      const m = nl.match(/^Alamat:\s*(.+)/i)
      if (m) { addrLines.push(m[1]); collecting = true }
      continue
    }
    if (
      /^Nama Produk/i.test(nl) ||
      /^[A-Z]{2,5}[-][A-Z]{2,5}[-]/.test(nl) ||
      /^\d{5}$/.test(nl) ||
      nl === ''
    ) break
    addrLines.push(nl)
  }

  if (!addrLines.length) return ''

  let full = addrLines.join(', ')
  full = full.replace(/\s*-\s*\d{5}\s*$/, '').trim()

  const parts = full.split(',').map(s => norm(s)).filter(Boolean)

  const trailingJunk = /^(Kab\.|Kota|DKI|Jawa|Sumatera|Kalimantan|Sulawesi|Bali|Banten|Lampung|Bangka|Nusa|Papua|Maluku|Aceh|Riau|Jambi|Bengkulu|Gorontalo)/i
  while (parts.length > 0 && trailingJunk.test(parts[parts.length - 1])) {
    parts.pop()
  }

  if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
  if (parts.length === 1) return parts[0]
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

function extractBiaya(t: string, exp: Expedition): number {
  if (exp === 'JNE') {
    const m = t.match(/Total Ongkir\s*:\s*([\d.]+)/i)
    if (m) return Number(m[1].replace(/\./g, ''))
  }
  return parseIDR(t)
}

function isCOD(t: string): boolean {
  if (/NON\s*COD/i.test(t)) return false
  return /\b(COD|DFOD)\b/i.test(t)
}

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
  const jnePos = [...fullText.matchAll(/AWB\s*:\s*(AKJNE[A-Z0-9]+)/gi)].map(m => ({ pos: m.index! }))
  if (jnePos.length > 1) return buildBlocksFromPositions(fullText, jnePos)

  const joPos = [...fullText.matchAll(/(?<![A-Z0-9])(JO\d{10})(?![0-9])/g)].map(m => ({ pos: m.index! }))
  if (joPos.length > 1) return buildBlocksFromPositions(fullText, joPos)

  const freq13: Record<string, number> = {}
  for (const m of fullText.matchAll(/\b(\d{13})\b/g)) freq13[m[1]] = (freq13[m[1]] || 0) + 1
  const wb13 = Object.keys(freq13).filter(k => freq13[k] >= 2)
  if (wb13.length > 1) {
    const pos = wb13
      .map(wb => ({ pos: fullText.indexOf(wb) }))
      .filter(x => x.pos !== -1)
      .sort((a, b) => a.pos - b.pos)
    return buildBlocksFromPositions(fullText, pos)
  }

  const freq10: Record<string, number> = {}
  for (const m of fullText.matchAll(/\b(\d{10})\b/g)) freq10[m[1]] = (freq10[m[1]] || 0) + 1
  const wb10 = Object.entries(freq10).filter(([, c]) => c >= 2).map(([k]) => k)
  if (wb10.length > 1) {
    const pos = wb10.map(wb => ({ pos: fullText.indexOf(wb) })).filter(x => x.pos !== -1).sort((a, b) => a.pos - b.pos)
    return buildBlocksFromPositions(fullText, pos)
  }

  const resiPos = [...fullText.matchAll(/No\.\s*Resi\s*:/gi)].map(m => ({ pos: m.index! }))
  if (resiPos.length > 1) return buildBlocksFromPositions(fullText, resiPos)

  return pageTexts.filter(p => p.trim().length > 20)
}

export function buildRow(text: string, label: string, idx: number): ResiRow {
  const exp = detectExpedition(text)
  const biaya = extractBiaya(text, exp)
  const cod = isCOD(text) ? biaya : 0
  return {
    _id: Math.random().toString(36).slice(2, 9),
    tanggal: extractDate(text),
    waybill: extractWaybill(text, exp),
    penerima: extractReceiver(text, exp),
    kecamatan: extractKec(text, exp),
    biaya,
    cod,
    keterangan: label + (idx > 0 ? ` #${idx + 1}` : ''),
  }
}

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
    const block = blocks[i]
    if (/Lembar Pengirim/i.test(block) && !/Penerima\s*:/i.test(block)) continue
    const row = buildRow(block, file.name, i)
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
