import { Link } from 'react-router-dom'
import { Paperclip } from 'lucide-react'
import { COMPLAINT_PRIORITY } from '../../lib/constants.js'
import { formatDateTime } from '../../lib/format.js'
import { Badge } from '../ui/index.js'
import ComplaintStatusBadge from './ComplaintStatusBadge.jsx'

/** A list of complaint cards. `basePath` is the role's complaints route, e.g. "/student/complaints". */
export default function ComplaintList({ complaints, basePath, showStudent = false, showPriority = false }) {
  return (
    <ul className="divide-y divide-slate-100">
      {complaints.map((complaint) => (
        <li key={complaint.id}>
          <Link to={`${basePath}/${encodeURIComponent(complaint.id)}`} className="block px-5 py-4 transition hover:bg-slate-50 focus-visible:bg-slate-50">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs text-slate-500">{complaint.reference}</p>
                <p className="mt-0.5 truncate font-medium text-slate-900">{complaint.title}</p>
              </div>
              <span className="flex items-center gap-2">
                {showPriority && complaint.priority && <Badge variant={COMPLAINT_PRIORITY[complaint.priority]?.variant ?? 'neutral'}>{COMPLAINT_PRIORITY[complaint.priority]?.label ?? complaint.priority}</Badge>}
                <ComplaintStatusBadge status={complaint.status} />
              </span>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span>{complaint.categoryName}</span>
              <span>{complaint.departmentName}</span>
              <span>{formatDateTime(complaint.submittedAt)}</span>
              {showStudent && <span>{complaint.studentName}</span>}
              {complaint.attachment && (
                <span className="inline-flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  Attachment
                </span>
              )}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
