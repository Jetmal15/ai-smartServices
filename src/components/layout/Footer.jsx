import { Link } from 'react-router-dom'
import { Mail, MapPin } from 'lucide-react'
import { APP_TAGLINE } from '../../lib/constants.js'
import { publicLinks } from '../../lib/navigation.js'
import Logo from './Logo.jsx'
import { PATHS } from '../../routes/paths.js'

const CURRENT_YEAR = new Date().getFullYear()

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="container-page grid gap-10 py-12 md:grid-cols-3">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-slate-600">{APP_TAGLINE} for the Faculty of Engineering and Technology (FET).</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Quick links</h3>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            {publicLinks.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="transition hover:text-brand-600">
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to={PATHS.login} className="transition hover:text-brand-600">
                Log in
              </Link>
            </li>
            <li>
              <Link to={PATHS.register} className="transition hover:text-brand-600">
                Student registration
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Contact</h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
              Faculty of Engineering and Technology, University Campus
            </li>
            <li className="flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
              support@smartservices.example
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-slate-100 py-4 text-center text-sm text-slate-500">
        &copy; {CURRENT_YEAR} AI SmartServices. All rights reserved.
      </div>
    </footer>
  )
}
