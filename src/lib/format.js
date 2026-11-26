/** "20 November 2026"; an em dash when there is no date. */
export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—'

/** "22 November 2026, 3:05 PM"; an em dash when there is no date. */
export const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

/** "2.4 MB", "310 KB". */
export const formatBytes = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} ago`

/**
 * A clear timestamp for lists: "Just now", "5 minutes ago", "3 hours ago", "Yesterday at 3:05 PM", "Tuesday at 9:40 AM",
 * or the full date for older items. Pair it with the exact time (formatDateTime) in a tooltip.
 */
export function formatRelativeTime(value, now = new Date()) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000)
  if (seconds < 45) return 'Just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return plural(minutes, 'minute')
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (days === 0) return plural(Math.floor(minutes / 60), 'hour')
  if (days === 1) return `Yesterday at ${time}`
  if (days < 7) return `${date.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`
  return formatDateTime(value)
}
