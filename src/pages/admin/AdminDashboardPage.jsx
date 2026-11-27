import { Link } from 'react-router-dom'
import { Building2, CheckCircle2, ClipboardList, Clock, GraduationCap, Loader, Lock, UserCog } from 'lucide-react'
import { Card, EmptyState, ErrorMessage, LoadingSpinner, StatCard } from '../../components/ui/index.js'
import NotificationTime from '../../components/notifications/NotificationTime.jsx'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { PATHS } from '../../routes/paths.js'
import * as adminService from '../../services/adminService.js'

const load = async () => {
  const [stats, activity] = await Promise.all([adminService.getDashboardStats(), adminService.listAudit(8)])
  return { stats, activity }
}

const LINKS = [
  { to: PATHS.admin.complaints, label: 'Review complaints' },
  { to: PATHS.admin.users, label: 'Manage users' },
  { to: PATHS.admin.departments, label: 'Departments and staff' },
  { to: PATHS.admin.categories, label: 'Categories' },
  { to: PATHS.admin.reports, label: 'Reports' },
]

/** The administrator's overview. Every number is counted by the server (complaint-api, administrator module), which only answers administrators. */
export default function AdminDashboardPage() {
  const data = useAsyncData(load, 'admin-dashboard', adminService.isSessionError)
  if (data.status === 'loading') return <LoadingSpinner center label="Loading the dashboard…" />
  if (data.status === 'error') return <ErrorMessage title="Could not load the dashboard" message={data.error} onRetry={data.reload} />

  const { stats, activity } = data.data
  const cards = [
    { label: 'Total complaints', value: stats.complaints.total, icon: ClipboardList, tone: 'blue' },
    { label: 'Pending', value: stats.complaints.pending, icon: Clock, tone: 'amber', note: 'Submitted or under review' },
    { label: 'In progress', value: stats.complaints.in_progress, icon: Loader, tone: 'amber' },
    { label: 'Resolved', value: stats.complaints.resolved, icon: CheckCircle2, tone: 'green' },
    { label: 'Closed', value: stats.complaints.closed, icon: Lock, tone: 'green' },
    { label: 'Total students', value: stats.users.students, icon: GraduationCap, tone: 'blue' },
    { label: 'Department staff', value: stats.users.staff, icon: UserCog, tone: 'blue' },
    { label: 'Departments', value: stats.departments.total, icon: Building2, tone: 'blue', note: `${stats.departments.active} active · ${stats.categories.active} active categories` },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Administrator dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">An overview of complaints, people and departments.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="font-semibold text-slate-900">Go to</h2>
          <ul className="mt-3 space-y-1">
            {LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="block rounded-lg px-3 py-2 text-sm font-medium text-brand-600 hover:bg-slate-50">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card padded={false} className="lg:col-span-2">
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-900">Recent administrator activity</h2>
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" description="Changes to accounts, departments, categories and staff appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((entry) => (
                <li key={entry.id} className="px-5 py-3">
                  <p className="text-sm text-slate-800">{entry.summary}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {entry.actorName} · <NotificationTime value={entry.createdAt} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
