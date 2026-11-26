import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { Alert, Button, Card, Select } from '../ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import * as adminService from '../../services/adminService.js'
import * as complaintService from '../../services/complaintService.js'

/**
 * Administrators: move a complaint to another category, and so to that category's department. The server checks that the caller
 * is an administrator and that the category and department are active; the student and both departments are notified.
 * `onChanged({ complaint, history, notes, ai })` receives the refreshed complaint.
 */
export default function ComplaintReassignPanel({ complaint, onChanged }) {
  const { handleAuthError } = useAuth()
  const categories = useAsyncData(() => adminService.listCategories(), 'categories', adminService.isSessionError)
  const [categoryId, setCategoryId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const options = (categories.data ?? [])
    .filter((c) => c.status === 'active' && c.id !== complaint.categoryId)
    .map((c) => ({ value: c.id, label: `${c.name} → ${c.departmentName}` }))
  const target = (categories.data ?? []).find((c) => c.id === categoryId)

  const move = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await complaintService.reassignComplaint({ complaintId: complaint.id, categoryId })
      onChanged(result)
      setDone(`Moved to ${target.name} (${target.departmentName}).`)
      setCategoryId('')
      setConfirming(false)
    } catch (caught) {
      if (complaintService.isSessionError(caught) && handleAuthError(caught)) return
      setError(complaintService.toComplaintError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4" aria-labelledby="reassign-heading">
      <h2 id="reassign-heading" className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <ArrowRightLeft className="h-4 w-4 text-brand-600" aria-hidden="true" />
        Reassign complaint
      </h2>
      <p className="text-sm text-slate-500">Currently with <span className="font-medium text-slate-700">{complaint.departmentName}</span> ({complaint.categoryName}). Moving it changes which department can see and handle it.</p>
      {done && <Alert variant="success">{done}</Alert>}
      {error && <Alert variant="warning">{error}</Alert>}
      <Select aria-label="Move to category" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setConfirming(false); setDone('') }} options={options} placeholder={categories.status === 'loading' ? 'Loading categories…' : 'Choose a category'} />
      {confirming && target ? (
        <Alert variant="warning" title="Move this complaint?">
          <p>It will go to {target.departmentName} as “{target.name}”. The student is told it was forwarded, and the current department loses access.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={busy} onClick={move}>Confirm move</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          </div>
        </Alert>
      ) : (
        <Button variant="outline" disabled={!categoryId} onClick={() => setConfirming(true)}>Move complaint</Button>
      )}
    </Card>
  )
}
