// In-process stand-in for the Appwrite HTTP API (TEST ONLY), so the REAL browser services (authService, complaintService,
// notificationService, profileService, adminService) and the REAL Appwrite web SDK run end to end against the REAL function handlers
// (profile-api, complaint-api) and the schema-driven fake database:
//
//   service -> Appwrite web SDK -> fetch() -> this gateway -> function handler -> fake database
//
// What it models: accounts, email/password sessions (kept by the SDK in localStorage, like a browser without a custom domain),
// blocked accounts, password recovery tokens (single use), Storage uploads with content-based MIME detection, and function executions
// (the gateway adds the `x-appwrite-user-id` / `x-appwrite-user-jwt` headers itself, exactly as Appwrite does - the browser cannot
// set them). What it does NOT model: real Appwrite validation, rate limits, e-mail delivery, CORS/platform checks.
import { register } from 'node:module'
import { randomBytes } from 'node:crypto'
import { TABLE_IDS } from '../../database/schema.js'
import { handle as handleComplaint } from '../../functions/complaint-api/src/handler.js'
import { handle as handleProfile } from '../../functions/profile-api/src/handler.js'
import { createComplaintBackend } from './fake-complaint-backend.mjs'
import { Query } from './fake-tablesdb.mjs'

export const ENDPOINT = 'http://appwrite.test/v1'
export const PROJECT = 'testproject'

const json = (data, status = 200, headers = {}) => (status === 204 ? new Response(null, { status, headers }) : new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } }))
const problem = (status, type, message) => json({ message, code: status, type }, status)

/** Detects the MIME type from the file's CONTENT (what Appwrite does), never from its name. */
export function sniffMime(bytes) {
  const b = Buffer.from(bytes)
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (b.length >= 2 && b.subarray(0, 2).toString('latin1') === 'MZ') return 'application/x-msdownload'
  return 'application/octet-stream'
}
export const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')])
export const PDF_BYTES = Buffer.from('%PDF-1.4 fake pdf body')
export const EXE_BYTES = Buffer.from('MZ fake windows executable')

/** One browser = one localStorage. Several browsers (tabs of different people) can share one gateway. */
export function createBrowser() {
  const store = new Map()
  return {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)), removeItem: (k) => void store.delete(k), clear: () => store.clear() },
    clear: () => store.clear(),
  }
}

export async function createGateway() {
  register('./vite-env-loader.mjs', import.meta.url)
  Object.assign(process.env, { VITE_APPWRITE_ENDPOINT: ENDPOINT, VITE_APPWRITE_PROJECT_ID: PROJECT, VITE_APPWRITE_DATABASE_ID: 'testdb' })

  const b = createComplaintBackend()
  const server = b.fake.as('server')
  const users = new Map() // id -> { $id, name, email, password, labels, status, prefs, registration }
  const sessions = new Map() // secret -> userId
  const recoveries = new Map() // secret -> { userId, used }
  const sent = [] // recovery e-mails "sent": { email, userId, secret, url }
  const calls = [] // every execution: { functionId, userId, action, status }
  const browser = { current: createBrowser() }
  let counter = 0

  const publicUser = (u) => ({ $id: u.$id, name: u.name, email: u.email, labels: [...u.labels], status: u.status, prefs: u.prefs, registration: u.registration, emailVerification: false })
  const sync = () => {
    for (const u of users.values()) {
      b.addAccount(u.$id, { labels: u.labels, status: u.status, name: u.name }) // also registers the user's `jwt-<id>` token
    }
  }
  const addUser = ({ id, name, email, password = 'Passw0rd!x', labels = [], status = true }) => {
    const user = { $id: id ?? `u${++counter}`, name, email: email.toLowerCase(), password, labels: [...labels], status, prefs: {}, registration: `2026-11-0${(counter % 9) + 1}T09:00:00.000+00:00` }
    users.set(user.$id, user)
    sync()
    return user
  }

  // ---- profile-api backed by the SAME schema-driven database as complaint-api ----
  const notFound = () => Object.assign(new Error('not found'), { code: 404 })
  const profileDeps = {
    log: (m) => b.logs.push(`[profile] ${m}`),
    adminAllowlist: [],
    now: () => b.deps.now(),
    audit: { record: (entry) => server.createRow({ databaseId: b.db, tableId: TABLE_IDS.adminAudit, rowId: 'unique()', data: entry, permissions: ['read("label:admin")'] }) },
    verifyJwt: (jwt) => b.deps.verifyJwt(jwt),
    users: {
      get: async (id) => (users.has(id) ? structuredClone(publicUser(users.get(id))) : null),
      listAll: async () => [...users.values()].map((u) => structuredClone(publicUser(u))),
      updateLabels: async (id, labels) => {
        if (!users.has(id)) throw notFound()
        users.get(id).labels = [...labels]
        sync()
        return structuredClone(publicUser(users.get(id)))
      },
      updateName: async (id, name) => {
        users.get(id).name = name
        sync()
        return structuredClone(publicUser(users.get(id)))
      },
      updateStatus: async (id, status) => {
        users.get(id).status = status
        sync()
        return structuredClone(publicUser(users.get(id)))
      },
      create: async ({ name, email, password }) => {
        if ([...users.values()].some((u) => u.email === email)) throw Object.assign(new Error('exists'), { code: 409 })
        return structuredClone(publicUser(addUser({ name, email, password })))
      },
    },
    rows: {
      get: (id) => server.getRow({ databaseId: b.db, tableId: TABLE_IDS.users, rowId: id }).catch((e) => (e?.code === 404 ? null : Promise.reject(e))),
      create: (id, data, permissions) => server.createRow({ databaseId: b.db, tableId: TABLE_IDS.users, rowId: id, data, permissions }),
      update: (id, data) => server.updateRow({ databaseId: b.db, tableId: TABLE_IDS.users, rowId: id, data }),
      listAll: async () => (await server.listRows({ databaseId: b.db, tableId: TABLE_IDS.users, queries: [Query.limit(500)] })).rows,
    },
    assignments: {
      listForUser: async (userId) => {
        const rows = (await server.listRows({ databaseId: b.db, tableId: TABLE_IDS.departmentUsers, queries: [Query.equal('userId', [userId])] })).rows
        const out = []
        for (const r of rows) out.push({ departmentId: r.departmentId, departmentName: (await b.deps.departments.get(r.departmentId))?.name ?? '', position: r.position ?? 'Staff' })
        return out
      },
      removeForUser: async (userId) => {
        const rows = (await server.listRows({ databaseId: b.db, tableId: TABLE_IDS.departmentUsers, queries: [Query.equal('userId', [userId])] })).rows
        for (const r of rows) await server.deleteRow({ databaseId: b.db, tableId: TABLE_IDS.departmentUsers, rowId: r.$id })
      },
    },
  }

  const sessionUser = (request) => {
    const header = request.headers['x-fallback-cookies']
    if (!header) return null
    let cookies
    try {
      cookies = JSON.parse(header)
    } catch {
      return null
    }
    const secret = cookies[`a_session_${PROJECT}`]
    return secret && sessions.has(secret) ? { secret, user: users.get(sessions.get(secret)) } : null
  }

  async function route(method, path, request, body) {
    // ---- Account ----
    if (method === 'POST' && path === '/account') {
      if (users.size && [...users.values()].some((u) => u.email === String(body.email).toLowerCase())) return problem(409, 'user_already_exists', 'A user with the same id, email, or phone already exists in this project.')
      if (String(body.password ?? '').length < 8) return problem(400, 'password_invalid', 'Password must be at least 8 characters.')
      return json(publicUser(addUser({ id: body.userId === 'unique()' ? undefined : body.userId, name: body.name, email: body.email, password: body.password })), 201)
    }
    if (method === 'POST' && path === '/account/sessions/email') {
      if (sessionUser(request)) return problem(401, 'user_session_already_exists', 'Creation of a session is prohibited when a session is active.')
      const user = [...users.values()].find((u) => u.email === String(body.email).toLowerCase())
      if (!user || user.password !== body.password) return problem(401, 'user_invalid_credentials', 'Invalid credentials. Please check the email and password.')
      if (user.status === false) return problem(401, 'user_blocked', 'The current user has been blocked.')
      const secret = randomBytes(12).toString('hex')
      sessions.set(secret, user.$id)
      return json({ $id: `sess-${secret.slice(0, 6)}`, userId: user.$id, secret }, 201, { 'X-Fallback-Cookies': JSON.stringify({ [`a_session_${PROJECT}`]: secret }) })
    }
    if (method === 'GET' && path === '/account') {
      const current = sessionUser(request)
      if (!current) return problem(401, 'general_unauthorized_scope', 'User (role: guests) missing scope (account)')
      if (current.user.status === false) return problem(401, 'user_blocked', 'The current user has been blocked.')
      return json(publicUser(current.user))
    }
    if (method === 'DELETE' && path === '/account/sessions/current') {
      const current = sessionUser(request)
      if (!current) return problem(401, 'general_unauthorized_scope', 'User (role: guests) missing scope (account)')
      sessions.delete(current.secret)
      return json({}, 204)
    }
    if (method === 'POST' && path === '/account/recovery') {
      const user = [...users.values()].find((u) => u.email === String(body.email).toLowerCase())
      if (user) {
        const secret = randomBytes(8).toString('hex')
        recoveries.set(secret, { userId: user.$id, used: false })
        sent.push({ email: user.email, userId: user.$id, secret, url: body.url })
      }
      return json({ $id: 'tok', userId: user?.$id ?? 'unknown' }, 201) // identical answer whether or not the e-mail exists
    }
    if (method === 'PUT' && path === '/account/recovery') {
      const token = recoveries.get(body.secret)
      if (!token || token.used || token.userId !== body.userId) return problem(401, 'user_invalid_token', 'Invalid token passed in the request.')
      if (String(body.password ?? '').length < 8) return problem(400, 'password_invalid', 'Password must be at least 8 characters.')
      token.used = true
      users.get(token.userId).password = body.password
      for (const [secret, id] of sessions) if (id === token.userId) sessions.delete(secret) // a reset signs the account out everywhere
      return json({ $id: 'tok' })
    }

    // ---- Storage (browser upload; the function verifies the file afterwards) ----
    const upload = /^\/storage\/buckets\/([^/]+)\/files$/.exec(path)
    if (method === 'POST' && upload) {
      const current = sessionUser(request)
      if (!current) return problem(401, 'user_unauthorized', 'The current user is not authorized to perform the requested action.')
      const form = request.body
      const file = form.get('file')
      const bytes = Buffer.from(await file.arrayBuffer())
      const fileId = String(form.get('fileId'))
      const mimeType = sniffMime(bytes)
      b.addFile(fileId, { ownerId: current.user.$id, name: file.name, mimeType, size: bytes.length, bytes })
      return json({ $id: fileId, name: file.name, mimeType, sizeOriginal: bytes.length }, 201)
    }

    const fileRoute = /^\/storage\/buckets\/([^/]+)\/files\/([^/]+)$/.exec(path)
    if (method === 'DELETE' && fileRoute) {
      const current = sessionUser(request)
      if (!current) return problem(401, 'user_unauthorized', 'The current user is not authorized to perform the requested action.')
      const file = b.files.get(fileRoute[2])
      if (!file) return problem(404, 'storage_file_not_found', 'The requested file could not be found.')
      if (!file.$permissions.includes(`delete("user:${current.user.$id}")`)) return problem(401, 'user_unauthorized', 'The current user is not authorized to perform the requested action.')
      b.files.delete(fileRoute[2])
      return json({}, 204)
    }

    // ---- Function executions ----
    const exec = /^\/functions\/([^/]+)\/executions$/.exec(path)
    if (method === 'POST' && exec) {
      const current = sessionUser(request)
      const functionId = exec[1]
      const handler = { 'profile-api': handleProfile, 'complaint-api': handleComplaint }[functionId]
      if (!handler) return problem(404, 'function_not_found', 'Function with the requested ID could not be found.')
      const headers = { 'content-type': 'application/json' }
      if (current && current.user.status !== false) {
        headers['x-appwrite-user-id'] = current.user.$id
        headers['x-appwrite-user-jwt'] = `jwt-${current.user.$id}`
      } else if (current) return problem(401, 'user_blocked', 'The current user has been blocked.')
      let parsed = {}
      try {
        parsed = JSON.parse(body.body || '{}')
      } catch {
        /* the function answers 400 */
      }
      const req = { headers, bodyText: body.body ?? '' , bodyJson: undefined }
      const out = functionId === 'profile-api' ? await handleProfile({ req }, profileDeps) : await handleComplaint({ req }, b.deps)
      calls.push({ functionId, userId: headers['x-appwrite-user-id'] ?? null, action: parsed.action, status: out.status })
      return json({ $id: `exec-${calls.length}`, status: 'completed', responseStatusCode: out.status, responseBody: JSON.stringify(out.body) }, 201)
    }
    return problem(404, 'general_route_not_found', `Route not found: ${method} ${path}`)
  }

  // ---- install the browser globals the SDK looks for, and the fetch that answers for Appwrite ----
  const realFetch = globalThis.fetch
  const hadWindow = 'window' in globalThis
  const windowShim = {
    get localStorage() {
      return browser.current.localStorage
    },
    sessionStorage: createBrowser().localStorage,
    location: { origin: 'http://localhost:5173', host: 'localhost:5173', href: 'http://localhost:5173/' },
    console: { warn() {}, log() {}, error() {} },
    setTimeout,
    setInterval,
    clearInterval,
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.window = windowShim
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    if (!url.href.startsWith(ENDPOINT)) throw new TypeError(`unexpected network request to ${url.href}`)
    const headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    let body = options.body
    if (typeof body === 'string' && (headers['content-type'] ?? '').includes('json')) body = JSON.parse(body)
    return route(options.method ?? 'GET', url.pathname.slice('/v1'.length), { headers, body }, body ?? {})
  }

  return {
    b,
    server,
    users,
    sessions,
    sent,
    calls,
    addUser,
    /** A user with an active users-table row, ready to sign in. */
    async addStudent(id, { name = `Student ${id}`, email = `${id}@test.edu`, rollNumber, password } = {}) {
      const user = addUser({ id, name, email, password })
      await profileDeps.rows.create(id, { userId: id, name, email, role: 'student', accountStatus: 'active', createdAt: '2026-11-01T09:00:00.000Z', ...(rollNumber ? { rollNumber } : {}) }, [`read("user:${id}")`, 'read("label:admin")'])
      return user
    },
    async addStaff(id, departmentIds = [], { password } = {}) {
      const user = addUser({ id, name: `Staff ${id}`, email: `${id}@test.edu`, labels: ['department'], password })
      await profileDeps.rows.create(id, { userId: id, name: user.name, email: user.email, role: 'department', accountStatus: 'active', createdAt: '2026-11-01T09:00:00.000Z' }, [`read("user:${id}")`, 'read("label:admin")'])
      for (const departmentId of departmentIds) await server.createRow({ databaseId: b.db, tableId: TABLE_IDS.departmentUsers, rowId: 'unique()', data: { userId: id, departmentId, position: 'Staff', createdAt: '2026-11-02T09:00:00.000Z' } })
      return user
    },
    async addAdmin(id, { password } = {}) {
      const user = addUser({ id, name: `Admin ${id}`, email: `${id}@test.edu`, labels: ['admin'], password })
      await profileDeps.rows.create(id, { userId: id, name: user.name, email: user.email, role: 'admin', accountStatus: 'active', createdAt: '2026-11-01T09:00:00.000Z' }, [`read("user:${id}")`, 'read("label:admin")'])
      return user
    },
    /** Switch to another person's browser (own localStorage, own session). */
    newBrowser: () => {
      browser.current = createBrowser()
      return browser.current
    },
    useBrowser: (instance) => {
      browser.current = instance
    },
    get browser() {
      return browser.current
    },
    block: (id) => {
      users.get(id).status = false
      sync()
    },
    close() {
      globalThis.fetch = realFetch
      if (!hadWindow) delete globalThis.window
    },
  }
}
