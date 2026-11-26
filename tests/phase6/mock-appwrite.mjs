// Mock Appwrite for the Phase 6 browser tests, updated for the Phase 7 `users` table (TEST ONLY).
//
// Account endpoints behave like Phase 5's mock. In addition, POST /v1/functions/profile-api/executions
// runs the REAL function handler (functions/profile-api/src/handler.js) against an in-memory
// Users/Table stand-in, passing it the same headers Appwrite would (user id + JWT).
// Direct table access is modelled too, with the permissions the docs ask you to configure:
// a row is readable by its owner and by label:admin; nobody can write from a client.
//
// This proves the app's and the function's logic. It does NOT prove your real Appwrite project is
// configured the same way – use the manual checklist in docs/APPWRITE_SETUP.md for that.
import http from 'node:http'
import { handle } from '../../functions/profile-api/src/handler.js'
import { createFakeBackend } from '../support/fake-backend.mjs'

const PROJECT = 'testproject'
const backend = createFakeBackend()
const passwords = new Map() // email -> password
const sessions = new Map() // token -> user id
const log = []
let recoveryUser = null

const seed = (id, name, email, labels = [], prefs = {}) => {
  backend.addAccount({ id, name, email, labels, prefs })
  passwords.set(email, 'Passw0rd!seed')
}
seed('u_admin', 'Admin Person', 'admin@test.edu', ['admin'])
seed('u_staff', 'Staff Person', 'staff@test.edu', ['department'])
seed('u_legacy', 'Legacy Student', 'legacy@test.edu', [], { rollNumber: '20ee007', department: 'Electronic Engineering' }) // Phase 5 account, no profile row yet

const send = (res, origin, code, body, extra = {}) => {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-expose-headers': 'X-Fallback-Cookies',
    ...extra,
  })
  res.end(JSON.stringify(body))
}
const err = (res, o, code, type, message) => send(res, o, code, { message, code, type })
const publicAccount = (u) => ({ $id: u.$id, name: u.name, email: u.email, labels: u.labels, prefs: u.prefs, status: u.status, registration: u.registration, emailVerification: false })
const findByEmail = (email) => [...backend.accounts.values()].find((a) => a.email === email)

http
  .createServer((req, res) => {
    const origin = req.headers.origin ?? '*'
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      })
      return res.end()
    }
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {}
      const url = new URL(req.url, 'http://x')
      const route = `${req.method} ${url.pathname}`
      let fb = {}
      try { fb = JSON.parse(req.headers['x-fallback-cookies'] ?? '{}') } catch { /* none */ }
      const token = fb[`a_session_${PROJECT}`]
      const me = backend.accounts.get(sessions.get(token))
      const entry = { route, body }
      log.push(entry)

      // ---- test control endpoints
      if (route === 'GET /__log') return send(res, origin, 200, log)
      if (route === 'POST /__revoke') { sessions.clear(); return send(res, origin, 200, {}) }
      if (route === 'POST /__setLabels') { findByEmail(body.email).labels = body.labels; return send(res, origin, 200, {}) }
      if (route === 'GET /__rows') return send(res, origin, 200, [...backend.rows.values()])
      if (route === 'GET /__account') return send(res, origin, 200, publicAccount(findByEmail(url.searchParams.get('email'))))
      if (req.headers['x-appwrite-project'] !== PROJECT) return err(res, origin, 404, 'project_not_found', 'Project not found')

      // ---- account
      if (route === 'POST /v1/account') {
        if (findByEmail(body.email)) return err(res, origin, 409, 'user_already_exists', 'A user with the same id, email, or phone already exists in this project.')
        if (!body.password || body.password.length < 8) return err(res, origin, 400, 'general_argument_invalid', 'Invalid `password` param: Password must be between 8 and 256 characters long.')
        const u = backend.addAccount({ id: body.userId, name: body.name, email: body.email, registration: new Date().toISOString() })
        passwords.set(body.email, body.password)
        return send(res, origin, 201, publicAccount(u))
      }
      if (route === 'POST /v1/account/sessions/email') {
        if (me) return err(res, origin, 401, 'user_session_already_exists', 'Creation of a session is prohibited when a session is active.')
        const u = findByEmail(body.email)
        if (!u || passwords.get(u.email) !== body.password) return err(res, origin, 401, 'user_invalid_credentials', 'Invalid credentials. Please check the email and password.')
        if (!u.status) return err(res, origin, 401, 'user_blocked', 'The current user has been blocked.')
        const t = 'tok_' + Math.random().toString(36).slice(2)
        sessions.set(t, u.$id)
        return send(res, origin, 201, { $id: 's1', userId: u.$id }, { 'x-fallback-cookies': JSON.stringify({ [`a_session_${PROJECT}`]: t }) })
      }
      if (route === 'GET /v1/account') return me && me.status ? send(res, origin, 200, publicAccount(me)) : err(res, origin, 401, 'general_unauthorized_scope', 'User (role: guests) missing scope (account)')
      if (route === 'DELETE /v1/account/sessions/current') {
        if (!me) return err(res, origin, 401, 'general_unauthorized_scope', 'missing scope')
        sessions.delete(token)
        return send(res, origin, 204, {})
      }
      if (route === 'POST /v1/account/recovery') { recoveryUser = findByEmail(body.email)?.$id; return send(res, origin, 201, { $id: 'tok', userId: 'x' }) }
      if (route === 'PUT /v1/account/recovery') {
        if (body.secret !== 'goodsecret') return err(res, origin, 401, 'user_invalid_token', 'Invalid token passed in the request.')
        const u = backend.accounts.get(body.userId) ?? backend.accounts.get(recoveryUser)
        if (u) passwords.set(u.email, body.password)
        return send(res, origin, 200, { $id: 'tok' })
      }

      // ---- the trusted function (execute permission: any signed-in user)
      if (route === 'POST /v1/functions/profile-api/executions') {
        if (!me || !me.status) return err(res, origin, 401, 'general_unauthorized_scope', 'User (role: guests) missing scope (execution.write)')
        const jwt = `jwt_${token}`
        backend.jwts.set(jwt, me.$id)
        const { status, body: out } = await handle(
          { req: { headers: { 'x-appwrite-user-id': me.$id, 'x-appwrite-user-jwt': jwt }, bodyText: body.body } },
          backend.deps,
        )
        entry.result = { status, code: out.error?.code, ok: out.ok }
        return send(res, origin, 201, { $id: 'ex1', status: 'completed', responseStatusCode: status, responseBody: JSON.stringify(out), logs: '', errors: '' })
      }

      // ---- direct table access (permissions as documented: owner + label:admin may READ; nobody writes)
      const rowMatch = url.pathname.match(/^\/v1\/tablesdb\/[^/]+\/tables\/users\/rows\/([^/]+)$/)
      if (rowMatch) {
        const rowId = rowMatch[1]
        if (!me) return err(res, origin, 401, 'user_unauthorized', 'The current user is not authorized to perform the requested action.')
        if (req.method !== 'GET') return err(res, origin, 401, 'user_unauthorized', 'The current user is not authorized to perform the requested action.')
        const row = backend.rows.get(rowId)
        if (!row) return err(res, origin, 404, 'row_not_found', 'Row with the requested ID could not be found.')
        const allowed = row.$permissions.some((p) => p === `read("user:${me.$id}")` || (p.startsWith('read("label:') && me.labels.includes(p.slice(12, -2))))
        return allowed ? send(res, origin, 200, row) : err(res, origin, 401, 'user_unauthorized', 'The current user is not authorized to perform the requested action.')
      }
      if (/^\/v1\/tablesdb\/[^/]+\/tables\/users\/rows$/.test(url.pathname)) {
        return err(res, origin, 401, 'user_unauthorized', 'The current user is not authorized to perform the requested action.')
      }
      return err(res, origin, 404, 'general_route_not_found', 'Route not found ' + route)
    })
  })
  .listen(4010, () => console.log('mock appwrite (phase 6) on 4010'))
