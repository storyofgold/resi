/**
 * Export ke Excel (.xlsx) menggunakan SheetJS (xlsx)
 * Format sesuai MASTER.xlsx:
 *   Baris 1 : judul merge "AWB VIP PLATFORM BULAN [BULAN] [TAHUN] / [LABEL]"
 *   Baris 2 : header kolom
 *   Baris 3+ : data
 *   Baris terakhir: TOTAL BIAYA
 *
 * Kolom:
 *   NO | NO WAYBIL | WAKTU INPUT | NAMA PENGIRIM | KOTA PENGIRIM |
 *   NAMA PENERIMA | KECAMATAN PENERIMA | TOTAL BIAYA | COD | METODE PEMBAYARAN
 */
// @ts-ignore
import * as XLSX from 'xlsx'
import type { ResiRow } from '../types'

function bulanIndo(m: number): string {
  const b = ['JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI','JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER']
  return b[m] ?? ''
}

function labelFromKeterangan(rows: ResiRow[]): string {
  if (!rows.length) return ''
  // Ambil nama file pertama, strip ekstensi
  const k = rows[0].keterangan
  const base = k.split(' #')[0].replace(/\.pdf$/i, '').trim()
  return base.toUpperCase()
}

function rupiah(n: number): string {
  if (!n) return 'Rp - 0'
  return 'Rp ' + n.toLocaleString('id-ID')
}

export function exportXlsx(rows: ResiRow[], filename?: string): void {
  const now = new Date()
  const bulan = bulanIndo(now.getMonth())
  const tahun = now.getFullYear()
  const label = labelFromKeterangan(rows)
  const judulStr = `AWB VIP PLATFORM BULAN ${bulan} ${tahun} /${label ? ' ' + label : ''}`

  // === Build worksheet data (array of arrays) ===
  const COL_COUNT = 10

  // Baris 0: judul (akan di-merge A1:J1)
  const titleRow = [judulStr, '', '', '', '', '', '', '', '', '']

  // Baris 1: header
  const headerRow = [
    'NO', 'NO WAYBIL', 'WAKTU INPUT', 'NAMA PENGIRIM', 'KOTA PENGIRIM',
    'NAMA PENERIMA', 'KECAMATAN PENERIMA', 'TOTAL BIAYA', 'COD', 'METODE PEMBAYARAN'
  ]

  // Baris data
  const dataRows = rows.map((r, i) => [
    i + 1,
    r.waybill,
    r.tanggal,
    '',              // NAMA PENGIRIM — tidak ada di parser
    'DKI JAKARTA',  // KOTA PENGIRIM — default sesuai MASTER
    r.penerima,
    r.kecamatan,
    r.biaya,
    r.cod,           // 0 jika bukan COD, nominal jika COD
    'BULANAN',       // METODE PEMBAYARAN
  ])

  // Baris total
  const totalBiaya = rows.reduce((s, r) => s + r.biaya, 0)
  const totalCOD   = rows.reduce((s, r) => s + r.cod, 0)
  const totalRow = [
    'TOTAL BIAYA', '', '', '', '', '', '',
    totalBiaya,
    totalCOD,
    ''
  ]

  const wsData = [titleRow, headerRow, ...dataRows, totalRow]

  // === Buat worksheet ===
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // === Merge judul A1:J1 ===
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } }
  ]

  // === Lebar kolom ===
  ws['!cols'] = [
    { wch: 4 },   // NO
    { wch: 18 },  // NO WAYBIL
    { wch: 14 },  // WAKTU INPUT
    { wch: 20 },  // NAMA PENGIRIM
    { wch: 16 },  // KOTA PENGIRIM
    { wch: 24 },  // NAMA PENERIMA
    { wch: 28 },  // KECAMATAN PENERIMA
    { wch: 14 },  // TOTAL BIAYA
    { wch: 14 },  // COD
    { wch: 14 },  // METODE PEMBAYARAN
  ]

  // === Buat workbook & nama sheet "01" ===
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '01')

  // === Download ===
  const fname = filename ?? `resi-${now.toISOString().slice(0,10)}.xlsx`
  XLSX.writeFile(wb, fname)
}
