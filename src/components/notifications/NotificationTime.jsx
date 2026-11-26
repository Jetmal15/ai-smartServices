import { formatDateTime, formatRelativeTime } from '../../lib/format.js'

/** "5 minutes ago" with the exact date and time as a tooltip (and for screen readers via the datetime attribute). */
export default function NotificationTime({ value, className = '' }) {
  if (!value) return null
  return (
    <time dateTime={new Date(value).toISOString()} title={formatDateTime(value)} className={className}>
      {formatRelativeTime(value)}
    </time>
  )
}
