import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, BellOff, CheckCheck } from 'lucide-react'
import { LoadingSpinner } from '../ui/index.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useNotifications } from '../../hooks/useNotifications.js'
import { NOTIFICATION_TYPE_LABELS, notificationPathFor } from '../../lib/notifications.js'
import { PATHS } from '../../routes/paths.js'
import NotificationTime from './NotificationTime.jsx'

/** The bell in the top bar: unread count, a dropdown with the latest notifications, "mark all as read" and a link to the full page. */
export default function NotificationBell() {
  const { user } = useAuth()
  const { status, unread, recent, error, markAllRead, refresh } = useNotifications()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const root = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    refresh()
    const onPointer = (event) => {
      if (root.current && !root.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, refresh])

  const readAll = async () => {
    setBusy(true)
    setFailed('')
    try {
      await markAllRead()
    } catch (caught) {
      setFailed(caught?.message || 'Could not mark notifications as read.')
    } finally {
      setBusy(false)
    }
  }

  const badge = unread > 99 ? '99+' : String(unread)
  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold leading-[1.1rem] text-white" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div role="region" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Notifications{unread > 0 ? ` (${unread} unread)` : ''}</h2>
            <button type="button" onClick={readAll} disabled={busy || unread === 0} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-slate-400">
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Mark all as read
            </button>
          </div>
          {failed && <p className="px-4 py-2 text-xs text-red-700" role="alert">{failed}</p>}

          <div className="max-h-96 overflow-y-auto">
            {status === 'loading' && <LoadingSpinner center label="Loading notifications…" />}
            {status === 'error' && <p className="px-4 py-6 text-center text-sm text-slate-500">{error}</p>}
            {status === 'ready' && recent.length === 0 && (
              <div className="flex flex-col items-center px-4 py-8 text-center text-sm text-slate-500">
                <BellOff className="mb-2 h-6 w-6 text-slate-300" aria-hidden="true" />
                You have no notifications yet.
              </div>
            )}
            {status === 'ready' && recent.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {recent.map((item) => (
                  <li key={item.id}>
                    <Link to={notificationPathFor(user.role, item.id)} onClick={() => setOpen(false)} className={`block px-4 py-3 hover:bg-slate-50 focus-visible:bg-slate-50 ${item.isRead ? '' : 'bg-brand-50/40'}`}>
                      <div className="flex items-start gap-2">
                        {!item.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm ${item.isRead ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{item.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.message}</p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {NOTIFICATION_TYPE_LABELS[item.type] ?? 'Update'} · <NotificationTime value={item.createdAt} />
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link to={PATHS[user.role].notifications} onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-3 text-center text-sm font-medium text-brand-600 hover:bg-slate-50">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  )
}
