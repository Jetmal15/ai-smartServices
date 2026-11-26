import { Account } from 'appwrite'
import { client } from './client.js'

/**
 * Appwrite Account service instance.
 * Phase 4 only configures it; no sign-in / sign-up / session logic is wired yet.
 */
export const account = new Account(client)
