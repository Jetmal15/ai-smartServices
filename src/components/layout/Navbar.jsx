import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { LayoutDashboard, LogOut, Menu, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth.js'
import { cn } from '../../lib/cn.js'
import { publicLinks } from '../../lib/navigation.js'
import { PATHS, ROLE_HOME } from '../../routes/paths.js'
import { Button } from '../ui/index.js'
import Logo from './Logo.jsx'

const linkClasses = ({ isActive }) =>
  cn(
    'rounded-lg px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  )

/** Log in / Register for guests; Dashboard / Log out for signed-in users. */
function AuthButtons({ className, onNavigate }) {
  const { isAuthenticated, role, logout } = useAuth()

  if (isAuthenticated) {
    return (
      <div className={className}>
        <Button as={Link} to={ROLE_HOME[role]} size="sm" icon={LayoutDashboard} onClick={onNavigate}>
          Dashboard
        </Button>
        <Button
          variant="outline"
          size="sm"
          icon={LogOut}
          onClick={() => {
            logout()
            onNavigate?.()
          }}
        >
          Log out
        </Button>
      </div>
    )
  }

  return (
    <div className={className}>
      <Button as={Link} to={PATHS.login} variant="ghost" size="sm" onClick={onNavigate}>
        Log in
      </Button>
      <Button as={Link} to={PATHS.register} size="sm" onClick={onNavigate}>
        Register
      </Button>
    </div>
  )
}

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {publicLinks.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={linkClasses}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <AuthButtons className="hidden items-center gap-2 md:flex" />

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div id="mobile-menu" className="border-t border-slate-200 bg-white md:hidden">
          <nav className="container-page flex flex-col gap-1 py-3" aria-label="Mobile navigation">
            {publicLinks.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} onClick={close} className={linkClasses}>
                {link.label}
              </NavLink>
            ))}
            <AuthButtons className="mt-2 grid grid-cols-2 gap-2" onNavigate={close} />
          </nav>
        </div>
      )}
    </header>
  )
}
