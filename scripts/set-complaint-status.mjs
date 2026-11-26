// Moves a complaint to a new status with an optional PUBLIC remark, exactly as the department feature will later do it:
// updates the complaint, writes the status-history entry and notifies the student. For administrators/testing until the
// department screens exist.
//
//   PowerShell:  $env:APPWRITE_API_KEY="<key>"; npm run complaint:status -- CMP-20261122-K7M2QX under_review "We are looking into it."
//   Statuses: submitted | under_review | in_progress | resolved | closed   (the move must be allowed; `closed` is final)
//
// The remark is shown to the student. Never put private information in it (internal notes belong in complaint_notes).
import { createDeps } from '../functions/complaint-api/src/main.js'
import { HttpError, recordStatusChange } from '../functions/complaint-api/src/handler.js'

const [complaintId, status, ...rest] = process.argv.slice(2)
if (!complaintId || !status) {
  console.error('Usage: npm run complaint:status -- <complaintId> <status> ["public remark"]')
  process.exit(1)
}
const need = (name, value) => {
  if (!value) {
    console.error(`✗ Missing ${name}. See docs/HISTORY_SETUP.md.`)
    process.exit(1)
  }
  return value
}
const env = process.env
const deps = createDeps({
  endpoint: need('VITE_APPWRITE_ENDPOINT (in .env)', env.VITE_APPWRITE_ENDPOINT?.trim()),
  projectId: need('VITE_APPWRITE_PROJECT_ID (in .env)', env.VITE_APPWRITE_PROJECT_ID?.trim()),
  apiKey: need('APPWRITE_API_KEY (environment variable)', env.APPWRITE_API_KEY?.trim()),
  databaseId: need('VITE_APPWRITE_DATABASE_ID (in .env)', env.VITE_APPWRITE_DATABASE_ID?.trim()),
  ids: { complaints: 'complaints', history: 'complaint_history', notes: 'complaint_notes', aiSummaries: 'ai_summaries', aiFunction: 'ai-analysis', users: 'users', departments: 'departments', categories: 'categories', departmentUsers: 'department_users', notifications: 'notifications', bucket: 'complaint-attachments' },
  log: (m) => console.warn('  !', m),
})
try {
  const { previousStatus } = await recordStatusChange(deps, { complaintId, status, remark: rest.join(' '), actor: { role: 'admin', id: null, name: 'Administrator (script)' } })
  console.log(`✓ ${complaintId}: ${previousStatus} → ${status}`)
} catch (error) {
  console.error(`✗ ${error instanceof HttpError ? error.message : (error?.message ?? error)}`)
  process.exit(1)
}
