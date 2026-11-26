import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import DashboardTopbar from '../components/layout/DashboardTopbar.jsx'
import Sidebar from '../components/layout/Sidebar.jsx'
import { Alert } from '../components/ui/index.js'
import NotificationsProvider from '../context/NotificationsProvider.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { clearFlash, peekFlash } from '../lib/flash.js'
import { PATHS } from '../routes/paths.js'

/** Generic dashboard shell. Role layouts supply the nav config; the user comes from auth. */
export default function DashboardLayout({ config }) {
  const { user } = useAuth()
  const location = useLocation()
  const [deniedDismissed, setDeniedDismissed] = useState(false)
  const accessDenied = location.state?.accessDenied && !deniedDismissed
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [flash, setFlashMessage] = useState(peekFlash)
  useEffect(() => {
    if (flash) clearFlash()
  }, [flash])
  const closeSidebar = () => setSidebarOpen(false)

  return (
    <NotificationsProvider>
    <div className="min-h-screen bg-slate-50">
      <Sidebar nav={config.nav} title={config.title} open={sidebarOpen} onClose={closeSidebar} />
      <div className="lg:pl-64">
        <DashboardTopbar role={config.role} user={user} profilePath={PATHS[user.role].profile} onMenuClick={() => setSidebarOpen(true)} />
        <main className="p-4 sm:p-6 lg:p-8">
          {accessDenied && (
            <div className="mb-6" onClick={() => setDeniedDismissed(true)}>
              <Alert variant="warning" title="You don't have access to that page">
                You were sent back to your own dashboard. Contact an administrator if you think this is a mistake.
              </Alert>
            </div>
          )}
          {flash && (
            <div className="mb-6" onClick={() => setFlashMessage(null)}>
              <Alert variant="success">{flash}</Alert>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
    </NotificationsProvider>
  )
}
