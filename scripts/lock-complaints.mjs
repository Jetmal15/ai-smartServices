// Phase 9: makes every existing complaint row administrator-read only (students now use complaint-api).
// Only needed if you submitted complaints during Phase 8. Safe to re-run.
//   PowerShell:  $env:APPWRITE_API_KEY="<key>"; npm run db:lock-complaints
import { Client, Query, TablesDB } from 'node-appwrite'
import { lockComplaintRows } from '../database/lock-complaints.js'

const need = (name, value) => {
  if (!value) {
    console.error(`✗ Missing ${name}. See docs/HISTORY_SETUP.md.`)
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
const result = await lockComplaintRows({ tablesDB, databaseId, Query, log: (m) => console.warn('  !', m) })
console.log(`✓ complaints: ${result.total} rows, ${result.updated} locked, ${result.failed} failed.`)
if (result.failed > 0) process.exit(1)
