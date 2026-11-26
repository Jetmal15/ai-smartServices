// Minimal mock of the Appwrite Account endpoints used by Phase 5 (TEST ONLY).
import http from 'node:http'
const PROJECT = 'testproject'
const users = new Map() // email -> user
const sessions = new Map() // token -> email
const log = []
const seed = (email, name, labels) =>
  users.set(email, { $id: 'u_' + email.split('@')[0], name, email, password: 'Passw0rd!seed', labels, prefs: {}, emailVerification: false })
seed('admin@test.edu', 'Admin Person', ['admin'])
seed('staff@test.edu', 'Staff Person', ['department'])

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
const pub = (u) => ({ $id: u.$id, name: u.name, email: u.email, labels: u.labels, prefs: u.prefs, emailVerification: u.emailVerification })

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
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      const url = new URL(req.url, 'http://x')
      const route = `${req.method} ${url.pathname}`
      log.push({ route, body })
      let fb = {}
      try { fb = JSON.parse(req.headers['x-fallback-cookies'] ?? '{}') } catch { /* none */ }
      const me = users.get(sessions.get(fb[`a_session_${PROJECT}`]))

      if (route === 'GET /__log') return send(res, origin, 200, log)
      if (route === 'POST /__revoke') { sessions.clear(); return send(res, origin, 200, {}) }
      if (req.headers['x-appwrite-project'] !== PROJECT && !route.includes('__')) return err(res, origin, 404, 'project_not_found', 'Project not found')

      if (route === 'POST /v1/account') {
        if (users.has(body.email)) return err(res, origin, 409, 'user_already_exists', 'A user with the same id, email, or phone already exists in this project.')
        if (!body.password || body.password.length < 8) return err(res, origin, 400, 'general_argument_invalid', 'Invalid `password` param: Password must be between 8 and 256 characters long.')
        const u = { $id: body.userId, name: body.name, email: body.email, password: body.password, labels: [], prefs: {}, emailVerification: false }
        users.set(u.email, u)
        return send(res, origin, 201, pub(u))
      }
      if (route === 'POST /v1/account/sessions/email') {
        if (me) return err(res, origin, 401, 'user_session_already_exists', 'Creation of a session is prohibited when a session is active.')
        const u = users.get(body.email)
        if (!u || u.password !== body.password) return err(res, origin, 401, 'user_invalid_credentials', 'Invalid credentials. Please check the email and password.')
        const token = 'tok_' + Math.random().toString(36).slice(2)
        sessions.set(token, u.email)
        return send(res, origin, 201, { $id: 's1', userId: u.$id }, { 'x-fallback-cookies': JSON.stringify({ [`a_session_${PROJECT}`]: token }) })
      }
      if (route === 'GET /v1/account') return me ? send(res, origin, 200, pub(me)) : err(res, origin, 401, 'general_unauthorized_scope', 'User (role: guests) missing scope (account)')
      if (route === 'PATCH /v1/account/prefs') {
        if (!me) return err(res, origin, 401, 'general_unauthorized_scope', 'missing scope')
        me.prefs = body.prefs
        return send(res, origin, 200, pub(me))
      }
      if (route === 'DELETE /v1/account/sessions/current') {
        if (!me) return err(res, origin, 401, 'general_unauthorized_scope', 'missing scope')
        for (const [t, e] of sessions) if (e === me.email) sessions.delete(t)
        return send(res, origin, 204, {})
      }
      if (route === 'POST /v1/account/recovery') { const ru = users.get(body.email); if (ru) global.__rec = ru.$id; return send(res, origin, 201, { $id: 'tok', userId: 'x' }) }
      if (route === 'PUT /v1/account/recovery') {
        if (body.secret !== 'goodsecret') return err(res, origin, 401, 'user_invalid_token', 'Invalid token passed in the request.')
        const u = [...users.values()].find((x) => x.$id === body.userId || x.$id === global.__rec)
        if (u) u.password = body.password
        return send(res, origin, 200, { $id: 'tok' })
      }
      return err(res, origin, 404, 'general_route_not_found', 'Route not found ' + route)
    })
  })
  .listen(4010, () => console.log('mock appwrite on 4010'))
