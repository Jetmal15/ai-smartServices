import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Alert, Button, ErrorMessage, Input, Modal, Select } from '../ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import * as adminService from '../../services/adminService.js'
import * as profileService from '../../services/profileService.js'

const ROLE_OPTIONS = [
  { value: 'department', label: 'Department staff' },
  { value: 'admin', label: 'Administrator' },
]

/**
 * Provision an account for department staff or an administrator (students register themselves). The server creates it with a
 * random temporary password that is shown here ONCE. For staff, an initial department can be chosen: they are assigned right away.
 */
export default function CreateUserModal({ onClose, onCreated }) {
  const { handleAuthError } = useAuth()
  const [values, setValues] = useState({ name: '', email: '', role: 'department', departmentId: '', position: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(null) // { profile, temporaryPassword, assignmentError }
  const [copied, setCopied] = useState(false)
  const departments = useAsyncData(() => adminService.listDepartments(), 'departments', adminService.isSessionError)
  const departmentOptions = (departments.data ?? departments.previous ?? []).filter((d) => d.status === 'active').map((d) => ({ value: d.id, label: d.name }))

  const change = (event) => {
    setValues((prev) => ({ ...prev, [event.target.name]: event.target.value }))
    setErrors((prev) => ({ ...prev, [event.target.name]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setFormError('')
    try {
      const { profile, temporaryPassword } = await profileService.adminCreateUser({ name: values.name, email: values.email, role: values.role })
      let assignmentError = ''
      if (values.role === 'department' && values.departmentId) {
        try {
          await adminService.assignStaff({ userId: profile.id, departmentId: values.departmentId, position: values.position })
        } catch (error) {
          assignmentError = adminService.toAdminError(error).message
        }
      }
      setCreated({ profile, temporaryPassword, assignmentError })
      onCreated(profile)
    } catch (error) {
      if (profileService.isSessionError?.(error) && handleAuthError(error)) return
      const problem = profileService.toProfileError(error)
      setErrors(problem.fields ?? {})
      setFormError(problem.message)
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.temporaryPassword)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (created) {
    return (
      <Modal open onClose={onClose} title="Account created" description={`${created.profile.name} · ${created.profile.email}`} footer={<Button onClick={onClose}>Done</Button>}>
        <div className="space-y-4">
          <Alert variant="warning" title="Save this temporary password now">
            It is shown only once and is not stored anywhere. Give it to {created.profile.name} through a secure channel and ask them to change it after signing in (or to use “Forgot password”).
          </Alert>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm text-slate-900" data-testid="temporary-password">
              {created.temporaryPassword}
            </code>
            <Button variant="outline" icon={copied ? Check : Copy} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
          {created.assignmentError && <Alert variant="warning" title="The account was created, but the department assignment failed">{created.assignmentError} You can assign them on the Departments page.</Alert>}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title="Add staff or administrator"
      description="Students register themselves. Use this for department staff and administrators."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="create-user-form" loading={saving}>Create account</Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <ErrorMessage title="The account was not created" message={formError} />}
        <Input label="Full name" name="name" value={values.name} onChange={change} error={errors.name} autoComplete="off" required />
        <Input label="E-mail address" name="email" type="email" value={values.email} onChange={change} error={errors.email} autoComplete="off" required />
        <Select label="Role" name="role" value={values.role} onChange={change} error={errors.role} options={ROLE_OPTIONS} />
        {values.role === 'department' && (
          <>
            <Select label="Department (optional)" name="departmentId" value={values.departmentId} onChange={change} options={departmentOptions} placeholder="Assign later" hint="They can be assigned now or later on the Departments page." />
            {values.departmentId && <Input label="Position (optional)" name="position" value={values.position} onChange={change} placeholder="e.g. Head, Technician" maxLength={100} />}
          </>
        )}
        {values.role === 'admin' && <Alert variant="warning">Administrators can manage every user, department and complaint. Only add people you trust.</Alert>}
      </form>
    </Modal>
  )
}
