import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'
import { canAccessPath } from '../lib/permissions.js'
import { ROLE_HOME } from './paths.js'

/**
 * Layout route for public pages.
 * With `restricted` (login, register) signed-in users are sent on to the page
 * they originally wanted, or to their dashboard.
 */
export default function PublicRoute({ restricted = false }) {
  const { isAuthenticated, isLoading, role } = useAuth()
  const location = useLocation()

  if (restricted && !isLoading && isAuthenticated) {
    const wanted = location.state?.from?.pathname
    const target = wanted && canAccessPath(role, wanted) ? wanted : ROLE_HOME[role]
    return <Navigate to={target} replace />
  }

  return <Outlet />
}
