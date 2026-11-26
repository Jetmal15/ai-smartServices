import { Inbox } from 'lucide-react'
import { cn } from '../../lib/cn.js'

export default function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
