// Phase 10 – department staff dashboard tests. Run: npm run test:phase10
// The REAL complaint-api handler (and, for the "no admin accounts" check, the real profile-api handler) against in-memory
// backends built from database/schema.js. Focus: department isolation, validated updates, and the audit trail.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { COMPLAINT_RULES, ENUMS, TABLE_IDS, TABLES } from '../../database/schema.js'
import { handle, RULES, STATUSES, TRANSITIONS } from '../../functions/complaint-api/src/handler.js'
import { handle as handleProfile } from '../../functions/profile-api/src/handler.js'
import { buildProgress, describeChange } from '../../src/lib/tracking.js'
import { createDatabaseServices } from '../../src/services/db/factory.js'
import { createComplaintBackend } from '../support/fake-complaint-backend.mjs'
import { createFakeBackend } from '../support/fake-backend.mjs'
import { ID, Query } from '../support/fake-tablesdb.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const NOW = '2026-11-22T10:00:00.000Z'
const SECRET = 'INTERNAL-NOTE-NEVER-FOR-STUDENTS'

const BY_CATEGORY = {
  cleaning: ['Dirty washroom on floor 2', 'cleaning-issues', 'The washroom has not been cleaned for days.'],
  itsc: ['LMS quiz will not open', 'lms-issues', 'The quiz page stays blank on every browser.'],
  'water-cooler': ['Water cooler is empty', 'water-cooler-issues', 'There has been no water since Monday.'],
}

async function setup() {
  const b = createComplaintBackend()
  const dbServices = (actor) => createDatabaseServices({ tablesDB: b.fake.as(actor), databaseId: b.db, Query, ID, now: () => NOW })
  await dbServices('server').seedInitialData()
  for (const id of ['s001', 's002', 's003']) await b.addStudent(id)
  await b.addStaff('clean1', ['cleaning'])
  await b.addStaff('clean2', ['cleaning'])
  await b.addStaff('itsc1', ['itsc'])
  await b.addStaff('multi', ['cleaning', 'water-cooler'])
  await b.addStaff('nodept')
  await b.addAdmin('admin1')
  const call = (who, body, opts) => handle(b.request(who, body, opts), b.deps)
  const submit = async (who, department, extra = {}) => {
    const [title, categoryId, description] = BY_CATEGORY[department]
    b.advance(3)
    const res = await call(who, { action: 'complaint.submit', title, categoryId, description, ...extra })
    assert.equal(res.body.ok, true, JSON.stringify(res.body))
    return res.body.complaint
  }
  const update = (who, complaintId, status, remark, expectedStatus) => call(who, { action: 'complaint.updateStatus', complaintId, status, remark, expectedStatus })
  const row = (id) => b.fake.rows(TABLE_IDS.complaints).find((r) => r.$id === id)
  return { b, call, submit, update, row, dbServices }
}
const err = (res) => res.body.error?.code
const ok = (res) => assert.equal(res.body.ok, true, JSON.stringify(res.body))

/* ============================================================== department isolation */

test('ISOLATION: staff list only their own department’s complaints', async () => {
  const t = await setup()
  const clean = await t.submit('s001', 'cleaning')
  const lms = await t.submit('s002', 'itsc')
  const water = await t.submit('s003', 'water-cooler')
  const ids = async (who, extra = {}) => (await t.call(who, { action: 'department.list', ...extra })).body.complaints.map((c) => c.id).sort()
  assert.deepEqual(await ids('clean1'), [clean.id])
  assert.deepEqual(await ids('clean2'), [clean.id], 'colleagues in one department see the same complaints')
  assert.deepEqual(await ids('itsc1'), [lms.id])
  assert.deepEqual(await ids('multi'), [clean.id, water.id].sort(), 'two assignments = two departments, and no others')
  assert.deepEqual(await ids('nodept'), [])
  // search, filters and sorting never widen the scope
  assert.deepEqual(await ids('clean1', { search: 'lms' }), [])
  assert.deepEqual(await ids('clean1', { search: 'quiz' }), [])
  assert.deepEqual(await ids('clean1', { categoryId: 'lms-issues' }), [])
  assert.deepEqual(await ids('clean1', { status: 'submitted', sort: 'oldest', limit: 50 }), [clean.id])
})

test('ISOLATION: a departmentId in the request can only narrow the list, never reach another department', async () => {
  const t = await setup()
  const clean = await t.submit('s001', 'cleaning')
  await t.submit('s002', 'itsc')
  const water = await t.submit('s003', 'water-cooler')
  const list = (who, departmentId) => t.call(who, { action: 'department.list', departmentId })
  const forbidden = await list('clean1', 'itsc')
  assert.equal(forbidden.status, 403)
  assert.equal(err(forbidden), 'forbidden')
  assert.deepEqual((await list('multi', 'water-cooler')).body.complaints.map((c) => c.id), [water.id])
  assert.deepEqual((await list('multi', 'cleaning')).body.complaints.map((c) => c.id), [clean.id])
  assert.equal(err(await list('clean1', '../x')), 'validation_failed')
  assert.equal((await list('nodept', 'itsc')).status, 403)
})

test('ISOLATION: details, attachments, status updates, remarks and notes of another department are 404', async () => {
  const t = await setup()
  t.b.addFile('f1', { ownerId: 's002', name: 'quiz.png', mimeType: 'image/png', size: 100 })
  const lms = await t.submit('s002', 'itsc', { attachmentId: 'f1' })
  const attempts = {
    get: { action: 'complaint.get', complaintId: lms.id },
    attachment: { action: 'complaint.attachment', complaintId: lms.id },
    status: { action: 'complaint.updateStatus', complaintId: lms.id, status: 'under_review', expectedStatus: 'submitted' },
    remark: { action: 'complaint.addRemark', complaintId: lms.id, remark: 'Hello from the wrong department' },
    note: { action: 'complaint.addNote', complaintId: lms.id, note: 'A note from the wrong department' },
  }
  for (const who of ['clean1', 'multi', 'nodept']) {
    for (const [name, body] of Object.entries(attempts)) {
      const res = await t.call(who, body)
      assert.equal(res.status, 404, `${who} ${name}`)
      assert.equal(err(res), 'not_found')
    }
  }
  assert.equal(t.row(lms.id).status, 'submitted', 'nothing changed')
  assert.equal(t.b.fake.rows(TABLE_IDS.complaintNotes).length, 0)
  assert.equal(t.b.fake.rows(TABLE_IDS.complaintHistory).filter((h) => h.complaintId === lms.id).length, 1, 'only the original "submitted" entry')
  // the right department can do all of them
  assert.equal((await t.call('itsc1', attempts.get)).body.ok, true)
  assert.equal((await t.call('itsc1', attempts.attachment)).body.ok, true)
})

test('ISOLATION: the department is never taken from the request on updates', async () => {
  const t = await setup()
  const lms = await t.submit('s002', 'itsc')
  const res = await t.call('clean1', { action: 'complaint.updateStatus', complaintId: lms.id, status: 'under_review', expectedStatus: 'submitted', departmentId: 'itsc', departmentIds: ['itsc'], actorId: 'itsc1', role: 'admin' })
  assert.equal(res.status, 404)
  const stats = await t.call('clean1', { action: 'department.stats', departmentId: 'itsc' })
  assert.equal(stats.body.stats.total, 0)
})

test('ISOLATION: students and administrators cannot use the staff actions; guests are refused', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  const bodies = [
    { action: 'department.list' },
    { action: 'department.stats' },
    { action: 'complaint.updateStatus', complaintId: c.id, status: 'under_review', expectedStatus: 'submitted' },
    { action: 'complaint.addRemark', complaintId: c.id, remark: 'Some remark' },
    { action: 'complaint.addNote', complaintId: c.id, note: 'Some note' },
  ]
  for (const who of ['s001', 's002', 'admin1']) {
    for (const body of bodies) assert.equal((await t.call(who, body)).status, 403, `${who} ${body.action}`)
  }
  for (const body of bodies) assert.equal((await t.call('clean1', body, { jwt: 'jwt-s001' })).status, 401, 'wrong token')
  assert.equal(t.row(c.id).status, 'submitted')
  t.b.accounts.get('clean1').status = false
  assert.equal(err(await t.call('clean1', bodies[0])), 'account_disabled', 'a disabled staff account is locked out')
})

test('ISOLATION at the database: staff cannot read complaint, history or notes tables directly', async () => {
  const t = await setup()
  await t.submit('s001', 'cleaning')
  const staff = { id: 'clean1', labels: ['department'] }
  for (const tableId of [TABLE_IDS.complaints, TABLE_IDS.complaintHistory, TABLE_IDS.complaintNotes]) {
    const rows = await t.b.fake.as(staff).listRows({ databaseId: t.b.db, tableId }).then((r) => r.rows, () => [])
    assert.equal(rows.length, 0, tableId)
    await assert.rejects(t.b.fake.as(staff).createRow({ databaseId: t.b.db, tableId, rowId: 'x1', data: {} }), (e) => e.code === 401)
  }
  const id = t.b.fake.rows(TABLE_IDS.complaints)[0].$id
  await assert.rejects(t.b.fake.as(staff).updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaints, rowId: id, data: { status: 'closed' } }), (e) => e.code === 401)
})

/* ============================================================== dashboard statistics */

test('dashboard statistics: total, new, under review, in progress, resolved, closed – for the staff member’s departments only', async () => {
  const t = await setup()
  const c = []
  for (let i = 0; i < 6; i++) c.push(await t.submit(`s00${(i % 3) + 1}`, 'cleaning', { title: `Cleaning complaint number ${i}` }))
  const other = await t.submit('s002', 'itsc')
  await t.submit('s003', 'water-cooler')
  await t.update('clean1', c[0].id, 'under_review', '', 'submitted')
  await t.update('clean1', c[1].id, 'in_progress', '', 'submitted')
  await t.update('clean1', c[2].id, 'resolved', 'Fixed it', 'submitted').then((r) => assert.equal(r.status, 409, 'submitted cannot jump to resolved'))
  await t.update('clean1', c[2].id, 'under_review', '', 'submitted')
  await t.update('clean1', c[2].id, 'resolved', 'Cleaned and checked', 'under_review')
  await t.update('clean1', c[3].id, 'closed', '', 'submitted')
  const stats = (who) => t.call(who, { action: 'department.stats' }).then((r) => r.body)
  const clean = await stats('clean1')
  assert.deepEqual(clean.stats, { total: 6, submitted: 2, under_review: 1, in_progress: 1, resolved: 1, closed: 1 })
  assert.deepEqual(clean.departments, [{ id: 'cleaning', name: 'Cleaning Department' }])
  assert.deepEqual((await stats('clean2')).stats, clean.stats, 'same department, same numbers')
  assert.deepEqual((await stats('itsc1')).stats, { total: 1, submitted: 1, under_review: 0, in_progress: 0, resolved: 0, closed: 0 })
  const multi = await stats('multi')
  assert.equal(multi.stats.total, 7)
  assert.deepEqual(multi.departments.map((d) => d.name).sort(), ['Cleaning Department', 'Water Cooler Maintenance'])
  assert.deepEqual((await stats('nodept')).stats, { total: 0, submitted: 0, under_review: 0, in_progress: 0, resolved: 0, closed: 0 })
  assert.deepEqual((await stats('nodept')).departments, [])
  // the buckets add up
  const s = clean.stats
  assert.equal(s.submitted + s.under_review + s.in_progress + s.resolved + s.closed, s.total)
  assert.equal(other.status, 'submitted')
})

/* ============================================================== list: search, filter, sort, paging */

test('staff list: search (ID, title, student, roll number, details), status filter, sorting and paging', async () => {
  const t = await setup()
  const titles = ['Broken ceiling fan', 'Blocked drain outside canteen', 'Dusty library shelves', 'Smelly washroom', 'Overflowing bins', 'Slippery floor near stairs', 'Cracked window in lab', 'Missing soap dispensers', 'Dirty cafeteria tables', 'Weeds in the courtyard', 'Paint peeling in hall', 'Chairs stacked in corridor']
  const made = []
  for (const [i, title] of titles.entries()) made.push(await t.submit(`s00${(i % 3) + 1}`, 'cleaning', { title, description: `Details about ${title.toLowerCase()} are described here.` }))
  await t.update('clean1', made[0].id, 'under_review', '', 'submitted')
  const list = (extra) => t.call('clean1', { action: 'department.list', ...extra })
  const names = (res) => res.body.complaints.map((c) => c.title)

  assert.equal((await list({ limit: 50 })).body.total, 12)
  assert.deepEqual(names(await list({ search: 'DRAIN' })), ['Blocked drain outside canteen'])
  assert.deepEqual(names(await list({ search: made[3].reference.toLowerCase() })), ['Smelly washroom'], 'by complaint ID')
  assert.equal((await list({ search: 'User s002', limit: 50 })).body.total, 4, 'by student name')
  assert.equal((await list({ search: '22SW-s003', limit: 50 })).body.total, 4, 'by roll number')
  assert.deepEqual(names(await list({ search: 'fan broken' })), ['Broken ceiling fan'], 'words may appear in any order')
  assert.deepEqual(names(await list({ search: 'broken drain' })), [], 'every word must match')
  assert.deepEqual(names(await list({ search: 'broken ceiling' })), ['Broken ceiling fan'])
  assert.deepEqual(names(await list({ search: 'smelly' , status: 'under_review' })), [], 'search + status')
  assert.deepEqual(names(await list({ status: 'under_review' })), ['Broken ceiling fan'])
  assert.equal((await list({ status: 'submitted', limit: 50 })).body.total, 11)
  assert.equal((await list({ search: '.*' })).body.total, 0, 'plain text, not a pattern')
  assert.equal(err(await list({ status: 'bogus' })), 'validation_failed')
  assert.equal(err(await list({ search: 'x'.repeat(101) })), 'validation_failed')
  assert.equal(err(await list({ sort: 'size' })), 'validation_failed')

  const newest = names(await list({ limit: 50 }))
  assert.equal(newest[0], 'Chairs stacked in corridor')
  assert.deepEqual(names(await list({ sort: 'oldest', limit: 50 })), [...newest].reverse())
  const p = [await list({ limit: 5 }), await list({ limit: 5, offset: 5 }), await list({ limit: 5, offset: 10 })]
  assert.deepEqual(p.flatMap(names), newest)
  assert.deepEqual(p.map((x) => x.body.total), [12, 12, 12])
  // searched results page the same way
  const s1 = await list({ search: 'in', limit: 3, offset: 0 })
  const s2 = await list({ search: 'in', limit: 3, offset: 3 })
  assert.ok(s1.body.total >= 6)
  assert.equal(new Set([...names(s1), ...names(s2)]).size, 6, 'no overlap between searched pages')
  assert.equal(s1.body.truncated, false)
})

/* ============================================================== viewing details & history */

test('staff see full details, the history with WHO changed what, and the internal notes', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning', { location: 'Floor 2' })
  t.b.advance(5)
  ok(await t.update('clean1', c.id, 'under_review', 'We are on it.', 'submitted'))
  const res = await t.call('clean2', { action: 'complaint.get', complaintId: c.id })
  const d = res.body
  assert.deepEqual([d.complaint.studentName, d.complaint.studentRollNumber, d.complaint.location, d.complaint.status], ['User s001', '22SW-s001', 'Floor 2', 'under_review'])
  assert.deepEqual(d.history.map((h) => [h.type, h.status, h.by, h.actorName]), [['status', 'submitted', 'System', 'System'], ['status', 'under_review', 'Department', 'User clean1']])
  assert.equal(d.history[1].remark, 'We are on it.')
  assert.deepEqual(d.notes, [])
  for (const h of d.history) assert.equal('actorId' in h, false, 'staff IDs are never sent, only names')
})

/* ============================================================== updating status */

test('UPDATE: valid transitions only; the full workflow Submitted → Under Review → In Progress → Resolved → Closed', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  const steps = [['under_review', ''], ['in_progress', ''], ['resolved', 'Washroom cleaned and inspected.'], ['closed', '']]
  let current = 'submitted'
  for (const [status, remark] of steps) {
    t.b.advance(5)
    const res = await t.update('clean1', c.id, status, remark, current)
    ok(res)
    assert.equal(res.body.complaint.status, status)
    current = status
  }
  assert.equal(t.row(c.id).status, 'closed')
  assert.ok(t.row(c.id).resolvedAt)
  const detail = (await t.call('clean1', { action: 'complaint.get', complaintId: c.id })).body
  assert.deepEqual(detail.history.map((h) => h.status), ['submitted', 'under_review', 'in_progress', 'resolved', 'closed'])
})

test('UPDATE: transitions outside the workflow are refused (every pair checked) and closed is final', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      await t.b.fake.as('server').updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaints, rowId: c.id, data: { status: from } })
      const res = await t.update('clean1', c.id, to, 'Remark long enough to resolve', from)
      const allowed = TRANSITIONS[from].includes(to)
      assert.equal(res.body.ok === true, allowed, `${from} -> ${to}`)
      if (!allowed) assert.equal(err(res), 'invalid_transition', `${from} -> ${to}`)
    }
  }
  await t.b.fake.as('server').updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaints, rowId: c.id, data: { status: 'closed' } })
  assert.equal(err(await t.update('clean1', c.id, 'in_progress', 'Reopen please', 'closed')), 'invalid_transition')
})

test('UPDATE: marking resolved needs a remark; remark is cleaned and limited; bad input is refused', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  await t.update('clean1', c.id, 'under_review', '', 'submitted')
  for (const remark of [undefined, '', '   ', 'ok', 'abcd']) {
    const res = await t.update('clean1', c.id, 'resolved', remark, 'under_review')
    assert.equal(err(res), 'validation_failed', JSON.stringify(remark))
    assert.ok(res.body.error.fields.remark)
  }
  assert.equal(t.row(c.id).status, 'under_review')
  assert.equal(err(await t.update('clean1', c.id, 'resolved', 'x'.repeat(RULES.remark.max + 1), 'under_review')), 'validation_failed')
  assert.equal(err(await t.update('clean1', c.id, 'resolved', { a: 1 }, 'under_review')), 'validation_failed')
  assert.equal(err(await t.update('clean1', c.id, 'finished', 'Remark', 'under_review')), 'validation_failed')
  assert.equal(err(await t.update('clean1', c.id, 'resolved', 'Remark long enough', 'nonsense')), 'validation_failed')
  assert.equal(err(await t.update('clean1', c.id, 'resolved', 'Remark long enough', undefined)), 'validation_failed', 'the status the user saw is required')
  const good = await t.update('clean1', c.id, 'resolved', ' Cleaned\u0000 and   checked. ', 'under_review')
  ok(good)
  assert.equal(good.body.history.at(-1).remark, 'Cleaned and   checked.', 'trimmed, control characters removed, inner spacing kept')
})

test('UPDATE: a stale screen cannot overwrite a colleague’s change', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  ok(await t.update('clean1', c.id, 'under_review', '', 'submitted'))
  const stale = await t.update('clean2', c.id, 'in_progress', '', 'submitted') // clean2 still looked at "submitted"
  assert.equal(stale.status, 409)
  assert.equal(err(stale), 'stale_status')
  assert.equal(t.row(c.id).status, 'under_review')
  ok(await t.update('clean2', c.id, 'in_progress', '', 'under_review'))
})

test('UPDATE: forged fields are ignored (who, when, student, department, history)', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  const res = await t.call('clean1', {
    action: 'complaint.updateStatus', complaintId: c.id, status: 'under_review', expectedStatus: 'submitted', remark: 'Starting.',
    actorId: 'admin1', actorName: 'The Dean', actorRole: 'admin', changedAt: '2001-01-01T00:00:00.000Z', studentId: 's002', departmentId: 'itsc', lastUpdatedBy: 'admin1', priority: 'high',
  })
  ok(res)
  const row = t.row(c.id)
  assert.deepEqual([row.studentId, row.departmentId, row.priority, row.lastUpdatedBy, row.lastUpdatedByName], ['s001', 'cleaning', 'medium', 'clean1', 'User clean1'])
  const entry = t.b.fake.rows(TABLE_IDS.complaintHistory).find((h) => h.status === 'under_review')
  assert.deepEqual([entry.actorId, entry.actorName, entry.actorRole], ['clean1', 'User clean1', 'department'])
  assert.notEqual(entry.changedAt, '2001-01-01T00:00:00.000Z')
})

test('AUDIT: who updated and when is recorded on the history entry and on the complaint', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  t.b.advance(60)
  const before = Date.now()
  ok(await t.update('clean1', c.id, 'under_review', 'Reviewing.', 'submitted'))
  t.b.advance(10)
  ok(await t.update('clean2', c.id, 'in_progress', '', 'under_review'))
  const entries = t.b.fake.rows(TABLE_IDS.complaintHistory).filter((h) => h.complaintId === c.id)
  assert.deepEqual(entries.map((h) => [h.status, h.previousStatus, h.actorId, h.actorName, h.actorRole, h.kind]), [
    ['submitted', null, null, null, 'system', 'status'],
    ['under_review', 'submitted', 'clean1', 'User clean1', 'department', 'status'],
    ['in_progress', 'under_review', 'clean2', 'User clean2', 'department', 'status'],
  ])
  assert.equal(entries[1].changedAt, '2026-11-22T11:03:00.000Z', 'time is the server clock (10:00 + 3 min submit + 60 min)')
  assert.ok(Date.now() >= before)
  assert.ok(new Date(entries[2].changedAt) > new Date(entries[1].changedAt))
  const row = t.row(c.id)
  assert.deepEqual([row.lastUpdatedBy, row.lastUpdatedByName, row.lastUpdatedAt], ['clean2', 'User clean2', entries[2].changedAt])
  assert.deepEqual(entries[1].$permissions, ['read("label:admin")'])
  // the audit fields never reach the student
  const student = JSON.stringify((await t.call('s001', { action: 'complaint.get', complaintId: c.id })).body)
  for (const leaked of ['clean1', 'clean2', 'User clean', 'lastUpdated', 'actorName', 'actorId']) assert.ok(!student.includes(leaked), leaked)
})

test('UPDATE: the student is notified (status, resolution, remark) and nobody else', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  await t.update('clean1', c.id, 'under_review', 'Reviewing.', 'submitted')
  await t.update('clean1', c.id, 'in_progress', '', 'under_review')
  await t.update('clean1', c.id, 'resolved', 'All done and checked.', 'in_progress')
  const mine = t.b.fake.rows(TABLE_IDS.notifications).filter((n) => n.userId === 's001' && n.type !== 'complaint_submitted')
  assert.deepEqual(mine.map((n) => [n.userId, n.type]), [['s001', 'status_changed'], ['s001', 'complaint_in_progress'], ['s001', 'complaint_resolved']])
  assert.match(mine[2].message, /resolved.*All done and checked\./)
  assert.ok(mine.every((n) => n.$permissions.join() === 'read("user:s001")'))
  // a failing notification never blocks the update
  t.b.deps.notifications.create = async () => { throw new Error('down') }
  ok(await t.update('clean1', c.id, 'closed', '', 'resolved'))
  assert.equal(t.row(c.id).status, 'closed')
})

test('UPDATE: if the history entry cannot be written, the status change is undone', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  const before = { ...t.row(c.id) }
  t.b.failHistory.on = true
  const res = await t.update('clean1', c.id, 'under_review', 'x', 'submitted')
  t.b.failHistory.on = false
  assert.equal(res.status, 500)
  const after = t.row(c.id)
  assert.deepEqual([after.status, after.lastUpdatedBy, after.lastUpdatedAt], [before.status, null, null])
  assert.ok(!JSON.stringify(res.body).includes('history down'), 'internal errors are not shown')
})

/* ============================================================== remarks and notes */

test('REMARKS: a public remark is added to the timeline, visible to the student, without changing the status', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  ok(await t.update('clean1', c.id, 'under_review', '', 'submitted'))
  t.b.advance(5)
  const res = await t.call('clean2', { action: 'complaint.addRemark', complaintId: c.id, remark: '  We have ordered the parts.  ' })
  ok(res)
  assert.equal(res.body.complaint.status, 'under_review')
  const last = res.body.history.at(-1)
  assert.deepEqual([last.type, last.status, last.remark, last.actorName], ['remark', 'under_review', 'We have ordered the parts.', 'User clean2'])
  assert.equal(t.row(c.id).lastUpdatedBy, 'clean2')
  const student = (await t.call('s001', { action: 'complaint.get', complaintId: c.id })).body
  assert.equal(student.history.at(-1).remark, 'We have ordered the parts.')
  assert.equal(student.history.at(-1).type, 'remark')
  assert.equal(student.complaint.status, 'under_review')
  assert.ok(t.b.fake.rows(TABLE_IDS.notifications).some((n) => n.title === 'New remark on your complaint' && n.userId === 's001'))
  // validation
  for (const remark of [undefined, '', '   ', '!!', 'x'.repeat(1001), { a: 1 }]) assert.equal(err(await t.call('clean1', { action: 'complaint.addRemark', complaintId: c.id, remark })), 'validation_failed', JSON.stringify(remark))
  // closed complaints take no more remarks
  await t.b.fake.as('server').updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaints, rowId: c.id, data: { status: 'closed' } })
  assert.equal(err(await t.call('clean1', { action: 'complaint.addRemark', complaintId: c.id, remark: 'One more thing' })), 'complaint_closed')
})

test('NOTES: internal notes are saved for staff and admins and can never reach the student', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning')
  const res = await t.call('clean1', { action: 'complaint.addNote', complaintId: c.id, note: `Caretaker says: ${SECRET}` })
  ok(res)
  assert.deepEqual(res.body.notes.map((n) => [n.note, n.authorName]), [[`Caretaker says: ${SECRET}`, 'User clean1']])
  assert.equal('authorId' in res.body.notes[0], false)
  const stored = t.b.fake.rows(TABLE_IDS.complaintNotes)[0]
  assert.deepEqual([stored.complaintId, stored.authorId, stored.$permissions], [c.id, 'clean1', ['read("label:admin")']])
  // colleagues and admins see it
  assert.equal((await t.call('clean2', { action: 'complaint.get', complaintId: c.id })).body.notes.length, 1)
  assert.equal((await t.call('admin1', { action: 'complaint.get', complaintId: c.id })).body.notes.length, 1)
  // another department does not
  assert.equal((await t.call('itsc1', { action: 'complaint.get', complaintId: c.id })).status, 404)
  // the student, in every response they can get, sees nothing of it
  const responses = [
    await t.call('s001', { action: 'complaint.get', complaintId: c.id }),
    await t.call('s001', { action: 'complaint.listMine', limit: 50 }),
    await t.call('s001', { action: 'complaint.listMine', search: 'caretaker' }),
    await t.call('s001', { action: 'complaint.listMine', search: SECRET }),
  ]
  assert.equal(responses[3].body.total, 0, 'searching for the note text finds nothing')
  assert.deepEqual(responses[0].body.notes, undefined)
  for (const r of responses) assert.ok(!JSON.stringify(r.body).includes(SECRET))
  const notices = t.b.fake.rows(TABLE_IDS.notifications).map((n) => n.message).join(' ')
  assert.ok(!notices.includes(SECRET), 'no notification carries it')
  assert.equal(t.row(c.id).status, 'submitted', 'a note changes nothing about the complaint')
  for (const note of [undefined, '', '  ', '..', 'x'.repeat(2001), { a: 1 }]) assert.equal(err(await t.call('clean1', { action: 'complaint.addNote', complaintId: c.id, note })), 'validation_failed', JSON.stringify(note))
  // notes can still be added to a closed complaint
  await t.b.fake.as('server').updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaints, rowId: c.id, data: { status: 'closed' } })
  ok(await t.call('clean1', { action: 'complaint.addNote', complaintId: c.id, note: 'Closed after follow-up call.' }))
})

/* ============================================================== staff cannot create administrators */

test('staff cannot create administrators or change roles (profile-api)', async () => {
  const p = createFakeBackend()
  p.addAccount({ id: 'admin1', labels: ['admin'], name: 'Admin One', email: 'admin1@test.edu' })
  p.addAccount({ id: 'staff1', labels: ['department'], name: 'Staff One', email: 'staff1@test.edu' })
  p.addAccount({ id: 'stu1', name: 'Student One', email: 'stu1@test.edu' })
  const call = async (who, body) => handleProfile(p.requestAs(who, body), p.deps)
  for (const body of [
    { action: 'admin.setRole', userId: 'stu1', role: 'admin' },
    { action: 'admin.setRole', userId: 'staff1', role: 'admin' },
    { action: 'admin.setRole', userId: 'stu1', role: 'department' },
    { action: 'admin.updateAccount', userId: 'stu1', status: 'disabled' },
    { action: 'admin.list' },
    { action: 'admin.syncProfiles' },
    { action: 'admin.get', userId: 'admin1' },
  ]) {
    const res = await call('staff1', body)
    assert.equal(res.status, 403, body.action + (body.role ?? ''))
  }
  assert.deepEqual(p.accounts.get('staff1').labels, ['department'])
  assert.deepEqual(p.accounts.get('stu1').labels, [])
  // trying to give yourself a role through the profile update is refused outright
  const forged = await call('staff1', { action: 'updateMe', name: 'Staff Renamed', role: 'admin', labels: ['admin'] })
  assert.equal(forged.status, 403)
  assert.equal(forged.body.error.code, 'role_change_forbidden')
  assert.deepEqual(p.accounts.get('staff1').labels, ['department'])
  // a normal profile update works and leaves the role alone
  const me = await call('staff1', { action: 'updateMe', name: 'Staff Renamed' })
  assert.equal(me.status, 200)
  assert.equal(me.body.profile.role, 'department')
  // and the complaint function has no account-management action at all
  const t = await setup()
  for (const action of ['admin.setRole', 'role.set', 'user.create', 'admin.createUser']) assert.equal((await t.call('clean1', { action })).status, 400)
  assert.ok(!/setLabels|updateLabels|users\.create|createUser/.test(read('../../functions/complaint-api/src/handler.js')), 'the complaint function never touches accounts')
})

/* ============================================================== shared rules & wiring */

test('rules shared by function, schema and browser stay identical', () => {
  assert.deepEqual(RULES, JSON.parse(JSON.stringify(COMPLAINT_RULES)))
  assert.equal(RULES.resolveRemarkMin, 5)
  assert.deepEqual(ENUMS.historyKind, ['status', 'remark'])
  for (const column of ['lastUpdatedBy', 'lastUpdatedByName', 'lastUpdatedAt']) assert.ok(TABLES.complaints.columns.some((c) => c.key === column), column)
  for (const column of ['kind', 'actorName', 'actorId']) assert.ok(TABLES.complaintHistory.columns.some((c) => c.key === column), column)
  assert.ok(TABLES.complaintNotes.columns.some((c) => c.key === 'authorName'))
})

test('tracking helpers: remark-only entries do not move step dates', () => {
  const history = [
    { type: 'status', status: 'submitted', at: '2026-11-01T00:00:00.000Z' },
    { type: 'status', status: 'under_review', at: '2026-11-02T00:00:00.000Z' },
    { type: 'remark', status: 'under_review', at: '2026-11-05T00:00:00.000Z' },
  ]
  assert.equal(buildProgress('under_review', history)[1].at, '2026-11-02T00:00:00.000Z')
  assert.equal(describeChange({ type: 'remark', status: 'under_review', previousStatus: 'under_review' }), 'Remark added')
})

test('the dashboard and management screens are wired to the server and offer every feature', () => {
  const service = read('../../src/services/complaintService.js')
  for (const action of ['department.stats', 'department.list', 'complaint.updateStatus', 'complaint.addRemark', 'complaint.addNote']) assert.ok(service.includes(`'${action}'`), action)
  const dash = read('../../src/pages/department/DepartmentDashboardPage.jsx')
  for (const label of ['Total complaints', 'New', 'Under review', 'In progress', 'Resolved', 'Closed', 'Loading your dashboard', 'not assigned to a department']) assert.ok(dash.includes(label), label)
  assert.ok(!/services\/db/.test(dash), 'staff never query the database directly')
  const list = read('../../src/pages/department/DepartmentComplaintsPage.jsx')
  for (const label of ['Search complaints', 'Filter by status', 'Sort by date', 'Clear filters', 'No complaints match', 'Pager']) assert.ok(list.includes(label), label)
  const panel = read('../../src/components/complaints/ComplaintStaffPanel.jsx')
  for (const label of ['Update status', 'Mark as resolved', 'Internal notes', 'Add a remark', 'expectedStatus: complaint.status', 'TRANSITIONS']) assert.ok(panel.includes(label), label)
  for (const forbidden of ['departmentId', 'actorId', 'userId', 'role']) assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(panel.replace(/<[^>]*>/g, '')), `panel must not send ${forbidden}`)
  const routes = read('../../src/routes/AppRoutes.jsx')
  assert.ok(routes.includes('DepartmentDashboardPage') && routes.includes('canManage'))
  assert.ok(!/canManage/.test(routes.split('ProtectedRoute allowedRoles={[ROLES.STUDENT]}')[1].split('ProtectedRoute allowedRoles={[ROLES.DEPARTMENT]}')[0]), 'students never get the management panel')
})
