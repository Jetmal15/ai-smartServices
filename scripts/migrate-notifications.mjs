// Phase 12: upgrades notification rows created in Phases 7-11 (complaintId -> relatedComplaintId, createdAt, read-only permissions).
// Only needed if notifications already exist. Safe to re-run.
//   PowerShell:  $env:APPWRITE_API_KEY="<key>"; npm run db:migrate-notifications
import { Client, Query, TablesDB } from 'node-appwrite'
import { migrateNotifications } from '../database/migrate-notifications.js'

const need = (name, value) => {
  if (!value) {
    console.error(`✗ Missing ${name}. See docs/NOTIFICATIONS_SETUP.md.`)
    process.exit(1)
  }
  return value
}
const tablesDB = new TablesDB(
  new Client()
    .setEndpoint(need('VITE_APPWRITE_ENDPOINT (in .env)', process.env.VITE_APPWRITE_ENDPOINT?.trim()))
    .setProject(need('VITE_APPWRITE_PROJECT_ID (in .env)', process.env.VITE_APPWRITE_PROJECT_ID?.trim()))
    .setKey(need('APPWRITE_API_KEY (environment variable)', process.env.APPWRITE_API_KEY?.trim())),
)
const databaseId = need('VITE_APPWRITE_DATABASE_ID (in .env)', process.env.VITE_APPWRITE_DATABASE_ID?.trim())
const result = await migrateNotifications({ tablesDB, databaseId, Query, log: (m) => console.warn('  !', m) })
console.log(`✓ notifications: ${result.total} rows, ${result.updated} upgraded, ${result.unchanged} already current, ${result.failed} failed.`)
if (result.failed > 0) process.exit(1)
