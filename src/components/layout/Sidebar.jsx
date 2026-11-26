import { Link, NavLink } from 'react-router-dom'
import { Globe, LogOut, X } from 'lucide-react'
import { cn } from '../../lib/cn.js'
import { useAuth } from '../../hooks/useAuth.js'
import { PATHS } from '../../routes/paths.js'
import Logo from './Logo.jsx'

const itemClasses = ({ isActive }) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  )

export default function Sidebar({ nav, title, open, onClose }) {
  const { logout } = useAuth()

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label={title}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="px-6 pb-2 pt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={onClose} className={itemClasses}>
              <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1 border-t border-slate-200 p-3">
          <Link to={PATHS.home} className={itemClasses({ isActive: false })}>
            <Globe className="h-5 w-5" aria-hidden="true" />
            Back to website
          </Link>
          <Link to={PATHS.login} onClick={logout} className={itemClasses({ isActive: false })}>
            <LogOut className="h-5 w-5" aria-hidden="true" />
            Log out
          </Link>
        </div>
      </aside>
    </>
  )
}
