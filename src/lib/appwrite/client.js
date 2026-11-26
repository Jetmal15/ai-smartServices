import { Client } from 'appwrite'
import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, isAppwriteConfigured } from './env.js'

/**
 * Single shared Appwrite client for the whole app.
 * Client-side only: it authenticates as the current user/guest via sessions,
 * never with an API key.
 *
 * If env values are missing the client is still created (so public pages keep
 * rendering) but is not pointed at any project; service calls will fail until
 * .env is filled in. Use assertAppwriteConfigured() to fail early with a clear message.
 */
export const client = new Client()

if (isAppwriteConfigured) {
  client.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID)
}

/**
 * Connection check. Calls Appwrite's /ping endpoint, which verifies that the
 * endpoint is reachable and that this origin is a registered Web platform for
 * the project. It does NOT verify the database ID (see docs/APPWRITE_SETUP.md).
 */
export async function pingAppwrite() {
  if (!isAppwriteConfigured) {
    throw new Error('Appwrite is not configured. Fill in .env first.')
  }
  return client.ping()
}
