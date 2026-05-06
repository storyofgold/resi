import { useRef, useState, useCallback, useEffect } from 'react';
import * as pdfjs from 'pdfjs-dist';

// Worker dari CDN agar tidak diproses Vite/Rollup
pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

// ── Types ─────────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────
function normSpaces(s: string) {
  return String(s || '').replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function todayISO() {
  const d = new Date(), p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function formatIDR(n: number | null) {
  if (n == null) return '-';
  return 'IDR ' + n.toLocaleString('id-ID');
}

function parseIDR(str: string): number | null {
  const m = String(str || '').match(/\b(?:IDR|Rp)\.?\s*([0-9][0-9.,]*)/i);
  if (!m) return null;
  return Number(m[1].replace(/\./g, '').replace(/,/g, '')) || null;
}

function extractDate(t: string) {
  const m = String(t || '').match(
    /(?:Cetak|Tanggal|Tgl)\s*[:\-]?\s*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{4})/i
  );
  return m ? m[1].replace(/\//g, '-') : todayISO();
}

function extractWaybill(t: string) {
  const byLabel = String(t || '').match(
    /(?:No\.?\s*(?:Resi|Waybill|AWB)|Resi)\s*[:\-]?\s*([A-Z0-9]{6,20})/i
  );
  if (byLabel) return byLabel[1];
  const byNum = String(t || '').match(/\b([0-9]{8,16})\b/);
  return byNum ? byNum[1] : '';
}

function extractReceiver(t: string) {
  const m = String(t || '').match(
    /(?:Penerima|Kepada|Nama\s+Penerima)\s*[:\-]?\s*([^\n\r]{3,60})/i
  );
  return m ? normSpaces(m[1]) : '';
}

function extractKecKota(t: string) {
  const s = String(t || '');
  const kec = (s.match(/\bKEC(?:AMATAN)?\.?\s*([A-Za-z0-9 \-]{3,40})/i) || [])[1] || '';
  const kab = (s.match(/\b(?:KAB(?:UPATEN)?\.?|KOTA)\s*([A-Za-z0-9 \-]{3,40})/i) || [])[1] || '';
  const trim = (x: string) => normSpaces(x).split(/\s+/).slice(0, 3).join(' ');
  return [kec ? 'KEC ' + trim(kec) : '', kab ? trim(kab) : ''].filter(Boolean).join(' / ');
}

function buildRow(text: string, label: string): ResiRow {
  return {
    _id: Math.random().toString(36).slice(2, 9),
    tanggal: extractDate(text),
    waybill: extractWaybill(text),
    penerima: extractReceiver(text),
    kecamatan: extractKecKota(text),
    biaya: parseIDR(text) ?? 0,
    cod: /\bCOD\b/i.test(text) ? 'Ya' : 'Tidak',
    keterangan: label,
  };
}

async function parsePdfFile(file: File): Promise<ResiRow | null> {
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const tc = await pg.getTextContent();
      text += tc.items.map((it: { str: string; hasEOL?: boolean }) =>
        it.str + (it.hasEOL ? '\n' : ' ')
      ).join('') + '\n';
    }
    return buildRow(text, file.name);
  } catch (err) {
    console.error('parsePdfFile error:', file.name, err);
    return null;
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

// ── Toast ─────────────────────────────────────────────────────────────────
type ToastType = 'info' | 'ok' | 'warn' | 'err';
interface ToastItem { id: number; msg: string; type: ToastType; }

function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const toast = useCallback((msg: string, type: ToastType = 'info') => {
    const id = ++counter.current;
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000);
  }, []);
  return { toasts, toast };
}

// ── Main Component ────────────────────────────────────────────────────────
export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // verify pdfjs loaded
  useEffect(() => {
    try {
      if (typeof pdfjs.getDocument === 'function') setLibOk(true);
    } catch { setLibOk(false); }
  }, []);

  const onFilesChosen = (chosen: File[]) => {
    const pdfs = chosen.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (!pdfs.length) { toast('Hanya file PDF yang diterima.', 'warn'); return; }
    setFiles(pdfs);
    toast(`${pdfs.length} file siap.`, 'info');
  };

  const handleParse = async () => {
    if (!files.length) { toast('Pilih file PDF dulu.', 'warn'); return; }
    setParsing(true);
    setProgress(0);
    const newRows: ResiRow[] = [];
    for (let i = 0; i < files.length; i++) {
      setStatus(`Memproses ${i + 1}/${files.length}: ${files[i].name}`);
      setProgress(Math.round((i / files.length) * 100));
      const row = await parsePdfFile(files[i]);
      if (row) newRows.push(row);
      else toast(`Gagal parse: ${files[i].name}`, 'err');
    }
    setProgress(100);
    setRows(merge ? r => [...r, ...newRows] : newRows);
    setStatus(`Selesai! ${newRows.length} data.`);
    toast(`${newRows.length} resi diparsing.`, 'ok');
    setParsing(false);
  };

  const handleParseText = () => {
    const raw = ocrText.trim();
    if (!raw) { toast('Teks kosong.', 'warn'); return; }
    const row = buildRow(raw, 'teks-manual');
    setRows(r => merge ? [...r, row] : [row]);
    toast('Parsed dari teks.', 'ok');
  };

  // drag & drop
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); dropRef.current?.classList.add('dragover'); };
  const onDragLeave = () => dropRef.current?.classList.remove('dragover');
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dropRef.current?.classList.remove('dragover');
    onFilesChosen(Array.from(e.dataTransfer.files));
  };

  const filtered = rows.filter(r =>
    !search || Object.values(r).join(' ').toLowerCase().includes(search.toLowerCase())
  );

  const toastBg: Record<ToastType, string> = {
    info: 'bg-white/10 border-white/10',
    ok: 'bg-emerald-500/10 border-emerald-400/30',
    warn: 'bg-amber-500/10 border-amber-400/30',
    err: 'bg-red-500/10 border-red-400/30',
  };

  return (
    <div className="min-h-screen font-sans" style={{ background: 'radial-gradient(1200px 600px at 15% 20%,rgba(124,58,237,.35),transparent 55%),radial-gradient(1000px 520px at 85% 25%,rgba(34,197,94,.22),transparent 60%),radial-gradient(800px 500px at 70% 85%,rgba(59,130,246,.18),transparent 60%),#0b1220', color: 'rgba(255,255,255,.92)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.06))', border: '1px solid rgba(255,255,255,.10)' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M7 2h7l5 5v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke="rgba(255,255,255,.85)" strokeWidth="1.6"/>
                <path d="M14 2v6h6" stroke="rgba(255,255,255,.85)" strokeWidth="1.6"/>
                <path d="M8 13h8M8 17h8" stroke="rgba(124,58,237,.95)" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Resi PDF Parser</h1>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,.65)' }}>Upload PDF resi — extract ke tabel CSV</p>
            </div>
          </div>
          <div className="hidden sm:flex gap-2">
            <button onClick={() => { setRows([]); setFiles([]); toast('Data dibersihkan.', 'info'); }} className="btn px-3 py-2 rounded-xl text-sm">Clear</button>
            <button onClick={() => exportCSV(rows)} className="btn btn-green px-3 py-2 rounded-xl text-sm font-medium">Export CSV</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Upload panel */}
          <section className="lg:col-span-7 glass rounded-3xl p-5 sm:p-6">
            <h2 className="text-base font-semibold">Upload PDF</h2>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,.65)' }}>Drag &amp; drop atau klik Pilih PDF.</p>

            <div
              ref={dropRef}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className="drop mt-4 rounded-3xl p-5"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                style={{ display: 'none' }}
                onChange={e => onFilesChosen(Array.from(e.target.files || []))}
              />
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M12 16V8" stroke="rgba(255,255,255,.86)" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M9 11l3-3 3 3" stroke="rgba(255,255,255,.86)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.7-1.7A4 4 0 0 1 18 16" stroke="rgba(124,58,237,.95)" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm" style={{ color: 'rgba(255,255,255,.75)' }}>
                    {files.length === 0 ? 'Belum ada file dipilih.' : files.length === 1 ? files[0].name : `${files.length} file dipilih`}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,.45)' }}>Bisa pilih banyak file sekaligus.</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="btn btn-primary px-4 py-2 rounded-xl text-sm font-semibold"
                  >Pilih PDF</button>
                  <button
                    onClick={handleParse}
                    disabled={parsing}
                    className="btn px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                  >{parsing ? 'Memproses…' : 'Parse'}</button>
                </div>
              </div>

              {/* Status & progress */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)' }}>
                  <div className="text-xs" style={{ color: 'rgba(255,255,255,.60)' }}>Status</div>
                  <div className="mt-1 text-sm">{status}</div>
                  {parsing && (
                    <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.10)' }}>
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#7c3aed,#6366f1)' }} />
                    </div>
                  )}
                </div>
                <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)' }}>
                  <div className="text-xs" style={{ color: 'rgba(255,255,255,.60)' }}>Pengaturan</div>
                  <label className="mt-2 inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={merge} onChange={e => setMerge(e.target.checked)} className="accent-violet-500" />
                    Merge (append)
                  </label>
                </div>
              </div>
            </div>

            {/* OCR text */}
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Teks OCR (opsional)</div>
                  <div className="text-xs" style={{ color: 'rgba(255,255,255,.55)' }}>Paste teks dari PDF scan, lalu klik Parse teks.</div>
                </div>
                <button onClick={handleParseText} className="btn px-3 py-2 rounded-xl text-sm">Parse teks</button>
              </div>
              <textarea
                value={ocrText}
                onChange={e => setOcrText(e.target.value)}
                className="mt-3 w-full min-h-28 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/60"
                style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)', color: 'rgba(255,255,255,.90)' }}
                placeholder="Paste hasil OCR di sini"
              />
            </div>
          </section>

          {/* Info panel */}
          <aside className="lg:col-span-5 glass rounded-3xl p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold">Info &amp; Status</h2>
              <a href="#hasil" className="btn px-3 py-2 rounded-xl text-sm">Lihat hasil ↓</a>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)' }}>
                <div className="text-xs" style={{ color: 'rgba(255,255,255,.60)' }}>Dideteksi</div>
                <div className="mt-1 text-lg font-semibold">{filtered.length}</div>
              </div>
              <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)' }}>
                <div className="text-xs" style={{ color: 'rgba(255,255,255,.60)' }}>File siap</div>
                <div className="mt-1 text-lg font-semibold">{files.length}</div>
              </div>
            </div>
            <div className="mt-4 rounded-2xl p-4" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)' }}>
              <div className="text-sm font-semibold">PDF.js Status</div>
              <div className="mt-2 text-xs font-mono" style={{ color: libOk ? '#6ee7b7' : '#fca5a5' }}>
                {libOk ? '✓ PDF.js 4.10.38 loaded dan siap.' : '✗ PDF.js belum/gagal load.'}
              </div>
              <ul className="mt-3 text-sm space-y-1 list-disc pl-5" style={{ color: 'rgba(255,255,255,.65)' }}>
                <li>PDF scan (gambar)? Pakai fitur OCR.</li>
                <li>Parse gagal? Cek Console browser.</li>
              </ul>
            </div>
          </aside>
        </div>

        {/* Hasil */}
        <main id="hasil" className="mt-6 sm:mt-8">
          <section className="glass rounded-3xl p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Hasil</h2>
                <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,.65)' }}>Double-click sel untuk edit inline.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Cari data…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-56 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/60"
                  style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)', color: 'rgba(255,255,255,.90)' }}
                />
                <button onClick={() => { copyTSV(rows); toast('TSV disalin!', 'ok'); }} className="btn px-3 py-2 rounded-xl text-sm">Copy TSV</button>
                <button onClick={() => exportCSV(rows)} className="btn btn-green px-3 py-2 rounded-xl text-sm">Export CSV</button>
              </div>
            </div>

            <div className="mt-4 overflow-auto rounded-2xl" style={{ border: '1px solid rgba(255,255,255,.10)' }}>
              <table className="w-full text-sm" style={{ minWidth: 980 }}>
                <thead>
                  <tr style={{ color: 'rgba(255,255,255,.75)', background: 'rgba(10,15,30,.95)' }}>
                    <th className="text-left font-semibold px-4 py-3 w-12">#</th>
                    <th className="text-left font-semibold px-4 py-3 w-36">Tanggal</th>
                    <th className="text-left font-semibold px-4 py-3 w-44">No Waybill</th>
                    <th className="text-left font-semibold px-4 py-3">Nama Penerima</th>
                    <th className="text-left font-semibold px-4 py-3 w-56">Kecamatan</th>
                    <th className="text-right font-semibold px-4 py-3 w-36">Biaya</th>
                    <th className="text-center font-semibold px-4 py-3 w-20">COD</th>
                    <th className="text-left font-semibold px-4 py-3 w-48">Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-12" style={{ color: 'rgba(255,255,255,.40)' }}>Belum ada data. Upload dan parse PDF dulu.</td></tr>
                  )}
                  {filtered.map((r, i) => (
                    <tr key={r._id} className="border-t" style={{ borderColor: 'rgba(255,255,255,.08)' }}>
                      <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,.45)' }}>{i + 1}</td>
                      <td className="px-4 py-3" contentEditable suppressContentEditableWarning>{r.tanggal}</td>
                      <td className="px-4 py-3 font-mono font-semibold" contentEditable suppressContentEditableWarning>{r.waybill}</td>
                      <td className="px-4 py-3" contentEditable suppressContentEditableWarning>{r.penerima}</td>
                      <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,.80)' }} contentEditable suppressContentEditableWarning>{r.kecamatan}</td>
                      <td className="px-4 py-3 text-right font-mono" contentEditable suppressContentEditableWarning>{formatIDR(r.biaya)}</td>
                      <td className="px-4 py-3 text-center">{r.cod}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,.50)' }} contentEditable suppressContentEditableWarning>{r.keterangan}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <footer className="py-10 text-center text-xs" style={{ color: 'rgba(255,255,255,.40)' }}>Resi PDF Parser — Vercel</footer>
        </main>
      </div>

      {/* Toast */}
      <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`glass ${toastBg[t.type]} rounded-2xl px-4 py-3 text-sm`} style={{ color: 'rgba(255,255,255,.85)' }}>{t.msg}</div>
        ))}
      </div>

      <style>{`
        .glass{background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.06));border:1px solid rgba(255,255,255,.10);box-shadow:0 18px 60px rgba(0,0,0,.35);backdrop-filter:blur(10px)}
        .btn{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);transition:transform .12s ease,background .12s ease;cursor:pointer;color:rgba(255,255,255,.90)}
        .btn:hover{transform:translateY(-1px);background:rgba(255,255,255,.12)}
        .btn-primary{background:linear-gradient(135deg,rgba(124,58,237,.95),rgba(99,102,241,.90));border-color:rgba(124,58,237,.55)}
        .btn-green{background:linear-gradient(135deg,rgba(34,197,94,.95),rgba(16,185,129,.90));border-color:rgba(34,197,94,.55)}
        .drop{outline:2px dashed rgba(255,255,255,.18);outline-offset:-10px;transition:outline-color .15s ease,background .15s ease}
        .drop.dragover{outline-color:rgba(124,58,237,.75);background:rgba(124,58,237,.12)}
        body{margin:0;font-family:'Inter',sans-serif}
      `}</style>
    </div>
  );
}
