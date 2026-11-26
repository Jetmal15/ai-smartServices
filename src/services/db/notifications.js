import { TABLE_IDS } from '../../../database/schema.js'
import { paging } from './core.js'

/** A notification as the screens use it. */
const toNotification = (row) =>
  row && {
    id: row.$id,
    type: row.type,
    title: row.title,
    message: row.message,
    relatedComplaintId: row.relatedComplaintId ?? null,
    isRead: Boolean(row.isRead),
    readAt: row.readAt ?? null,
    createdAt: row.createdAt ?? row.$createdAt ?? null,
  }

/**
 * READ-ONLY access to the signed-in user's own notifications.
 *
 * Appwrite itself limits what comes back: every notification row is readable only by its recipient (row permissions), so even
 * a query for another user's ID returns nothing. There is no create/update/delete here: notifications are created by the
 * complaint-api function, and marking one as read goes through it too (services/notificationService.js).
 */
export function createNotificationsService(db) {
  const { Query } = db
  const T = TABLE_IDS.notifications

  return {
    /** Newest first. Options: unreadOnly, limit, offset. */
    async list(userId, { unreadOnly = false, limit, offset } = {}) {
      const page = paging({ limit, offset }, 10)
      const queries = [Query.equal('userId', [userId]), Query.orderDesc('createdAt'), Query.limit(page.limit), Query.offset(page.offset)]
      if (unreadOnly) queries.push(Query.equal('isRead', [false]))
      const { rows, total } = await db.list(T, queries)
      return { notifications: rows.map(toNotification), total }
    },

    /** How many unread notifications the user has (counts only; no rows are read). */
    async countUnread(userId) {
      const { total } = await db.list(T, [Query.equal('userId', [userId]), Query.equal('isRead', [false]), Query.limit(1)])
      return total
    },

    /** One notification, or null when it does not exist or belongs to someone else. */
    async get(notificationId) {
      try {
        return toNotification(await db.find(T, notificationId))
      } catch (error) {
        if (error.code === 'forbidden') return null
        throw error
      }
    },
  }
}
