import { Link } from 'react-router-dom'
import { Button } from '../components/ui/index.js'
import { useAuth } from '../hooks/useAuth.js'
import { PATHS, ROLE_HOME } from '../routes/paths.js'

export default function NotFound() {
  const { isAuthenticated, role } = useAuth()

  return (
    <section className="container-page py-24 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-2 text-slate-600">The page you are looking for does not exist or has been moved.</p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <Button as={Link} to={PATHS.home}>
          Back to home
        </Button>
        {isAuthenticated && (
          <Button as={Link} to={ROLE_HOME[role]} variant="outline">
            Go to my dashboard
          </Button>
        )}
      </div>
    </section>
  )
}
