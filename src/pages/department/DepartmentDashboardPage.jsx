import { Link } from 'react-router-dom'
import { Building2, CheckCircle2, CircleDot, Eye, Inbox, Loader, Lock } from 'lucide-react'
import ComplaintList from '../../components/complaints/ComplaintList.jsx'
import { Alert, Button, Card, EmptyState, ErrorMessage, LoadingSpinner, StatCard } from '../../components/ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import { PATHS } from '../../routes/paths.js'
import * as complaintService from '../../services/complaintService.js'

const load = async () => {
  const [summary, newest] = await Promise.all([complaintService.getDepartmentStats(), complaintService.listDepartmentComplaints({ status: 'submitted', sort: 'newest', limit: 5 })])
  return { ...summary, newest: newest.complaints }
}

/** Department staff dashboard: counts per status and the newest complaints waiting for review. Numbers come from the server, scoped to the staff member's own department(s). */
export default function DepartmentDashboardPage() {
  const { user } = useAuth()
  const data = useAsyncData(load, user.id, complaintService.isSessionError)

  if (data.status === 'loading') return <LoadingSpinner center label="Loading your dashboard…" />
  if (data.status === 'error') return <ErrorMessage title="Could not load the dashboard" message={data.error} onRetry={data.reload} />

  const { stats, departments, newest } = data.data
  const cards = [
    { label: 'Total complaints', value: stats.total, icon: Inbox, tone: 'blue' },
    { label: 'New', value: stats.submitted, icon: CircleDot, tone: 'blue', note: 'Waiting for review' },
    { label: 'Under review', value: stats.under_review, icon: Eye, tone: 'amber' },
    { label: 'In progress', value: stats.in_progress, icon: Loader, tone: 'amber' },
    { label: 'Resolved', value: stats.resolved, icon: CheckCircle2, tone: 'green' },
    { label: 'Closed', value: stats.closed, icon: Lock, tone: 'green' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
          <Building2 className="h-4 w-4" aria-hidden="true" />
          {departments.length > 0 ? departments.map((department) => department.name).join(', ') : 'No department assigned'}
        </p>
      </div>

      {departments.length === 0 && (
        <Alert variant="warning" title="You are not assigned to a department yet">
          Ask an administrator to assign you to a department. Complaints appear here once you are.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      <Card padded={false}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold text-slate-900">New complaints</h2>
          <Button as={Link} to={PATHS.department.complaints} variant="outline" size="sm">
            View all complaints
          </Button>
        </div>
        {newest.length === 0 ? (
          <EmptyState icon={Inbox} title="No new complaints" description="Complaints waiting for review will appear here." />
        ) : (
          <ComplaintList complaints={newest} basePath={PATHS.department.complaints} showStudent showPriority />
        )}
      </Card>
    </div>
  )
}
