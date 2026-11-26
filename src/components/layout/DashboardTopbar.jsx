import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import NotificationBell from '../notifications/NotificationBell.jsx'

export default function DashboardTopbar({ role, user, profilePath, onMenuClick }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="Open sidebar"
        >
          <Menu className="h-6 w-6" />
        </button>
        <span className="text-sm font-medium text-slate-500">{role}</span>
      </div>

      <div className="flex items-center gap-3">
        <NotificationBell />

        <Link to={profilePath} className="flex items-center gap-3 rounded-lg p-1 transition hover:bg-slate-100" aria-label="Open my profile">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
            {user.initials}
          </span>
          <div className="hidden text-left leading-tight sm:block">
            <p className="text-sm font-medium text-slate-900">{user.name}</p>
            <p className="text-xs text-slate-500">{user.email}</p>
          </div>
        </Link>
      </div>
    </header>
  )
}
