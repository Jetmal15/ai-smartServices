/** One-shot message that survives a redirect (e.g. "Account created" after register). */
const KEY = 'ai-smartservices:flash'

export function setFlash(message) {
  try {
    sessionStorage.setItem(KEY, message)
  } catch {
    /* storage unavailable – message is simply skipped */
  }
}

/** Read without clearing (safe under React StrictMode double-invocation). */
export function peekFlash() {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function clearFlash() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
