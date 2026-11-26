import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn.js'

const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' }

export default function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return undefined
    const handleKey = (event) => event.key === 'Escape' && onCloseRef.current()
    const previousOverflow = document.body.style.overflow
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-xs" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('relative max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white shadow-xl outline-hidden', sizes[size])}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
