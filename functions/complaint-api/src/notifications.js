/**
 * In-app notifications (Phase 12). Created ONLY here, on the server, with the API key: a browser can read its own
 * notifications but cannot create, edit or delete any.
 *
 * Duplicates are prevented by the row ID. Every notification has an event key (what happened, to which complaint, for whom,
 * and when); the row ID is a hash of that key. Appwrite refuses a second row with the same ID (409), so the same event can
 * never notify the same person twice, even if a request is retried. A later, genuinely different event (e.g. a complaint
 * re-opened and resolved again) has a different key and notifies again.
 */
import { createHash } from 'node:crypto'

export const NOTIFICATION_TYPES = ['complaint_submitted', 'complaint_assigned', 'status_changed', 'complaint_in_progress', 'complaint_resolved', 'complaint_closed', 'admin_update', 'system']
const TITLE_MAX = 200
const MESSAGE_MAX = 1000

/** The recipient may READ their notification. Nobody may update or delete it from a browser (marking read goes through the server). */
export const notificationPermissions = (userId) => [`read("user:${userId}")`]

/** Deterministic row ID for an event key: "n" + 32 hex characters (valid Appwrite ID, 33 characters). */
export const notificationId = (...parts) => `n${createHash('sha256').update(parts.map(String).join('|')).digest('hex').slice(0, 32)}`

const clip = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * Creates one notification. Never throws: returns 'created', 'duplicate' (the same event already notified this person) or 'failed'.
 * `key` = the parts that identify the event for this recipient.
 */
export async function sendNotification(deps, { userId, type, title, message, complaintId = null, key }) {
  if (!userId || !NOTIFICATION_TYPES.includes(type)) return 'failed'
  const now = deps.now ? deps.now() : new Date()
  try {
    await deps.notifications.create(
      notificationId(...key, userId), // the recipient is always part of the event: the same event for someone else is a separate notification
      {
        userId,
        type,
        title: clip(title, TITLE_MAX),
        message: clip(message, MESSAGE_MAX),
        relatedComplaintId: complaintId,
        isRead: false,
        createdAt: now.toISOString(),
      },
      notificationPermissions(userId),
    )
    return 'created'
  } catch (error) {
    if (error?.code === 409) return 'duplicate'
    deps.log?.(`could not create a notification for ${userId}: ${error?.message ?? error}`)
    return 'failed'
  }
}

/** The same notification for several people (each person's duplicate check is separate). */
export async function sendToMany(deps, userIds, spec) {
  const result = { created: 0, duplicate: 0, failed: 0 }
  for (const userId of new Set(userIds)) {
    const outcome = await sendNotification(deps, { ...spec, userId })
    result[outcome] += 1
  }
  return result
}

async function staffOf(deps, departmentId) {
  try {
    return await deps.assignments.listUsersOfDepartment(departmentId)
  } catch (error) {
    deps.log?.(`could not list staff of ${departmentId}: ${error?.message ?? error}`)
    return []
  }
}

/* ------------------------------------------------------------------ *
 * The events
 * ------------------------------------------------------------------ */

/** 1 + 2. A student submits a complaint: the student gets a confirmation, the department's staff learn a complaint was assigned to them. */
export async function complaintSubmitted(deps, row) {
  await sendNotification(deps, {
    userId: row.studentId,
    type: 'complaint_submitted',
    title: 'Complaint submitted',
    message: `Your complaint ${row.referenceNumber} “${clip(row.title, 80)}” was received and sent to ${row.departmentName}.`,
    complaintId: row.$id,
    key: ['submitted', row.$id, row.studentId],
  })
  await sendToMany(deps, await staffOf(deps, row.departmentId), {
    type: 'complaint_assigned',
    title: 'New complaint for your department',
    message: `${row.referenceNumber} “${clip(row.title, 80)}” (${row.categoryName}) was assigned to ${row.departmentName}.`,
    complaintId: row.$id,
    key: ['assigned', row.$id, row.departmentId, 'initial'],
  })
}

const STATUS_EVENT = {
  under_review: { type: 'status_changed', title: 'Your complaint is under review' },
  in_progress: { type: 'complaint_in_progress', title: 'Your complaint is now in progress' },
  resolved: { type: 'complaint_resolved', title: 'Your complaint has been resolved' },
  closed: { type: 'complaint_closed', title: 'Your complaint has been closed' },
  submitted: { type: 'status_changed', title: 'Your complaint status was updated' },
}

/** 3, 4, 5, 6. Staff (or an administrator) moved a complaint to a new status: the student is told. `stamp` = the time of the change. */
export async function statusChanged(deps, row, { status, remark, stamp }) {
  const event = STATUS_EVENT[status] ?? STATUS_EVENT.submitted
  await sendNotification(deps, {
    userId: row.studentId,
    type: event.type,
    title: event.title,
    message: `Your complaint ${row.referenceNumber} is now ${status.replace('_', ' ')}.${remark ? ` Department remark: ${remark}` : ''}`,
    complaintId: row.$id,
    key: ['status', row.$id, status, stamp, row.studentId],
  })
}

/** Staff added a public remark without changing the status. */
export async function remarkAdded(deps, row, { remark, stamp }) {
  await sendNotification(deps, {
    userId: row.studentId,
    type: 'status_changed',
    title: 'New remark on your complaint',
    message: `The department added a remark to your complaint ${row.referenceNumber}: ${remark}`,
    complaintId: row.$id,
    key: ['remark', row.$id, stamp, row.studentId],
  })
}

/** 2 + 7. An administrator moved a complaint to another department. */
export async function complaintReassigned(deps, row, { from, to, stamp }) {
  await sendNotification(deps, {
    userId: row.studentId,
    type: 'complaint_assigned',
    title: 'Your complaint was forwarded',
    message: `Your complaint ${row.referenceNumber} was forwarded to ${to.departmentName}.`,
    complaintId: row.$id,
    key: ['reassign', row.$id, stamp, row.studentId],
  })
  await sendToMany(deps, await staffOf(deps, to.departmentId), {
    type: 'complaint_assigned',
    title: 'New complaint for your department',
    message: `${row.referenceNumber} “${clip(row.title, 80)}” (${to.categoryName}) was assigned to ${to.departmentName} by an administrator.`,
    complaintId: row.$id,
    key: ['assigned', row.$id, to.departmentId, stamp],
  })
  if (from.departmentId !== to.departmentId) {
    await sendToMany(deps, await staffOf(deps, from.departmentId), {
      type: 'admin_update',
      title: 'A complaint was moved out of your department',
      message: `An administrator moved ${row.referenceNumber} from ${from.departmentName} to ${to.departmentName}.`,
      complaintId: row.$id,
      key: ['moved', row.$id, stamp],
    })
  }
}

/** 7. An administrator's announcement. `announcementId` identifies it, so sending the same one twice does not notify anyone twice. */
export function announce(deps, userIds, { announcementId, title, message, complaintId = null }) {
  return sendToMany(deps, userIds, { type: 'admin_update', title, message, complaintId, key: ['announce', announcementId] })
}
