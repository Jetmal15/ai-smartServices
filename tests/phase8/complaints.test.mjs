// Phase 8 – student complaint submission tests. Run: npm run test:phase8
// The REAL complaint-api handler runs against an in-memory backend built from database/schema.js, so what the function
// writes is validated against the real columns/enums/unique indexes and read access is evaluated per user.
// (functions/complaint-api/src/main.js, the node-appwrite wiring, is not executed here: it needs the SDK and a live project.)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BUCKETS, CATEGORY_SEEDS, COMPLAINT_RULES, DEPARTMENT_SEEDS, ENUMS, TABLE_IDS } from '../../database/schema.js'
import { handle, RULES, STATUSES, validateSubmission, generateReference } from '../../functions/complaint-api/src/handler.js'
import { validateAttachmentFile, validateComplaintForm } from '../../src/lib/complaintValidation.js'
import { createDatabaseServices } from '../../src/services/db/factory.js'
import { createComplaintBackend } from '../support/fake-complaint-backend.mjs'
import { ID, Query } from '../support/fake-tablesdb.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const NOW = '2026-11-22T10:00:00.000Z'

const VALID = {
  action: 'complaint.submit',
  title: 'Ceiling fan not working',
  description: 'The ceiling fan in Lab 3 has stopped working and the room is very hot.',
  categoryId: 'cleaning-issues',
  location: 'Block B, Lab 3',
}

async function setup() {
  const b = createComplaintBackend()
  const dbServices = (actor) => createDatabaseServices({ tablesDB: b.fake.as(actor), databaseId: b.db, Query, ID, now: () => NOW })
  await dbServices('server').seedInitialData()
  await b.addStudent('s001')
  await b.addStudent('s002')
  await b.addStaff('staff-clean', ['cleaning'])
  await b.addStaff('staff-itsc', ['itsc'])
  await b.addStaff('staff-none')
  await b.addAdmin('admin1')
  const call = (userId, body, opts) => handle(b.request(userId, body, opts), b.deps)
  const rows = () => b.fake.rows(TABLE_IDS.complaints)
  return { b, call, rows, dbServices }
}
const err = (res) => res.body.error?.code
const submit = (t, who, over = {}) => t.call(who, { ...VALID, ...over })

/* ============================================================== rules & wiring */

test('rules in the function equal the shared rules (browser form + schema)', () => {
  assert.deepEqual(RULES, JSON.parse(JSON.stringify(COMPLAINT_RULES)))
  assert.deepEqual(STATUSES, ENUMS.complaintStatus)
  assert.equal(STATUSES[0], 'submitted')
  assert.deepEqual(Object.keys(BUCKETS.complaintAttachments.allowedFileExtensions.reduce((o, e) => ({ ...o, [e]: 1 }), {})), Object.keys(RULES.attachment.types))
  assert.equal(BUCKETS.complaintAttachments.maximumFileSize, RULES.attachment.maxBytes)
  assert.equal(BUCKETS.complaintAttachments.fileSecurity, true)
})

test('statuses are Submitted, Under Review, In Progress, Resolved, Closed everywhere', () => {
  const constants = read('../../src/lib/constants.js')
  const block = constants.match(/export const COMPLAINT_STATUS = \{([\s\S]*?)\n\}/)[1]
  const keys = [...block.matchAll(/^\s{2}(\w+): \{ label: '([^']+)'/gm)].map((m) => [m[1], m[2]])
  assert.deepEqual(keys, [['submitted', 'Submitted'], ['under_review', 'Under Review'], ['in_progress', 'In Progress'], ['resolved', 'Resolved'], ['closed', 'Closed']])
})

test('the complaint form offers exactly the seven categories', async () => {
  const t = await setup()
  const available = await t.dbServices({ id: 's001', labels: [] }).categories.listAvailable()
  assert.deepEqual(available.map((c) => c.name).sort(), CATEGORY_SEEDS.map((c) => c.name).sort())
  assert.equal(available.length, 7)
})

/* ============================================================== successful submission */

test('a student submits: record created with server-decided ID, student, department, status and time', async () => {
  const t = await setup()
  const res = await submit(t, 's001')
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.duplicate, false)
  const c = res.body.complaint
  assert.match(c.reference, /^CMP-20261122-[A-HJ-NP-Z2-9]{6}$/)
  assert.equal(c.id, c.reference, 'row ID = complaint ID')
  assert.deepEqual([c.status, c.categoryName, c.departmentId, c.departmentName, c.submittedAt], ['submitted', 'Cleaning Issues', 'cleaning', 'Cleaning Department', NOW])
  assert.deepEqual([c.title, c.location, c.attachment], ['Ceiling fan not working', 'Block B, Lab 3', null])

  const [row] = t.rows()
  assert.equal(row.studentId, 's001', 'associated with the authenticated student')
  assert.deepEqual([row.studentName, row.studentRollNumber], ['User s001', '22SW-s001'], 'snapshot from the server-side users row')
  assert.equal(row.referenceNumber, row.$id)
  assert.equal(row.priority, 'medium')
  assert.deepEqual(row.$permissions, ['read("label:admin")'], 'readable by administrators only; students and staff go through the function; nobody writes from a browser')
})

test('the student receives a confirmation notification readable only by them', async () => {
  const t = await setup()
  const res = await submit(t, 's001')
  const n = t.b.fake.rows(TABLE_IDS.notifications).find((x) => x.userId === 's001')
  assert.deepEqual([n.userId, n.type, n.relatedComplaintId, n.isRead], ['s001', 'complaint_submitted', res.body.complaint.id, false])
  assert.match(n.message, /Cleaning Department/)
  assert.deepEqual(n.$permissions, ['read("user:s001")'], 'readable by the student only; nobody can edit it from a browser')
  // a notification failure never loses the complaint
  const t2 = await setup()
  t2.b.deps.notifications.create = async () => { throw new Error('boom') }
  const r2 = await submit(t2, 's001')
  assert.equal(r2.body.ok, true)
  assert.equal(t2.rows().length, 1)
  assert.ok(t2.b.logs.some((l) => l.includes('could not create a notification')))
})

test('every category routes to its department, looked up on the server', async () => {
  const t = await setup()
  const deptName = (id) => DEPARTMENT_SEEDS.find((d) => d.id === id).name
  for (const [i, category] of CATEGORY_SEEDS.entries()) {
    await t.b.addStudent(`m${String(i).padStart(3, '0')}`)
    const res = await submit(t, `m${String(i).padStart(3, '0')}`, { categoryId: category.id })
    assert.equal(res.body.complaint.departmentId, category.departmentId, category.name)
    assert.equal(res.body.complaint.departmentName, deptName(category.departmentId))
  }
})

/* ============================================================== do not trust the frontend */

test('studentId, departmentId, status, dates, IDs and permissions sent by the browser are ignored', async () => {
  const t = await setup()
  const res = await submit(t, 's001', {
    studentId: 's002',
    studentName: 'Hacker',
    departmentId: 'itsc',
    departmentName: 'ITSC Department',
    status: 'resolved',
    priority: 'high',
    submittedAt: '2001-01-01T00:00:00.000Z',
    referenceNumber: 'CMP-FAKE',
    $id: 'CMP-FAKE',
    $permissions: ['read("any")'],
    assignedTo: 'staff-itsc',
    resolvedAt: NOW,
    attachmentName: 'evil.exe',
  })
  assert.equal(res.body.ok, true)
  const [row] = t.rows()
  assert.deepEqual(
    [row.studentId, row.studentName, row.departmentId, row.status, row.priority, row.submittedAt, row.assignedTo, row.resolvedAt, row.attachmentName],
    ['s001', 'User s001', 'cleaning', 'submitted', 'medium', NOW, null, null, null],
  )
  assert.notEqual(row.$id, 'CMP-FAKE')
  assert.deepEqual(row.$permissions, ['read("label:admin")'])
})

test('the caller is identified by the verified login, not by the request', async () => {
  const t = await setup()
  assert.equal(err(await t.call('s001', VALID, { jwt: 'jwt-s002' })), 'unauthenticated', "someone else's token")
  assert.equal(err(await t.call('s001', VALID, { jwt: 'garbage' })), 'unauthenticated')
  assert.equal((await handle({ req: { headers: {}, bodyJson: VALID } }, t.b.deps)).status, 401, 'no headers')
  assert.equal((await handle({ req: { headers: { 'x-appwrite-user-id': 's001' }, bodyJson: VALID } }, t.b.deps)).status, 401, 'no token')
  assert.equal(t.rows().length, 0)
})

test('only active students can submit', async () => {
  const t = await setup()
  assert.equal(err(await submit(t, 'staff-clean')), 'students_only')
  assert.equal(err(await submit(t, 'admin1')), 'students_only')
  t.b.accounts.get('s002').status = false
  const disabled = await submit(t, 's002')
  assert.equal(disabled.status, 403)
  assert.equal(err(disabled), 'account_disabled')
  assert.equal(t.rows().length, 0)
  assert.equal((await t.call('s001', { action: 'nope' })).status, 400)
})

/* ============================================================== validation */

test('empty and invalid submissions are rejected with field messages and create nothing', async () => {
  const t = await setup()
  const fieldsOf = async (over, who = 's001') => {
    const res = await t.call(who, { action: 'complaint.submit', ...over })
    assert.equal(res.status, 400, JSON.stringify(over))
    assert.equal(err(res), 'validation_failed')
    return Object.keys(res.body.error.fields ?? {}).sort()
  }
  assert.deepEqual(await fieldsOf({}), ['categoryId', 'description', 'title'], 'completely empty')
  assert.deepEqual(await fieldsOf({ title: '   ', description: '\n\n  ', categoryId: ' ' }), ['categoryId', 'description', 'title'], 'whitespace only')
  assert.deepEqual(await fieldsOf({ ...VALID, title: 'Hi' }), ['title'])
  assert.deepEqual(await fieldsOf({ ...VALID, title: '!!!!!!!!' }), ['title'], 'no real words')
  assert.deepEqual(await fieldsOf({ ...VALID, title: 'x'.repeat(RULES.title.max + 1) }), ['title'])
  assert.deepEqual(await fieldsOf({ ...VALID, description: 'too short' }), ['description'])
  assert.deepEqual(await fieldsOf({ ...VALID, description: 'a'.repeat(RULES.description.max + 1) }), ['description'])
  assert.deepEqual(await fieldsOf({ ...VALID, location: 'y'.repeat(RULES.location.max + 1) }), ['location'])
  assert.deepEqual(await fieldsOf({ ...VALID, categoryId: '../etc' }), ['categoryId'])
  assert.deepEqual(await fieldsOf({ ...VALID, categoryId: 'no-such-category' }), ['categoryId'])
  assert.deepEqual(await fieldsOf({ ...VALID, title: 123 }), [], 'wrong types are refused outright')
  assert.deepEqual(await fieldsOf({ ...VALID, description: { $gt: '' } }), [])
  assert.deepEqual(await fieldsOf({ ...VALID, categoryId: ['cleaning-issues'] }), [])
  assert.equal(t.rows().length, 0)
  assert.equal(t.b.fake.rows(TABLE_IDS.notifications).length, 0)
})

test('input is cleaned: control characters and extra spaces removed, line breaks kept, optional location may be empty', async () => {
  const t = await setup()
  const res = await submit(t, 's001', { title: '  Fan\u0000   not\tworking  ', description: 'Line one is here.\r\n\r\n\r\n\r\nLine two is here.\u0007  ', location: '   ' })
  assert.equal(res.body.ok, true)
  const [row] = t.rows()
  assert.equal(row.title, 'Fan not working')
  assert.equal(row.description, 'Line one is here.\n\nLine two is here.')
  assert.equal(row.location, null)
})

test('stored text is plain data: markup is kept as text (React escapes it when shown), never executed', async () => {
  const t = await setup()
  const res = await submit(t, 's001', { title: '<script>alert(1)</script> fan', description: '<img src=x onerror=alert(1)> broken fan in the lab' })
  assert.equal(res.body.ok, true)
  assert.equal(res.body.complaint.title, '<script>alert(1)</script> fan')
})

test('inactive category, or a category whose department is inactive, cannot be used', async () => {
  const t = await setup()
  const dbs = t.dbServices('server')
  await dbs.categories.deactivate('lms-issues')
  assert.equal(err(await submit(t, 's001', { categoryId: 'lms-issues' })), 'validation_failed')
  await dbs.departments.deactivate('cleaning')
  const res = await submit(t, 's001', { categoryId: 'cleaning-issues' })
  assert.equal(err(res), 'validation_failed')
  assert.ok(res.body.error.fields.categoryId)
  assert.equal(t.rows().length, 0)
})

test('browser-side validation gives the same verdicts as the server', async () => {
  const t = await setup()
  const cases = [
    {}, { title: '   ' }, { ...VALID, title: 'Hi' }, { ...VALID, title: '!!!!!!!!' }, { ...VALID, description: 'short' },
    { ...VALID, title: 'x'.repeat(151) }, { ...VALID, description: 'd'.repeat(5001) }, { ...VALID, location: 'l'.repeat(301) }, { ...VALID, categoryId: '' }, VALID,
    { ...VALID, title: 'Fan', description: 'The fan is broken.' },
  ]
  for (const c of cases) {
    const client = validateComplaintForm(c)
    let serverFields = []
    try {
      validateSubmission(c)
    } catch (e) {
      serverFields = Object.keys(e.fields ?? {})
    }
    assert.deepEqual(Object.keys(client.errors).sort(), serverFields.sort(), JSON.stringify(c).slice(0, 80))
  }
  assert.equal(validateAttachmentFile(null), '')
  assert.equal(validateAttachmentFile({ name: 'a.png', size: 10 }), '')
  assert.ok(validateAttachmentFile({ name: 'a.exe', size: 10 }))
  assert.ok(validateAttachmentFile({ name: 'noext', size: 10 }))
  assert.ok(validateAttachmentFile({ name: 'a.pdf', size: 0 }))
  assert.ok(validateAttachmentFile({ name: 'a.pdf', size: RULES.attachment.maxBytes + 1 }))
  assert.equal(validateAttachmentFile({ name: 'A.PDF', size: RULES.attachment.maxBytes }), '')
})

/* ============================================================== unique IDs, duplicates, rate limit */

test('complaint IDs are unique: many submissions, and a clash is retried with a new ID', async () => {
  const t = await setup()
  const ids = new Set()
  for (let i = 0; i < 40; i++) {
    const id = `u${String(i).padStart(3, '0')}`
    await t.b.addStudent(id)
    const res = await submit(t, id)
    assert.equal(res.body.ok, true)
    ids.add(res.body.complaint.id)
  }
  assert.equal(ids.size, 40)
  assert.equal(t.rows().length, 40)

  // force the first two random suffixes to collide with an existing complaint
  const existing = t.rows()[0].$id.slice(-6)
  t.b.randomQueue.push(existing, existing, 'ZZZZZZ')
  await t.b.addStudent('x001')
  const res = await submit(t, 'x001')
  assert.equal(res.body.complaint.id, 'CMP-20261122-ZZZZZZ')
  assert.equal(t.rows().length, 41)

  // and if every attempt clashes, it fails cleanly instead of overwriting anything
  t.b.randomQueue.length = 0
  t.b.randomQueue.push(...Array(6).fill(existing))
  await t.b.addStudent('x002')
  const failed = await submit(t, 'x002')
  assert.equal(failed.status, 503)
  assert.equal(t.rows().length, 41)
  assert.match(generateReference(new Date(NOW)), /^CMP-20261122-[A-HJ-NP-Z2-9]{6}$/)
})

test('double-click / retry returns the same complaint instead of creating a second one', async () => {
  const t = await setup()
  const first = await submit(t, 's001')
  t.b.advance(1)
  const again = await submit(t, 's001')
  assert.equal(again.body.duplicate, true)
  assert.equal(again.body.complaint.id, first.body.complaint.id)
  assert.equal(t.rows().length, 1)
  assert.equal(t.b.fake.rows(TABLE_IDS.notifications).length, 2, 'one for the student, one for the department staff; none for the repeat')
  // a different student with identical text is a different complaint
  assert.equal((await submit(t, 's002')).body.duplicate, false)
  // the same text later (after the window) is allowed
  t.b.advance(5)
  assert.equal((await submit(t, 's001')).body.duplicate, false)
  assert.equal(t.rows().length, 3)
})

test('spam limit: at most 5 complaints per 10 minutes per student', async () => {
  const t = await setup()
  for (let i = 1; i <= 5; i++) assert.equal((await submit(t, 's001', { title: `Different complaint number ${i}` })).body.ok, true)
  const sixth = await submit(t, 's001', { title: 'Different complaint number 6' })
  assert.equal(sixth.status, 429)
  assert.equal(err(sixth), 'too_many_submissions')
  assert.equal((await submit(t, 's002')).body.ok, true, 'other students are unaffected')
  t.b.advance(11)
  assert.equal((await submit(t, 's001', { title: 'Different complaint number 7' })).body.ok, true)
  assert.equal(t.rows().filter((r) => r.studentId === 's001').length, 6)
})

/* ============================================================== attachments */

test('a valid attachment is verified from the stored file, recorded, and locked to read-only', async () => {
  const t = await setup()
  t.b.addFile('file1', { ownerId: 's001', name: 'broken fan.PNG', mimeType: 'image/png', size: 2048 })
  const res = await submit(t, 's001', { attachmentId: 'file1', attachmentName: 'client-lies.exe', attachmentSize: 1, attachmentMime: 'text/html' })
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.complaint.attachment, { name: 'broken fan.PNG', mimeType: 'image/png', size: 2048 })
  const [row] = t.rows()
  assert.deepEqual([row.attachmentId, row.attachmentName, row.attachmentMime, row.attachmentSize], ['file1', 'broken fan.PNG', 'image/png', 2048])
  assert.deepEqual(t.b.files.get('file1').$permissions, ['read("user:s001")', 'read("label:admin")'], 'student can no longer delete or replace the evidence')
})

test('attachment checks: type, size, content, ownership, reuse', async () => {
  const t = await setup()
  const attempt = async (id, file, who = 's001') => {
    if (file) t.b.addFile(id, { ownerId: 's001', ...file })
    t.b.advance(3) // keep clear of the duplicate/rate-limit windows
    const res = await submit(t, who, { attachmentId: id, title: `Complaint with ${id}` })
    return res.body.ok ? 'ok' : res.body.error.fields?.attachment
  }
  assert.equal(await attempt('pdf1', { name: 'proof.pdf', mimeType: 'application/pdf' }), 'ok')
  assert.match(await attempt('exe1', { name: 'virus.exe', mimeType: 'application/x-msdownload' }), /Only JPG, JPEG, PNG, PDF/)
  assert.match(await attempt('fake1', { name: 'virus.pdf', mimeType: 'application/x-msdownload' }), /do not match/, 'renamed executable')
  assert.match(await attempt('fake2', { name: 'page.png', mimeType: 'text/html' }), /do not match/)
  assert.match(await attempt('mismatch', { name: 'photo.png', mimeType: 'application/pdf' }), /do not match/)
  assert.match(await attempt('big1', { name: 'big.png', mimeType: 'image/png', size: RULES.attachment.maxBytes + 1 }), /smaller than 5 MB/)
  assert.match(await attempt('empty1', { name: 'empty.png', mimeType: 'image/png', size: 0 }), /empty/)
  assert.match(await attempt('noext', { name: 'noextension', mimeType: 'image/png' }), /Only/)
  assert.match(await attempt('missing'), /could not be found/)
  assert.match(await attempt('bad/id'), /not valid/)
  // someone else's file (uploaded by s002) cannot be attached by s001
  t.b.addFile('theirs', { ownerId: 's002', name: 'theirs.png', mimeType: 'image/png' })
  assert.match(await attempt('theirs'), /cannot be used/)
  // a file already attached to a complaint (locked) cannot be attached again
  assert.match(await attempt('pdf1'), /cannot be used/)
  assert.equal(t.rows().length, 1, 'only the one valid submission was stored')
  assert.equal(t.b.files.get('exe1').$permissions.length, 3, 'rejected files are not touched')
})

test('a size just at the limit is accepted', async () => {
  const t = await setup()
  t.b.addFile('edge', { ownerId: 's001', name: 'edge.jpg', mimeType: 'image/jpeg', size: RULES.attachment.maxBytes })
  assert.equal((await submit(t, 's001', { attachmentId: 'edge' })).body.ok, true)
})

/* ============================================================== protecting complaint information */

test('privacy: nobody but administrators can read the complaints table directly; students use the function', async () => {
  const t = await setup()
  const a = (await submit(t, 's001')).body.complaint
  const b = (await submit(t, 's002', { title: 'Wi-Fi is down everywhere', categoryId: 'lms-issues' })).body.complaint
  const as = (id, labels = []) => t.dbServices({ id, labels }).complaints

  for (const [who, labels] of [['s001', []], ['s002', []], ['staff-clean', ['department']], ['nobody', []]]) {
    assert.equal((await as(who, labels).list()).total, 0, `${who} sees no rows`)
    assert.equal((await as(who, labels).listByStudent('s001')).total, 0, `${who} cannot list by student`)
    assert.equal(await as(who, labels).get(a.id), null, `${who} cannot open a row`)
  }
  assert.equal((await as('admin1', ['admin']).list()).total, 2)
  assert.equal((await as('admin1', ['admin']).list({ departmentId: 'itsc' })).total, 1)
  assert.equal((await as('admin1', ['admin']).get(b.id)).studentId, 's002')

  // browsers cannot change or delete complaints, nor create them directly
  const raw = (actor, method, args) => t.b.fake.as(actor)[method]({ databaseId: t.b.db, tableId: TABLE_IDS.complaints, ...args })
  const denied = (p) => assert.rejects(p, (e) => e.code === 401)
  await denied(raw({ id: 's001', labels: [] }, 'updateRow', { rowId: a.id, data: { status: 'resolved' } }))
  await denied(raw({ id: 's001', labels: [] }, 'deleteRow', { rowId: a.id }))
  await denied(raw({ id: 'admin1', labels: ['admin'] }, 'updateRow', { rowId: a.id, data: { status: 'resolved' } }))
  const forged = { ...t.rows()[0] }
  for (const k of Object.keys(forged).filter((k) => k.startsWith('$'))) delete forged[k]
  await denied(raw({ id: 's001', labels: [] }, 'createRow', { rowId: 'CMP-20261122-HACKED', data: forged, permissions: ['read("user:s001")'] }))
  assert.equal(t.rows().length, 2)
})

test('complaint.get: owner, admin and the right department staff only; everyone else gets 404', async () => {
  const t = await setup()
  const { id } = (await submit(t, 's001')).body.complaint
  const get = (who) => t.call(who, { action: 'complaint.get', complaintId: id })
  assert.equal((await get('s001')).body.complaint.id, id)
  assert.equal((await get('admin1')).body.complaint.id, id)
  assert.equal((await get('staff-clean')).body.complaint.departmentName, 'Cleaning Department')
  for (const who of ['s002', 'staff-itsc', 'staff-none']) {
    const res = await get(who)
    assert.equal(res.status, 404, who)
    assert.equal(err(res), 'not_found')
  }
  assert.equal((await t.call('s001', { action: 'complaint.get', complaintId: 'CMP-DOES-NOT-EXIST' })).status, 404)
  assert.equal((await t.call('s001', { action: 'complaint.get', complaintId: '../x' })).status, 404)
  assert.equal((await t.call('s001', { action: 'complaint.get' })).status, 404)
})

/* ============================================================== visible to the appropriate department */

test('department staff see exactly the complaints routed to their department(s)', async () => {
  const t = await setup()
  await t.b.addStudent('s003')
  await submit(t, 's001', { categoryId: 'cleaning-issues', title: 'Dirty corridor on floor 2' })
  await submit(t, 's002', { categoryId: 'lms-issues', title: 'LMS will not open quizzes' })
  await submit(t, 's003', { categoryId: 'water-cooler-issues', title: 'Water cooler is empty' })
  const list = (who, extra = {}) => t.call(who, { action: 'department.list', ...extra })

  const clean = await list('staff-clean')
  assert.deepEqual(clean.body.complaints.map((c) => c.title), ['Dirty corridor on floor 2'])
  assert.equal(clean.body.total, 1)
  assert.deepEqual((await list('staff-itsc')).body.complaints.map((c) => c.categoryName), ['LMS Issues'])

  // a staff member with two assignments sees both, newest first
  await t.b.addStaff('staff-two', ['cleaning', 'water-cooler'])
  const two = await list('staff-two')
  assert.deepEqual(two.body.complaints.map((c) => c.title), ['Water cooler is empty', 'Dirty corridor on floor 2'])

  assert.deepEqual((await list('staff-none')).body.complaints, [], 'no assignment, no complaints')
  assert.equal((await list('staff-two', { status: 'resolved' })).body.total, 0)
  assert.equal((await list('staff-two', { status: 'submitted', limit: 1 })).body.complaints.length, 1)
  assert.equal((await list('staff-two', { status: 'submitted', limit: 1, offset: 1 })).body.complaints[0].title, 'Dirty corridor on floor 2')
  assert.equal(err(await list('staff-two', { status: 'weird' })), 'validation_failed')

  for (const who of ['s001', 'admin1']) assert.equal((await list(who)).status, 403, `${who} cannot use the department list`)
})

test('staff assigned to a department only learn of a new complaint through the function, and removal of the assignment hides it again', async () => {
  const t = await setup()
  await submit(t, 's001')
  assert.equal((await t.call('staff-clean', { action: 'department.list' })).body.total, 1)
  const rows = t.b.fake.rows(TABLE_IDS.departmentUsers).filter((r) => r.userId === 'staff-clean')
  await t.b.fake.as('server').deleteRow({ databaseId: t.b.db, tableId: TABLE_IDS.departmentUsers, rowId: rows[0].$id })
  assert.equal((await t.call('staff-clean', { action: 'department.list' })).body.total, 0)
})

test('attachment download: owner, admin and the department only; bytes round-trip', async () => {
  const t = await setup()
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250])
  t.b.addFile('img1', { ownerId: 's001', name: 'fan.png', mimeType: 'image/png', size: bytes.length, bytes })
  const { id } = (await submit(t, 's001', { attachmentId: 'img1' })).body.complaint
  const get = (who) => t.call(who, { action: 'complaint.attachment', complaintId: id })
  for (const who of ['s001', 'admin1', 'staff-clean']) {
    const res = await get(who)
    assert.equal(res.body.ok, true, who)
    assert.deepEqual([res.body.attachment.name, res.body.attachment.mimeType], ['fan.png', 'image/png'])
    assert.deepEqual(Buffer.from(res.body.attachment.base64, 'base64'), bytes)
  }
  for (const who of ['s002', 'staff-itsc']) assert.equal((await get(who)).status, 404, who)
  const { id: plain } = (await submit(t, 's002', { title: 'A complaint without a file' })).body.complaint
  assert.equal((await t.call('s002', { action: 'complaint.attachment', complaintId: plain })).status, 404)
})

/* ============================================================== database service: ordering, paging */

test('complaints service (administrators) lists newest first with paging and status filter', async () => {
  const t = await setup()
  for (let i = 1; i <= 4; i++) {
    t.b.advance(3)
    await submit(t, 's001', { title: `Complaint number ${i}` })
  }
  const mine = t.dbServices({ id: 'admin1', labels: ['admin'] }).complaints
  assert.deepEqual((await mine.listByStudent('s001')).complaints.map((c) => c.title), ['Complaint number 4', 'Complaint number 3', 'Complaint number 2', 'Complaint number 1'])
  const page2 = await mine.listByStudent('s001', { limit: 2, offset: 2 })
  assert.deepEqual([page2.total, ...page2.complaints.map((c) => c.title)], [4, 'Complaint number 2', 'Complaint number 1'])
  assert.equal((await mine.listByStudent('s001', { status: 'closed' })).total, 0)
  assert.equal(typeof mine.create, 'undefined', 'no write methods in the browser service')
  assert.equal(await mine.get('CMP-20261122-NOPE00'), null)
})

/* ============================================================== client wiring */

test('the browser never sends identity, department or status to the function', () => {
  const service = read('../../src/services/complaintService.js')
  const body = service.match(/export async function submitComplaint[\s\S]*?\n\}/)[0]
  assert.ok(/call\('complaint\.submit'/.test(body))
  for (const forbidden of ['studentId', 'departmentId', 'status', 'submittedAt', 'userId']) assert.ok(!body.includes(forbidden), `submitComplaint must not mention ${forbidden}`)
})
