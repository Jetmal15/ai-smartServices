import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Search, UserPlus, Users } from 'lucide-react'
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorMessage, Input, LoadingSpinner, Modal, Select, StatCard } from '../../components/ui/index.js'
import CreateUserModal from '../../components/admin/CreateUserModal.jsx'
import { useAuth } from '../../hooks/useAuth.js'
import { ACCOUNT_STATUS, FET_DEPARTMENTS, ROLE_BADGE_VARIANT, ROLE_TITLES, ROLES } from '../../lib/constants.js'
import { formatDate } from '../../lib/format.js'
import * as profileService from '../../services/profileService.js'

const PAGE_SIZE = 10
const ROLE_OPTIONS = Object.values(ROLES).map((value) => ({ value, label: ROLE_TITLES[value] }))
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
]

/** Describes what a save will do, for the confirmation step. */
function describeChanges(target, draft) {
  const lines = []
  if (draft.role !== target.role) lines.push(`change the role of ${target.name} from ${ROLE_TITLES[target.role]} to ${ROLE_TITLES[draft.role]}`)
  if (draft.status !== target.status) lines.push(`${draft.status === 'disabled' ? 'disable' : 're-enable'} the account of ${target.name}`)
  return lines
}

function ManageUserModal({ target, onClose, onSaved }) {
  const { handleAuthError } = useAuth()
  const [draft, setDraft] = useState({ role: target.role, department: target.department, status: target.status })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  const set = (event) => {
    const { name, value } = event.target
    setDraft((prev) => {
      const next = { ...prev, [name]: value }
      // Only students have an academic department; staff are assigned to service departments separately.
      if (name === 'role') next.department = value === target.role ? target.department : ''
      return next
    })
    setErrors((prev) => ({ ...prev, [name]: undefined }))
    setFormError('')
  }

  const roleChanged = draft.role !== target.role
  const departmentChanged = draft.department !== target.department
  const statusChanged = draft.status !== target.status
  const hasChanges = roleChanged || departmentChanged || statusChanged

  const save = async () => {
    setSaving(true)
    setFormError('')
    try {
      let result = target
      // The server re-checks that the caller is an administrator for every one of these calls.
      if (roleChanged) {
        result = await profileService.adminSetRole({ userId: target.id, role: draft.role })
      }
      const accountChanges = {}
      if (statusChanged) accountChanges.status = draft.status
      if (departmentChanged && !roleChanged && draft.role === ROLES.STUDENT && draft.department) accountChanges.department = draft.department
      if (Object.keys(accountChanges).length > 0) {
        result = await profileService.adminUpdateAccount({ userId: target.id, ...accountChanges })
      }
      onSaved(result)
    } catch (error) {
      if (profileService.isSessionError(error)) handleAuthError(error)
      const problem = profileService.toProfileError(error)
      setConfirming(false)
      if (problem.fields) setErrors(problem.fields)
      else setFormError(problem.message)
      setSaving(false)
    }
  }

  const submit = (event) => {
    event.preventDefault()
    if (roleChanged || (statusChanged && draft.status === 'disabled')) setConfirming(true)
    else save()
  }

  return (
    <>
      <Modal
        open
        onClose={saving ? () => {} : onClose}
        title={`Manage ${target.name}`}
        description={target.email}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="manage-user-form" loading={saving && !confirming} disabled={!hasChanges}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="manage-user-form" onSubmit={submit} noValidate className="space-y-4">
          {formError && <ErrorMessage title="Could not save" message={formError} />}
          <Select label="Role" name="role" options={ROLE_OPTIONS} value={draft.role} onChange={set} error={errors.role} />
          {draft.role === ROLES.STUDENT && (
            <Select
              label="Department / program"
              name="department"
              options={FET_DEPARTMENTS}
              placeholder="Select department"
              value={draft.department}
              onChange={set}
              error={errors.department}
            />
          )}
          <Select label="Account status" name="status" options={STATUS_OPTIONS} value={draft.status} onChange={set} error={errors.status} />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={save}
        loading={saving}
        title="Confirm change"
        message={`You are about to ${describeChanges(target, draft).join(' and ')}. Continue?`}
        confirmLabel="Yes, apply"
      />
    </>
  )
}

export default function UsersPage() {
  const { user, handleAuthError } = useAuth()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage] = useState(0)
  const [managing, setManaging] = useState(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  // The latest finished request. It is "loading" whenever it does not match what is being asked for.
  const [result, setResult] = useState({ key: null, data: null, error: '' })

  // Debounce typing in the search box.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const requestKey = `${query}|${roleFilter}|${page}|${reloadToken}`
  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const data = await profileService.adminListProfiles({ search: query, role: roleFilter || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
        if (!cancelled) setResult({ key: requestKey, data, error: '' })
      } catch (err) {
        if (cancelled) return
        if (profileService.isSessionError(err) && handleAuthError(err)) return
        setResult((prev) => ({ key: requestKey, data: prev.data, error: profileService.toProfileError(err).message }))
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [query, roleFilter, page, reloadToken, requestKey, handleAuthError])

  const data = result.data
  const loading = result.key !== requestKey
  const hasError = !loading && Boolean(result.error)
  const status = hasError ? 'error' : loading ? 'loading' : 'ready'
  const error = result.error

  const handleSaved = (profile) => {
    setManaging(null)
    setNotice(`Updated ${profile.name}.`)
    reload()
  }

  const handleSync = async () => {
    setSyncing(true)
    setNotice('')
    try {
      const outcome = await profileService.adminSyncProfiles()
      setNotice(`Synced ${outcome.total} accounts: ${outcome.created} profiles created, ${outcome.updated} updated${outcome.failed ? `, ${outcome.failed} failed` : ''}.`)
      reload()
    } catch (err) {
      if (profileService.isSessionError(err) && handleAuthError(err)) return
      setNotice('')
      setResult((prev) => ({ ...prev, key: requestKey, error: profileService.toProfileError(err).message }))
    } finally {
      setSyncing(false)
    }
  }

  const counts = data?.counts
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="mt-1 text-sm text-slate-600">Manage roles, departments and account status. Only administrators can see this page.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={UserPlus} onClick={() => setCreating(true)}>
            Add staff or administrator
          </Button>
          <Button variant="outline" icon={RefreshCw} onClick={handleSync} loading={syncing}>
            Sync accounts
          </Button>
        </div>
      </div>

      {notice && (
        <div onClick={() => setNotice('')}>
          <Alert variant="success">{notice}</Alert>
        </div>
      )}

      {counts && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Students" value={String(counts.student)} icon={Users} tone="blue" />
          <StatCard label="Department staff" value={String(counts.department)} icon={Users} tone="green" />
          <StatCard label="Administrators" value={String(counts.admin)} icon={Users} tone="amber" />
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="flex-1">
            <Input aria-label="Search users" icon={Search} placeholder="Search by name, email, roll number or department" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="sm:w-52">
            <Select
              aria-label="Filter by role"
              options={[{ value: '', label: 'All roles' }, ...ROLE_OPTIONS]}
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value)
                setPage(0)
              }}
            />
          </div>
        </div>

        {status === 'loading' && !data && <LoadingSpinner center label="Loading users…" />}
        {status === 'error' && (
          <div className="p-4">
            <ErrorMessage title="Could not load users" message={error} onRetry={reload} />
          </div>
        )}
        {data && !hasError && (
          <>
            {data.profiles.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No users found"
                description={data.counts.total === 0 ? 'No profiles exist yet. Use “Sync accounts” to create profiles for existing accounts.' : 'Try a different search or filter.'}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-200 text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      {['User', 'Role', 'Department / roll no.', 'Status', 'Created', ''].map((heading) => (
                        <th key={heading} scope="col" className="px-5 py-3 font-semibold">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.profiles.map((profile) => {
                      const isSelf = profile.id === user.id
                      const accountStatus = ACCOUNT_STATUS[profile.status] ?? ACCOUNT_STATUS.active
                      return (
                        <tr key={profile.id} className="hover:bg-slate-50" data-testid={`user-row-${profile.email}`}>
                          <td className="px-5 py-3.5">
                            <p className="font-medium text-slate-900">
                              {profile.name} {isSelf && <Badge variant="neutral">You</Badge>}
                            </p>
                            <p className="text-slate-500">{profile.email}</p>
                          </td>
                          <td className="px-5 py-3.5">
                            <Badge variant={ROLE_BADGE_VARIANT[profile.role]}>{ROLE_TITLES[profile.role]}</Badge>
                          </td>
                          <td className="px-5 py-3.5 text-slate-600">
                            {profile.department || '—'}
                            {profile.rollNumber && <span className="block text-slate-500">{profile.rollNumber}</span>}
                          </td>
                          <td className="px-5 py-3.5">
                            <Badge variant={accountStatus.variant} dot>
                              {accountStatus.label}
                            </Badge>
                          </td>
                          <td className="px-5 py-3.5 text-slate-500">{formatDate(profile.accountCreatedAt)}</td>
                          <td className="px-5 py-3.5 text-right">
                            <Button size="sm" variant="outline" disabled={isSelf} onClick={() => setManaging(profile)} aria-label={`Manage ${profile.name}`} title={isSelf ? 'You cannot change your own role or status' : undefined}>
                              Manage
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
              <span>
                {data.total} {data.total === 1 ? 'user' : 'users'}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" icon={ChevronLeft} disabled={page === 0 || status === 'loading'} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" />
                <span>
                  Page {page + 1} of {totalPages}
                </span>
                <Button size="sm" variant="outline" icon={ChevronRight} disabled={page + 1 >= totalPages || status === 'loading'} onClick={() => setPage((p) => p + 1)} aria-label="Next page" />
              </div>
            </div>
          </>
        )}
      </Card>

      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={() => reload()} />}
      {managing && <ManageUserModal key={managing.id} target={managing} onClose={() => setManaging(null)} onSaved={handleSaved} />}
    </div>
  )
}
