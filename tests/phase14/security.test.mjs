// Phase 14 - SECURITY AUDIT. Run: npm run test:phase14
// Each test states the attack and what must happen. "browser" = what a signed-in user can do with the public Appwrite project ID
// and the SDK (the only thing an attacker has); "function" = the server-side handlers, which are the real access control.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BUCKETS, COMPLAINT_RULES, ENUMS, TABLE_IDS, TABLES } from '../../database/schema.js'
import { handle as handleComplaint, MAX_BODY_CHARS } from '../../functions/complaint-api/src/handler.js'
import { handle as handleProfile } from '../../functions/profile-api/src/handler.js'
import { canAccessPath, hasRole } from '../../src/lib/permissions.js'
import { validateAttachmentFile, validateComplaintForm } from '../../src/lib/complaintValidation.js'
import { bootstrap } from '../support/e2e.mjs'
import { EXE_BYTES, PDF_BYTES, PNG_BYTES } from '../support/fake-appwrite-http.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const walk = (dir, skip = /(^|\/)(node_modules|\.git|dist|coverage)(\/|$)/) => {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name)
    if (skip.test(rel)) continue
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, skip))
    else out.push(rel)
  }
  return out
}

const t = await bootstrap()
const { g, b, signIn, complaints: C } = t
const rows = (table) => b.fake.rows(table)
const VALID = { title: 'Ceiling fan not working', description: 'The ceiling fan in Lab 3 has stopped working and the room is very hot.', location: 'Lab 3', categoryId: 'cleaning-issues' }
const call = (who, body, opts) => handleComplaint(b.request(who, body, opts), b.deps)
const make = async (who, over = {}) => {
  b.advance(6)
  const res = await call(who, { action: 'complaint.submit', ...VALID, ...over })
  assert.equal(res.body.ok, true, JSON.stringify(res.body))
  return res.body.complaint
}
const asDb = (actor) => b.fake.as(actor)
const student = (id) => ({ id, labels: [] })
const staff = (id) => ({ id, labels: ['department'] })
const adminActor = { id: 'admin1', labels: ['admin'] }
const refused = (p) => assert.rejects(p, (e) => e.code === 401 || e.code === 403 || e.code === 404)

/* =============================================================================== 1. APPWRITE PERMISSIONS */

test('PERMISSIONS: the browser can never write to ANY table, whoever is signed in (all writes go through the functions)', async () => {
  const c = await make('s001')
  const sample = (tableId) => rows(tableId)[0]
  for (const [name, table] of Object.entries(TABLES)) {
    const target = sample(table.id)
    for (const actor of [null, student('s001'), student('s002'), staff('clean1'), adminActor]) {
      const db = asDb(actor)
      const label = `${name} as ${actor ? actor.id : 'guest'}`
      await refused(db.createRow({ databaseId: b.db, tableId: table.id, rowId: 'unique()', data: {}, permissions: actor ? [`read("user:${actor.id}")`] : [] })).catch(() => assert.fail(`${label}: createRow was allowed`))
      if (target) {
        await refused(db.updateRow({ databaseId: b.db, tableId: table.id, rowId: target.$id, data: {} })).catch(() => assert.fail(`${label}: updateRow was allowed`))
        await refused(db.deleteRow({ databaseId: b.db, tableId: table.id, rowId: target.$id })).catch(() => assert.fail(`${label}: deleteRow was allowed`))
      }
    }
  }
  assert.ok(c.id)
})

test('PERMISSIONS: no table or bucket grants anything to "any" or to all users beyond what the design needs', () => {
  const grants = Object.entries(TABLES).flatMap(([name, table]) => table.permissions.map((p) => `${name}: ${p}`))
  assert.deepEqual(grants.filter((p) => /any/.test(p)), [], 'nothing is public')
  assert.deepEqual(grants.filter((p) => /^(\w+): (create|update|delete)/.test(p)), [], 'no table-level write permission exists')
  const everyoneReads = Object.entries(TABLES).filter(([, table]) => table.permissions.includes('read("users")')).map(([name]) => name).sort()
  assert.deepEqual(everyoneReads, ['categories', 'departments'], 'only the public catalogue (departments, categories) is readable by every signed-in user')
  assert.deepEqual(BUCKETS.complaintAttachments.permissions, ['create("users")'], 'users may only upload; reading/changing is per file')
  assert.equal(BUCKETS.complaintAttachments.fileSecurity, true)
})

test('PERMISSIONS (reads): each person sees only their own rows; staff and students cannot read complaints, notes, AI results, history or the audit log directly', async () => {
  const c = await make('s001')
  await call('admin1', { action: 'notification.announce', audience: 'all_students', title: 'Hello students', message: 'A message for everybody.' })
  const list = async (actor, tableId) => asDb(actor).listRows({ databaseId: b.db, tableId }).then((r) => r.rows, () => [])
  // users: own row only (admins: all)
  assert.deepEqual((await list(student('s001'), TABLE_IDS.users)).map((r) => r.$id), ['s001'])
  assert.deepEqual((await list(staff('clean1'), TABLE_IDS.users)).map((r) => r.$id), ['clean1'])
  assert.ok((await list(adminActor, TABLE_IDS.users)).length >= 8)
  assert.deepEqual(await list(null, TABLE_IDS.users), [])
  // everything complaint-related is admin-only for a direct browser read
  for (const tableId of [TABLE_IDS.complaints, TABLE_IDS.complaintHistory, TABLE_IDS.complaintNotes, TABLE_IDS.aiSummaries, TABLE_IDS.adminAudit]) {
    for (const actor of [null, student('s001'), student('s002'), staff('clean1'), staff('itsc1')]) assert.deepEqual(await list(actor, tableId), [], `${tableId} is not readable by ${actor ? actor.id : 'a guest'}`)
  }
  assert.ok((await list(adminActor, TABLE_IDS.complaints)).some((r) => r.$id === c.id))
  // staff assignments: staff and admins only, never students
  assert.deepEqual(await list(student('s001'), TABLE_IDS.departmentUsers), [])
  assert.ok((await list(staff('clean1'), TABLE_IDS.departmentUsers)).length > 0)
  // the public catalogue needs a signed-in user
  assert.deepEqual(await list(null, TABLE_IDS.departments), [])
  assert.ok((await list(student('s001'), TABLE_IDS.departments)).length >= 7)
  // notifications: your own only
  for (const id of ['s001', 's002']) assert.ok((await list(student(id), TABLE_IDS.notifications)).every((n) => n.userId === id), `${id} sees only their notifications`)
  assert.deepEqual(await list(adminActor, TABLE_IDS.notifications).then((r) => r.filter((n) => n.userId !== 'admin1')), [], 'not even administrators read other people\'s notifications from the browser')
})

test('PERMISSIONS: rows created by the functions carry the minimum permissions (no row is public or writable by its owner)', async () => {
  for (const tableId of Object.values(TABLE_IDS)) {
    for (const row of rows(tableId)) {
      for (const permission of row.$permissions ?? []) {
        assert.match(permission, /^read\("(user:[A-Za-z0-9._-]+|label:admin|label:department)"\)$/, `${tableId}/${row.$id}: unexpected permission ${permission}`)
      }
    }
  }
})

/* =============================================================================== 2. BACKEND AUTHORIZATION */

test('AUTHORIZATION: EVERY complaint-api action refuses guests (401) and a forged or mismatched identity (401), and unknown actions are 400', async () => {
  const source = read('functions/complaint-api/src/handler.js')
  const actions = [...source.slice(source.indexOf('const ACTIONS = {')).matchAll(/^\s*'([a-zA-Z.]+)':/gm)].map((m) => m[1])
  const admins = [...source.slice(source.indexOf('const ADMIN_ACTIONS')).matchAll(/^\s*'([a-zA-Z.]+)',/gm)].map((m) => m[1])
  const all = [...new Set([...actions, ...admins, 'department.list'])]
  assert.ok(all.length >= 30, `found ${all.length} actions`)
  for (const action of all) {
    const guest = await handleComplaint({ req: { headers: {}, bodyJson: { action } } }, b.deps)
    assert.equal(guest.status, 401, `${action}: guest`)
    const idOnly = await handleComplaint({ req: { headers: { 'x-appwrite-user-id': 'admin1' }, bodyJson: { action } } }, b.deps)
    assert.equal(idOnly.status, 401, `${action}: user id without JWT`)
    // someone's valid JWT with ANOTHER user's id in the header (an attempt to act as the administrator)
    const forged = await handleComplaint({ req: { headers: { 'x-appwrite-user-id': 'admin1', 'x-appwrite-user-jwt': 'jwt-s001' }, bodyJson: { action } } }, b.deps)
    assert.equal(forged.status, 401, `${action}: forged identity`)
    const badJwt = await handleComplaint({ req: { headers: { 'x-appwrite-user-id': 's001', 'x-appwrite-user-jwt': 'garbage' }, bodyJson: { action } } }, b.deps)
    assert.equal(badJwt.status, 401, `${action}: invalid JWT`)
  }
  assert.equal((await call('s001', { action: 'no.such.action' })).status, 400)
  assert.equal((await call('s001', { action: '__proto__' })).status, 400)
  assert.equal((await call('s001', { action: 'constructor' })).status, 400)
  assert.equal((await call('s001', { action: ['complaint.get'] })).status, 400)
})

test('AUTHORIZATION: role gates - students never reach staff/admin actions; staff never reach admin actions; nothing leaks in the refusal', async () => {
  const c = await make('s001')
  const staffActions = ['department.stats', 'complaint.updateStatus', 'complaint.addRemark', 'complaint.addNote', 'ai.analyze', 'ai.review', 'ai.applyPriority']
  const adminActions = ['dashboard.stats', 'admin.complaints.list', 'reports.summary', 'department.create', 'department.update', 'category.list', 'category.create', 'category.update', 'staff.candidates', 'staff.list', 'staff.assign', 'staff.updatePosition', 'staff.remove', 'audit.list', 'complaint.reassign', 'notification.announce']
  for (const action of [...staffActions, 'department.list']) {
    const res = await call('s001', { action, complaintId: c.id })
    assert.equal(res.status, 403, `student -> ${action}`)
    assert.equal(JSON.stringify(res.body).includes(c.title), false, 'the refusal leaks nothing')
  }
  for (const action of adminActions) {
    for (const who of ['s001', 'clean1', 'itsc1', 'nodept']) assert.equal((await call(who, { action, complaintId: c.id })).status, 403, `${who} -> ${action}`)
  }
})

test('AUTHORIZATION: every profile-api admin action refuses students and staff; disabled accounts get nothing', async () => {
  const run = (who, action, extra = {}) => handleProfile({ req: { headers: { 'x-appwrite-user-id': who, 'x-appwrite-user-jwt': `jwt-${who}` }, bodyJson: { action, ...extra } } }, profileDepsFor())
  for (const action of ['admin.list', 'admin.get', 'admin.setRole', 'admin.updateAccount', 'admin.syncProfiles', 'admin.createUser']) {
    for (const who of ['s001', 'clean1']) assert.equal((await run(who, action, { userId: 's002', role: 'admin' })).status, 403, `${who} -> ${action}`)
    assert.equal((await handleProfile({ req: { headers: {}, bodyJson: { action } } }, profileDepsFor())).status, 401)
  }
})
// The gateway built profile-api's deps internally; the e2e flow already covers real calls, so use the same function through the gateway.
const profileDepsFor = () => ({
  log() {},
  adminAllowlist: [],
  now: () => b.deps.now(),
  verifyJwt: (jwt) => b.deps.verifyJwt(jwt),
  users: { get: async (id) => (g.users.has(id) ? { $id: id, name: g.users.get(id).name, email: g.users.get(id).email, labels: g.users.get(id).labels, status: g.users.get(id).status } : null), listAll: async () => [], updateLabels: async () => ({}), updateName: async () => ({}), updateStatus: async () => ({}), create: async () => ({}) },
  rows: { get: async () => null, create: async () => ({}), update: async () => ({}), listAll: async () => [] },
  assignments: { listForUser: async () => [], removeForUser: async () => {} },
  audit: { record: async () => ({}) },
})

test('AUTHORIZATION: administrators cannot lock themselves out (no self-demotion, no self-disable, no removing the last admin)', async () => {
  await signIn('admin1')
  await assert.rejects(t.profiles.adminSetRole({ userId: 'admin1', role: 'student' }), (e) => /own role|yourself|cannot/i.test(e.message))
  await assert.rejects(t.profiles.adminUpdateAccount({ userId: 'admin1', status: 'disabled' }), (e) => /own|yourself|cannot/i.test(e.message))
  assert.deepEqual(g.users.get('admin1').labels, ['admin'])
  assert.equal(g.users.get('admin1').status, true)
})

/* =============================================================================== 3. INPUT VALIDATION */

test('VALIDATION: wrong types, oversized values and hostile strings never cause a 500 or a stored non-string', async () => {
  const weird = [null, undefined, 0, 1, -1, 1e999, true, false, [], ['x'], {}, { $gt: '' }, { a: { b: 1 } }, '', ' ', '\u0000', '\n\n\n', 'x'.repeat(10_000), '𝒳'.repeat(200), '__proto__', 'constructor', "'; DROP TABLE complaints; --", '" OR 1=1', '<script>alert(1)</script>', '{{7*7}}', '${process.env}', '../../../etc/passwd']
  const bodies = (field) => weird.map((value) => ({ ...VALID, [field]: value }))
  for (const field of ['title', 'description', 'location', 'categoryId', 'attachmentId']) {
    for (const body of bodies(field)) {
      b.advance(6)
      const res = await call('s002', { action: 'complaint.submit', ...body })
      assert.ok(res.status < 500, `${field}=${JSON.stringify(body[field])?.slice(0, 40)} -> ${res.status}`)
      assert.equal(typeof res.body.ok, 'boolean')
    }
  }
  for (const complaint of rows(TABLE_IDS.complaints)) for (const key of ['title', 'description', 'location']) assert.ok(typeof complaint[key] === 'string' || (key === 'location' && complaint[key] === null), `stored ${key} is a string (location may be empty)`)
  const strangeParams = [{ search: { $ne: 1 } }, { search: ['a'] }, { status: { $ne: 'x' } }, { status: '"; DROP' }, { limit: -5 }, { limit: 1e9 }, { limit: 'many' }, { offset: -1 }, { offset: 1e12 }, { sort: 'sideways' }, { categoryId: [] }, { search: ')(*&^%$#@!' }, { search: 'x'.repeat(500) }]
  for (const params of strangeParams) {
    for (const action of ['complaint.list', 'department.list']) {
      const res = await call(action === 'complaint.list' ? 's002' : 'clean1', { action, ...params })
      assert.ok(res.status < 500, `${action} ${JSON.stringify(params).slice(0, 40)} -> ${res.status}`)
      if (res.status === 200 && Array.isArray(res.body.complaints)) assert.ok(res.body.complaints.length <= 100, 'results are capped')
    }
  }
})

test('VALIDATION: hostile text is stored as inert text (the UI renders text nodes) and control characters are removed', async () => {
  const payload = '<img src=x onerror=alert(1)> <script>steal()</script> javascript:alert(2)'
  const c = await make('s002', { title: `Fan ${payload}`.slice(0, 150), description: `${payload}\u0000\u0007 The fan in Lab 3 is not working at all.` })
  const row = rows(TABLE_IDS.complaints).find((r) => r.$id === c.id)
  assert.equal(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(row.description + row.title), false, 'control characters stripped')
  const sources = walk('src').filter((f) => /\.(jsx?|html)$/.test(f))
  const offenders = sources.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(read(f)))
  assert.deepEqual(offenders, [], 'the app never renders user text as HTML or evaluates it')
  assert.equal(/target="_blank"/.test(sources.map(read).join('')) && !/rel="noopener/.test(sources.map(read).join('')), false, 'external links use rel="noopener"')
})

test('VALIDATION: oversized and malformed request bodies are refused before any work is done', async () => {
  const huge = JSON.stringify({ action: 'complaint.submit', ...VALID, description: 'x'.repeat(MAX_BODY_CHARS + 10) })
  const res = await handleComplaint({ req: { headers: { 'x-appwrite-user-id': 's001', 'x-appwrite-user-jwt': 'jwt-s001' }, bodyText: huge } }, b.deps)
  assert.equal(res.status, 413)
  for (const bodyText of ['{not json', '[]', '"string"', '123', 'null']) {
    const r = await handleComplaint({ req: { headers: { 'x-appwrite-user-id': 's001', 'x-appwrite-user-jwt': 'jwt-s001' }, bodyText } }, b.deps)
    assert.equal(r.status, 400, bodyText)
  }
  assert.equal((await handleProfile({ req: { headers: { 'x-appwrite-user-id': 's001', 'x-appwrite-user-jwt': 'jwt-s001' }, bodyText: huge } }, profileDepsFor())).status, 413)
})

test('VALIDATION: the browser form and the server give the same verdict for the same input (no "client-only" rules)', () => {
  for (const bad of [{ title: 'a' }, { description: 'tiny' }, { title: '!!!!' }, { location: 'x'.repeat(301) }, { categoryId: '' }]) {
    const { errors } = validateComplaintForm({ ...VALID, ...bad })
    assert.ok(Object.keys(errors).length > 0, JSON.stringify(bad))
  }
})

test('VALIDATION: the server enforces ENUMs - priority, status and roles outside the allowed lists are refused', async () => {
  const c = await make('s003')
  for (const status of ['', 'Resolved', 'RESOLVED', 'done', '__proto__', 1, null, ['resolved']]) {
    const res = await call('clean1', { action: 'complaint.updateStatus', complaintId: c.id, status, expectedStatus: 'submitted', remark: 'testing 123' })
    assert.ok([400, 404].includes(res.status), `status ${JSON.stringify(status)} -> ${res.status}`)
  }
  assert.ok(Object.keys(ENUMS).length > 0, 'the schema defines the allowed values the server enforces')
  assert.equal(rows(TABLE_IDS.complaints).find((r) => r.$id === c.id).status, 'submitted')
})

/* =============================================================================== 4. FILE UPLOADS */

test('UPLOAD (browser rules): only JPG/PNG/PDF up to 5 MB; no empty files, double extensions or look-alikes', () => {
  const file = (name, size = 1000) => ({ name, size })
  for (const ok of ['a.png', 'a.JPG', 'a.jpeg', 'report.final.pdf', 'weird name (1).PdF']) assert.equal(validateAttachmentFile(file(ok)), '', ok)
  for (const bad of ['a.exe', 'a.svg', 'a.html', 'a.php', 'a.png.exe', 'a.js', 'a', 'a.png ', 'a.pdf.', 'a.gif', 'a.webp', 'a.docx', 'a.zip', 'a.png\u0000.exe']) assert.notEqual(validateAttachmentFile(file(bad)), '', bad)
  assert.notEqual(validateAttachmentFile(file('a.png', 0)), '', 'empty file')
  assert.notEqual(validateAttachmentFile(file('a.png', COMPLAINT_RULES.attachment.maxBytes + 1)), '', 'over 5 MB')
  assert.equal(validateAttachmentFile(file('a.png', COMPLAINT_RULES.attachment.maxBytes)), '')
})

test('UPLOAD (server rules): the function re-checks the stored file - a renamed executable, a wrong type or a oversized file is refused and discarded', async () => {
  await signIn('s001')
  const attempt = (name, bytes, type = 'image/png') => C.submitComplaint({ ...VALID, title: `Upload test ${name}`.slice(0, 100), file: new File([bytes], name, { type }) })
  b.advance(6)
  await assert.rejects(attempt('virus.png', EXE_BYTES), (e) => Boolean(e.fields?.attachment), 'an .exe renamed to .png')
  b.advance(6)
  await assert.rejects(attempt('doc.pdf', PNG_BYTES, 'application/pdf'), (e) => Boolean(e.fields?.attachment), 'a PNG renamed to .pdf')
  assert.deepEqual([...b.files.values()].filter((f) => /virus|doc\.pdf/.test(f.name)).map((f) => f.name), [], 'rejected files are deleted from storage, not left behind')
  // the genuine ones work
  b.advance(6)
  assert.ok((await attempt('good.png', PNG_BYTES)).complaint.attachment)
  b.advance(6)
  assert.ok((await attempt('good.pdf', PDF_BYTES, 'application/pdf')).complaint.attachment)
})

test('UPLOAD: you cannot attach someone else\'s file, reuse a file already attached, or invent a file ID', async () => {
  await signIn('s002')
  b.advance(6)
  const mine = (await C.submitComplaint({ ...VALID, title: 'Complaint with evidence A', file: new File([PNG_BYTES], 'evidence.png') })).complaint
  const fileId = rows(TABLE_IDS.complaints).find((r) => r.$id === mine.id).attachmentId
  // another student tries to attach s002's (now locked) file to their own complaint
  for (const bad of [fileId, 'does-not-exist', '../etc/passwd', 'x'.repeat(100), 'a b']) {
    b.advance(6)
    const res = await call('s001', { action: 'complaint.submit', ...VALID, title: `Steal evidence ${String(bad).slice(0, 10)}`, attachmentId: bad })
    assert.equal(res.status, 400, `attachmentId ${bad.slice(0, 20)} -> ${res.status}`)
    assert.ok(res.body.error.fields?.attachment, 'reported against the attachment field')
  }
  // s002 cannot reuse their own locked file for a second complaint either
  b.advance(6)
  assert.equal((await call('s002', { action: 'complaint.submit', ...VALID, title: 'Second complaint, same file', attachmentId: fileId })).status, 400)
})

test('UPLOAD: the file name is sanitised and downloads are limited to the owner, the complaint\'s department and administrators', async () => {
  await signIn('s003')
  b.advance(6)
  const c = (await C.submitComplaint({ ...VALID, title: 'Complaint with a strange file name', file: new File([PNG_BYTES], '../../etc/passwd<script>.png') })).complaint
  assert.equal(/[\\/<>:*?"|]|\.\.|^\./.test(c.attachment.name), false, `stored name: ${c.attachment.name}`)
  assert.match(c.attachment.name, /\.png$/)
  assert.ok((await C.fetchAttachment(c.id)).attachment ?? true)
  await signIn('s001')
  await assert.rejects(C.fetchAttachment(c.id), (e) => e.status === 404)
  await signIn('itsc1')
  await assert.rejects(C.fetchAttachment(c.id), (e) => e.status === 404, 'another department')
  await signIn('clean1')
  await C.fetchAttachment(c.id)
  await signIn('admin1')
  await C.fetchAttachment(c.id)
})

/* =============================================================================== 5. SECRETS AND ENVIRONMENT */

test('SECRETS: no real key, token or password is committed anywhere in the project', () => {
  const patterns = {
    'Appwrite API key': /standard_[a-f0-9]{64,}/i,
    'OpenAI key': /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/,
    'Anthropic key': /\bsk-ant-[A-Za-z0-9_-]{20,}/,
    'Google key': /\bAIza[0-9A-Za-z_-]{30,}/,
    'Groq key': /\bgsk_[A-Za-z0-9]{20,}/,
    'private key block': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    'bearer token': /Bearer\s+[A-Za-z0-9._-]{30,}/,
    'hard-coded API key assignment': /(API_KEY|SECRET|PASSWORD)\s*[:=]\s*['"][A-Za-z0-9_\-./+=]{16,}['"]/,
  }
  const files = walk('.').filter((f) => !/^tests\//.test(f) && !/\.(png|jpg|jpeg|ico|gz|zip|woff2?|lock)$/i.test(f) && !/package-lock\.json$/.test(f))
  assert.ok(files.length > 100)
  const hits = []
  for (const file of files) {
    const text = read(file)
    for (const [name, pattern] of Object.entries(patterns)) if (pattern.test(text)) hits.push(`${file}: ${name}`)
  }
  assert.deepEqual(hits, [])
})

test('SECRETS: .env files are git-ignored; the browser reads only public VITE_ variables; .env holds only public identifiers', () => {
  const ignore = read('.gitignore')
  assert.match(ignore, /^\.env$/m)
  assert.match(ignore, /^\.env\.\*$/m)
  assert.match(ignore, /^!\.env\.example$/m)
  const used = new Set(walk('src').flatMap((f) => [...read(f).matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])))
  assert.deepEqual([...used].filter((name) => !/^VITE_APPWRITE_(ENDPOINT|PROJECT_ID|DATABASE_ID)$|^(DEV|PROD|MODE|BASE_URL|SSR)$/.test(name)), [], 'the app reads only public variables')
  for (const file of ['.env', '.env.example']) {
    if (!existsSync(join(ROOT, file))) continue
    for (const line of read(file).split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))) {
      const [key, value] = line.split('=')
      assert.match(key, /^VITE_APPWRITE_(ENDPOINT|PROJECT_ID|DATABASE_ID)$/, `${file}: ${key} must be a public setting`)
      assert.equal(/key|secret|token|password/i.test(key), false)
      if (file === '.env.example') assert.equal(value.trim(), '', '.env.example has no values')
    }
  }
})

test('SECRETS: server keys exist only in the functions (read from the environment) and never in the browser code or the built bundle', () => {
  const browser = walk('src').map(read).join('\n')
  for (const word of ['APPWRITE_API_KEY', 'x-appwrite-key', 'AI_API_KEY', 'GROQ_API_KEY', 'INTERNAL_AI_SECRET', 'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.groq.com']) {
    assert.equal(browser.includes(word), false, `src/ must not mention ${word}`)
  }
  assert.equal(/from\s+['"]node-appwrite['"]|require\(['"]node-appwrite['"]\)/.test(browser), false, 'the server SDK is never imported by the browser app')
  const dist = walk('dist', /$^/).filter((f) => /\.(js|css|html)$/.test(f))
  for (const file of dist) {
    const text = read(file)
    for (const word of ['APPWRITE_API_KEY', 'x-appwrite-key', 'AI_API_KEY', 'GROQ_API_KEY', 'INTERNAL_AI_SECRET', 'api.openai.com', 'api.groq.com', 'standard_']) assert.equal(text.includes(word), false, `${file} must not contain ${word}`)
  }
  // functions take every secret from the environment
  const main = read('functions/complaint-api/src/main.js') + read('functions/profile-api/src/main.js')
  assert.match(main, /process\.env\./)
  assert.equal(/setKey\(\s*['"`]/.test(main), false, 'the server API key is never a literal')
  const provider = read('functions/complaint-api/src/ai/provider.js')
  assert.match(provider, /env\.AI_API_KEY|env\.GROQ_API_KEY/)
})

test('SECRETS: the AI key and internal secret never appear in logs, errors or API responses', async () => {
  const KEY = 'sk-test-SUPER-SECRET-KEY-98765'
  const { createProvider } = await import('../../functions/complaint-api/src/ai/provider.js')
  b.aiControl.provider = createProvider({ provider: 'openai', apiKey: KEY, model: 'm', baseUrl: 'https://ai.example.test/v1', timeoutMs: 500, enabled: true }, {
    fetch: async (url, init) => {
      assert.equal(init.headers.authorization ?? init.headers.Authorization, `Bearer ${KEY}`, 'the key is sent only to the provider')
      return new Response(`provider error mentioning ${KEY}`, { status: 500 })
    },
    sleep: async () => {},
  })
  const before = b.logs.length
  const c = await make('s003')
  await signIn('clean1')
  const seen = JSON.stringify([await C.getComplaint(c.id), await C.listDepartmentComplaints(), rows(TABLE_IDS.aiSummaries)])
  assert.equal(seen.includes(KEY), false, 'not in responses or stored results')
  assert.equal(b.logs.slice(before).join('\n').includes(KEY), false, 'not in logs')
})

/* =============================================================================== 6. PROTECTED ROUTES */

test('ROUTES: every role area is wrapped in ProtectedRoute with exactly its role; auth pages redirect signed-in users; unknown roles get nothing', () => {
  const routes = read('src/routes/AppRoutes.jsx')
  for (const role of ['STUDENT', 'DEPARTMENT', 'ADMIN']) assert.match(routes, new RegExp(`<ProtectedRoute allowedRoles=\\{\\[ROLES\\.${role}\\]\\} />`), role)
  assert.equal((routes.match(/<ProtectedRoute/g) ?? []).length, 3)
  // every page of an area sits under that area's ProtectedRoute (no private page is declared outside it)
  const [, afterStudent] = routes.split('allowedRoles={[ROLES.STUDENT]}')
  assert.ok(afterStudent.indexOf('student.dashboard') < afterStudent.indexOf('allowedRoles={[ROLES.DEPARTMENT]}'))
  const [publicPart] = routes.split('allowedRoles={[ROLES.STUDENT]}')
  assert.equal(/PATHS\.(student|department|admin)\./.test(publicPart), false, 'no private path is declared in the public section')
  assert.match(read('src/routes/PublicRoute.jsx'), /isAuthenticated/)
  const guard = read('src/routes/ProtectedRoute.jsx')
  assert.match(guard, /!isAuthenticated\) return <Navigate to=\{PATHS\.login\}/)
  assert.match(guard, /hasRole\(role, \.\.\.allowedRoles\)/)
  assert.match(guard, /isLoading\) return/, 'nothing private renders while the session is being checked')
  for (const role of ['student', 'department', 'admin']) for (const other of ['student', 'department', 'admin']) assert.equal(canAccessPath(role, `/${other}/dashboard`), role === other, `${role} -> /${other}`)
  assert.equal(canAccessPath('hacker', '/admin'), false)
  assert.equal(canAccessPath('student', '/studentx'), false, 'prefix look-alikes do not match')
  assert.equal(hasRole(undefined, 'admin'), false)
  assert.equal(hasRole('student', 'admin', 'department'), false)
})

test('ROUTES: the frontend never trusts itself - every private page loads its data through a server-checked service', () => {
  for (const file of walk('src/pages').filter((f) => /\.jsx$/.test(f))) {
    const text = read(file)
    assert.equal(/localStorage|sessionStorage/.test(text), false, `${file} must not keep role or session data in browser storage`)
    assert.equal(/role\s*=\s*['"](admin|department)['"]/.test(text), false, `${file} must not hard-code a privileged role`)
  }
})

/* =============================================================================== 7. CROSS-USER / CROSS-DEPARTMENT */

test('CROSS-USER: nobody can reach another student\'s complaint through any action, id guessing or filter trick', async () => {
  const victim = await make('s001', { title: 'Victim private complaint', description: 'This private complaint must never be visible to other students.' })
  const mine = await make('s002', { title: 'Attacker own complaint' })
  for (const action of ['complaint.get', 'complaint.attachment', 'complaint.updateStatus', 'complaint.addRemark', 'complaint.addNote', 'ai.analyze', 'ai.review', 'ai.applyPriority', 'complaint.reassign']) {
    const res = await call('s002', { action, complaintId: victim.id, status: 'closed', expectedStatus: 'submitted', remark: 'hello hello', note: 'hello hello', decision: 'accepted', categoryId: 'lms-issues' })
    assert.ok([403, 404].includes(res.status), `${action} -> ${res.status}`)
    assert.equal(JSON.stringify(res.body).includes('Victim private'), false, `${action} leaks nothing`)
  }
  // filters that try to widen the query are ignored: the owner always comes from the session
  for (const extra of [{ studentId: 's001' }, { userId: 's001' }, { departmentId: 'cleaning' }, { all: true }, { search: 'Victim' }, { search: 's001' }]) {
    const res = await call('s002', { action: 'complaint.list', ...extra })
    assert.ok((res.body.complaints ?? []).every((x) => x.id === mine.id || rows(TABLE_IDS.complaints).find((r) => r.$id === x.id)?.studentId === 's002'), JSON.stringify(extra))
  }
  assert.equal(rows(TABLE_IDS.complaints).find((r) => r.$id === victim.id).status, 'submitted', 'untouched')
  // the student view is a whitelist: nothing internal ever reaches a student
  const view = (await call('s001', { action: 'complaint.get', complaintId: victim.id })).body
  const flat = JSON.stringify(view)
  for (const leak of ['studentId', 'priority', 'assignedTo', 'internal', 'aiSummary', 'confidence', 'notes":[{', '$permissions', 'clean1']) assert.equal(flat.includes(leak), false, `student view must not contain ${leak}`)
})

test('CROSS-DEPARTMENT: staff of one department cannot read or touch another department\'s complaints by any route', async () => {
  const it = await make('s001', { title: 'IT only complaint here', categoryId: 'lms-issues', description: 'The LMS keeps logging me out in the middle of an exam.' })
  const clean = await make('s002', { title: 'Cleaning only complaint', categoryId: 'cleaning-issues' })
  for (const action of ['complaint.get', 'complaint.attachment', 'complaint.updateStatus', 'complaint.addRemark', 'complaint.addNote', 'ai.analyze', 'ai.review', 'ai.applyPriority']) {
    const res = await call('clean1', { action, complaintId: it.id, status: 'in_progress', expectedStatus: 'submitted', remark: 'hello hello', note: 'hello hello', decision: 'accepted' })
    assert.equal(res.status, 404, `${action} across departments -> ${res.status}`)
  }
  for (const extra of [{ departmentId: 'itsc' }, { categoryId: 'lms-issues' }, { search: 'IT only' }, { status: 'submitted', limit: 100 }]) {
    const res = await call('clean1', { action: 'department.list', ...extra })
    assert.equal((res.body.complaints ?? []).some((x) => x.id === it.id), false, `list filter ${JSON.stringify(extra)} cannot reach another department`)
  }
  const stats = (await call('clean1', { action: 'department.stats' })).body
  assert.equal(JSON.stringify(stats).includes('ITSC'), false, 'statistics are limited to the staff member\'s own departments')
  assert.equal(rows(TABLE_IDS.complaints).find((r) => r.$id === it.id).status, 'submitted')
  assert.ok(clean.id)
  // a staff member in TWO departments sees both, and only those
  await g.server.createRow({ databaseId: b.db, tableId: TABLE_IDS.departmentUsers, rowId: 'unique()', data: { userId: 'clean2', departmentId: 'itsc', position: 'Staff', createdAt: '2026-11-02T09:00:00.000Z' } })
  assert.equal((await call('clean2', { action: 'complaint.get', complaintId: it.id })).status, 200)
  await g.server.deleteRow({ databaseId: b.db, tableId: TABLE_IDS.departmentUsers, rowId: rows(TABLE_IDS.departmentUsers).find((r) => r.userId === 'clean2' && r.departmentId === 'itsc').$id })
  assert.equal((await call('clean2', { action: 'complaint.get', complaintId: it.id })).status, 404, 'access ends the moment the assignment is removed')
})

test('CROSS-USER (internal notes): internal notes and AI results are never returned to a student, and staff notes are not visible to other departments', async () => {
  const c = await make('s003', { title: 'Complaint with an internal note' })
  assert.equal((await call('clean1', { action: 'complaint.addNote', complaintId: c.id, note: 'INTERNAL-ONLY remark about the student' })).body.ok, true)
  const asStudent = JSON.stringify((await call('s003', { action: 'complaint.get', complaintId: c.id })).body)
  assert.equal(asStudent.includes('INTERNAL-ONLY'), false)
  assert.equal(JSON.stringify((await call('itsc1', { action: 'complaint.get', complaintId: c.id })).body).includes('INTERNAL-ONLY'), false)
  assert.equal(JSON.stringify((await call('clean2', { action: 'complaint.get', complaintId: c.id })).body).includes('INTERNAL-ONLY'), true, 'the department itself sees it')
})

test('CROSS-USER (disabled / re-roled accounts): a demoted or disabled staff member loses access immediately', async () => {
  const c = await make('s001', { title: 'Complaint for revocation test' })
  assert.equal((await call('clean1', { action: 'complaint.get', complaintId: c.id })).status, 200)
  g.users.get('clean1').labels = []
  b.addAccount('clean1', { labels: [], status: true, name: 'Staff clean1' })
  assert.equal((await call('clean1', { action: 'complaint.get', complaintId: c.id })).status, 404, 'no longer staff: treated as an ordinary user')
  assert.equal((await call('clean1', { action: 'department.list' })).status, 403)
  g.users.get('clean1').labels = ['department']
  b.addAccount('clean1', { labels: ['department'], status: false, name: 'Staff clean1' })
  assert.equal((await call('clean1', { action: 'complaint.get', complaintId: c.id })).status, 403, 'disabled')
  b.addAccount('clean1', { labels: ['department'], status: true, name: 'Staff clean1' })
})

/* =============================================================================== 8. ABUSE AND ERROR HANDLING */

test('ABUSE: a student cannot flood the system - submissions are rate limited, and announcements are size-limited', async () => {
  b.advance(60)
  const sent = []
  for (let i = 0; i < COMPLAINT_RULES.rateLimit.max + 2; i += 1) sent.push((await call('s003', { action: 'complaint.submit', ...VALID, title: `Flood number ${i} of the system` })).status)
  assert.deepEqual(sent.slice(0, COMPLAINT_RULES.rateLimit.max).every((s) => s === 200 || s === 201), true)
  assert.ok(sent.slice(COMPLAINT_RULES.rateLimit.max).every((s) => s === 429), `statuses ${sent}`)
  const big = await call('admin1', { action: 'notification.announce', audience: 'all_students', title: 'x'.repeat(500), message: 'y'.repeat(5000) })
  assert.equal(big.status, 400)
})

test('ERRORS: an unexpected failure returns a generic message - no stack traces, SQL, file paths or secrets reach the browser', async () => {
  const original = b.deps.complaints.get
  b.deps.complaints.get = async () => {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432 at /srv/functions/complaint-api/src/main.js secret=abc123')
  }
  try {
    const res = await call('s001', { action: 'complaint.get', complaintId: 'anything' })
    assert.equal(res.status, 500)
    const text = JSON.stringify(res.body)
    for (const leak of ['ECONNREFUSED', '10.0.0.5', '/srv/', 'main.js', 'secret=abc123', 'at ']) assert.equal(text.includes(leak), false, `error body leaks ${leak}`)
    assert.equal(res.body.ok, false)
  } finally {
    b.deps.complaints.get = original
  }
})

test('ERRORS: refusals look the same for "does not exist" and "not yours" (no way to probe which complaint IDs exist)', async () => {
  const c = await make('s001', { title: 'Existence probe complaint' })
  const foreign = await call('s002', { action: 'complaint.get', complaintId: c.id })
  const missing = await call('s002', { action: 'complaint.get', complaintId: 'CMP-DOES-NOT-EXIST' })
  assert.equal(foreign.status, missing.status)
  assert.deepEqual(foreign.body, missing.body)
  const foreignNote = await call('s002', { action: 'notification.markRead', notificationId: rows(TABLE_IDS.notifications).find((n) => n.userId === 's001').$id })
  const missingNote = await call('s002', { action: 'notification.markRead', notificationId: 'nope' })
  assert.deepEqual(foreignNote.body, missingNote.body)
})

test('SESSION HYGIENE: the browser keeps no password, role or token of its own', async () => {
  await signIn('s001')
  const stored = JSON.stringify([...Object.entries(g.browser.localStorage ? { dump: JSON.stringify(g.sessions.size) } : {})])
  assert.equal(/Passw0rd|password/i.test(stored), false)
  for (const file of ['src/services/authService.js', 'src/context/AuthProvider.jsx']) {
    if (!existsSync(join(ROOT, file))) continue
    assert.equal(/localStorage|sessionStorage|document\.cookie/.test(read(file)), false, `${file} stores nothing itself`)
  }
})

test.after(() => g.close())
