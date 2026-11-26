import { useState } from 'react'
import { Hash, Lock, Mail, User } from 'lucide-react'
import { Alert, Badge, Button, Card, ErrorMessage, Input, LoadingSpinner, Select } from '../../components/ui/index.js'
import { useAuth } from '../../hooks/useAuth.js'
import { ACCOUNT_STATUS, FET_DEPARTMENTS, ROLE_BADGE_VARIANT, ROLE_TITLES, ROLES } from '../../lib/constants.js'
import { formatDate } from '../../lib/format.js'
import { canEditField, SELF_EDITABLE_FIELDS } from '../../lib/permissions.js'
import { validateProfileUpdate } from '../../utils/validators.js'

/** "ITSC Department (Head), Cleaning Department" – or a hint when no service department is assigned yet. */
function describeAssignments(assignments = []) {
  if (assignments.length === 0) return 'Not assigned yet'
  return assignments
    .map((item) => {
      const name = item.departmentName || 'Unknown department'
      return item.position && item.position !== 'Staff' ? `${name} (${item.position})` : name
    })
    .join(', ')
}

/** Read-only rows for each role (what the spec lists for that role's profile). */
function detailRows(profile) {
  const role = ROLE_TITLES[profile.role]
  const roleBadge = <Badge variant={ROLE_BADGE_VARIANT[profile.role]}>{role}</Badge>
  const status = ACCOUNT_STATUS[profile.status] ?? ACCOUNT_STATUS.active
  const statusBadge = (
    <Badge variant={status.variant} dot>
      {status.label}
    </Badge>
  )

  if (profile.role === ROLES.STUDENT) {
    return [
      ['Name', profile.name],
      ['Roll number', profile.rollNumber || 'Not set'],
      ['Email', profile.email],
      ['Department / program', profile.department || 'Not set'],
      ['Account created', formatDate(profile.accountCreatedAt)],
      ['Role', roleBadge],
    ]
  }
  if (profile.role === ROLES.DEPARTMENT) {
    return [
      ['Name', profile.name],
      ['Email', profile.email],
      ['Assigned department', describeAssignments(profile.assignments)],
      ['Role', roleBadge],
      ['Account status', statusBadge],
    ]
  }
  return [
    ['Name', profile.name],
    ['Email', profile.email],
    ['Role', roleBadge],
  ]
}

function EditProfileForm({ profile }) {
  const { saveProfile } = useAuth()
  const editable = SELF_EDITABLE_FIELDS[profile.role] ?? []
  // The roll number can be set once (e.g. if it could not be saved at sign-up); after that it is locked.
  const rollEditable = canEditField(profile.role, 'rollNumber') && !profile.rollNumber
  const fields = editable.filter((field) => field !== 'rollNumber' || rollEditable)

  const [values, setValues] = useState({ name: profile.name, department: profile.department, rollNumber: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleChange = (event) => {
    const { name, value } = event.target
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: undefined }))
    setFormError('')
    setSaved(false)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const next = validateProfileUpdate(values, fields, FET_DEPARTMENTS)
    setErrors(next)
    if (Object.keys(next).length > 0) return

    // Send only what actually changed, and only fields this role may edit.
    const changes = {}
    if (fields.includes('name') && values.name.trim() !== profile.name) changes.name = values.name.trim()
    if (fields.includes('department') && values.department !== profile.department) changes.department = values.department
    if (fields.includes('rollNumber') && values.rollNumber.trim()) changes.rollNumber = values.rollNumber.trim()
    if (Object.keys(changes).length === 0) {
      setFormError('You have not changed anything.')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      await saveProfile(changes)
      setValues((prev) => ({ ...prev, rollNumber: '' }))
      setSaved(true)
    } catch (error) {
      if (error.fields) setErrors(error.fields)
      else setFormError(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Edit profile" description="You can change the details below. Everything else is managed for you.">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {saved && <Alert variant="success">Your profile has been updated.</Alert>}
        {formError && <ErrorMessage title="Could not save your profile" message={formError} />}

        <Input label="Full name" name="name" icon={User} autoComplete="name" value={values.name} onChange={handleChange} error={errors.name} required />

        {fields.includes('department') && (
          <Select
            label="Department / program"
            name="department"
            options={FET_DEPARTMENTS}
            placeholder="Select department"
            value={values.department}
            onChange={handleChange}
            error={errors.department}
            required
          />
        )}

        {profile.role === ROLES.STUDENT &&
          (rollEditable ? (
            <Input
              label="Roll number"
              name="rollNumber"
              icon={Hash}
              placeholder="e.g. 22SW001"
              hint="You can set this once. After that, only an administrator can change it."
              value={values.rollNumber}
              onChange={handleChange}
              error={errors.rollNumber}
            />
          ) : (
            <Input label="Roll number" icon={Lock} value={profile.rollNumber} disabled hint="Only an administrator can change a roll number." readOnly />
          ))}

        <Input label="Email" icon={Mail} value={profile.email} disabled readOnly hint="Your email is your sign-in and cannot be changed here." />

        {profile.role !== ROLES.STUDENT && (
          <p className="flex items-start gap-2 text-sm text-slate-500">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Your role{profile.role === ROLES.DEPARTMENT ? ' and assigned department are' : ' is'} managed by an administrator.
          </p>
        )}

        <Button type="submit" loading={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
    </Card>
  )
}

/** One profile page for all three roles; what it shows and allows depends on the user's role. */
export default function ProfilePage() {
  const { profile, profileStatus, profileError, refreshProfile } = useAuth()

  if (profileStatus === 'error') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">My profile</h1>
        <ErrorMessage title="Could not load your profile" message={profileError} onRetry={refreshProfile} />
      </div>
    )
  }
  if (!profile) return <LoadingSpinner center label="Loading your profile…" />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My profile</h1>
        <p className="mt-1 text-sm text-slate-600">Your account details and the information you can update.</p>
      </div>

      {profile.role === ROLES.STUDENT && !profile.rollNumber && (
        <Alert variant="info" title="Add your roll number">
          Your roll number is not on your profile yet. Add it below so departments can identify you.
        </Alert>
      )}
      {profile.status === 'disabled' && (
        <Alert variant="warning" title="This account is disabled">
          Contact the administrator to have it re-enabled.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Account details">
          <dl className="divide-y divide-slate-100">
            {detailRows(profile).map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                <dt className="w-44 shrink-0 text-sm font-medium text-slate-500">{label}</dt>
                <dd className="min-w-0 break-words text-sm text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <EditProfileForm key={profile.id} profile={profile} />
      </div>
    </div>
  )
}
