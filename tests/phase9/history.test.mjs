// Phase 9 – complaint history and tracking tests. Run: npm run test:phase9
// Same approach as Phase 8: the REAL complaint-api handler against an in-memory backend built from database/schema.js.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { lockComplaintRows } from '../../database/lock-complaints.js'
import { ENUMS, TABLE_IDS, TABLES } from '../../database/schema.js'
import { buildTimeline, handle, recordStatusChange, STATUSES, TRANSITIONS as SERVER_TRANSITIONS } from '../../functions/complaint-api/src/handler.js'
import { buildProgress, describeChange, STATUS_FLOW, TRANSITIONS as CLIENT_TRANSITIONS } from '../../src/lib/tracking.js'
import { createDatabaseServices } from '../../src/services/db/factory.js'
import { createComplaintBackend } from '../support/fake-complaint-backend.mjs'
import { ID, Query } from '../support/fake-tablesdb.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const NOW = '2026-11-22T10:00:00.000Z'
const SECRET = 'INTERNAL-ONLY-DO-NOT-SHOW'

const COMPLAINTS = [
  ['Projector not working in Room 12', 'computer-problems', 'The projector shows no signal during lectures.'],
  ['LMS quiz will not open', 'lms-issues', 'The quiz page stays blank on every browser.'],
  ['Water cooler is empty near library', 'water-cooler-issues', 'There has been no water since Monday.'],
  ['Dirty washroom on floor 2', 'cleaning-issues', 'The washroom has not been cleaned for days.'],
  ['Clerk office closed during hours', 'clerk-related-issues', 'The office was locked at noon on a working day.'],
  ['Lecturer arrives late every day', 'teacher-related-complaints', 'Classes start twenty minutes late every day.'],
  ['Hostel NOC delayed', 'student-affairs', 'My NOC request is pending for a month.'],
  ['LMS grades missing', 'lms-issues', 'Midterm grades are not visible in the LMS.'],
  ['Lab computer 14 keeps freezing', 'computer-problems', 'The computer freezes while compiling code.'],
  ['Corridor lights flicker', 'cleaning-issues', 'The corridor lights flicker all evening.'],
  ['Wi-Fi drops in the cafeteria', 'lms-issues', 'We cannot reach the LMS from the cafeteria.'],
  ['Broken chair in Room 3', 'cleaning-issues', 'Several chairs in room 3 are broken.'],
]

async function setup({ populate = false } = {}) {
  const b = createComplaintBackend()
  const dbServices = (actor) => createDatabaseServices({ tablesDB: b.fake.as(actor), databaseId: b.db, Query, ID, now: () => NOW })
  await dbServices('server').seedInitialData()
  await b.addStudent('s001')
  await b.addStudent('s002')
  await b.addStaff('staff-clean', ['cleaning'])
  await b.addStaff('staff-lms', ['itsc'])
  await b.addAdmin('admin1')
  const call = (userId, body, opts) => handle(b.request(userId, body, opts), b.deps)
  const submit = async (who, [title, categoryId, description], extra = {}) => {
    b.advance(3)
    const res = await call(who, { action: 'complaint.submit', title, categoryId, description, ...extra })
    assert.equal(res.body.ok, true, JSON.stringify(res.body))
    return res.body.complaint
  }
  const t = { b, call, dbServices, submit, ids: [] }
  if (populate) for (const c of COMPLAINTS) t.ids.push((await submit('s001', c)).id)
  return t
}
const list = (t, who, params = {}) => t.call(who, { action: 'complaint.listMine', ...params })
const titles = (res) => res.body.complaints.map((c) => c.title)
const err = (res) => res.body.error?.code
const staffActor = { role: 'department', id: 'staff-clean' }
const move = (t, id, status, remark) => recordStatusChange(t.b.deps, { complaintId: id, status, remark, actor: staffActor })
const forceStatus = (t, id, status) => t.b.fake.as('server').updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaints, rowId: id, data: { status } })

/* ============================================================== structure & privacy by design */

test('history and notes tables exist; students and staff cannot read or write them directly', async () => {
  const t = await setup()
  const c = await t.submit('s001', COMPLAINTS[0])
  await t.b.fake.as('server').createRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaintNotes, rowId: 'n1', data: { complaintId: c.id, authorId: 'staff-clean', note: SECRET, createdAt: NOW } })
  for (const tableId of [TABLE_IDS.complaintHistory, TABLE_IDS.complaintNotes]) {
    for (const actor of [{ id: 's001', labels: [] }, { id: 'staff-clean', labels: ['department'] }, null]) {
      const rows = await t.b.fake.as(actor).listRows({ databaseId: t.b.db, tableId }).then((r) => r.rows, () => [])
      assert.equal(rows.length, 0, `${tableId} must show nothing to ${actor?.id ?? 'guests'}`)
      await assert.rejects(t.b.fake.as(actor).createRow({ databaseId: t.b.db, tableId, rowId: 'x1', data: {} }), (e) => e.code === 401)
    }
    assert.ok((await t.b.fake.as({ id: 'admin1', labels: ['admin'] }).listRows({ databaseId: t.b.db, tableId })).total >= 1)
  }
  assert.deepEqual(ENUMS.actorRole, ['system', 'department', 'admin'])
  assert.deepEqual(TABLES.complaintHistory.columns.map((c) => c.key), ['complaintId', 'status', 'previousStatus', 'kind', 'remark', 'actorRole', 'actorId', 'actorName', 'changedAt'])
  assert.ok(!TABLES.complaintHistory.columns.some((c) => /note/i.test(c.key)), 'no internal note field in the student-visible history')
})

test('submitting writes the first history entry; rows are admin-read only', async () => {
  const t = await setup()
  const c = await t.submit('s001', COMPLAINTS[0])
  const [entry] = t.b.fake.rows(TABLE_IDS.complaintHistory)
  assert.deepEqual([entry.complaintId, entry.status, entry.previousStatus, entry.actorRole, entry.actorId], [c.id, 'submitted', null, 'system', null])
  assert.equal(entry.changedAt, c.submittedAt)
  assert.deepEqual(entry.$permissions, ['read("label:admin")'])
})

/* ============================================================== listing: ownership & field whitelist */

test('history list: ID, title, category, department, date and status; only my own complaints', async () => {
  const t = await setup({ populate: true })
  await t.submit('s002', ['Zebra crossing paint faded', 'cleaning-issues', 'The paint at the main gate crossing has faded.'])
  const mine = await list(t, 's001', { limit: 50 })
  assert.equal(mine.body.total, 12)
  assert.ok(mine.body.complaints.every((c) => c.title !== 'Zebra crossing paint faded'))
  const first = mine.body.complaints[0]
  assert.match(first.reference, /^CMP-20261122-/)
  assert.deepEqual([first.title, first.categoryName, first.departmentName, first.status], ['Broken chair in Room 3', 'Cleaning Issues', 'Cleaning Department', 'submitted'])
  assert.ok(first.submittedAt)
  const other = await list(t, 's002')
  assert.deepEqual(titles(other), ['Zebra crossing paint faded'])
  assert.equal(other.body.filters.overallTotal, 1)
})

test('students only receive whitelisted fields: no priority, staff IDs, student IDs or internal data', async () => {
  const t = await setup()
  const c = await t.submit('s001', COMPLAINTS[0])
  await t.b.fake.as('server').updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaints, rowId: c.id, data: { assignedTo: 'staff-clean', resolutionNote: SECRET, priority: 'high' } })
  await t.b.fake.as('server').createRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaintNotes, rowId: 'n1', data: { complaintId: c.id, authorId: 'staff-clean', note: SECRET, createdAt: NOW } })
  await move(t, c.id, 'under_review', 'We have started reviewing it.')

  const keys = ['attachment', 'categoryId', 'categoryName', 'departmentId', 'departmentName', 'description', 'id', 'location', 'reference', 'status', 'submittedAt', 'title']
  const l = await list(t, 's001')
  assert.deepEqual(Object.keys(l.body.complaints[0]).sort(), keys)
  const g = await t.call('s001', { action: 'complaint.get', complaintId: c.id })
  assert.deepEqual(Object.keys(g.body.complaint).sort(), keys)
  assert.deepEqual(Object.keys(g.body.history[0]).sort(), ['at', 'by', 'previousStatus', 'remark', 'status', 'type'])

  const everything = JSON.stringify([l.body, g.body])
  for (const leaked of [SECRET, 'priority', 'assignedTo', 'staff-clean', 'actorId', 'actorName', 'lastUpdated', 'actorRole', 'studentId', 'resolutionNote', 'internal', 'rollNumber', '22SW']) {
    assert.ok(!everything.includes(leaked), `a student response must not contain "${leaked}"`)
  }
  // the notification the student receives also carries only the public remark
  const notes = t.b.fake.rows(TABLE_IDS.notifications).filter((n) => n.userId === 's001').map((n) => n.message).join(' ')
  assert.ok(!notes.includes(SECRET))
  assert.ok(notes.includes('We have started reviewing it.'))
})

test('only students have a history; unauthenticated callers are refused', async () => {
  const t = await setup()
  for (const who of ['staff-clean', 'admin1']) {
    const res = await list(t, who)
    assert.equal(res.status, 403, who)
    assert.equal(err(res), 'students_only')
  }
  assert.equal((await t.call('s001', { action: 'complaint.listMine' }, { jwt: 'jwt-s002' })).status, 401)
  assert.equal((await handle({ req: { headers: {}, bodyJson: { action: 'complaint.listMine' } } }, t.b.deps)).status, 401)
})

test('the student is taken from the login: IDs in the request cannot widen the list', async () => {
  const t = await setup({ populate: true })
  await t.submit('s002', ['Zebra crossing paint faded', 'cleaning-issues', 'The paint at the main gate crossing has faded.'])
  const res = await list(t, 's002', { studentId: 's001', userId: 's001', departmentId: 'cleaning' })
  assert.deepEqual(titles(res), ['Zebra crossing paint faded'])
})

/* ============================================================== search */

test('search: title, ID, category, department, details; case-insensitive; every word must match', async () => {
  const t = await setup({ populate: true })
  const search = async (text) => titles(await list(t, 's001', { search: text, limit: 50 })).sort()
  assert.deepEqual(await search('PROJECTOR'), ['Projector not working in Room 12'])
  assert.deepEqual(await search('lms'), ['LMS grades missing', 'LMS quiz will not open', 'Wi-Fi drops in the cafeteria'].sort(), 'title, and category "LMS Issues"')
  assert.deepEqual(await search('washroom floor'), ['Dirty washroom on floor 2'], 'all words must match')
  assert.deepEqual(await search('washroom projector'), [])
  assert.deepEqual(await search('Computer Technician'), ['Lab computer 14 keeps freezing', 'Projector not working in Room 12'].sort(), 'department name')
  assert.deepEqual(await search('freezes while compiling'), ['Lab computer 14 keeps freezing'], 'description')
  assert.deepEqual(await search('   hostel   noc  '), ['Hostel NOC delayed'], 'extra spaces ignored')
  const id = (await list(t, 's001', { search: 'hostel' })).body.complaints[0].reference
  assert.deepEqual(await search(id.toLowerCase()), ['Hostel NOC delayed'], 'complaint ID')
  assert.deepEqual(await search('nothing-matches-this'), [])
  assert.deepEqual((await search('')).length, 12, 'empty search = everything')
  for (const odd of ['.*', '[a-', '(', '\\', '%', '$gt', "' OR 1=1 --"]) assert.deepEqual(await search(odd), [], `"${odd}" is plain text, not a pattern`)
})

test('search never reaches other students’ complaints', async () => {
  const t = await setup({ populate: true })
  await t.submit('s002', ['Zebra crossing paint faded', 'cleaning-issues', 'The paint at the main gate crossing has faded.'])
  assert.equal((await list(t, 's001', { search: 'zebra' })).body.total, 0)
  assert.equal((await list(t, 's002', { search: 'zebra' })).body.total, 1)
  assert.equal((await list(t, 's002', { search: 'projector' })).body.total, 0)
})

test('search text is validated', async () => {
  const t = await setup()
  assert.equal(err(await list(t, 's001', { search: 'x'.repeat(101) })), 'validation_failed')
  assert.equal(err(await list(t, 's001', { search: { $ne: '' } })), 'validation_failed')
  assert.equal((await list(t, 's001', { search: 'x'.repeat(100) })).status, 200)
})

/* ============================================================== filters, sort, paging */

async function withStatuses() {
  const t = await setup({ populate: true })
  const [p, lms, water, wash] = t.ids
  await move(t, p, 'under_review')
  await move(t, lms, 'in_progress')
  await move(t, lms, 'resolved', 'Fixed after the server restart.')
  await move(t, water, 'closed')
  await move(t, wash, 'under_review')
  return t
}

test('filter by status (and the counts shown in the dropdown)', async () => {
  const t = await withStatuses()
  const by = async (status) => titles(await list(t, 's001', { status, limit: 50 })).sort()
  assert.deepEqual(await by('under_review'), ['Dirty washroom on floor 2', 'Projector not working in Room 12'])
  assert.deepEqual(await by('resolved'), ['LMS quiz will not open'])
  assert.deepEqual(await by('closed'), ['Water cooler is empty near library'])
  assert.deepEqual(await by('in_progress'), [])
  assert.equal((await by('submitted')).length, 8)
  const { statusCounts, overallTotal } = (await list(t, 's001', { status: 'closed' })).body.filters
  assert.deepEqual(statusCounts, { submitted: 8, under_review: 2, in_progress: 0, resolved: 1, closed: 1 }, 'counts cover all complaints, not just the filtered ones')
  assert.equal(overallTotal, 12)
  assert.equal(err(await list(t, 's001', { status: 'deleted' })), 'validation_failed')
})

test('filter by category, combined filters, and the category dropdown', async () => {
  const t = await withStatuses()
  const cleaning = await list(t, 's001', { categoryId: 'cleaning-issues', limit: 50 })
  assert.deepEqual(titles(cleaning).sort(), ['Broken chair in Room 3', 'Corridor lights flicker', 'Dirty washroom on floor 2'])
  const combo = await list(t, 's001', { categoryId: 'cleaning-issues', status: 'under_review' })
  assert.deepEqual(titles(combo), ['Dirty washroom on floor 2'])
  const withSearch = await list(t, 's001', { categoryId: 'cleaning-issues', status: 'submitted', search: 'chair' })
  assert.deepEqual(titles(withSearch), ['Broken chair in Room 3'])
  assert.equal((await list(t, 's001', { categoryId: 'no-such-category' })).body.total, 0)
  assert.equal(err(await list(t, 's001', { categoryId: '../x' })), 'validation_failed')
  const { categories } = (await list(t, 's001', { status: 'resolved' })).body.filters
  assert.deepEqual(categories.map((c) => c.name), ['Cleaning Issues', 'Clerk-Related Issues', 'Computer Problems', 'LMS Issues', 'Student Affairs', 'Teacher-Related Complaints', 'Water Cooler Issues'])
  const s2 = await setup()
  await s2.submit('s001', COMPLAINTS[0])
  assert.deepEqual((await list(s2, 's001')).body.filters.categories, [{ id: 'computer-problems', name: 'Computer Problems' }], 'only categories the student has used')
})

test('sort by date: newest first by default, oldest first on request', async () => {
  const t = await setup({ populate: true })
  const dates = (res) => res.body.complaints.map((c) => new Date(c.submittedAt).getTime())
  const newest = await list(t, 's001', { limit: 50 })
  assert.deepEqual(dates(newest), [...dates(newest)].sort((a, b) => b - a))
  assert.equal(titles(newest)[0], 'Broken chair in Room 3')
  const oldest = await list(t, 's001', { sort: 'oldest', limit: 50 })
  assert.deepEqual(dates(oldest), [...dates(oldest)].sort((a, b) => a - b))
  assert.equal(titles(oldest)[0], 'Projector not working in Room 12')
  assert.deepEqual(titles(oldest), titles(newest).reverse())
  assert.equal(err(await list(t, 's001', { sort: 'title' })), 'validation_failed')
})

test('pagination: pages are consecutive, complete and consistent with filters', async () => {
  const t = await setup({ populate: true })
  const all = titles(await list(t, 's001', { limit: 50 }))
  const p1 = await list(t, 's001', { limit: 5, offset: 0 })
  const p2 = await list(t, 's001', { limit: 5, offset: 5 })
  const p3 = await list(t, 's001', { limit: 5, offset: 10 })
  assert.deepEqual([p1.body.total, p2.body.total, p3.body.total], [12, 12, 12])
  assert.deepEqual([...titles(p1), ...titles(p2), ...titles(p3)], all, 'no gaps, no repeats')
  assert.equal(p3.body.complaints.length, 2)
  assert.equal((await list(t, 's001', { limit: 5, offset: 100 })).body.complaints.length, 0)
  assert.equal((await list(t, 's001')).body.complaints.length, 10, 'default page size 10')
  assert.equal((await list(t, 's001', { limit: 9999 })).body.complaints.length, 12, 'limit is capped (50) not rejected')
  assert.equal((await list(t, 's001', { limit: -3, offset: -7 })).body.complaints.length, 1, 'a limit below 1 becomes 1; a negative offset becomes 0')
  const filtered = await list(t, 's001', { categoryId: 'lms-issues', limit: 2, offset: 2 })
  assert.deepEqual([filtered.body.total, filtered.body.complaints.length], [3, 1])
})

test('loading/empty data: a student with no complaints gets an empty, well-formed result', async () => {
  const t = await setup()
  const res = await list(t, 's001')
  assert.deepEqual(res.body.complaints, [])
  assert.equal(res.body.total, 0)
  assert.deepEqual(res.body.filters, { overallTotal: 0, statusCounts: { submitted: 0, under_review: 0, in_progress: 0, resolved: 0, closed: 0 }, categories: [] })
})

/* ============================================================== details & tracking */

test('details: full description, status history with department remarks, oldest first', async () => {
  const t = await setup()
  const c = await t.submit('s001', COMPLAINTS[1], { location: 'Online' })
  t.b.advance(10)
  await move(t, c.id, 'under_review', 'Checking the LMS logs.')
  t.b.advance(10)
  await move(t, c.id, 'in_progress')
  t.b.advance(10)
  await move(t, c.id, 'resolved', '  Fixed.\u0000 Please try again.  ')
  const res = await t.call('s001', { action: 'complaint.get', complaintId: c.id })
  assert.equal(res.body.complaint.description, COMPLAINTS[1][2])
  assert.deepEqual([res.body.complaint.status, res.body.complaint.location, res.body.complaint.departmentName, res.body.complaint.reference], ['resolved', 'Online', 'ITSC Department', c.reference])
  assert.deepEqual(res.body.history.map((h) => [h.status, h.previousStatus, h.remark, h.by]), [
    ['submitted', null, '', 'System'],
    ['under_review', 'submitted', 'Checking the LMS logs.', 'Department'],
    ['in_progress', 'under_review', '', 'Department'],
    ['resolved', 'in_progress', 'Fixed. Please try again.', 'Department'],
  ])
  const times = res.body.history.map((h) => new Date(h.at).getTime())
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
})

test('details are private: another student gets 404; staff of the department see the staff view with the same public timeline', async () => {
  const t = await setup()
  const c = await t.submit('s001', COMPLAINTS[3])
  await move(t, c.id, 'under_review', 'On it.')
  const get = (who) => t.call(who, { action: 'complaint.get', complaintId: c.id })
  assert.equal((await get('s002')).status, 404)
  assert.equal((await get('staff-lms')).status, 404)
  const staff = await get('staff-clean')
  assert.equal(staff.body.history.length, 2)
  assert.equal(staff.body.complaint.studentName, 'User s001')
  assert.equal((await get('admin1')).body.history[1].remark, 'On it.')
  for (const h of staff.body.history) assert.equal('actorId' in h, false)
})

test('the timeline is rebuilt when history is missing, and a history failure at submit never loses the complaint', async () => {
  const t = await setup()
  t.b.failHistory.on = true
  const c = await t.submit('s001', COMPLAINTS[0])
  t.b.failHistory.on = false
  assert.ok(t.b.logs.some((l) => l.includes('first history entry')))
  assert.equal(t.b.fake.rows(TABLE_IDS.complaintHistory).length, 0)
  const res = await t.call('s001', { action: 'complaint.get', complaintId: c.id })
  assert.deepEqual(res.body.history.map((h) => [h.status, h.by, h.at]), [['submitted', 'System', c.submittedAt]])
  // out-of-order rows are sorted by time
  const row = { $id: 'X', submittedAt: '2026-01-01T00:00:00.000Z' }
  const entries = [
    { status: 'resolved', changedAt: '2026-01-03T00:00:00.000Z', actorRole: 'department' },
    { status: 'submitted', changedAt: '2026-01-01T00:00:00.000Z', actorRole: 'system' },
    { status: 'in_progress', changedAt: '2026-01-02T00:00:00.000Z', actorRole: 'admin' },
  ]
  assert.deepEqual(buildTimeline(row, entries).map((h) => [h.status, h.by]), [['submitted', 'System'], ['in_progress', 'Department'], ['resolved', 'Department']])
})

/* ============================================================== recording status changes */

test('status transitions: exactly the allowed moves work; closed is final', async () => {
  assert.deepEqual(SERVER_TRANSITIONS, CLIENT_TRANSITIONS, 'browser and function agree')
  assert.deepEqual(Object.keys(SERVER_TRANSITIONS), STATUSES)
  assert.deepEqual(STATUS_FLOW, ENUMS.complaintStatus)
  const t = await setup()
  const c = await t.submit('s001', COMPLAINTS[0])
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      await forceStatus(t, c.id, from)
      const allowed = SERVER_TRANSITIONS[from].includes(to)
      const outcome = await move(t, c.id, to).then(() => 'moved', (e) => `${e.status}:${e.code}`)
      assert.equal(outcome, allowed ? 'moved' : '409:invalid_transition', `${from} -> ${to}`)
    }
  }
  await forceStatus(t, c.id, 'closed')
  assert.equal(await move(t, c.id, 'in_progress').then(() => 'moved', (e) => e.code), 'invalid_transition')
})

test('a status change updates the complaint, the history, resolvedAt and notifies the student', async () => {
  const t = await setup()
  const c = await t.submit('s001', COMPLAINTS[0])
  t.b.advance(30)
  await recordStatusChange(t.b.deps, { complaintId: c.id, status: 'under_review', remark: 'Looking into it', actor: staffActor })
  const history = t.b.fake.rows(TABLE_IDS.complaintHistory).filter((h) => h.complaintId === c.id)
  const last = history.at(-1)
  assert.deepEqual([last.status, last.previousStatus, last.remark, last.actorRole, last.actorId], ['under_review', 'submitted', 'Looking into it', 'department', 'staff-clean'])
  assert.deepEqual(last.$permissions, ['read("label:admin")'])
  await move(t, c.id, 'resolved', 'Done')
  const row = t.b.fake.rows(TABLE_IDS.complaints)[0]
  assert.equal(row.status, 'resolved')
  assert.ok(row.resolvedAt)
  const notes = t.b.fake.rows(TABLE_IDS.notifications).filter((n) => n.userId === 's001' && n.type !== 'complaint_submitted')
  assert.deepEqual(notes.map((n) => [n.userId, n.type, n.isRead]), [['s001', 'status_changed', false], ['s001', 'complaint_resolved', false]])
  assert.match(notes[1].message, /resolved/)
  assert.deepEqual(notes[0].$permissions, ['read("user:s001")'])
  // the student sees the new status in both the list and the details
  assert.equal((await list(t, 's001')).body.complaints[0].status, 'resolved')
})

test('status change validation: remark limits, unknown status/complaint, only staff or admins', async () => {
  const t = await setup()
  const c = await t.submit('s001', COMPLAINTS[0])
  const code = (p) => p.then(() => 'ok', (e) => e.code)
  assert.equal(await code(move(t, c.id, 'under_review', 'x'.repeat(1001))), 'validation_failed')
  assert.equal(await code(move(t, c.id, 'finished')), 'validation_failed')
  assert.equal(await code(move(t, 'CMP-NOPE', 'under_review')), 'not_found')
  assert.equal(await code(recordStatusChange(t.b.deps, { complaintId: c.id, status: 'under_review', actor: { role: 'student', id: 's001' } })), 'forbidden')
  assert.equal(await code(recordStatusChange(t.b.deps, { complaintId: c.id, status: 'under_review' })), 'forbidden')
  assert.equal(await code(move(t, c.id, 'under_review', 'x'.repeat(1000))), 'ok')
  // students cannot trigger it through the API (staff-only action; other names do not exist)
  assert.equal((await t.call('s001', { action: 'complaint.updateStatus', complaintId: c.id, status: 'resolved', expectedStatus: 'under_review' })).status, 403)
  for (const action of ['complaint.setStatus', 'department.updateStatus']) assert.equal((await t.call('s001', { action, complaintId: c.id, status: 'resolved' })).status, 400)
  assert.equal(t.b.fake.rows(TABLE_IDS.complaints)[0].status, 'under_review')
})

test('if the history entry cannot be written the status change is rolled back', async () => {
  const t = await setup()
  const c = await t.submit('s001', COMPLAINTS[0])
  t.b.failHistory.on = true
  await assert.rejects(move(t, c.id, 'under_review', 'x'), /history down/)
  t.b.failHistory.on = false
  assert.equal(t.b.fake.rows(TABLE_IDS.complaints)[0].status, 'submitted')
  assert.equal(t.b.fake.rows(TABLE_IDS.notifications).filter((n) => n.userId === 's001' && n.type !== 'complaint_submitted').length, 0)
})

/* ============================================================== browser-side tracking helpers */

test('progress tracker: done / current / upcoming for every status, with dates', () => {
  const states = (status, history = []) => buildProgress(status, history).map((s) => s.state)
  assert.deepEqual(states('submitted'), ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
  assert.deepEqual(states('under_review'), ['done', 'current', 'upcoming', 'upcoming', 'upcoming'])
  assert.deepEqual(states('in_progress'), ['done', 'done', 'current', 'upcoming', 'upcoming'])
  assert.deepEqual(states('resolved'), ['done', 'done', 'done', 'current', 'upcoming'])
  assert.deepEqual(states('closed'), ['done', 'done', 'done', 'done', 'current'])
  assert.deepEqual(states('nonsense'), ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
  const history = [
    { status: 'submitted', at: '2026-11-01T00:00:00.000Z' },
    { status: 'in_progress', at: '2026-11-02T00:00:00.000Z' },
    { status: 'resolved', at: '2026-11-03T00:00:00.000Z' },
    { status: 'in_progress', at: '2026-11-04T00:00:00.000Z' },
  ]
  const reopened = buildProgress('in_progress', history)
  assert.deepEqual(reopened.map((s) => s.state), ['done', 'done', 'current', 'upcoming', 'upcoming'])
  assert.equal(reopened[2].at, '2026-11-04T00:00:00.000Z', 'most recent time in that status')
  assert.equal(reopened[1].at, null, 'a skipped step has no date')
  assert.deepEqual(reopened.map((s) => s.label), ['Submitted', 'Under Review', 'In Progress', 'Resolved', 'Closed'])
  assert.equal(describeChange({ status: 'under_review', previousStatus: 'submitted' }), 'Under Review (from Submitted)')
  assert.equal(describeChange({ status: 'submitted', previousStatus: null }), 'Submitted')
})

/* ============================================================== wiring & migration */

test('the history page is connected to the server, not to the database, and has every control', () => {
  const page = read('../../src/pages/student/MyComplaintsPage.jsx')
  assert.ok(page.includes('complaintService.listMyComplaints'))
  assert.ok(!/services\/db/.test(page), 'students never query the database directly')
  for (const label of ['Search complaints', 'Filter by status', 'Filter by category', 'Sort by date', 'Clear filters', 'No complaints match', 'You have not submitted any complaints', 'Loading your complaints']) {
    assert.ok(page.includes(label), `missing: ${label}`)
  }
  assert.ok(page.includes('Pager') && page.includes('Newest first') && page.includes('Oldest first'))
  const service = read('../../src/services/complaintService.js')
  assert.ok(/'complaint\.listMine'/.test(service))
  const detail = read('../../src/pages/complaints/ComplaintDetailPage.jsx')
  assert.ok(detail.includes('ComplaintTimeline') && detail.includes('data.description') && detail.includes('data.departmentName'))
  assert.ok(read('../../src/components/complaints/ComplaintList.jsx').includes('departmentName'))
  assert.ok(read('../../src/components/complaints/ComplaintTimeline.jsx').includes('Department remark'))
  // the student-facing code never mentions internal data
  for (const file of ['../../src/components/complaints/ComplaintTimeline.jsx', '../../src/pages/student/MyComplaintsPage.jsx']) {
    assert.ok(!/internalNote|complaint_notes|assignedTo|actorId/.test(read(file)), file)
  }
})

test('migration: Phase 8 complaint rows that the student could read become administrator-only', async () => {
  const t = await setup()
  const server = t.b.fake.as('server')
  const data = {
    referenceNumber: 'CMP-20261101-OLD234', studentId: 's001', studentName: 'User s001', title: 'Old complaint', description: 'Created during Phase 8.', categoryId: 'cleaning-issues',
    categoryName: 'Cleaning Issues', departmentId: 'cleaning', departmentName: 'Cleaning Department', status: 'submitted', submittedAt: '2026-11-01T10:00:00.000Z',
  }
  await server.createRow({ databaseId: t.b.db, tableId: TABLE_IDS.complaints, rowId: 'CMP-20261101-OLD234', data, permissions: ['read("user:s001")', 'read("label:admin")'] })
  const student = t.dbServices({ id: 's001', labels: [] }).complaints
  assert.equal((await student.listByStudent('s001')).total, 1, 'before: the student could read it directly')
  const run = () => lockComplaintRows({ tablesDB: server, databaseId: t.b.db, Query })
  assert.deepEqual(await run(), { total: 1, updated: 1, failed: 0 })
  assert.deepEqual(await run(), { total: 1, updated: 1, failed: 0 }, 'idempotent')
  assert.equal((await student.listByStudent('s001')).total, 0, 'after: only the function can show it to them')
  assert.deepEqual(t.b.fake.rows(TABLE_IDS.complaints)[0].$permissions, ['read("label:admin")'])
  assert.equal((await list(t, 's001')).body.total, 1, 'the student still sees it through the function')
})
