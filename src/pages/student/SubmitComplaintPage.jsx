import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileText, Paperclip, X } from 'lucide-react'
import ComplaintStatusBadge from '../../components/complaints/ComplaintStatusBadge.jsx'
import { Alert, Button, Card, ErrorMessage, Input, LoadingSpinner, Select, Textarea } from '../../components/ui/index.js'
import Field from '../../components/ui/Field.jsx'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import { COMPLAINT_RULES } from '../../../database/schema.js'
import { ATTACHMENT_ACCEPT, ATTACHMENT_EXTENSIONS, ATTACHMENT_MAX_MB, validateAttachmentFile, validateComplaintForm } from '../../lib/complaintValidation.js'
import { controlClasses } from '../../lib/styles.js'
import { formatBytes, formatDateTime } from '../../lib/format.js'
import { PATHS } from '../../routes/paths.js'
import * as complaintService from '../../services/complaintService.js'
import { categories as categoriesService, isSessionError as isDbSessionError } from '../../services/db/index.js'

const EMPTY = { title: '', description: '', location: '', categoryId: '' }

function Confirmation({ result, onAnother }) {
  const { complaint, duplicate } = result
  return (
    <Card>
      <div className="flex flex-col items-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-slate-900">{duplicate ? 'We already have this complaint' : 'Complaint submitted'}</h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          {duplicate
            ? 'You sent the same complaint a moment ago, so no second copy was created.'
            : 'Thank you. Your complaint was received and has been sent to the responsible department. Keep your complaint ID to follow its progress.'}
        </p>
      </div>
      <dl className="mx-auto mt-6 grid max-w-md gap-3 text-sm">
        {[
          ['Complaint ID', <span key="id" className="font-mono font-semibold text-slate-900">{complaint.reference}</span>],
          ['Title', complaint.title],
          ['Category', complaint.categoryName],
          ['Sent to', complaint.departmentName],
          ['Status', <ComplaintStatusBadge key="s" status={complaint.status} />],
          ['Submitted', formatDateTime(complaint.submittedAt)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-right text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button as={Link} to={`${PATHS.student.complaints}/${encodeURIComponent(complaint.id)}`}>
          View complaint
        </Button>
        <Button variant="outline" onClick={onAnother}>
          Submit another complaint
        </Button>
      </div>
    </Card>
  )
}

export default function SubmitComplaintPage() {
  const { handleAuthError } = useAuth()
  const categories = useAsyncData(() => categoriesService.listAvailable(), 'categories', isDbSessionError)
  const [values, setValues] = useState(EMPTY)
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  const options = (categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))
  const selected = (categories.data ?? []).find((category) => category.id === values.categoryId)

  const change = (event) => {
    const { name, value } = event.target
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: undefined }))
    setFormError('')
  }

  const chooseFile = (event) => {
    const chosen = event.target.files?.[0] ?? null
    const problem = validateAttachmentFile(chosen)
    if (problem) {
      setErrors((prev) => ({ ...prev, attachment: problem }))
      setFile(null)
      setFileInputKey((key) => key + 1)
      return
    }
    setFile(chosen)
    setErrors((prev) => ({ ...prev, attachment: undefined }))
  }

  const removeFile = () => {
    setFile(null)
    setFileInputKey((key) => key + 1)
  }

  const reset = () => {
    setValues(EMPTY)
    setFile(null)
    setFileInputKey((key) => key + 1)
    setErrors({})
    setFormError('')
    setResult(null)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    const { errors: found } = validateComplaintForm(values)
    const fileProblem = validateAttachmentFile(file)
    if (fileProblem) found.attachment = fileProblem
    if (Object.keys(found).length > 0) {
      setErrors(found)
      setFormError('Please correct the highlighted fields.')
      return
    }

    setSubmitting(true)
    setFormError('')
    try {
      setResult(await complaintService.submitComplaint({ ...values, file }))
    } catch (error) {
      if (complaintService.isSessionError(error) && handleAuthError(error)) return
      const problem = complaintService.toComplaintError(error)
      if (problem.fields) setErrors(problem.fields)
      setFormError(problem.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Submit a complaint</h1>
        <p className="mt-1 text-sm text-slate-500">Tell us what went wrong. The right department is chosen from the category you select.</p>
      </div>

      {result ? (
        <Confirmation result={result} onAnother={reset} />
      ) : categories.status === 'loading' ? (
        <LoadingSpinner center label="Loading categories…" />
      ) : categories.status === 'error' ? (
        <ErrorMessage title="Could not load the complaint categories" message={categories.error} onRetry={categories.reload} />
      ) : options.length === 0 ? (
        <Alert variant="warning" title="No categories are available yet">
          Complaints cannot be submitted until an administrator sets up the departments and categories.
        </Alert>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {formError && <ErrorMessage title="Your complaint was not submitted" message={formError} />}

            <Input
              label="Complaint title"
              name="title"
              value={values.title}
              onChange={change}
              error={errors.title}
              maxLength={COMPLAINT_RULES.title.max}
              placeholder="e.g. Ceiling fan not working in Lab 3"
              required
              autoComplete="off"
            />

            <Select
              label="Category"
              name="categoryId"
              value={values.categoryId}
              onChange={change}
              error={errors.categoryId}
              options={options}
              placeholder="Choose a category"
              hint={selected ? `This will be sent to: ${selected.departmentName}` : undefined}
              required
            />

            <Textarea
              label="Description"
              name="description"
              value={values.description}
              onChange={change}
              error={errors.description}
              rows={6}
              maxLength={COMPLAINT_RULES.description.max}
              placeholder="Describe the problem: what happened, when, and how it affects you."
              hint={`${values.description.length} / ${COMPLAINT_RULES.description.max} characters (at least ${COMPLAINT_RULES.description.min})`}
              required
            />

            <Input
              label="Location or relevant details (optional)"
              name="location"
              value={values.location}
              onChange={change}
              error={errors.location}
              maxLength={COMPLAINT_RULES.location.max}
              placeholder="e.g. Block B, Lab 3, second floor"
              autoComplete="off"
            />

            <Field
              id="attachment"
              label="Attachment (optional)"
              error={errors.attachment}
              hint={`${ATTACHMENT_EXTENSIONS.join(', ').toUpperCase()} up to ${ATTACHMENT_MAX_MB} MB. Only you, administrators and the responsible department can open it.`}
            >
              {file ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0 text-slate-500">{formatBytes(file.size)}</span>
                  </span>
                  <button type="button" onClick={removeFile} className="rounded p-1 text-slate-500 hover:bg-slate-200" aria-label="Remove attachment">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <label className={`${controlClasses(Boolean(errors.attachment))} flex cursor-pointer items-center gap-2 text-slate-500`}>
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                  Choose a file
                  <input key={fileInputKey} id="attachment" type="file" accept={ATTACHMENT_ACCEPT} onChange={chooseFile} className="sr-only" />
                </label>
              )}
            </Field>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="submit" loading={submitting}>
                {submitting ? 'Submitting…' : 'Submit complaint'}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  )
}
