import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth.js'

/**
 * Loads data for a page. `key` must change whenever the inputs of `load` change (it is what triggers a new request).
 * A session that has ended is handed to the auth provider (which signs the user out); other errors are returned as text.
 * Returns { status: 'loading' | 'ready' | 'error', data, previous, error, reload }.
 * `previous` is the last successful result, kept while a new request is loading (handy for filter dropdowns).
 */
export function useAsyncData(load, key, isSessionError = () => false) {
  const { handleAuthError } = useAuth()
  const [reloadToken, setReloadToken] = useState(0)
  const [result, setResult] = useState({ key: null, data: null, previous: null, error: '' })
  const requestKey = `${key}|${reloadToken}`

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const data = await load()
        if (!cancelled) setResult({ key: requestKey, data, previous: data, error: '' })
      } catch (error) {
        if (cancelled) return
        if (isSessionError(error) && handleAuthError(error)) return
        setResult((prev) => ({ key: requestKey, data: null, previous: prev.previous ?? null, error: error?.message || 'Something went wrong. Please try again.' }))
      }
    }
    run()
    return () => {
      cancelled = true
    }
    // `load` and `isSessionError` are recreated every render; `requestKey` already describes their inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, handleAuthError])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])
  const loading = result.key !== requestKey
  return { status: loading ? 'loading' : result.error ? 'error' : 'ready', data: loading ? null : result.data, previous: result.data, error: result.error, reload }
}
