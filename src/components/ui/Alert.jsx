import { CheckCircle2, Info, ShieldAlert } from 'lucide-react'
import { cn } from '../../lib/cn.js'

const variants = {
  info: { box: 'border-brand-200 bg-brand-50 text-brand-800', icon: Info, color: 'text-brand-600' },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: CheckCircle2, color: 'text-emerald-600' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: ShieldAlert, color: 'text-amber-600' },
}

/** Informational / success / warning banner. Use ErrorMessage for errors. */
export default function Alert({ variant = 'info', title, children, className }) {
  const { box, icon: Icon, color } = variants[variant]
  return (
    <div role="status" className={cn('flex gap-3 rounded-lg border p-4', box, className)}>
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', color)} aria-hidden="true" />
      <div className="text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : undefined}>{children}</div>}
      </div>
    </div>
  )
}
