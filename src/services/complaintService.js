import { AppwriteException } from 'appwrite'
import { assertAppwriteConfigured, COMPLAINT_ATTACHMENTS_BUCKET_ID, COMPLAINT_FUNCTION_ID, functions, ID, storage } from '../lib/appwrite/index.js'
import { validateAttachmentFile, validateComplaintForm } from '../lib/complaintValidation.js'

/**
 * Client for the `complaint-api` Appwrite Function.
 *
 * The browser only sends what the student typed. The function works out who the student is (from the login),
 * which department receives the complaint (from the category), the status, the date and the complaint ID, and it is the
 * only thing that can create a complaint. Students read their complaints ONLY through it too (listMyComplaints /
 * getComplaint): it returns an explicit whitelist of fields, so internal data can never reach a student's browser.
 */

export class ComplaintError extends Error {
  constructor(message, { code = 'error', status = 0, fields } = {}) {
    super(message)
    this.name = 'ComplaintError'
    this.code = code
    this.status = status
    this.fields = fields
  }
}

const UNREACHABLE = 'Cannot reach the server. Check your internet connection and try again.'

export function toComplaintError(error, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof ComplaintError) return error
  if (error instanceof AppwriteException) {
    if (error.code === 0 || error.type === '') return new ComplaintError(UNREACHABLE)
    if (error.type === 'function_not_found') {
      return new ComplaintError('The complaint service is not set up yet. Ask the administrator to deploy it.', { code: 'service_missing', status: 404 })
    }
    return new ComplaintError(error.code >= 500 ? fallback : error.message || fallback, { status: error.code })
  }
  if (error instanceof TypeError) return new ComplaintError(UNREACHABLE)
  return new ComplaintError(error?.message || fallback)
}

/** True when the failure means "your session ended". */
export const isSessionError = (error) =>
  (error instanceof AppwriteException && error.code === 401) || (error instanceof ComplaintError && error.status === 401)

/** Calls an action of one of the Appwrite Functions (complaint-api, profile-api) and returns its data. Throws ComplaintError. */
export async function callFunction(functionId, action, payload = {}) {
  assertAppwriteConfigured()
  let execution
  try {
    execution = await functions.createExecution({ functionId, body: JSON.stringify({ ...payload, action }), async: false })
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 401) throw error
    throw toComplaintError(error)
  }
  let data = null
  try {
    data = JSON.parse(execution.responseBody)
  } catch {
    /* handled below */
  }
  if (!data || typeof data !== 'object') {
    throw new ComplaintError('The complaint service did not respond correctly. Please try again.', { code: 'bad_response', status: execution.responseStatusCode })
  }
  if (!data.ok) {
    const { code, message, fields } = data.error ?? {}
    throw new ComplaintError(message || 'Something went wrong. Please try again.', { code, status: execution.responseStatusCode, fields })
  }
  return data
}

export const call = (action, payload = {}) => callFunction(COMPLAINT_FUNCTION_ID, action, payload)

/* ---- Attachment upload (the function verifies the file afterwards) ---------------------- */

async function uploadAttachment(file) {
  assertAppwriteConfigured()
  try {
    // No permissions given: Appwrite gives the uploader (only) read/update/delete on a new file.
    const stored = await storage.createFile({ bucketId: COMPLAINT_ATTACHMENTS_BUCKET_ID, fileId: ID.unique(), file })
    return stored.$id
  } catch (error) {
    if (error instanceof AppwriteException) {
      if (error.code === 401) throw error
      if (error.type === 'storage_file_type_unsupported') throw new ComplaintError('That file type is not allowed.', { fields: { attachment: 'That file type is not allowed.' } })
      if (error.type === 'storage_invalid_file_size') throw new ComplaintError('That file is too large.', { fields: { attachment: 'That file is too large.' } })
      if (error.type === 'storage_bucket_not_found') throw new ComplaintError('Attachments are not set up yet. Submit without a file, or ask the administrator.', { code: 'service_missing' })
    }
    throw toComplaintError(error, 'The file could not be uploaded. Please try again.')
  }
}

/** Removes an uploaded file that never became part of a complaint (the uploader may still delete it). */
async function discardAttachment(fileId) {
  try {
    await storage.deleteFile({ bucketId: COMPLAINT_ATTACHMENTS_BUCKET_ID, fileId })
  } catch {
    /* best effort */
  }
}

/* ---- Students ---------------------------------------------------------------------------- */

/**
 * Submits a complaint. `file` is optional (a File from <input type="file">).
 * Returns { complaint, duplicate }: `duplicate` is true when the same complaint was already received a moment ago.
 */
export async function submitComplaint({ title, description, location, categoryId, file }) {
  const { values, errors } = validateComplaintForm({ title, description, location, categoryId })
  const fileError = validateAttachmentFile(file)
  if (fileError) errors.attachment = fileError
  if (Object.keys(errors).length > 0) throw new ComplaintError('Please correct the highlighted fields.', { code: 'validation_failed', fields: errors })

  let fileId = null
  try {
    if (file) fileId = await uploadAttachment(file)
    return await call('complaint.submit', { ...values, ...(fileId ? { attachmentId: fileId } : {}) }).then(({ complaint, duplicate }) => ({ complaint, duplicate: Boolean(duplicate) }))
  } catch (error) {
    if (fileId) await discardAttachment(fileId)
    throw error
  }
}

/* ---- Student, department staff and administrators (the server decides who may see what) -- */

/**
 * One complaint with its status timeline: { complaint, history, notes }. history is oldest first. `notes` (internal department
 * notes) is only ever returned to department staff and administrators; for a student it is always [].
 */
export async function getComplaint(complaintId) {
  const { complaint, history, notes, ai } = await call('complaint.get', { complaintId })
  return { complaint, history: Array.isArray(history) ? history : [], notes: Array.isArray(notes) ? notes : [], ai: ai ?? null }
}

/**
 * The signed-in student's complaint history. Searching, filtering, sorting and paging happen on the server, over this
 * student's complaints only. params: { search, status, categoryId, sort: 'newest' | 'oldest', limit, offset }.
 * Returns { complaints, total, filters: { overallTotal, statusCounts, categories } }.
 */
export async function listMyComplaints(params = {}) {
  const { complaints, total, filters } = await call('complaint.listMine', params)
  return { complaints, total, filters }
}

/**
 * Staff only: complaints routed to their assigned department(s).
 * params: { search, status, categoryId, sort: 'newest' | 'oldest', limit, offset }. The server decides which departments.
 */
export async function listDepartmentComplaints(params = {}) {
  const { complaints, total, truncated } = await call('department.list', params)
  return { complaints, total, truncated: Boolean(truncated) }
}

/** Staff only: { stats: { total, submitted, under_review, in_progress, resolved, closed }, departments: [{ id, name }] } */
export async function getDepartmentStats() {
  const { stats, departments } = await call('department.stats')
  return { stats, departments }
}

/* ---- Staff updates. The browser sends the complaint ID and what the staff member typed; who they are and which
 *      department they belong to is decided by the server. Each returns the refreshed { complaint, history, notes }. ---- */

const detail = ({ complaint, history, notes, ai, queued }) => ({ complaint, history: history ?? [], notes: notes ?? [], ai: ai ?? null, queued: Boolean(queued) })

/** `expectedStatus` is the status the user was looking at; the server refuses the change if someone else already moved it. */
export async function updateComplaintStatus({ complaintId, status, expectedStatus, remark }) {
  return detail(await call('complaint.updateStatus', { complaintId, status, expectedStatus, remark }))
}

/** A public remark the student will see (no status change). */
export async function addComplaintRemark({ complaintId, remark }) {
  return detail(await call('complaint.addRemark', { complaintId, remark }))
}

/** An internal note: visible to department staff and administrators only. */
export async function addComplaintNote({ complaintId, note }) {
  return detail(await call('complaint.addNote', { complaintId, note }))
}

/** { name, mimeType, size, base64 } */
export async function fetchAttachment(complaintId) {
  return (await call('complaint.attachment', { complaintId })).attachment
}

/** Saves an attachment from fetchAttachment() to the user's device. */
export function saveAttachment({ name, mimeType, base64 }) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/* ---- AI analysis (staff and administrators). The AI provider is called only by the server; the browser asks the server to
 *      start an analysis and later reads the stored result. The AI only SUGGESTS: a person decides what to apply. ---- */

/** Start (or re-run) the AI analysis. It finishes in the background; read the result again with getComplaint(). */
export async function requestAiAnalysis(complaintId) {
  return detail(await call('ai.analyze', { complaintId }))
}

/** Record that you reviewed the suggestion: decision 'accepted' | 'dismissed'. Changes nothing about the complaint. */
export async function reviewAiAnalysis({ complaintId, decision }) {
  return detail(await call('ai.review', { complaintId, decision }))
}

/** Set the complaint's priority to the one the AI suggested (the server uses its stored suggestion). */
export async function applyAiPriority(complaintId) {
  return detail(await call('ai.applyPriority', { complaintId }))
}

/** Administrators only: move the complaint to another category (and so to that category's department). */
export async function reassignComplaint({ complaintId, categoryId }) {
  return detail(await call('complaint.reassign', { complaintId, categoryId }))
}
