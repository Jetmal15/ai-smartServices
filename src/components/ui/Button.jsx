import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn.js'

const variants = {
  primary: 'bg-brand-600 text-white shadow-xs hover:bg-brand-700 focus-visible:outline-brand-600',
  secondary: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  outline: 'border border-slate-300 bg-white text-slate-700 shadow-xs hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-red-600 text-white shadow-xs hover:bg-red-700 focus-visible:outline-red-600',
}

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
}

/** Works as a <button> by default; pass `as={Link}` (or "a") to render a link. */
export default function Button({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  className,
  children,
  disabled,
  type,
  ...props
}) {
  const isButton = Component === 'button'
  return (
    <Component
      type={isButton ? (type ?? 'button') : undefined}
      disabled={isButton ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      {children}
    </Component>
  )
}
