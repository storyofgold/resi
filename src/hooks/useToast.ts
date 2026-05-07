import { useRef, useState, useCallback } from 'react'
import type { ToastItem, ToastType } from '../types'

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const ref = useRef(0)

  const toast = useCallback((msg: string, type: ToastType = 'info', duration = 3000) => {
    const id = ++ref.current
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), duration)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(p => p.filter(t => t.id !== id))
  }, [])

  return { toasts, toast, dismiss }
}
