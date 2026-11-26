import { cn } from '../../lib/cn.js'

const tones = {
  blue: 'bg-brand-50 text-brand-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
}

export default function StatCard({ label, value, note, icon: Icon, tone = 'blue' }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
        {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      </div>
      {Icon && (
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
    </div>
  )
}
