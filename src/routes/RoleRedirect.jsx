import { Navigate, useLocation } from 'react-router-dom'
import { LoadingSpinner } from '../components/ui/index.js'
import { useAuth } from '../hooks/useAuth.js'
import { PATHS, ROLE_HOME } from './paths.js'

/**
 * Role-aware shortcut routes (/dashboard, /profile): sends each signed-in user to the page that
 * belongs to THEIR role, and guests to the login page.
 */
export default function RoleRedirect({ to = 'dashboard' }) {
  const { isAuthenticated, isLoading, role } = useAuth()
  const location = useLocation()

  if (isLoading) return <LoadingSpinner center label="Checking session…" className="min-h-screen" />
  if (!isAuthenticated) return <Navigate to={PATHS.login} replace state={{ from: location }} />

  const target = to === 'profile' ? PATHS[role].profile : ROLE_HOME[role]
  return <Navigate to={target} replace />
}
