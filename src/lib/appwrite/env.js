/**
 * Appwrite environment configuration (browser-safe values ONLY).
 *
 * Vite exposes only variables prefixed with VITE_ to frontend code, and
 * everything that is exposed ends up readable in the shipped JS bundle.
 * Therefore: Project ID, endpoint and database ID are fine here (they are
 * public identifiers). NEVER put an Appwrite API key / server secret in a
 * VITE_ variable – server keys belong only in a backend or Appwrite Function.
 */
const read = (value) => (typeof value === 'string' ? value.trim() : '')

export const APPWRITE_ENDPOINT = read(import.meta.env.VITE_APPWRITE_ENDPOINT)
export const APPWRITE_PROJECT_ID = read(import.meta.env.VITE_APPWRITE_PROJECT_ID)
export const APPWRITE_DATABASE_ID = read(import.meta.env.VITE_APPWRITE_DATABASE_ID)

const REQUIRED = {
  VITE_APPWRITE_ENDPOINT: APPWRITE_ENDPOINT,
  VITE_APPWRITE_PROJECT_ID: APPWRITE_PROJECT_ID,
  VITE_APPWRITE_DATABASE_ID: APPWRITE_DATABASE_ID,
}

/** Names of required variables that are empty or missing. */
export const MISSING_ENV_VARS = Object.entries(REQUIRED)
  .filter(([, value]) => !value)
  .map(([name]) => name)

export const isAppwriteConfigured = MISSING_ENV_VARS.length === 0

/** Throws a readable error naming the missing variables. */
export function assertAppwriteConfigured() {
  if (!isAppwriteConfigured) {
    throw new Error(
      `Appwrite is not configured. Set ${MISSING_ENV_VARS.join(', ')} in your .env file ` +
        '(see .env.example) and restart the dev server.',
    )
  }
}

if (import.meta.env.DEV && !isAppwriteConfigured) {
  console.warn(
    `[appwrite] Missing ${MISSING_ENV_VARS.join(', ')}. Copy .env.example to .env and fill the values in.`,
  )
}
