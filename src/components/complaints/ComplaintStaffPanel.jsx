import { useState } from 'react'
import { CheckCircle2, Lock, MessageSquarePlus, StickyNote } from 'lucide-react'
import { Alert, Button, Card, Select, Textarea } from '../ui/index.js'
import { COMPLAINT_RULES } from '../../../database/schema.js'
import { COMPLAINT_STATUS } from '../../lib/constants.js'
import { formatDateTime } from '../../lib/format.js'
import { TRANSITIONS } from '../../lib/tracking.js'
import * as complaintService from '../../services/complaintService.js'
import { useAuth } from '../../hooks/useAuth.js'

const MIN_RESOLVE = COMPLAINT_RULES.resolveRemarkMin

/**
 * What department staff can do with a complaint: move it to the next status (with a remark), add a public remark,
 * and keep internal notes. The server re-checks everything (department, transition, remark) – this form only guides.
 * `onChanged({ complaint, history, notes })` receives the refreshed complaint after every successful change.
 */
export default function ComplaintStaffPanel({ complaint, notes, onChanged }) {
  const { handleAuthError } = useAuth()
  const next = TRANSITIONS[complaint.status] ?? []
  const [status, setStatus] = useState('')
  const [remark, setRemark] = useState('')
  const [publicRemark, setPublicRemark] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('') // 'status' | 'remark' | 'note'
  const [fieldErrors, setFieldErrors] = useState({}) // per field, e.g. { remark: '…' }
  const [formError, setFormError] = useState(null) // { kind, message } for the form that failed
  const [message, setMessage] = useState('')

  const run = async (kind, action, onDone) => {
    if (busy) return
    setBusy(kind)
    setFieldErrors({})
    setFormError(null)
    setMessage('')
    try {
      const result = await action()
      onDone()
      onChanged(result)
    } catch (error) {
      if (complaintService.isSessionError(error) && handleAuthError(error)) return
      const problem = complaintService.toComplaintError(error)
      setFieldErrors(problem.fields ?? {})
      setFormError({ kind, message: problem.message })
    } finally {
      setBusy('')
    }
  }

  const submitStatus = (event) => {
    event.preventDefault()
    if (!status) return setFieldErrors({ status: 'Choose the new status.' })
    if (status === 'resolved' && remark.trim().length < MIN_RESOLVE) {
      return setFieldErrors({ remark: `Explain what was done (at least ${MIN_RESOLVE} characters) before marking this complaint resolved.` })
    }
    run('status', () => complaintService.updateComplaintStatus({ complaintId: complaint.id, status, expectedStatus: complaint.status, remark }), () => {
      setMessage(`Status changed to ${COMPLAINT_STATUS[status].label}.`)
      setStatus('')
      setRemark('')
    })
  }

  const submitRemark = (event) => {
    event.preventDefault()
    run('remark', () => complaintService.addComplaintRemark({ complaintId: complaint.id, remark: publicRemark }), () => {
      setMessage('Remark sent to the student.')
      setPublicRemark('')
    })
  }

  const submitNote = (event) => {
    event.preventDefault()
    run('note', () => complaintService.addComplaintNote({ complaintId: complaint.id, note }), () => {
      setMessage('Internal note saved.')
      setNote('')
    })
  }

  return (
    <Card className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Manage this complaint</h2>
        {complaint.lastUpdatedAt && (
          <p className="mt-1 text-xs text-slate-500">
            Last updated {formatDateTime(complaint.lastUpdatedAt)}
            {complaint.lastUpdatedByName ? ` by ${complaint.lastUpdatedByName}` : ''}
          </p>
        )}
      </div>

      {message && <Alert variant="success">{message}</Alert>}

      <form onSubmit={submitStatus} noValidate className="space-y-3" aria-label="Update status">
        <h3 className="text-sm font-semibold text-slate-900">Update status</h3>
        {next.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Lock className="h-4 w-4" aria-hidden="true" />
            This complaint is closed. Its status can no longer change.
          </p>
        ) : (
          <>
            {formError?.kind === 'status' && <Alert variant="warning">{formError.message}</Alert>}
            <Select
              label="New status"
              name="status"
              value={status}
              error={fieldErrors.status}
              onChange={(event) => {
                setStatus(event.target.value)
                setFieldErrors({})
              }}
              options={next.map((value) => ({ value, label: COMPLAINT_STATUS[value].label }))}
              placeholder={`Currently ${COMPLAINT_STATUS[complaint.status].label}. Choose the next status`}
            />
            <Textarea
              label={status === 'resolved' ? 'Remark for the student (required)' : 'Remark for the student (optional)'}
              name="remark"
              rows={3}
              value={remark}
              maxLength={COMPLAINT_RULES.remark.max}
              onChange={(event) => setRemark(event.target.value)}
              error={formError?.kind === 'status' || !formError ? fieldErrors.remark : undefined}
              hint="The student can see this remark. Do not include private information."
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === 'status'} disabled={!status}>
                Update status
              </Button>
              {next.includes('resolved') && (
                <Button type="button" variant="outline" icon={CheckCircle2} onClick={() => setStatus('resolved')}>
                  Mark as resolved
                </Button>
              )}
            </div>
          </>
        )}
      </form>

      {complaint.status !== 'closed' && (
        <form onSubmit={submitRemark} noValidate className="space-y-3 border-t border-slate-100 pt-6" aria-label="Add remark">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
            Add a remark (visible to the student)
          </h3>
          <Textarea aria-label="Remark for the student" rows={3} value={publicRemark} maxLength={COMPLAINT_RULES.remark.max} onChange={(event) => setPublicRemark(event.target.value)} error={formError?.kind === 'remark' ? fieldErrors.remark : undefined} />
          {formError?.kind === 'remark' && !fieldErrors.remark && <Alert variant="warning">{formError.message}</Alert>}
          <Button type="submit" variant="outline" loading={busy === 'remark'} disabled={!publicRemark.trim()}>
            Send remark
          </Button>
        </form>
      )}

      <div className="space-y-3 border-t border-slate-100 pt-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <StickyNote className="h-4 w-4" aria-hidden="true" />
          Internal notes (never shown to students)
        </h3>
        {notes.length === 0 ? (
          <p className="text-sm text-slate-500">No internal notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((item) => (
              <li key={item.id} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-slate-800">
                <p className="whitespace-pre-wrap break-words">{item.note}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.authorName} · {formatDateTime(item.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submitNote} noValidate className="space-y-3" aria-label="Add internal note">
          <Textarea aria-label="Internal note" rows={3} value={note} maxLength={COMPLAINT_RULES.note.max} onChange={(event) => setNote(event.target.value)} error={formError?.kind === 'note' ? fieldErrors.note : undefined} />
          {formError?.kind === 'note' && !fieldErrors.note && <Alert variant="warning">{formError.message}</Alert>}
          <Button type="submit" variant="outline" loading={busy === 'note'} disabled={!note.trim()}>
            Save internal note
          </Button>
        </form>
      </div>
    </Card>
  )
}
