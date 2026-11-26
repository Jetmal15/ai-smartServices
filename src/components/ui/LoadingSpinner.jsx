import { cn } from '../../lib/cn.js'

const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-10 w-10 border-[3px]' }

/** Set `center` for a block-level, centered spinner with a visible label. */
export default function LoadingSpinner({ size = 'md', label = 'Loading…', center = false, className }) {
  const spinner = (
    <span
      className={cn('inline-block animate-spin rounded-full border-2 border-brand-200 border-t-brand-600', sizes[size])}
      aria-hidden="true"
    />
  )

  if (!center) {
    return (
      <span role="status" className={cn('inline-flex', className)}>
        {spinner}
        <span className="sr-only">{label}</span>
      </span>
    )
  }

  return (
    <div role="status" className={cn('flex min-h-48 flex-col items-center justify-center gap-3', className)}>
      {spinner}
      <span className="text-sm text-slate-500">{label}</span>
    </div>
  )
}
