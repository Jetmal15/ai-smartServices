import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BellOff, CheckCheck } from 'lucide-react'
import AnnouncementForm from '../../components/notifications/AnnouncementForm.jsx'
import NotificationTime from '../../components/notifications/NotificationTime.jsx'
import Pager from '../../components/complaints/Pager.jsx'
import { Badge, Button, Card, EmptyState, ErrorMessage, LoadingSpinner } from '../../components/ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useNotifications } from '../../hooks/useNotifications.js'
import { NOTIFICATION_TYPE_LABELS, NOTIFICATION_TYPE_VARIANTS, notificationPathFor } from '../../lib/notifications.js'
import * as notificationService from '../../services/notificationService.js'
import { isSessionError, notifications as notificationsDb } from '../../services/db/index.js'

const PAGE_SIZE = 10
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
]

/** The full notification list for the signed-in user (any role). Administrators also get the "send an important update" form. */
export default function NotificationsPage({ canAnnounce = false }) {
  const { user, handleAuthError } = useAuth()
  const { unread, markRead, markAllRead } = useNotifications()
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')

  const list = useAsyncData(
    () => notificationsDb.list(user.id, { unreadOnly: filter === 'unread', limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    `${user.id}|${filter}|${page}|${unread}`,
    isSessionError,
  )
  const data = list.data

  const run = async (kind, action) => {
    if (busy) return
    setBusy(kind)
    setActionError('')
    try {
      await action()
      list.reload()
    } catch (error) {
      if (notificationService.isSessionError(error) && handleAuthError(error)) return
      setActionError(notificationService.toNotificationError(error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">{unread > 0 ? `You have ${unread} unread notification${unread === 1 ? '' : 's'}.` : 'You are all caught up.'}</p>
        </div>
        <Button variant="outline" icon={CheckCheck} loading={busy === 'all'} disabled={unread === 0} onClick={() => run('all', markAllRead)}>
          Mark all as read
        </Button>
      </div>

      {canAnnounce && <AnnouncementForm />}

      <Card padded={false}>
        <div className="flex gap-2 border-b border-slate-100 px-4 py-3" role="tablist" aria-label="Filter notifications">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              onClick={() => {
                setFilter(item.value)
                setPage(0)
              }}
              className={`rounded-full px-3 py-1 text-sm font-medium ${filter === item.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {item.label}
              {item.value === 'unread' && unread > 0 ? ` (${unread})` : ''}
            </button>
          ))}
        </div>

        {actionError && <p className="px-5 pt-3 text-sm text-red-700" role="alert">{actionError}</p>}
        {list.status === 'loading' && <LoadingSpinner center label="Loading notifications…" />}
        {list.status === 'error' && (
          <div className="p-5">
            <ErrorMessage title="Could not load notifications" message={list.error} onRetry={list.reload} />
          </div>
        )}
        {data && data.total === 0 && (
          <EmptyState
            icon={BellOff}
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description={filter === 'unread' ? 'You have read everything.' : 'Updates about your complaints will appear here.'}
          />
        )}
        {data && data.total > 0 && (
          <>
            <ul className="divide-y divide-slate-100">
              {data.notifications.map((item) => (
                <li key={item.id} className={`flex items-start gap-3 px-5 py-4 ${item.isRead ? '' : 'bg-brand-50/40'}`}>
                  {!item.isRead ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" /> : <span className="mt-2 h-2 w-2 shrink-0" aria-hidden="true" />}
                  <Link to={notificationPathFor(user.role, item.id)} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm ${item.isRead ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{item.title}</p>
                      <Badge variant={NOTIFICATION_TYPE_VARIANTS[item.type] ?? 'neutral'}>{NOTIFICATION_TYPE_LABELS[item.type] ?? 'Update'}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-500">{item.message}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      <NotificationTime value={item.createdAt} />
                    </p>
                  </Link>
                  {!item.isRead && (
                    <Button variant="outline" size="sm" loading={busy === item.id} onClick={() => run(item.id, () => markRead(item.id))}>
                      Mark as read
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  )
}
