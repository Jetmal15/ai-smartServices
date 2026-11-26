import { PATHS } from '../routes/paths.js'

/** Short labels for the kind of notification (shown as a small tag). */
export const NOTIFICATION_TYPE_LABELS = {
  complaint_submitted: 'Submitted',
  complaint_assigned: 'Assigned',
  status_changed: 'Update',
  complaint_in_progress: 'In progress',
  complaint_resolved: 'Resolved',
  complaint_closed: 'Closed',
  admin_update: 'Important',
  system: 'System',
}

/** The tone of the tag: important and resolved stand out. */
export const NOTIFICATION_TYPE_VARIANTS = {
  complaint_submitted: 'info',
  complaint_assigned: 'info',
  status_changed: 'warning',
  complaint_in_progress: 'warning',
  complaint_resolved: 'success',
  complaint_closed: 'neutral',
  admin_update: 'danger',
  system: 'neutral',
}

/** The page of the related complaint for this role, or null when the notification is not about a complaint. */
export function complaintPathFor(role, complaintId) {
  const base = PATHS[role]?.complaints
  return base && complaintId ? `${base}/${encodeURIComponent(complaintId)}` : null
}

/** The notification's own details page for this role. */
export const notificationPathFor = (role, id) => `${PATHS[role].notifications}/${encodeURIComponent(id)}`
