// Copies the Phase 6 `profiles` table into the Phase 7 `users` table (only needed if you already ran Phase 6).
//
//   PowerShell:  $env:APPWRITE_API_KEY="<key>"; npm run db:migrate-profiles
//   macOS/Linux: APPWRITE_API_KEY=<key> npm run db:migrate-profiles
//
// The key needs the rows.read and rows.write scopes. It is read from the environment only – never put it in `.env`.
// Safe to run more than once. The old `profiles` table is left untouched; delete it yourself once you are happy.
import { Client, Query, TablesDB } from 'node-appwrite'
import { migrateProfilesToUsers } from '../database/migrate.js'

const need = (name, value) => {
  if (!value) {
    console.error(`✗ Missing ${name}. See docs/DATABASE_SETUP.md.`)
    process.exit(1)
  }
  return value
}
const endpoint = need('VITE_APPWRITE_ENDPOINT (in .env)', process.env.VITE_APPWRITE_ENDPOINT?.trim())
const projectId = need('VITE_APPWRITE_PROJECT_ID (in .env)', process.env.VITE_APPWRITE_PROJECT_ID?.trim())
const databaseId = need('VITE_APPWRITE_DATABASE_ID (in .env)', process.env.VITE_APPWRITE_DATABASE_ID?.trim())
const apiKey = need('APPWRITE_API_KEY (environment variable)', process.env.APPWRITE_API_KEY?.trim())

const tablesDB = new TablesDB(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey))
try {
  const result = await migrateProfilesToUsers({ tablesDB, databaseId, Query, log: (m) => console.warn('  !', m) })
  console.log(`✓ profiles → users: ${result.total} read, ${result.created} copied, ${result.skipped} already there / skipped, ${result.failed} failed.`)
  if (result.skipped > 0) console.log('  “Skipped” rows already exist in users, or clash on email/roll number. Open Users → “Sync accounts” in the app to repair them.')
  if (result.failed > 0) process.exit(1)
} catch (error) {
  console.error('✗ Migration failed:', error?.message ?? error)
  process.exit(1)
}
