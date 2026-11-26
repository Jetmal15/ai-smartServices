import { Link, generatePath } from 'react-router-dom'
import { Alert, Badge, Card, StatCard } from '../../components/ui/index.js'
import { COMPLAINT_PRIORITY, COMPLAINT_STATUS } from '../../lib/constants.js'
import { previewComplaints, previewContent } from '../../mock/previewData.js'
import { PATHS } from '../../routes/paths.js'

/** Layout preview for each role. Uses static data from src/mock only. */
export default function DashboardPreview({ role }) {
  const { heading, subheading, tableTitle, stats } = previewContent[role]
  const detailsPath = PATHS[role].complaintDetails // admins have no details route

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
        <p className="mt-1 text-sm text-slate-600">{subheading}</p>
      </div>

      <Alert title="Preview data">Figures and complaints below are static placeholders for UI preview only.</Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <Card title={tableTitle} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                {['ID', 'Complaint', 'Department', 'Priority', 'Status', 'Date'].map((heading) => (
                  <th key={heading} scope="col" className="px-5 py-3 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {previewComplaints.map((complaint) => (
                <tr key={complaint.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5 font-medium text-slate-900">
                    {detailsPath ? (
                      <Link to={generatePath(detailsPath, { id: complaint.id })} className="text-brand-600 hover:text-brand-700 hover:underline">
                        {complaint.id}
                      </Link>
                    ) : (
                      complaint.id
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-700">{complaint.title}</td>
                  <td className="px-5 py-3.5 text-slate-600">{complaint.department}</td>
                  <td className="px-5 py-3.5">
                    <Badge variant={COMPLAINT_PRIORITY[complaint.priority].variant}>{COMPLAINT_PRIORITY[complaint.priority].label}</Badge>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge variant={COMPLAINT_STATUS[complaint.status].variant} dot>
                      {COMPLAINT_STATUS[complaint.status].label}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">{complaint.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
