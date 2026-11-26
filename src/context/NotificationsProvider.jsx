import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import * as notificationService from '../services/notificationService.js'
import { isSessionError, notifications as notificationsDb } from '../services/db/index.js'
import { NotificationsContext } from './NotificationsContext.js'

const POLL_MS = 30_000
const RECENT = 8

/**
 * Keeps the unread count and the latest notifications for the signed-in user (the bell and its dropdown), and refreshes them
 * every 30 seconds while the tab is visible. Reads come straight from Appwrite (only the user's own rows are readable);
 * marking as read goes through the server.
 */
export default function NotificationsProvider({ children }) {
  const { user, handleAuthError } = useAuth()
  const userId = user.id
  const [state, setState] = useState({ status: 'loading', unread: 0, recent: [], error: '' })
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const [unread, recent] = await Promise.all([notificationsDb.countUnread(userId), notificationsDb.list(userId, { limit: RECENT })])
      if (alive.current) setState({ status: 'ready', unread, recent: recent.notifications, error: '' })
    } catch (error) {
      if (isSessionError(error) && handleAuthError(error)) return
      // A failed refresh keeps what is already shown; only the first load reports an error.
      if (alive.current) setState((prev) => (prev.status === 'ready' ? prev : { status: 'error', unread: 0, recent: [], error: error?.message || 'Could not load notifications.' }))
    }
  }, [userId, handleAuthError])

  useEffect(() => {
    alive.current = true
    refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const markRead = useCallback(
    async (notificationId) => {
      try {
        const { unreadCount } = await notificationService.markNotificationRead(notificationId)
        setState((prev) => ({ ...prev, unread: unreadCount, recent: prev.recent.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n)) }))
      } catch (error) {
        if (notificationService.isSessionError(error) && handleAuthError(error)) return
        throw error
      }
    },
    [handleAuthError],
  )

  const markAllRead = useCallback(async () => {
    try {
      await notificationService.markAllNotificationsRead()
      setState((prev) => ({ ...prev, unread: 0, recent: prev.recent.map((n) => ({ ...n, isRead: true })) }))
      await refresh()
    } catch (error) {
      if (notificationService.isSessionError(error) && handleAuthError(error)) return
      throw error
    }
  }, [handleAuthError, refresh])

  const value = useMemo(() => ({ ...state, refresh, markRead, markAllRead }), [state, refresh, markRead, markAllRead])
  return <NotificationsContext value={value}>{children}</NotificationsContext>
}
