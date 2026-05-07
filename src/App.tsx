// @ts-nocheck
import { useRef, useState, useCallback, useEffect } from 'react';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

interface ResiRow {
  _id: string;
  tanggal: string;
  waybill: string;
  penerima: string;
  kecamatan: string;
  biaya: number;
  cod: string;
  keterangan: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function norm(s: string) {
  return String(s ?? '').replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function todayISO() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function formatIDR(n: number) {
  return n ? 'IDR ' + n.toLocaleString('id-ID') : '-';
}

function parseIDR(t: string): number {
  const m = t.match(/(?:IDR|Rp)\.?\s*([0-9][0-9.,]*)/i);
  return m ? Number(m[1].replace(/\./g, '').replace(/,/g, '')) || 0 : 0;
}

function extractDate(t: string): string {
  const m = t.match(/(?:Ship|Cetak|Tanggal|Tgl)\s*[:\-]?\s*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/i);
  return m ? m[1].replace(/\//g, '-') : todayISO();
}

/**
 * extractWaybill — J&T nomor 10 digit (paling sering muncul), JNE via label AWB.
 * Routing code J&T (XXX-YYYY-ZZ) diabaikan.
 */
function extractWaybill(t: string): string {
  // 1. Label eksplisit AWB (JNE)
  const byLabel = t.match(
    /(?:No\.?\s*(?:Resi|Waybill|AWB)|AWB|Resi\s*No\.?|Waybill\s*No?\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{5,30})/i
  );
  if (byLabel) return byLabel[1].toUpperCase().replace(/^[-]+|[-]+$/g, '');

  // 2. Numeric 10 digit — ambil yang paling sering muncul (waybill J&T berulang 6-8x)
  const all10 = [...t.matchAll(/\b(\d{10})\b/g)].map(m => m[1]);
  if (all10.length > 0) {
    const freq: Record<string, number> = {};
    for (const n of all10) freq[n] = (freq[n] || 0) + 1;
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    return sorted[0][0];
  }

  // 3. Numeric 12 digit (SiCepat/Anteraja)
  const n12 = t.match(/\b(\d{12})\b/);
  if (n12) return n12[1];

  // 4. Prefiks ekspedisi
  const prefix = t.match(/\b((?:CEK|JP|JD|SIPC|IDP|GKD|PAXEL)[A-Z0-9]{6,18})\b/i);
  if (prefix) return prefix[1].toUpperCase();

  // 5. Standalone numeric di baris sendiri
  for (const line of t.split(/[\n\r]+/)) {
    const c = norm(line);
    if (/^\d{8,20}$/.test(c)) return c;
  }

  // 6. Fallback
  const fb = t.match(/\b(\d{8,20})\b/);
  return fb ? fb[1] : '';
}

/**
 * extractReceiver — ambil nama penerima, buang semua non-alfabet.
 *
 * Di label J&T format: "Penerima: VIAN ****7657"
 * Kita hanya ambil bagian yang berupa huruf + spasi.
 * Contoh: "VIAN ****7657" → "VIAN"
 *         "RINA SUSILA ******1234" → "RINA SUSILA"
 */
function extractReceiver(t: string): string {
  const m = t.match(/(?:Penerima|Kepada|Nama\s+Penerima|Receiver)\s*[:\-]?\s*([^\n\r]{3,80})/i);
  if (!m) return '';
  // Hanya ambil kata-kata yang seluruh karakternya alfabet (A-Z, a-z, dan spasi antar kata)
  const words = norm(m[1])
    .split(/\s+/)
    .filter(w => /^[A-Za-z]+$/.test(w));
  return words.join(' ');
}

/**
 * extractKec — ambil Kota dan Kecamatan dari baris tepat di bawah "Penerima: NAMA".
 *
 * Struktur label J&T:
 *   Penerima: VIAN ****7657          ← baris ini
 *   CIPUTAT, PONDOK AREN, JL. ...   ← baris ini yang kita mau
 *
 * Token[0] = Kota/Kab  → "CIPUTAT"
 * Token[1] = Kecamatan → "PONDOK AREN" (strip suffix hub misal "-JKT")
 *
 * Output: "PONDOK AREN - CIPUTAT"
 */
function extractKec(t: string): string {
  // Cari baris "Penerima: ..." lalu ambil baris berikutnya yang berisi huruf kapital
  const m = t.match(/Penerima\s*:\s*[^\n\r]+[\n\r]+\s*([A-Z][^\n\r]{5,})/i);
  if (!m) return '';

  const addrLine = norm(m[1]);

  // Split by koma
  const parts = addrLine.split(',').map(s => norm(s)).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';

  const kota = parts[0].trim();
  // Strip kode hub setelah dash: "PONDOK AREN-JKT" → "PONDOK AREN"
  const kec = parts[1].trim().replace(/-[A-Z]{2,5}$/, '').trim();

  if (!kec) return kota;
  return `${kec} - ${kota}`;
}

/**
 * splitBlocks — pisah teks PDF jadi blok per resi.
 * J&T: nomor 10 digit muncul ≥3x per resi → pakai sebagai split point.
 * JNE: split by posisi "AWB:".
 * Fallback: per halaman.
 */
function splitBlocks(fullText: string, pageTexts: string[]): string[] {
  const freq: Record<string, number> = {};
  for (const m of fullText.matchAll(/\b(\d{10})\b/g)) {
    freq[m[1]] = (freq[m[1]] || 0) + 1;
  }

  const waybills = Object.entries(freq)
    .filter(([, c]) => c >= 3)
    .map(([k]) => k);

  if (waybills.length <= 1) {
    // Coba JNE: split by "AWB:"
    const jneSplits = [...fullText.matchAll(/AWB\s*:\s*([A-Z0-9]{8,30})/gi)].map(m => ({
      pos: m.index!,
      wb: m[1],
    }));
    if (jneSplits.length > 1) {
      jneSplits.sort((a, b) => a.pos - b.pos);
      const blocks: string[] = [];
      for (let i = 0; i < jneSplits.length; i++) {
        const start = Math.max(0, jneSplits[i].pos - 200);
        const end = i + 1 < jneSplits.length ? jneSplits[i + 1].pos : fullText.length;
        blocks.push(fullText.slice(start, end));
      }
      return blocks;
    }

    // Coba 12 digit
    const freq12: Record<string, number> = {};
    for (const m of fullText.matchAll(/\b(\d{12})\b/g)) {
      freq12[m[1]] = (freq12[m[1]] || 0) + 1;
    }
    const wb12 = Object.entries(freq12).filter(([, c]) => c >= 2).map(([k]) => k);
    if (wb12.length > 1) {
      return buildBlocksFromPositions(
        fullText,
        wb12.map(wb => ({ pos: fullText.indexOf(wb), wb })).filter(x => x.pos !== -1).sort((a, b) => a.pos - b.pos)
      );
    }

    return pageTexts.filter(p => p.trim().length > 20);
  }

  const positions = waybills
    .map(wb => ({ pos: fullText.indexOf(wb), wb }))
    .filter(x => x.pos !== -1)
    .sort((a, b) => a.pos - b.pos);

  return buildBlocksFromPositions(fullText, positions);
}

function buildBlocksFromPositions(
  fullText: string,
  positions: { pos: number; wb: string }[]
): string[] {
  if (positions.length === 0) return [fullText];
  const blocks: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = Math.max(0, positions[i].pos - 100);
    const end = i + 1 < positions.length ? positions[i + 1].pos : fullText.length;
    blocks.push(fullText.slice(start, end));
  }
  return blocks;
}

function buildRow(text: string, label: string, idx: number): ResiRow {
  return {
    _id: Math.random().toString(36).slice(2, 9),
    tanggal: extractDate(text),
    waybill: extractWaybill(text),
    penerima: extractReceiver(text),
    kecamatan: extractKec(text),
    biaya: parseIDR(text),
    cod: /\bCOD\b/i.test(text) ? 'Ya' : 'Tidak',
    keterangan: label + (idx > 0 ? ` #${idx + 1}` : ''),
  };
}

async function parsePdfFile(file: File): Promise<ResiRow[]> {
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const pageTexts: string[] = [];
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const tc = await pg.getTextContent();
      let pt = '';
      for (const it of tc.items) {
        if ('str' in it) pt += it.str + (it.hasEOL ? '\n' : ' ');
      }
      pageTexts.push(pt);
      fullText += pt + '\n---PAGE---\n';
    }

    const blocks = splitBlocks(fullText, pageTexts);
    const rows: ResiRow[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const row = buildRow(blocks[i], file.name, i);
      if (row.waybill) rows.push(row);
      else if (blocks.length === 1) rows.push(row);
    }
    return rows;
  } catch (err) {
    console.error('parsePdfFile error:', file.name, err);
    return [];
  }
}

function exportCSV(rows: ResiRow[]) {
  const hdr = ['No', 'Tanggal', 'No Waybill', 'Nama Penerima', 'Kecamatan', 'Biaya', 'COD', 'Keterangan'];
  const body = rows.map((r, i) =>
    [i + 1, r.tanggal, r.waybill, r.penerima, r.kecamatan, r.biaya, r.cod, r.keterangan]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  const csv = [hdr.join(','), ...body].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })),
    download: `resi_${todayISO()}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function copyTSV(rows: ResiRow[]) {
  const hdr = ['No', 'Tanggal', 'No Waybill', 'Nama Penerima', 'Kecamatan', 'Biaya', 'COD', 'Keterangan'];
  const body = rows.map((r, i) =>
    [i + 1, r.tanggal, r.waybill, r.penerima, r.kecamatan, r.biaya, r.cod, r.keterangan].join('\t')
  );
  navigator.clipboard.writeText([hdr.join('\t'), ...body].join('\n'));
}

type TT = 'info' | 'ok' | 'warn' | 'err';
interface Toast { id: number; msg: string; type: TT; }

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ref = useRef(0);
  const toast = useCallback((msg: string, type: TT = 'info') => {
    const id = ++ref.current;
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000);
  }, []);
  return { toasts, toast };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse 1200px 600px at 15% 20%,rgba(124,58,237,.35),transparent 55%),radial-gradient(ellipse 1000px 500px at 85% 25%,rgba(34,197,94,.22),transparent 60%),radial-gradient(ellipse 800px 500px at 70% 85%,rgba(59,130,246,.18),transparent 60%),#0b1220',
    color: 'rgba(255,255,255,.92)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 14,
  } as React.CSSProperties,
  wrap: { maxWidth: 1280, margin: '0 auto', padding: '32px 20px' } as React.CSSProperties,
  glass: {
    background: 'linear-gradient(160deg,rgba(255,255,255,.11),rgba(255,255,255,.06))',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 20,
    boxShadow: '0 20px 60px rgba(0,0,0,.4)',
    backdropFilter: 'blur(12px)',
  } as React.CSSProperties,
  card: {
    background: 'rgba(255,255,255,.055)',
    border: '1px solid rgba(255,255,255,.10)',
    borderRadius: 14,
    padding: '14px 16px',
  } as React.CSSProperties,
  btn: {
    border: '1px solid rgba(255,255,255,.15)',
    background: 'rgba(255,255,255,.09)',
    color: 'rgba(255,255,255,.90)',
    borderRadius: 10,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
    transition: 'background .15s',
  } as React.CSSProperties,
  btnPrimary: {
    background: 'linear-gradient(135deg,rgba(124,58,237,.95),rgba(99,102,241,.9))',
    border: '1px solid rgba(124,58,237,.5)',
    color: '#fff',
    borderRadius: 10,
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btnGreen: {
    background: 'linear-gradient(135deg,rgba(34,197,94,.95),rgba(16,185,129,.9))',
    border: '1px solid rgba(34,197,94,.5)',
    color: '#fff',
    borderRadius: 10,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
  } as React.CSSProperties,
  input: {
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 10,
    padding: '8px 14px',
    color: 'rgba(255,255,255,.90)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    width: 220,
  } as React.CSSProperties,
  label: { color: 'rgba(255,255,255,.55)', fontSize: 12 } as React.CSSProperties,
  muted: { color: 'rgba(255,255,255,.55)', fontSize: 13 } as React.CSSProperties,
  drop: {
    outline: '2px dashed rgba(255,255,255,.20)',
    outlineOffset: -8,
    borderRadius: 16,
    padding: 20,
    transition: 'outline-color .15s, background .15s',
  } as React.CSSProperties,
};

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ResiRow[]>([]);
  const [status, setStatus] = useState('Menunggu file');
  const [progress, setProgress] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [search, setSearch] = useState('');
  const [merge, setMerge] = useState(true);
  const [ocrText, setOcrText] = useState('');
  const [libOk, setLibOk] = useState(false);
  const { toasts, toast } = useToast();

  useEffect(() => {
    try { if (typeof pdfjs.getDocument === 'function') setLibOk(true); } catch {}
  }, []);

  const addFiles = (chosen: File[]) => {
    const pdfs = chosen.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (!pdfs.length) { toast('Hanya PDF yang diterima.', 'warn'); return; }
    setFiles(pdfs); toast(`${pdfs.length} file siap.`, 'info');
  };

  const handleParse = async () => {
    if (!files.length) { toast('Pilih file dulu.', 'warn'); return; }
    setParsing(true); setProgress(0);
    const newRows: ResiRow[] = [];
    for (let i = 0; i < files.length; i++) {
      setStatus(`Memproses ${i + 1}/${files.length}: ${files[i].name}`);
      setProgress(Math.round((i / files.length) * 100));
      const result = await parsePdfFile(files[i]);
      if (result.length) newRows.push(...result);
      else toast(`Gagal parse: ${files[i].name}`, 'err');
    }
    setProgress(100);
    setRows(r => merge ? [...r, ...newRows] : newRows);
    setStatus(`Selesai! ${newRows.length} resi ditemukan.`);
    toast(`${newRows.length} resi diparsing.`, 'ok');
    setParsing(false);
  };

  const handleParseText = () => {
    const raw = ocrText.trim();
    if (!raw) { toast('Teks kosong.', 'warn'); return; }
    const row = buildRow(raw, 'teks-manual', 0);
    setRows(r => merge ? [...r, row] : [row]);
    toast('Parsed dari teks.', 'ok');
  };

  const filtered = rows.filter(r =>
    !search || Object.values(r).join(' ').toLowerCase().includes(search.toLowerCase())
  );

  const toastColor: Record<TT, string> = {
    info: 'rgba(255,255,255,.08)',
    ok: 'rgba(34,197,94,.15)',
    warn: 'rgba(251,191,36,.15)',
    err: 'rgba(239,68,68,.15)',
  };

  return (
    <div style={S.page}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,.04); }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 3px; }
        button:hover { opacity: .88; }
        tr:hover td { background: rgba(255,255,255,.03); }
        [contenteditable]:focus { outline: 1px solid rgba(124,58,237,.6); border-radius: 4px; }
      `}</style>

      <div style={S.wrap}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 24, gap: 12 }}>
          <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
            <div style={{ width:44, height:44, borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(124,58,237,.25)', border:'1px solid rgba(124,58,237,.4)' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M7 2h7l5 5v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke="#c4b5fd" strokeWidth="1.6"/>
                <path d="M14 2v6h6" stroke="#c4b5fd" strokeWidth="1.6"/>
                <path d="M8 13h8M8 17h8" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: -.3 }}>Resi PDF Parser</div>
              <div style={S.muted}>Upload PDF resi — extract ke tabel CSV</div>
            </div>
          </div>
          <div style={{ display:'flex', gap: 8 }}>
            <button style={S.btn} onClick={() => { setRows([]); setFiles([]); toast('Data dibersihkan.','info'); }}>Clear</button>
            <button style={S.btnGreen} onClick={() => exportCSV(rows)}>Export CSV</button>
          </div>
        </div>

        {/* Grid utama */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap: 16, alignItems:'start' }}>

          {/* Upload panel */}
          <div style={{ ...S.glass, padding: '24px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Upload PDF</div>
            <div style={S.muted}>Drag &amp; drop atau klik Pilih PDF. Satu file bisa berisi banyak resi.</div>

            <div
              ref={dropRef}
              style={S.drop}
              onDragOver={e => { e.preventDefault(); if(dropRef.current) dropRef.current.style.outlineColor='rgba(124,58,237,.7)'; }}
              onDragLeave={() => { if(dropRef.current) dropRef.current.style.outlineColor='rgba(255,255,255,.20)'; }}
              onDrop={e => { e.preventDefault(); if(dropRef.current) dropRef.current.style.outlineColor='rgba(255,255,255,.20)'; addFiles(Array.from(e.dataTransfer.files)); }}
            >
              <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple style={{ display:'none' }}
                onChange={e => addFiles(Array.from(e.target.files ?? []))}
              />
              <div style={{ display:'flex', alignItems:'center', gap: 14, flexWrap:'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.80)' }}>
                    {files.length === 0 ? 'Belum ada file dipilih.' : files.length === 1 ? files[0].name : `${files.length} file dipilih`}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.40)', marginTop: 3 }}>Bisa pilih banyak file sekaligus.</div>
                </div>
                <div style={{ display:'flex', gap: 8 }}>
                  <button style={S.btnPrimary} onClick={() => fileRef.current?.click()}>Pilih PDF</button>
                  <button style={S.btn} onClick={handleParse} disabled={parsing}>
                    {parsing ? 'Memproses…' : 'Parse'}
                  </button>
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10, marginTop: 14 }}>
                <div style={S.card}>
                  <div style={S.label}>Status</div>
                  <div style={{ marginTop: 4, fontSize: 13 }}>{status}</div>
                  {parsing && (
                    <div style={{ marginTop: 10, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.10)', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:2, background:'linear-gradient(90deg,#7c3aed,#6366f1)', width:`${progress}%`, transition:'width .3s' }}/>
                    </div>
                  )}
                </div>
                <div style={S.card}>
                  <div style={S.label}>Pengaturan</div>
                  <label style={{ display:'flex', alignItems:'center', gap: 8, marginTop: 8, fontSize: 13, cursor:'pointer' }}>
                    <input type="checkbox" checked={merge} onChange={e => setMerge(e.target.checked)} style={{ accentColor:'#7c3aed' }}/>
                    Merge (append)
                  </label>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Teks OCR (opsional)</div>
                  <div style={{ fontSize: 12, color:'rgba(255,255,255,.45)' }}>Paste teks dari PDF scan.</div>
                </div>
                <button style={S.btn} onClick={handleParseText}>Parse teks</button>
              </div>
              <textarea
                value={ocrText} onChange={e => setOcrText(e.target.value)}
                placeholder="Paste hasil OCR di sini"
                style={{ ...S.input, width:'100%', minHeight: 100, resize:'vertical', padding: 12 }}
              />
            </div>
          </div>

          {/* Info panel */}
          <div style={{ ...S.glass, padding: '24px', display:'flex', flexDirection:'column', gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Info &amp; Status</div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10 }}>
              <div style={S.card}>
                <div style={S.label}>Dideteksi</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{filtered.length}</div>
              </div>
              <div style={S.card}>
                <div style={S.label}>File siap</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{files.length}</div>
              </div>
            </div>

            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>PDF.js Status</div>
              <div style={{ fontSize: 12, fontFamily:'monospace', color: libOk ? '#6ee7b7' : '#fca5a5' }}>
                {libOk ? '✓ PDF.js 4.10.38 siap.' : '✗ PDF.js gagal load.'}
              </div>
            </div>

            <div style={S.card}>
              <div style={{ fontSize: 12, fontWeight: 600, color:'rgba(255,255,255,.55)', marginBottom: 8 }}>Format hasil</div>
              <div style={{ fontSize: 12, color:'rgba(255,255,255,.50)', lineHeight: 1.8 }}>
                <div><b>Nama:</b> hanya huruf alfabet</div>
                <div style={{ fontFamily:'monospace', fontSize: 11 }}>VIAN ****7657 → VIAN</div>
                <div style={{ fontFamily:'monospace', fontSize: 11 }}>RINA SUSILA ***8 → RINA SUSILA</div>
                <div style={{ marginTop: 6 }}><b>Kecamatan:</b> baris setelah Penerima</div>
                <div style={{ fontFamily:'monospace', fontSize: 11 }}>CIPUTAT, PONDOK AREN → PONDOK AREN - CIPUTAT</div>
              </div>
            </div>

            <a href="#hasil" style={{ ...S.btn, textAlign:'center', textDecoration:'none', display:'block' }}>Lihat hasil ↓</a>
          </div>
        </div>

        {/* Hasil */}
        <div id="hasil" style={{ marginTop: 24 }}>
          <div style={{ ...S.glass, padding: '24px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 16, flexWrap:'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Hasil</div>
                <div style={S.muted}>Double-click sel untuk edit inline.</div>
              </div>
              <div style={{ display:'flex', gap: 8, alignItems:'center', flexWrap:'wrap' }}>
                <input
                  placeholder="Cari data…"
                  value={search} onChange={e => setSearch(e.target.value)}
                  style={S.input}
                />
                <button style={S.btn} onClick={() => { copyTSV(rows); toast('TSV disalin!','ok'); }}>Copy TSV</button>
                <button style={S.btnGreen} onClick={() => exportCSV(rows)}>Export CSV</button>
              </div>
            </div>

            <div style={{ overflowX:'auto', borderRadius: 12, border:'1px solid rgba(255,255,255,.10)' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth: 960, fontSize: 13 }}>
                <thead>
                  <tr style={{ background:'rgba(10,15,30,.95)', color:'rgba(255,255,255,.70)' }}>
                    {['#','Tanggal','No Waybill','Nama Penerima','Kecamatan','Biaya','COD','Keterangan'].map(h => (
                      <th key={h} style={{ textAlign: h==='Biaya'?'right':h==='COD'?'center':'left', padding:'10px 14px', fontWeight: 600, whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign:'center', padding: 48, color:'rgba(255,255,255,.35)' }}>Belum ada data. Upload dan parse PDF dulu.</td></tr>
                  )}
                  {filtered.map((r, i) => (
                    <tr key={r._id} style={{ borderTop:'1px solid rgba(255,255,255,.07)' }}>
                      <td style={{ padding:'10px 14px', color:'rgba(255,255,255,.40)' }}>{i+1}</td>
                      <td style={{ padding:'10px 14px' }} contentEditable suppressContentEditableWarning>{r.tanggal}</td>
                      <td style={{ padding:'10px 14px', fontFamily:'monospace', fontWeight:600, color:'#c4b5fd' }} contentEditable suppressContentEditableWarning>{r.waybill}</td>
                      <td style={{ padding:'10px 14px' }} contentEditable suppressContentEditableWarning>{r.penerima}</td>
                      <td style={{ padding:'10px 14px', color:'rgba(255,255,255,.75)' }} contentEditable suppressContentEditableWarning>{r.kecamatan}</td>
                      <td style={{ padding:'10px 14px', textAlign:'right', fontFamily:'monospace' }} contentEditable suppressContentEditableWarning>{formatIDR(r.biaya)}</td>
                      <td style={{ padding:'10px 14px', textAlign:'center' }}>
                        <span style={{ background: r.cod==='Ya'?'rgba(34,197,94,.2)':'rgba(255,255,255,.07)', color: r.cod==='Ya'?'#6ee7b7':'rgba(255,255,255,.55)', borderRadius: 6, padding:'2px 8px', fontSize:12 }}>{r.cod}</span>
                      </td>
                      <td style={{ padding:'10px 14px', fontSize:12, color:'rgba(255,255,255,.45)' }} contentEditable suppressContentEditableWarning>{r.keterangan}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ textAlign:'center', padding:'32px 0 16px', fontSize:12, color:'rgba(255,255,255,.35)' }}>Resi PDF Parser — Hans Logistik</div>
        </div>
      </div>

      {/* Toast */}
      <div style={{ position:'fixed', right:16, bottom:16, zIndex:999, display:'flex', flexDirection:'column', gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: toastColor[t.type], border:'1px solid rgba(255,255,255,.12)', borderRadius:12, padding:'10px 16px', fontSize:13, color:'rgba(255,255,255,.88)', backdropFilter:'blur(8px)', boxShadow:'0 8px 24px rgba(0,0,0,.3)' }}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
