// Connection test: `npm run appwrite:check`
// Reads values from .env (via node --env-file) and pings the Appwrite endpoint.
import { Client } from 'appwrite'

const endpoint = process.env.VITE_APPWRITE_ENDPOINT?.trim()
const projectId = process.env.VITE_APPWRITE_PROJECT_ID?.trim()
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID?.trim()

const missing = Object.entries({
  VITE_APPWRITE_ENDPOINT: endpoint,
  VITE_APPWRITE_PROJECT_ID: projectId,
  VITE_APPWRITE_DATABASE_ID: databaseId,
})
  .filter(([, v]) => !v)
  .map(([k]) => k)

if (missing.length) {
  console.error(`✗ Missing in .env: ${missing.join(', ')}`)
  process.exit(1)
}

try {
  await new Client().setEndpoint(endpoint).setProject(projectId).ping()
  console.log('✓ Appwrite endpoint reachable and project ID accepted.')
  console.log('  Note: ping cannot verify the Database ID; that is checked on the first real read in a later phase.')
} catch (error) {
  console.error('✗ Ping failed:', error?.message ?? error)
  process.exit(1)
}
