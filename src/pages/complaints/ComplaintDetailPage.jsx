import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileQuestion, Paperclip } from 'lucide-react'
import AiAnalysisPanel from '../../components/complaints/AiAnalysisPanel.jsx'
import ComplaintReassignPanel from '../../components/complaints/ComplaintReassignPanel.jsx'
import ComplaintStaffPanel from '../../components/complaints/ComplaintStaffPanel.jsx'
import ComplaintStatusBadge from '../../components/complaints/ComplaintStatusBadge.jsx'
import ComplaintTimeline from '../../components/complaints/ComplaintTimeline.jsx'
import { Button, Card, EmptyState, ErrorMessage, LoadingSpinner } from '../../components/ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import { COMPLAINT_PRIORITY } from '../../lib/constants.js'
import { formatBytes, formatDateTime } from '../../lib/format.js'
import * as complaintService from '../../services/complaintService.js'

/** One complaint. Used by students (their own) and department staff (their department's); the server decides who may open it. */
export default function ComplaintDetailPage({ backTo, backLabel, showStudent = false, canManage = false, canReassign = false }) {
  const { id } = useParams()
  const { handleAuthError } = useAuth()
  const [downloadError, setDownloadError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [updated, setUpdated] = useState(null) // fresh { complaint, history, notes } after a staff change
  const complaint = useAsyncData(() => complaintService.getComplaint(id), id, complaintService.isSessionError)

  const download = async () => {
    setDownloading(true)
    setDownloadError('')
    try {
      complaintService.saveAttachment(await complaintService.fetchAttachment(id))
    } catch (error) {
      if (complaintService.isSessionError(error) && handleAuthError(error)) return
      setDownloadError(complaintService.toComplaintError(error).message)
    } finally {
      setDownloading(false)
    }
  }

  const current = updated?.id === id ? updated : complaint.data
  const data = current?.complaint
  const history = current?.history ?? []
  const notes = current?.notes ?? []
  const ai = current?.ai ?? null
  const handleChanged = useCallback((result) => setUpdated({ id, ...result }), [id])
  const rows = data && [
    ['Category', data.categoryName],
    ['Department', data.departmentName],
    ...(data.priority ? [['Priority', COMPLAINT_PRIORITY[data.priority]?.label ?? data.priority]] : []),
    ['Submitted', formatDateTime(data.submittedAt)],
    ...(data.location ? [['Location / details', data.location]] : []),
    ...(data.lastUpdatedAt ? [['Last updated', `${formatDateTime(data.lastUpdatedAt)}${data.lastUpdatedByName ? ` by ${data.lastUpdatedByName}` : ''}`]] : []),
    ...(showStudent ? [['Submitted by', `${data.studentName}${data.studentRollNumber ? ` (${data.studentRollNumber})` : ''}`]] : []),
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {backLabel}
      </Link>

      {complaint.status === 'loading' && <LoadingSpinner center label="Loading complaint…" />}
      {complaint.status === 'error' && <ErrorMessage title="Could not open this complaint" message={complaint.error} onRetry={complaint.reload} />}
      {complaint.status === 'ready' && !data && <EmptyState icon={FileQuestion} title="Complaint not found" />}
      {data && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-sm text-slate-500">{data.reference}</p>
              <h1 className="mt-1 break-words text-xl font-bold text-slate-900">{data.title}</h1>
            </div>
            <ComplaintStatusBadge status={data.status} />
          </div>

          <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-slate-500">{label}</dt>
                <dd className="mt-0.5 break-words font-medium text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>

          <h2 className="mt-6 text-sm font-semibold text-slate-900">Description</h2>
          {/* React escapes the text; whitespace-pre-wrap only keeps the student's line breaks. */}
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{data.description}</p>

          <ComplaintTimeline status={data.status} history={history} showActor={showStudent} />

          {data.attachment && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
                  <Paperclip className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="truncate">{data.attachment.name}</span>
                  <span className="shrink-0 text-slate-500">{formatBytes(data.attachment.size)}</span>
                </span>
                <Button variant="outline" size="sm" icon={Download} loading={downloading} onClick={download}>
                  Download
                </Button>
              </div>
              {downloadError && <p className="mt-2 text-sm text-red-700" role="alert">{downloadError}</p>}
            </div>
          )}
        </Card>
      )}
      {data && ai && <AiAnalysisPanel key={`ai-${data.id}`} complaint={data} ai={ai} canReassign={canReassign} onChanged={handleChanged} />}
      {data && canReassign && <ComplaintReassignPanel key={`reassign-${data.id}`} complaint={data} onChanged={handleChanged} />}
      {data && canManage && <ComplaintStaffPanel key={data.id} complaint={data} notes={notes} onChanged={handleChanged} />}
    </div>
  )
}
