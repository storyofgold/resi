import type { ResiRow } from '../types'
import { todayISO } from './parser'

export function exportCSV(rows: ResiRow[]): void {
  const hdr = ['No', 'Tanggal', 'No Waybill', 'Nama Penerima', 'Kecamatan', 'Biaya', 'COD', 'Keterangan']
  const body = rows.map((r, i) =>
    [i + 1, r.tanggal, r.waybill, r.penerima, r.kecamatan, r.biaya, r.cod, r.keterangan]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  )
  const csv = [hdr.join(','), ...body].join('\r\n')
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })),
    download: `resi_${todayISO()}.csv`,
  })
  a.click()
  URL.revokeObjectURL(a.href)
}

export function copyTSV(rows: ResiRow[]): void {
  const hdr = ['No', 'Tanggal', 'No Waybill', 'Nama Penerima', 'Kecamatan', 'Biaya', 'COD', 'Keterangan']
  const body = rows.map((r, i) =>
    [i + 1, r.tanggal, r.waybill, r.penerima, r.kecamatan, r.biaya, r.cod, r.keterangan].join('\t')
  )
  navigator.clipboard.writeText([hdr.join('\t'), ...body].join('\n'))
}
