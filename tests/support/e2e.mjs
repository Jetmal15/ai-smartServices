// Shared setup for the Phase 14 integration tests (TEST ONLY): a gateway with seeded departments/categories, a few people, and a
// `signIn(id)` that works like a person using their own browser (own localStorage, own Appwrite session).
import { createDatabaseServices } from '../../src/services/db/factory.js'
import { createGateway } from './fake-appwrite-http.mjs'
import { ID, Query } from './fake-tablesdb.mjs'
import { createProvider } from '../../functions/complaint-api/src/ai/provider.js'

export async function bootstrap({ students = ['s001', 's002', 's003'] } = {}) {
  const g = await createGateway()
  await createDatabaseServices({ tablesDB: g.server, databaseId: g.b.db, Query, ID, now: () => g.b.deps.now().toISOString() }).seedInitialData()
  for (const id of students) await g.addStudent(id, { rollNumber: `22SW-${id}`.slice(0, 20) })
  await g.addStaff('clean1', ['cleaning'])
  await g.addStaff('clean2', ['cleaning'])
  await g.addStaff('itsc1', ['itsc'])
  await g.addStaff('nodept')
  await g.addAdmin('admin1')

  const auth = await import('../../src/services/authService.js')
  const complaints = await import('../../src/services/complaintService.js')
  const notifications = await import('../../src/services/notificationService.js')
  const admin = await import('../../src/services/adminService.js')
  const profiles = await import('../../src/services/profileService.js')
  const dbModule = await import('../../src/services/db/index.js')

  const browsers = new Map()
  /** Use (and if needed sign in) as this person. Returns their app user. */
  async function signIn(id) {
    if (!browsers.has(id)) browsers.set(id, g.newBrowser())
    g.useBrowser(browsers.get(id))
    const existing = await auth.getCurrentUser()
    if (existing) return existing
    return auth.login({ email: `${id}@test.edu`, password: 'Passw0rd!x' })
  }
  /** Act as nobody (a guest browser). */
  const guest = () => g.newBrowser()
  const use = (id) => g.useBrowser(browsers.get(id))
  /** Make the AI provider answer like a sensible model (or fail). */
  const aiReplies = (fetch) => {
    g.b.aiControl.provider = createProvider({ provider: 'openai', apiKey: 'sk-test', model: 'm', baseUrl: 'https://ai.example.test/v1', timeoutMs: 1000, enabled: true }, { fetch, sleep: async () => {} })
  }
  return { g, b: g.b, auth, complaints, notifications, admin, profiles, dbModule, signIn, guest, use, aiReplies, ID, Query }
}
