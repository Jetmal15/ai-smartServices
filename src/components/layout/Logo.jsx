import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { cn } from '../../lib/cn.js'
import { APP_NAME } from '../../lib/constants.js'

export default function Logo({ to = '/', light = false, className }) {
  return (
    <Link to={to} className={cn('flex items-center gap-2.5 font-semibold', light ? 'text-white' : 'text-slate-900', className)}>
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg',
          light ? 'bg-white/15 text-white' : 'bg-brand-600 text-white',
        )}
      >
        <Sparkles className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-lg tracking-tight">{APP_NAME}</span>
    </Link>
  )
}
