import { Outlet } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import Logo from '../components/layout/Logo.jsx'
import { APP_TAGLINE } from '../lib/constants.js'

const points = [
  'Submit and track complaints in one place',
  'Automatic routing to the right department',
  'Instant status notifications',
]

export default function AuthLayout() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-linear-to-br from-brand-800 via-brand-700 to-brand-600 p-12 text-white lg:flex">
        <Logo light />
        <div>
          <h2 className="text-3xl font-bold leading-tight">Faculty of Engineering and Technology</h2>
          <p className="mt-3 max-w-md text-brand-100">{APP_TAGLINE}</p>
          <ul className="mt-8 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex items-center gap-3 text-sm text-brand-50">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-200" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-brand-200">&copy; AI SmartServices</p>
      </aside>

      <div className="flex flex-col bg-white">
        <div className="border-b border-slate-100 p-4 lg:hidden">
          <Logo />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-md">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
