import { useState } from 'react'
import { Pencil, Plus, Tags } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorMessage, Input, LoadingSpinner, Modal, Select, Textarea } from '../../components/ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import * as adminService from '../../services/adminService.js'

function CategoryForm({ category, departments, onClose, onSaved }) {
  const { handleAuthError } = useAuth()
  const [values, setValues] = useState({ name: category?.name ?? '', description: category?.description ?? '', departmentId: category?.departmentId ?? '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const options = departments.filter((d) => d.status === 'active' || d.id === category?.departmentId).map((d) => ({ value: d.id, label: d.status === 'active' ? d.name : `${d.name} (inactive)` }))

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
      if (category) await adminService.updateCategory(category.id, values)
      else await adminService.createCategory(values)
      onSaved(category ? 'Category updated.' : 'Category added.')
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
      title={category ? `Edit ${category.name}` : 'Add a category'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="category-form" loading={saving}>{category ? 'Save changes' : 'Add category'}</Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <ErrorMessage title="Could not save" message={formError} />}
        <Input label="Name" name="name" value={values.name} onChange={change} error={errors.name} maxLength={128} required autoComplete="off" />
        <Textarea label="Description" name="description" rows={3} value={values.description} onChange={change} error={errors.description} maxLength={1000} />
        <Select label="Department that handles it" name="departmentId" value={values.departmentId} onChange={change} error={errors.departmentId} options={options} placeholder="Choose a department" required />
      </form>
    </Modal>
  )
}

export default function AdminCategoriesPage() {
  const { handleAuthError } = useAuth()
  const load = async () => {
    const [categories, departments] = await Promise.all([adminService.listCategories(), adminService.listDepartments()])
    return { categories, departments }
  }
  const list = useAsyncData(load, 'categories', adminService.isSessionError)
  const [form, setForm] = useState(null)
  const [toggling, setToggling] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const toggle = async () => {
    setBusy(true)
    setError('')
    try {
      await adminService.updateCategory(toggling.id, { status: toggling.status === 'active' ? 'inactive' : 'active' })
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
          <h1 className="text-2xl font-bold text-slate-900">Categories</h1>
          <p className="mt-1 text-sm text-slate-500">What students can complain about. Each category is handled by one department.</p>
        </div>
        <Button icon={Plus} onClick={() => setForm('new')} disabled={list.status !== 'ready'}>Add category</Button>
      </div>
      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800" role="status">{notice}</p>}
      {error && <ErrorMessage title="That did not work" message={error} />}

      <Card padded={false}>
        {list.status === 'loading' && <LoadingSpinner center label="Loading categories…" />}
        {list.status === 'error' && <div className="p-5"><ErrorMessage title="Could not load categories" message={list.error} onRetry={list.reload} /></div>}
        {list.status === 'ready' && list.data.categories.length === 0 && <EmptyState icon={Tags} title="No categories yet" description="Add the first category." />}
        {list.status === 'ready' && list.data.categories.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  {['Category', 'Department', 'Status', ''].map((heading) => (
                    <th key={heading} scope="col" className="px-5 py-3 font-semibold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data.categories.map((category) => (
                  <tr key={category.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-slate-900">{category.name}</p>
                      {category.description && <p className="line-clamp-1 text-slate-500">{category.description}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{category.departmentName || '—'}</td>
                    <td className="px-5 py-3.5"><Badge variant={category.status === 'active' ? 'success' : 'neutral'} dot>{category.status === 'active' ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" icon={Pencil} onClick={() => setForm(category)} aria-label={`Edit ${category.name}`}>Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => setToggling(category)}>{category.status === 'active' ? 'Deactivate' : 'Activate'}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {form && list.data && (
        <CategoryForm
          key={form === 'new' ? 'new' : form.id}
          category={form === 'new' ? null : form}
          departments={list.data.departments}
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
        message={toggling?.status === 'active' ? 'Students will no longer be able to choose this category. Existing complaints keep it.' : 'Students will be able to choose this category again (its department must be active).'}
        confirmLabel={toggling?.status === 'active' ? 'Deactivate' : 'Activate'}
      />
    </div>
  )
}
