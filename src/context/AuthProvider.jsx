import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setFlash } from '../lib/flash.js'
import { hasRole as roleMatches } from '../lib/permissions.js'
import * as authService from '../services/authService.js'
import * as profileService from '../services/profileService.js'
import { AuthContext } from './AuthContext.js'

/** How often a signed-in tab re-checks that its session is still valid. */
const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000
/** Minimum gap between focus-triggered checks. */
const FOCUS_CHECK_THROTTLE_MS = 15 * 1000

/**
 * Real authentication state backed by Appwrite sessions.
 * Context shape: { user, role, isAuthenticated, isLoading, sessionExpired,
 *                  profile, profileStatus, profileError, refreshProfile, saveProfile, hasRole,
 *                  login, register, logout, handleAuthError, clearSessionExpired }
 *
 * `role` comes from the account's Appwrite labels (read-only for users). The `profile` is the
 * user's record in the `users` table, created/repaired by the profile-api function and
 * linked to the account by user id. Both are re-read on tab focus and every few minutes, so a
 * role change made by an administrator reaches an open tab without a manual reload.
 *
 * Session persistence: the Appwrite SDK keeps the session in the browser, so on
 * mount we simply ask Appwrite who the current user is.
 * Expired sessions: any 401 while signed in (periodic/focus re-check, or a service
 * calling handleAuthError) clears the user and flags `sessionExpired`.
 */
export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [profile, setProfile] = useState(null)
  const [profileStatus, setProfileStatus] = useState('idle') // idle | loading | ready | error
  const [profileError, setProfileError] = useState('')
  const userRef = useRef(null)
  const profileRef = useRef(null)
  const lastCheckRef = useRef(0)

  const applyUser = useCallback((nextUser) => {
    userRef.current = nextUser
    setUser(nextUser)
  }, [])

  const applyProfile = useCallback((nextProfile) => {
    profileRef.current = nextProfile
    setProfile(nextProfile)
    setProfileStatus(nextProfile ? 'ready' : 'idle')
    setProfileError('')
  }, [])

  const expireSession = useCallback(() => {
    if (userRef.current) {
      applyUser(null)
      applyProfile(null)
      setSessionExpired(true)
    }
  }, [applyUser, applyProfile])

  /** Loads (creating on first use) the signed-in user's profile. Never throws. */
  const refreshProfile = useCallback(async () => {
    const owner = userRef.current?.id
    if (!owner) return
    setProfileStatus('loading')
    setProfileError('')
    try {
      const { profile: loaded } = await profileService.fetchMyProfile()
      if (userRef.current?.id === owner) applyProfile(loaded)
    } catch (error) {
      if (profileService.isSessionError(error)) {
        expireSession()
        return
      }
      if (userRef.current?.id === owner) {
        setProfileStatus('error')
        setProfileError(profileService.toProfileError(error).message)
      }
    }
  }, [applyProfile, expireSession])

  // Link the account to its profile record whenever a different user signs in.
  const userId = user?.id ?? null
  useEffect(() => {
    if (!userId) return
    if (profileRef.current?.id === userId) return // already provided (e.g. by registration)
    refreshProfile()
  }, [userId, refreshProfile])

  // Restore the session on first load.
  useEffect(() => {
    let cancelled = false
    authService
      .getCurrentUser()
      .then((current) => {
        if (!cancelled) applyUser(current)
      })
      .catch((error) => {
        // Server/network problem: treat as signed out for now without claiming expiry.
        console.warn('[auth] Could not restore session:', error.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [applyUser])

  // Detect sessions that expired or were revoked while the tab was open.
  useEffect(() => {
    const recheck = async () => {
      if (!userRef.current) return
      lastCheckRef.current = Date.now()
      try {
        const previousRole = userRef.current?.role
        const current = await authService.getCurrentUser()
        if (current) {
          applyUser(current) // also picks up label/role changes
          if (current.role !== previousRole) refreshProfile()
        } else expireSession()
      } catch {
        /* offline / server error: keep the user signed in; a later check will retry */
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheckRef.current > FOCUS_CHECK_THROTTLE_MS) recheck()
    }
    const interval = setInterval(recheck, SESSION_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [applyUser, expireSession, refreshProfile])

  const login = useCallback(
    async (credentials) => {
      const signedIn = await authService.login(credentials)
      setSessionExpired(false)
      applyUser(signedIn)
      return signedIn
    },
    [applyUser],
  )

  const register = useCallback(
    async (details) => {
      const result = await authService.registerStudent(details)
      // Store the welcome message BEFORE the user state flips: that flip triggers the redirect
      // to the dashboard, which reads the message as it mounts.
      setFlash(
        result.profileSaved
          ? 'Account created. Welcome to AI SmartServices!'
          : 'Account created, but your roll number and department could not be saved. You can add them from your profile.',
      )
      setSessionExpired(false)
      applyProfile(result.profile)
      applyUser(result.user)
      return result
    },
    [applyUser, applyProfile],
  )

  const logout = useCallback(async () => {
    // Clear local state first so the UI always logs out, even if the request fails.
    applyUser(null)
    applyProfile(null)
    setSessionExpired(false)
    try {
      await authService.logout()
    } catch (error) {
      console.warn('[auth]', error.message)
    }
  }, [applyUser, applyProfile])

  /** Call from any service that catches an error: a 401 means the session ended. */
  const handleAuthError = useCallback(
    (error) => {
      if (authService.isUnauthorizedError(error)) {
        expireSession()
        return true
      }
      return false
    },
    [expireSession],
  )

  /** Saves the permitted fields of the user's OWN profile; the server rejects anything else. */
  const saveProfile = useCallback(
    async (values) => {
      try {
        const saved = await profileService.updateMyProfile(values)
        applyProfile(saved)
        const current = userRef.current
        if (current && saved.name !== current.name) {
          applyUser({ ...current, name: saved.name, initials: authService.getInitials(saved.name) })
        }
        return saved
      } catch (error) {
        if (profileService.isSessionError(error)) expireSession()
        throw profileService.toProfileError(error)
      }
    },
    [applyProfile, applyUser, expireSession],
  )

  const role = user?.role ?? null
  const hasRole = useCallback((...allowed) => roleMatches(role, ...allowed), [role])

  const clearSessionExpired = useCallback(() => setSessionExpired(false), [])

  const value = useMemo(
    () => ({
      user,
      role,
      isAuthenticated: user !== null,
      isLoading,
      sessionExpired,
      profile,
      profileStatus,
      profileError,
      refreshProfile,
      saveProfile,
      hasRole,
      login,
      register,
      logout,
      handleAuthError,
      clearSessionExpired,
    }),
    [
      user,
      role,
      isLoading,
      sessionExpired,
      profile,
      profileStatus,
      profileError,
      refreshProfile,
      saveProfile,
      hasRole,
      login,
      register,
      logout,
      handleAuthError,
      clearSessionExpired,
    ],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
