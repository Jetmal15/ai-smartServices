import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, BellOff } from 'lucide-react'
import NotificationTime from '../../components/notifications/NotificationTime.jsx'
import { Badge, Button, Card, EmptyState, ErrorMessage, LoadingSpinner } from '../../components/ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useNotifications } from '../../hooks/useNotifications.js'
import { formatDateTime } from '../../lib/format.js'
import { complaintPathFor, NOTIFICATION_TYPE_LABELS, NOTIFICATION_TYPE_VARIANTS } from '../../lib/notifications.js'
import { PATHS } from '../../routes/paths.js'
import { isSessionError, notifications as notificationsDb } from '../../services/db/index.js'

/** One notification in full. Opening an unread notification marks it as read. */
export default function NotificationDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const { markRead } = useNotifications()
  const result = useAsyncData(() => notificationsDb.get(id), id, isSessionError)
  const item = result.data
  const marked = useRef('')

  useEffect(() => {
    if (item && !item.isRead && marked.current !== item.id) {
      marked.current = item.id
      markRead(item.id).then(result.reload, () => {})
    }
    // Mark each notification once per visit; `result.reload` changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, markRead])

  const complaintPath = item ? complaintPathFor(user.role, item.relatedComplaintId) : null
  const back = PATHS[user.role].notifications

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to={back} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to notifications
      </Link>
      {result.status === 'loading' && <LoadingSpinner center label="Loading notification…" />}
      {result.status === 'error' && <ErrorMessage title="Could not open this notification" message={result.error} onRetry={result.reload} />}
      {result.status === 'ready' && !item && <EmptyState icon={BellOff} title="Notification not found" description="It may not exist, or it belongs to someone else." />}
      {item && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 break-words text-xl font-bold text-slate-900">{item.title}</h1>
            <Badge variant={NOTIFICATION_TYPE_VARIANTS[item.type] ?? 'neutral'}>{NOTIFICATION_TYPE_LABELS[item.type] ?? 'Update'}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <NotificationTime value={item.createdAt} /> · {formatDateTime(item.createdAt)}
          </p>
          <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{item.message}</p>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className="mt-0.5 font-medium text-slate-800">{item.isRead ? `Read${item.readAt ? ` ${formatDateTime(item.readAt)}` : ''}` : 'Unread'}</dd>
            </div>
          </dl>
          {complaintPath && (
            <div className="mt-6">
              <Button as={Link} to={complaintPath}>
                View complaint
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
