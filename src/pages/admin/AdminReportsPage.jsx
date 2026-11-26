import { BarChart3 } from 'lucide-react'
import { Card, EmptyState, ErrorMessage, LoadingSpinner, StatCard } from '../../components/ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { COMPLAINT_STATUS } from '../../lib/constants.js'
import { formatDateTime } from '../../lib/format.js'
import * as adminService from '../../services/adminService.js'

const TONES = { submitted: 'bg-brand-500', under_review: 'bg-amber-500', in_progress: 'bg-amber-600', resolved: 'bg-emerald-500', closed: 'bg-slate-500' }

/** "5.5 hours" / "3.2 days"; "—" when unknown. */
const formatHours = (hours) => (hours === null || hours === undefined ? '—' : hours < 48 ? `${hours} h` : `${(hours / 24).toFixed(1)} days`)
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${value}%`)

/** Horizontal bars; the numbers are always printed, so nothing depends on the colour or the bar length. */
function BarList({ items, label }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return (
    <ul aria-label={label} className="space-y-3">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-slate-700">{item.label}</span>
            <span className="shrink-0 font-semibold text-slate-900">{item.value}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div className={`h-full rounded-full ${item.tone ?? 'bg-brand-500'}`} style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function AdminReportsPage() {
  const result = useAsyncData(() => adminService.getReport(), 'report', adminService.isSessionError)
  if (result.status === 'loading') return <LoadingSpinner center label="Building the reports…" />
  if (result.status === 'error') return <ErrorMessage title="Could not build the reports" message={result.error} onRetry={result.reload} />

  const report = result.data
  const { resolution } = report
  const statusItems = Object.entries(COMPLAINT_STATUS).map(([status, { label }]) => ({ key: status, label, value: report.statusDistribution[status] ?? 0, tone: TONES[status] }))
  const categoryItems = report.byCategory.map((c) => ({ key: c.categoryId, label: c.status === 'active' ? c.name : `${c.name} (inactive)`, value: c.total }))
  const departmentItems = report.byDepartment.map((d) => ({ key: d.departmentId, label: d.status === 'active' ? d.name : `${d.name} (inactive)`, value: d.total }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">How complaints are distributed and how quickly they are resolved.</p>
        </div>
        <p className="text-xs text-slate-500">Generated {formatDateTime(report.generatedAt)}</p>
      </div>

      {report.total === 0 ? (
        <Card><EmptyState icon={BarChart3} title="No complaints yet" description="Reports appear once complaints are submitted." /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total complaints" value={report.total} icon={BarChart3} tone="blue" />
            <StatCard label="Resolved or closed" value={resolution.resolvedOrClosed} tone="green" note={`Resolution rate ${formatPercent(resolution.resolutionRate)}`} />
            <StatCard label="Average resolution time" value={formatHours(resolution.averageHours)} tone="amber" note={`Median ${formatHours(resolution.medianHours)}`} />
            <StatCard label="Resolved within 24 h / 72 h" value={`${formatPercent(resolution.within24h)} / ${formatPercent(resolution.within72h)}`} tone="green" note={`Based on ${resolution.count} complaint${resolution.count === 1 ? '' : 's'}`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-4 font-semibold text-slate-900">Status distribution</h2>
              <BarList items={statusItems} label="Status distribution" />
            </Card>
            <Card>
              <h2 className="mb-4 font-semibold text-slate-900">Complaints by category</h2>
              <BarList items={categoryItems} label="Complaints by category" />
            </Card>
            <Card className="lg:col-span-2">
              <h2 className="mb-4 font-semibold text-slate-900">Complaints by department</h2>
              <BarList items={departmentItems} label="Complaints by department" />
            </Card>
          </div>

          <Card padded={false}>
            <h2 className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-900">Department performance</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    {['Department', 'Complaints', 'Open', 'Resolved / closed', 'Resolution rate', 'Average resolution time'].map((heading) => (
                      <th key={heading} scope="col" className="px-5 py-3 font-semibold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.byDepartment.map((d) => (
                    <tr key={d.departmentId}>
                      <th scope="row" className="px-5 py-3 font-medium text-slate-900">{d.name}{d.status !== 'active' && <span className="ml-2 text-xs font-normal text-slate-500">(inactive)</span>}</th>
                      <td className="px-5 py-3">{d.total}</td>
                      <td className="px-5 py-3">{d.open}</td>
                      <td className="px-5 py-3">{d.resolved}</td>
                      <td className="px-5 py-3">{formatPercent(d.resolutionRate)}</td>
                      <td className="px-5 py-3">{formatHours(d.averageResolutionHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="font-semibold text-slate-900">Resolution statistics</h2>
            <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {[['Average time to resolve', formatHours(resolution.averageHours)], ['Median time to resolve', formatHours(resolution.medianHours)], ['Resolved within 24 hours', formatPercent(resolution.within24h)], ['Resolved within 72 hours', formatPercent(resolution.within72h)]].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Resolution times count complaints that were marked resolved. Complaints closed without being resolved are included in the resolution rate but not in the times.
              {resolution.sampled ? ' Times are based on the 2,000 newest resolved complaints.' : ''}
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
