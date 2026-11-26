import { cn } from '../../lib/cn.js'

export default function Card({ title, description, actions, padded = true, className, children, ...props }) {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white shadow-xs', className)} {...props}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn(padded && 'p-5')}>{children}</div>
    </section>
  )
}
