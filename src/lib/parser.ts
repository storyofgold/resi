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

function extractReceiverJNT(t: string): string {
  for (const line of t.split('\n')) {
    const m = line.match(/Penerima\s*:\s*(.+)/)
    if (!m) continue
    let name = m[1].trim()
    name = name.replace(/\s*,?\s*(?:\*+\d+|\d[\d*]{7,})\s*$/, '')
    name = norm(name)
    if (name.length >= 2) return name
  }
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
    p === p.toUpperCase() && /[A-Z]{3,}/.test(p) && p.length > 2
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/Penerima\s*:/i.test(line)) continue

    const inlineAddr = line
      .replace(/Penerima\s*:\s*/i, '')
      .replace(/^.+?(?:\*+\d+|\d[\d*]{7,})\s*/, '')
      .trim()
    if (inlineAddr.length > 5 && /,/.test(inlineAddr)) return inlineAddr

    const addrLines: string[] = []
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const nl = lines[j].trim()
      if (/^(Pengirim\s*:|BIAYA|Notes\s*:|Syarat|Order|PT\.|LANDMARK|Sudah Termasuk|TOTAL BIAYA|Qty)/i.test(nl)) break
      if (/^(COD|DFOD|NP|EZ|BULANAN)$/i.test(nl)) break
      if (/^\d+$/.test(nl) || /^\*+\d+$/.test(nl) || /^\d{10}$/.test(nl)) continue
      if (nl.length > 3) addrLines.push(nl)
    }
    if (addrLines.length > 0 && /,/.test(addrLines.join(' '))) return addrLines.join(' ')
  }

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
      const block = [line]
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const nl = lines[j].trim()
        if (nl && nl === nl.toUpperCase() && /[A-Z]{3,}/.test(nl) &&
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
  if (candidates.length > 0)
    return candidates.reduce((a, b) => b.split(',').length > a.split(',').length ? b : a)
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

/**
 * Ambil kecamatan PENERIMA dari resi IDE/SAP.
 *
 * Format alamat penerima konsisten:
 *   Alamat: [jalan bebas], Kelurahan, Kecamatan, Kota, [Kab.,] Provinsi - kodepos
 *
 * Strategi:
 * 1. Cari blok teks setelah "Penerima" (buang blok pengirim).
 * 2. Dari blok itu, ambil nilai setelah "Alamat:" hingga "Nama Produk" / akhir.
 * 3. Gabungkan baris multi-line jadi satu string.
 * 4. Strip kode pos + provinsi + kota di ujung.
 * 5. Ambil 2 segmen terakhir yang tersisa (= Kelurahan, Kecamatan).
 */
function extractKecIDESAP(t: string): string {
  // Potong teks mulai dari kemunculan pertama "Penerima" agar tidak nyenggol alamat pengirim
  const penerimaIdx = t.search(/\bPenerima\b/i)
  const src = penerimaIdx >= 0 ? t.slice(penerimaIdx) : t

  // Kumpulkan baris alamat penerima: mulai dari "Alamat:" sampai "Nama Produk" / rute kode / akhir blok
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
    // Hentikan pengumpulan saat ketemu baris berikutnya yang bukan lanjutan alamat
    if (
      /^Nama Produk/i.test(nl) ||
      /^[A-Z]{2,5}[-][A-Z]{2,5}[-]/.test(nl) || // kode rute misal SUB-SUB11-SUB13
      /^\d{5}$/.test(nl) ||
      nl === ''
    ) break
    addrLines.push(nl)
  }

  if (!addrLines.length) return ''

  // Gabung semua baris alamat
  let full = addrLines.join(', ')

  // Strip kode pos beserta provinsi/kota di bagian akhir
  // Format: "..., Kelurahan, Kecamatan, Kota, [Kab.,] Provinsi - kodepos"
  // Buang " - kodepos" di ujung
  full = full.replace(/\s*-\s*\d{5}\s*$/, '').trim()

  const parts = full.split(',').map(s => norm(s)).filter(Boolean)

  // Buang bagian yang jelas merupakan provinsi/kota/kab di ujung
  // ("Kab.", "Jawa Timur", "DKI Jakarta", dll)
  const trailingJunk = /^(Kab\.|Kota|DKI|Jawa|Sumatera|Kalimantan|Sulawesi|Bali|Banten|Lampung|Bangka|Nusa|Papua|Maluku|Aceh|Riau|Jambi|Bengkulu|Gorontalo)/i
  while (parts.length > 0 && trailingJunk.test(parts[parts.length - 1])) {
    parts.pop()
  }

  // Buang juga segmen yang mengandung nama kota besar di ujung
  // (hasil setelah strip provinsi, kota masih bisa tersisa)
  // Cukup 2 segmen terakhir = Kelurahan, Kecamatan
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
