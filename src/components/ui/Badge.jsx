import { cn } from '../../lib/cn.js'

const variants = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-brand-50 text-brand-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
}

const dots = {
  neutral: 'bg-slate-400',
  info: 'bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
}

export default function Badge({ variant = 'neutral', dot = false, className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        variants[variant],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dots[variant])} aria-hidden="true" />}
      {children}
    </span>
  )
}
