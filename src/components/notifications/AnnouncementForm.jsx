import { useState } from 'react'
import { Megaphone } from 'lucide-react'
import { Alert, Button, Card, ErrorMessage, Input, Select, Textarea } from '../ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import * as notificationService from '../../services/notificationService.js'
import { departments, isSessionError } from '../../services/db/index.js'

const AUDIENCES = [
  { value: 'all_students', label: 'All students' },
  { value: 'all_staff', label: 'All department staff' },
  { value: 'department', label: 'Staff of one department' },
  { value: 'complaint', label: 'The student of one complaint' },
]
const EMPTY = { audience: 'all_students', departmentId: '', complaintId: '', title: '', message: '' }

/** Administrators: send an important update. The server works out who receives it; the same announcement sent twice notifies nobody twice. */
export default function AnnouncementForm() {
  const { handleAuthError } = useAuth()
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const list = useAsyncData(() => departments.list({ status: 'active' }), 'departments', isSessionError)
  const departmentOptions = (list.data ?? list.previous)?.departments.map((d) => ({ value: d.id, label: d.name })) ?? []

  const change = (event) => {
    const { name, value } = event.target
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: undefined }))
    setResult(null)
    setFormError('')
  }

  const submit = async (event) => {
    event.preventDefault()
    if (sending) return
    setSending(true)
    setFormError('')
    setResult(null)
    try {
      const sent = await notificationService.sendAnnouncement({
        audience: values.audience,
        title: values.title,
        message: values.message,
        ...(values.audience === 'department' ? { departmentId: values.departmentId } : {}),
        ...(values.audience === 'complaint' ? { complaintId: values.complaintId } : {}),
      })
      setResult(sent)
      setValues((prev) => ({ ...EMPTY, audience: prev.audience }))
    } catch (error) {
      if (notificationService.isSessionError(error) && handleAuthError(error)) return
      const problem = notificationService.toNotificationError(error)
      setErrors(problem.fields ?? {})
      setFormError(problem.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Megaphone className="h-4 w-4 text-brand-600" aria-hidden="true" />
        Send an important update
      </h2>
      <p className="mt-1 text-sm text-slate-500">Recipients see it in their notifications as an important update.</p>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        {formError && <ErrorMessage title="The update was not sent" message={formError} />}
        {result && (
          <Alert variant="success">
            Sent to {result.created} {result.created === 1 ? 'person' : 'people'}
            {result.duplicate > 0 ? ` (${result.duplicate} had already received it)` : ''}
            {result.failed > 0 ? `, ${result.failed} could not be notified` : ''}.
          </Alert>
        )}
        <Select label="Send to" name="audience" value={values.audience} onChange={change} error={errors.audience} options={AUDIENCES} />
        {values.audience === 'department' && (
          <Select label="Department" name="departmentId" value={values.departmentId} onChange={change} error={errors.departmentId} options={departmentOptions} placeholder="Choose a department" />
        )}
        {values.audience === 'complaint' && (
          <Input label="Complaint ID" name="complaintId" value={values.complaintId} onChange={change} error={errors.complaintId} placeholder="e.g. CMP-20261122-K7M2QX" autoComplete="off" />
        )}
        <Input label="Title" name="title" value={values.title} onChange={change} error={errors.title} maxLength={120} autoComplete="off" />
        <Textarea label="Message" name="message" rows={4} value={values.message} onChange={change} error={errors.message} maxLength={1000} />
        <div className="flex justify-end">
          <Button type="submit" loading={sending}>
            Send update
          </Button>
        </div>
      </form>
    </Card>
  )
}
