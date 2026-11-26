import { useState } from 'react'
import { Building2, ChevronDown, ChevronUp, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorMessage, Input, LoadingSpinner, Modal, Select, Textarea } from '../../components/ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import * as adminService from '../../services/adminService.js'

function DepartmentForm({ department, onClose, onSaved }) {
  const { handleAuthError } = useAuth()
  const [values, setValues] = useState({ name: department?.name ?? '', description: department?.description ?? '', email: department?.email ?? '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

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
      if (department) await adminService.updateDepartment(department.id, values)
      else await adminService.createDepartment(values)
      onSaved(department ? 'Department updated.' : 'Department added.')
    } catch (error) {
      if (adminService.isSessionError(error) && handleAuthError(error)) return
      const problem = adminService.toAdminError(error)
      setErrors(problem.fields ?? {})
      setFormError(problem.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title={department ? `Edit ${department.name}` : 'Add a department'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="department-form" loading={saving}>{department ? 'Save changes' : 'Add department'}</Button>
        </>
      }
    >
      <form id="department-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <ErrorMessage title="Could not save" message={formError} />}
        <Input label="Name" name="name" value={values.name} onChange={change} error={errors.name} maxLength={128} required autoComplete="off" />
        <Textarea label="Description" name="description" rows={3} value={values.description} onChange={change} error={errors.description} maxLength={1000} />
        <Input label="Contact email (optional)" name="email" type="email" value={values.email} onChange={change} error={errors.email} autoComplete="off" />
      </form>
    </Modal>
  )
}

/** The staff assigned to one department, with assign / change position / remove. */
function StaffPanel({ department, onChanged }) {
  const { handleAuthError } = useAuth()
  const staff = useAsyncData(() => adminService.listDepartmentStaff(department.id), `staff-${department.id}`, adminService.isSessionError)
  const candidates = useAsyncData(() => adminService.listStaffCandidates(), 'candidates', adminService.isSessionError)
  const [userId, setUserId] = useState('')
  const [position, setPosition] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState('')
  const [edits, setEdits] = useState({})

  const assignedIds = new Set((staff.data ?? []).map((s) => s.userId))
  const options = (candidates.data ?? candidates.previous ?? []).filter((c) => !assignedIds.has(c.id)).map((c) => ({ value: c.id, label: `${c.name} (${c.email})` }))

  const run = async (kind, action, after) => {
    if (busy) return
    setBusy(kind)
    setErrors({})
    setFormError('')
    try {
      await action()
      after?.()
      staff.reload()
      onChanged()
    } catch (error) {
      if (adminService.isSessionError(error) && handleAuthError(error)) return
      const problem = adminService.toAdminError(error)
      setErrors(problem.fields ?? {})
      setFormError(problem.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-5 py-4" aria-label={`Staff of ${department.name}`}>
      <h3 className="text-sm font-semibold text-slate-900">Department staff</h3>
      {staff.status === 'loading' && <LoadingSpinner label="Loading staff…" />}
      {staff.status === 'error' && <ErrorMessage title="Could not load the staff" message={staff.error} onRetry={staff.reload} />}
      {staff.status === 'ready' && staff.data.length === 0 && <p className="mt-2 text-sm text-slate-500">Nobody is assigned to this department yet.</p>}
      {staff.status === 'ready' && staff.data.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-200">
          {staff.data.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{member.name}</p>
                <p className="text-xs text-slate-500">{member.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Position of ${member.name}`}
                  className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  value={edits[member.id] ?? member.position}
                  maxLength={100}
                  onChange={(event) => setEdits((prev) => ({ ...prev, [member.id]: event.target.value }))}
                />
                <Button size="sm" variant="outline" disabled={(edits[member.id] ?? member.position) === member.position} loading={busy === `pos-${member.id}`} onClick={() => run(`pos-${member.id}`, () => adminService.updateStaffPosition(member.id, edits[member.id]), () => setEdits((prev) => ({ ...prev, [member.id]: undefined })))}>
                  Save
                </Button>
                <Button size="sm" variant="outline" icon={Trash2} loading={busy === `rm-${member.id}`} onClick={() => run(`rm-${member.id}`, () => adminService.removeStaff(member.id))} aria-label={`Remove ${member.name}`}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-start"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          run('assign', () => adminService.assignStaff({ userId, departmentId: department.id, position }), () => {
            setUserId('')
            setPosition('')
          })
        }}
      >
        <Select aria-label="Staff member to assign" name="userId" value={userId} onChange={(e) => setUserId(e.target.value)} options={options} placeholder={options.length ? 'Choose a staff member' : 'No unassigned staff available'} error={errors.userId} />
        <Input aria-label="Position" name="position" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Position (e.g. Head)" maxLength={100} error={errors.position} />
        <Button type="submit" icon={Plus} loading={busy === 'assign'} disabled={!userId || department.status !== 'active'}>
          Assign
        </Button>
      </form>
      {formError && <p className="mt-2 text-sm text-red-700" role="alert">{formError}</p>}
      {department.status !== 'active' && <p className="mt-2 text-xs text-slate-500">Activate the department to assign more staff. Staff must have the department-staff role (Users page).</p>}
    </div>
  )
}

export default function AdminDepartmentsPage() {
  const { handleAuthError } = useAuth()
  const list = useAsyncData(() => adminService.listDepartments(), 'departments', adminService.isSessionError)
  const [form, setForm] = useState(null) // null | 'new' | department
  const [toggling, setToggling] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [openStaff, setOpenStaff] = useState('')

  const toggle = async () => {
    setBusy(true)
    setError('')
    try {
      await adminService.updateDepartment(toggling.id, { status: toggling.status === 'active' ? 'inactive' : 'active' })
      setNotice(`${toggling.name} is now ${toggling.status === 'active' ? 'inactive' : 'active'}.`)
      setToggling(null)
      list.reload()
    } catch (caught) {
      if (adminService.isSessionError(caught) && handleAuthError(caught)) return
      setError(adminService.toAdminError(caught).message)
      setToggling(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Departments</h1>
          <p className="mt-1 text-sm text-slate-500">The departments that receive complaints, and the staff who handle them.</p>
        </div>
        <Button icon={Plus} onClick={() => setForm('new')}>Add department</Button>
      </div>

      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800" role="status">{notice}</p>}
      {error && <ErrorMessage title="That did not work" message={error} />}

      <Card padded={false}>
        {list.status === 'loading' && <LoadingSpinner center label="Loading departments…" />}
        {list.status === 'error' && <div className="p-5"><ErrorMessage title="Could not load departments" message={list.error} onRetry={list.reload} /></div>}
        {list.status === 'ready' && list.data.length === 0 && <EmptyState icon={Building2} title="No departments yet" description="Add the first department, or run the database setup to create the standard ones." />}
        {list.status === 'ready' && list.data.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {list.data.map((department) => (
              <li key={department.id}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {department.name}
                      <Badge variant={department.status === 'active' ? 'success' : 'neutral'} dot>{department.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                    </p>
                    {department.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{department.description}</p>}
                    <p className="mt-1 text-xs text-slate-500">
                      {department.staffCount} staff · {department.categoryCount} {department.categoryCount === 1 ? 'category' : 'categories'}
                      {department.email ? ` · ${department.email}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" icon={Pencil} onClick={() => setForm(department)}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => setToggling(department)}>{department.status === 'active' ? 'Deactivate' : 'Activate'}</Button>
                    <Button size="sm" variant="outline" icon={openStaff === department.id ? ChevronUp : ChevronDown} onClick={() => setOpenStaff(openStaff === department.id ? '' : department.id)} aria-expanded={openStaff === department.id}>
                      <Users className="h-4 w-4" aria-hidden="true" />
                      Staff
                    </Button>
                  </div>
                </div>
                {openStaff === department.id && <StaffPanel department={department} onChanged={list.reload} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {form && (
        <DepartmentForm
          key={form === 'new' ? 'new' : form.id}
          department={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={(message) => {
            setForm(null)
            setNotice(message)
            list.reload()
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(toggling)}
        onClose={() => setToggling(null)}
        onConfirm={toggle}
        loading={busy}
        variant={toggling?.status === 'active' ? 'danger' : 'primary'}
        title={toggling?.status === 'active' ? `Deactivate ${toggling?.name}?` : `Activate ${toggling?.name}?`}
        message={toggling?.status === 'active' ? 'Students will no longer be able to submit complaints to this department’s categories, and no new staff can be assigned. Existing complaints and staff are kept.' : 'The department can receive complaints again once its categories are active.'}
        confirmLabel={toggling?.status === 'active' ? 'Deactivate' : 'Activate'}
      />
    </div>
  )
}
