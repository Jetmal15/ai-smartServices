import { call, isSessionError, toComplaintError } from './complaintService.js'

/**
 * Notification actions. Reading goes straight to the database (services/db → notifications; Appwrite only returns the user's
 * own). Everything that WRITES goes through the complaint-api function, which changes nothing but "read" on the caller's own
 * notifications, and lets only administrators send announcements.
 */
export { isSessionError, toComplaintError as toNotificationError }

/** Marks one of your notifications as read. Returns { notification, unreadCount }. */
export async function markNotificationRead(notificationId) {
  const { notification, unreadCount } = await call('notification.markRead', { notificationId })
  return { notification, unreadCount }
}

/** Marks all your notifications as read (in batches until none are left). Returns the number marked. */
export async function markAllNotificationsRead() {
  let marked = 0
  for (let round = 0; round < 25; round += 1) {
    const result = await call('notification.markAllRead')
    marked += result.marked
    if (!result.more || result.marked === 0) break
  }
  return marked
}

/**
 * Administrators only. audience: 'all_students' | 'all_staff' | 'department' (with departmentId) | 'complaint' (with complaintId).
 * Returns { recipients, created, duplicate, failed }. Who receives it is worked out by the server.
 */
export async function sendAnnouncement({ audience, title, message, departmentId, complaintId }) {
  const { recipients, created, duplicate, failed } = await call('notification.announce', { audience, title, message, departmentId, complaintId })
  return { recipients, created, duplicate, failed }
}
