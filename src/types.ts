export interface ResiRow {
  _id: string
  tanggal: string
  waybill: string
  penerima: string
  kecamatan: string
  biaya: number
  cod: number
  keterangan: string
}

export type ToastType = 'info' | 'ok' | 'warn' | 'err'

export interface ToastItem {
  id: number
  msg: string
  type: ToastType
}
