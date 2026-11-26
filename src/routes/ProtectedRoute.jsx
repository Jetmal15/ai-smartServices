import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingSpinner } from '../components/ui/index.js'
import { useAuth } from '../hooks/useAuth.js'
import { hasRole } from '../lib/permissions.js'
import { PATHS, ROLE_HOME } from './paths.js'

/**
 * Layout route that guards its children.
 * - Not signed in  -> /login (remembers where the user was heading)
 * - Wrong role     -> that user's own dashboard, with an "access denied" notice
 * The check is for navigation only; the data behind every page is protected by Appwrite permissions.
 */
export default function ProtectedRoute({ allowedRoles }) {
  const { isAuthenticated, isLoading, role } = useAuth()
  const location = useLocation()

  if (isLoading) return <LoadingSpinner center label="Checking session…" className="min-h-screen" />
  if (!isAuthenticated) return <Navigate to={PATHS.login} replace state={{ from: location }} />
  if (allowedRoles && !hasRole(role, ...allowedRoles)) {
    return <Navigate to={ROLE_HOME[role]} replace state={{ accessDenied: location.pathname }} />
  }

  return <Outlet />
}
