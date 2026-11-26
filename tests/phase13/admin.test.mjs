// Phase 13 – administrator dashboard tests. Run: npm run test:phase13
// The REAL admin-api, complaint-api and profile-api handlers against in-memory backends built from database/schema.js.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { TABLE_IDS } from '../../database/schema.js'
import { handle as handleAdmin } from '../../functions/admin-api/src/handler.js'
import { handle as handleComplaints } from '../../functions/complaint-api/src/handler.js'
import { generateTemporaryPassword, handle as handleProfile, isAuthorizedAdminEmail } from '../../functions/profile-api/src/handler.js'
import { createDatabaseServices } from '../../src/services/db/factory.js'
import { createAdminBackend } from '../support/fake-admin-backend.mjs'
import { createFakeBackend } from '../support/fake-backend.mjs'
import { ID, Query } from '../support/fake-tablesdb.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const NOW = '2026-11-22T10:00:00.000Z'
const err = (res) => res.body.error?.code
const ok = (res) => assert.equal(res.body.ok, true, JSON.stringify(res.body))

async function setup() {
  const a = createAdminBackend()
  const { b } = a
  const services = createDatabaseServices({ tablesDB: b.fake.as('server'), databaseId: b.db, Query, ID, now: () => NOW })
  await services.seedInitialData()
  for (const id of ['s001', 's002', 's003']) await b.addStudent(id)
  await b.addStaff('clean1', ['cleaning'])
  await b.addStaff('itsc1', ['itsc'])
  await b.addStaff('free1') // department staff with no assignment yet
  await b.addAdmin('admin1')
  const call = (who, body, opts) => handleAdmin(b.request(who, body, opts), a.deps)
  const complaint = (who, body, opts) => handleComplaints(b.request(who, body, opts), b.deps)
  const submit = async (who, categoryId, title) => {
    b.advance(3)
    const res = await complaint(who, { action: 'complaint.submit', title, categoryId, description: `Description for ${title} in the building.` })
    assert.equal(res.body.ok, true, JSON.stringify(res.body))
    return res.body.complaint
  }
  const rows = (table) => b.fake.rows(table)
  const audit = () => rows(TABLE_IDS.adminAudit)
  return { a, b, call, complaint, submit, rows, audit, services }
}

const ACTIONS = ['dashboard.stats', 'reports.summary', 'department.list', 'department.create', 'department.update', 'category.list', 'category.create', 'category.update', 'staff.candidates', 'staff.list', 'staff.assign', 'staff.updatePosition', 'staff.remove', 'audit.list']

/* ============================================================== only administrators */

test('SECURITY: every admin-api action is refused to students, staff and guests', async () => {
  const t = await setup()
  const before = JSON.stringify([t.rows(TABLE_IDS.departments), t.rows(TABLE_IDS.categories), t.rows(TABLE_IDS.departmentUsers), t.audit()])
  for (const action of ACTIONS) {
    const body = { action, name: 'Hack', departmentId: 'itsc', categoryId: 'lms-issues', userId: 'clean1', assignmentId: 'x', status: 'inactive' }
    for (const who of ['s001', 'clean1', 'free1']) assert.equal((await t.call(who, body)).status, 403, `${who} ${action}`)
    assert.equal((await t.call('admin1', body, { jwt: 'jwt-s001' })).status, 401, `forged token ${action}`)
    assert.equal((await handleAdmin({ req: { headers: {}, bodyJson: body } }, t.a.deps)).status, 401, `guest ${action}`)
  }
  assert.equal(JSON.stringify([t.rows(TABLE_IDS.departments), t.rows(TABLE_IDS.categories), t.rows(TABLE_IDS.departmentUsers), t.audit()]), before, 'nothing changed')
  t.b.accounts.get('admin1').status = false
  assert.equal(err(await t.call('admin1', { action: 'dashboard.stats' })), 'account_disabled')
  t.b.accounts.get('admin1').status = true
  assert.equal(err(await t.call('admin1', { action: 'nope' })), 'unknown_action')
  assert.equal((await t.call('admin1', { action: 'dashboard.stats' })).status, 200)
})

test('SECURITY: the role is re-read on every call (a demoted administrator is locked out immediately)', async () => {
  const t = await setup()
  await t.b.addAdmin('admin2')
  ok(await t.call('admin2', { action: 'dashboard.stats' }))
  t.b.accounts.get('admin2').labels = []
  assert.equal((await t.call('admin2', { action: 'dashboard.stats' })).status, 403)
})

test('SECURITY: departments, categories, staff assignments and the audit log cannot be written from a browser, even by an administrator', async () => {
  const t = await setup()
  const admin = t.b.fake.as({ id: 'admin1', labels: ['admin'] })
  const denied = (p) => assert.rejects(p, (e) => e.code === 401)
  for (const tableId of [TABLE_IDS.departments, TABLE_IDS.categories, TABLE_IDS.departmentUsers, TABLE_IDS.adminAudit]) {
    await denied(admin.createRow({ databaseId: t.b.db, tableId, rowId: 'x1', data: {} }))
    const first = t.rows(tableId)[0]
    if (first) {
      await denied(admin.updateRow({ databaseId: t.b.db, tableId, rowId: first.$id, data: {} }))
      await denied(admin.deleteRow({ databaseId: t.b.db, tableId, rowId: first.$id }))
    }
  }
  // they can still read what they need
  assert.ok((await admin.listRows({ databaseId: t.b.db, tableId: TABLE_IDS.departments })).total >= 7)
})

/* ============================================================== dashboard statistics */

test('DASHBOARD: totals, pending, in progress, resolved, closed, students, staff and departments are correct', async () => {
  const t = await setup()
  const made = []
  for (let i = 0; i < 6; i++) made.push(await t.submit(`s00${(i % 3) + 1}`, i < 4 ? 'cleaning-issues' : 'lms-issues', `Complaint number ${i}`))
  const move = (who, id, status, remark, from) => t.complaint(who, { action: 'complaint.updateStatus', complaintId: id, status, remark, expectedStatus: from })
  ok(await move('clean1', made[0].id, 'under_review', '', 'submitted'))
  ok(await move('clean1', made[1].id, 'in_progress', '', 'submitted'))
  ok(await move('clean1', made[2].id, 'in_progress', '', 'submitted'))
  ok(await move('clean1', made[2].id, 'resolved', 'Fixed and checked.', 'in_progress'))
  ok(await move('clean1', made[3].id, 'closed', '', 'submitted'))
  const { stats } = (await t.call('admin1', { action: 'dashboard.stats' })).body
  assert.deepEqual(stats.complaints, { total: 6, pending: 3, submitted: 2, under_review: 1, in_progress: 1, resolved: 1, closed: 1 })
  assert.equal(stats.complaints.pending, stats.complaints.submitted + stats.complaints.under_review, 'pending = submitted + under review')
  assert.deepEqual(stats.users, { students: 3, staff: 3, admins: 1 })
  assert.deepEqual(stats.departments, { total: 7, active: 7 })
  assert.deepEqual(stats.categories, { total: 7, active: 7 })
  ok(await t.call('admin1', { action: 'department.update', departmentId: 'cleaning', status: 'inactive' }))
  assert.deepEqual((await t.call('admin1', { action: 'dashboard.stats' })).body.stats.departments, { total: 7, active: 6 })
  const parts = stats.complaints
  assert.equal(parts.submitted + parts.under_review + parts.in_progress + parts.resolved + parts.closed, parts.total)
})

test('DASHBOARD: an empty system reports zeros', async () => {
  const a = createAdminBackend()
  await a.b.addAdmin('admin1')
  const res = await handleAdmin(a.b.request('admin1', { action: 'dashboard.stats' }), a.deps)
  assert.deepEqual(res.body.stats.complaints, { total: 0, pending: 0, submitted: 0, under_review: 0, in_progress: 0, resolved: 0, closed: 0 })
  assert.deepEqual(res.body.stats.users, { students: 0, staff: 0, admins: 1 })
})

/* ============================================================== reports */

test('REPORTS: by category, by department, status distribution and resolution statistics', async () => {
  const t = await setup()
  const move = (id, status, remark, from) => t.complaint('clean1', { action: 'complaint.updateStatus', complaintId: id, status, remark, expectedStatus: from })
  const moveItsc = (id, status, remark, from) => t.complaint('itsc1', { action: 'complaint.updateStatus', complaintId: id, status, remark, expectedStatus: from })
  const c = []
  for (const [i, cat] of ['cleaning-issues', 'cleaning-issues', 'cleaning-issues', 'lms-issues', 'lms-issues', 'student-affairs'].entries()) c.push(await t.submit(`s00${(i % 3) + 1}`, cat, `Report complaint ${i}`))
  // resolve with known durations: c0 after 5h, c1 after 30h, c3 after 100h (itsc), c2 closed without being resolved
  const hoursLater = async (h, fn) => {
    t.b.setClock(new Date(new Date(c.find(Boolean).submittedAt).getTime()))
    void h
    return fn()
  }
  void hoursLater
  const resolveAfter = async (complaint, hours, mover) => {
    t.b.setClock(new Date(new Date(complaint.submittedAt).getTime() + hours * 3_600_000))
    ok(await mover(complaint.id, 'under_review', '', 'submitted'))
    ok(await mover(complaint.id, 'in_progress', '', 'under_review'))
    ok(await mover(complaint.id, 'resolved', 'Done and verified.', 'in_progress'))
  }
  await resolveAfter(c[0], 5, move)
  await resolveAfter(c[1], 30, move)
  await resolveAfter(c[3], 100, moveItsc)
  ok(await move(c[2].id, 'closed', '', 'submitted'))

  const { report } = (await t.call('admin1', { action: 'reports.summary' })).body
  assert.equal(report.total, 6)
  assert.deepEqual(report.statusDistribution, { submitted: 2, under_review: 0, in_progress: 0, resolved: 3, closed: 1 })
  const cat = Object.fromEntries(report.byCategory.map((x) => [x.categoryId, x.total]))
  assert.deepEqual([cat['cleaning-issues'], cat['lms-issues'], cat['student-affairs'], cat['water-cooler-issues']], [3, 2, 1, 0])
  assert.deepEqual(report.byCategory.slice(0, 2).map((x) => x.categoryId), ['cleaning-issues', 'lms-issues'], 'most complaints first')
  const dep = Object.fromEntries(report.byDepartment.map((x) => [x.departmentId, x]))
  assert.deepEqual([dep.cleaning.total, dep.cleaning.open, dep.cleaning.resolved, dep.cleaning.resolutionRate], [3, 0, 3, 100])
  assert.deepEqual([dep.itsc.total, dep.itsc.open, dep.itsc.resolved, dep.itsc.resolutionRate], [2, 1, 1, 50])
  assert.deepEqual([dep['student-affairs'].total, dep['student-affairs'].open], [1, 1])
  assert.equal(dep.cleaning.averageResolutionHours, 17.5, '(5 + 30) / 2: the complaint closed without a resolution has no resolution time')
  assert.equal(dep.itsc.averageResolutionHours, 100)
  assert.equal(dep['water-cooler'].averageResolutionHours, null)
  assert.equal(dep['water-cooler'].resolutionRate, null)
  assert.deepEqual(report.resolution.count, 3)
  assert.equal(report.resolution.averageHours, 45)
  assert.equal(report.resolution.medianHours, 30)
  assert.equal(report.resolution.within24h, 33.3)
  assert.equal(report.resolution.within72h, 66.7)
  assert.deepEqual([report.resolution.resolvedOrClosed, report.resolution.resolutionRate, report.resolution.sampled], [4, 66.7, false])
  assert.ok(report.generatedAt)
  assert.equal(report.byDepartment[0].departmentId, 'cleaning', 'departments are ordered by workload')
  // an inactive category/department still appears (history is not hidden)
  ok(await t.call('admin1', { action: 'department.update', departmentId: 'water-cooler', status: 'inactive' }))
  assert.ok((await t.call('admin1', { action: 'reports.summary' })).body.report.byDepartment.some((d) => d.departmentId === 'water-cooler' && d.status === 'inactive'))
})

test('REPORTS: an empty system gives empty, well-formed reports', async () => {
  const a = createAdminBackend()
  await a.b.addAdmin('admin1')
  const res = await handleAdmin(a.b.request('admin1', { action: 'reports.summary' }), a.deps)
  assert.deepEqual([res.body.report.total, res.body.report.byCategory, res.body.report.byDepartment], [0, [], []])
  assert.deepEqual(res.body.report.resolution, { count: 0, averageHours: null, medianHours: null, within24h: null, within72h: null, resolvedOrClosed: 0, resolutionRate: null, sampled: false })
})

/* ============================================================== departments */

test('DEPARTMENTS: view, add, edit, activate/deactivate, with validation and counts', async () => {
  const t = await setup()
  const list = async () => (await t.call('admin1', { action: 'department.list' })).body.departments
  const initial = await list()
  assert.equal(initial.length, 7)
  assert.deepEqual(initial.map((d) => d.name), [...initial.map((d) => d.name)].sort((a, b) => a.localeCompare(b)))
  assert.deepEqual(initial.find((d) => d.id === 'cleaning'), { id: 'cleaning', name: 'Cleaning Department', description: initial.find((d) => d.id === 'cleaning').description, email: '', status: 'active', createdAt: NOW, staffCount: 1, categoryCount: 1 })

  const created = await t.call('admin1', { action: 'department.create', name: '  Library   Services ', description: 'Books', email: 'Library@Test.edu' })
  ok(created)
  assert.deepEqual([created.body.department.name, created.body.department.email, created.body.department.status, created.body.department.staffCount], ['Library Services', 'library@test.edu', 'active', 0])
  assert.equal((await list()).length, 8)

  const id = created.body.department.id
  const edited = await t.call('admin1', { action: 'department.update', departmentId: id, description: 'Books and journals', email: '' })
  ok(edited)
  assert.deepEqual([edited.body.department.description, edited.body.department.email, edited.body.department.name], ['Books and journals', '', 'Library Services'])
  assert.equal((await t.call('admin1', { action: 'department.update', departmentId: id, status: 'inactive' })).body.department.status, 'inactive')
  assert.equal((await t.call('admin1', { action: 'department.update', departmentId: id, status: 'active' })).body.department.status, 'active')

  // validation
  const bad = await t.call('admin1', { action: 'department.create', name: 'A', email: 'nope', status: 'gone' })
  assert.equal(err(bad), 'validation_failed')
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['email', 'name', 'status'])
  for (const body of [{ name: { a: 1 } }, { name: 'x'.repeat(129) }, { name: 'Fine name', description: 'd'.repeat(1001) }, { name: 'Fine name', email: 5 }]) {
    assert.equal(err(await t.call('admin1', { action: 'department.create', ...body })), 'validation_failed', JSON.stringify(body).slice(0, 40))
  }
  assert.equal(err(await t.call('admin1', { action: 'department.create', name: ' cleaning   DEPARTMENT ' })), 'conflict')
  assert.equal(err(await t.call('admin1', { action: 'department.update', departmentId: id, name: 'CLEANING department' })), 'conflict')
  assert.equal((await t.call('admin1', { action: 'department.update', departmentId: id, name: 'LIBRARY SERVICES' })).body.department.name, 'LIBRARY SERVICES', 'case change of its own name is fine')
  assert.equal(err(await t.call('admin1', { action: 'department.update', departmentId: id })), 'validation_failed', 'nothing to update')
  assert.equal(err(await t.call('admin1', { action: 'department.update', departmentId: id, status: 'active', description: 'Books and journals' })), 'validation_failed', 'no actual change')
  assert.equal((await t.call('admin1', { action: 'department.update', departmentId: 'no-such' })).status, 404)
  assert.equal((await t.call('admin1', { action: 'department.update', departmentId: '../x', name: 'Whatever' })).status, 404)
  assert.equal((await list()).length, 8)
})

/* ============================================================== categories */

test('CATEGORIES: view, add, edit, connect to a department, activate/deactivate', async () => {
  const t = await setup()
  const list = async () => (await t.call('admin1', { action: 'category.list' })).body.categories
  const initial = await list()
  assert.equal(initial.length, 7)
  assert.deepEqual(initial.find((c) => c.id === 'lms-issues'), { id: 'lms-issues', name: 'LMS Issues', description: initial.find((c) => c.id === 'lms-issues').description, departmentId: 'itsc', departmentName: 'ITSC Department', status: 'active' })

  const created = await t.call('admin1', { action: 'category.create', name: ' Wi-Fi  Issues ', description: 'Campus Wi-Fi', departmentId: 'itsc' })
  ok(created)
  const id = created.body.category.id
  assert.deepEqual([created.body.category.name, created.body.category.departmentName, created.body.category.status], ['Wi-Fi Issues', 'ITSC Department', 'active'])
  assert.equal((await t.call('admin1', { action: 'category.update', categoryId: id, departmentId: 'computer-technician' })).body.category.departmentName, 'Computer Technician Department', 'moved to another department')
  assert.equal((await t.call('admin1', { action: 'category.update', categoryId: id, status: 'inactive' })).body.category.status, 'inactive')
  assert.equal((await t.call('admin1', { action: 'category.update', categoryId: id, name: 'Network Issues', description: 'Wired and wireless' })).body.category.name, 'Network Issues')

  const code = async (body) => err(await t.call('admin1', body))
  assert.equal(await code({ action: 'category.create', name: 'network issues', departmentId: 'itsc' }), 'conflict')
  assert.equal(await code({ action: 'category.create', name: 'Ghost', departmentId: 'no-such' }), 'validation_failed')
  assert.equal(await code({ action: 'category.create', name: '', departmentId: '' }), 'validation_failed')
  assert.equal(await code({ action: 'category.create', name: 'Valid name', departmentId: { a: 1 } }), 'validation_failed')
  assert.equal(await code({ action: 'category.update', categoryId: id, departmentId: 'no-such' }), 'validation_failed')
  ok(await t.call('admin1', { action: 'department.update', departmentId: 'student-affairs', status: 'inactive' }))
  assert.equal(await code({ action: 'category.create', name: 'Welfare', departmentId: 'student-affairs' }), 'validation_failed', 'inactive department')
  assert.equal(await code({ action: 'category.update', categoryId: id, departmentId: 'student-affairs' }), 'validation_failed')
  assert.equal(await code({ action: 'category.update', categoryId: 'student-affairs', status: 'inactive' }), undefined)
  assert.equal(await code({ action: 'category.update', categoryId: 'student-affairs', status: 'active' }), 'validation_failed', 'cannot switch on while its department is inactive')
  ok(await t.call('admin1', { action: 'department.update', departmentId: 'student-affairs', status: 'active' }))
  ok(await t.call('admin1', { action: 'category.update', categoryId: 'student-affairs', status: 'active' }))
  assert.equal((await t.call('admin1', { action: 'category.update', categoryId: 'nope', name: 'Fine name' })).status, 404)
  assert.equal((await list()).length, 8)
  // the complaint form only offers active categories of active departments
  const available = await createDatabaseServices({ tablesDB: t.b.fake.as({ id: 's001', labels: [] }), databaseId: t.b.db, Query, ID }).categories.listAvailable()
  assert.ok(!available.some((c) => c.id === id), 'the inactive category is hidden from students')
  assert.equal(available.length, 7)
})

/* ============================================================== department staff */

test('STAFF: candidates, assign, change position, remove – with the rules enforced on the server', async () => {
  const t = await setup()
  const call = (body) => t.call('admin1', body)
  const cands = (await call({ action: 'staff.candidates' })).body.candidates
  assert.deepEqual(cands.map((c) => c.id).sort(), ['clean1', 'free1', 'itsc1'], 'only active department staff')

  const assigned = await call({ action: 'staff.assign', userId: 'free1', departmentId: 'itsc', position: ' Technician ' })
  ok(assigned)
  assert.deepEqual([assigned.body.staff.userId, assigned.body.staff.name, assigned.body.staff.position, assigned.body.staff.departmentId], ['free1', 'User free1', 'Technician', 'itsc'])
  assert.equal((await call({ action: 'staff.assign', userId: 'free1', departmentId: 'cleaning' })).body.staff.position, 'Staff', 'default position')

  const code = async (body) => err(await call(body))
  assert.equal(await code({ action: 'staff.assign', userId: 'free1', departmentId: 'itsc' }), 'conflict')
  assert.equal(await code({ action: 'staff.assign', userId: 's001', departmentId: 'itsc' }), 'validation_failed', 'a student cannot be assigned')
  assert.equal(await code({ action: 'staff.assign', userId: 'admin1', departmentId: 'itsc' }), 'validation_failed')
  assert.equal(await code({ action: 'staff.assign', userId: 'ghost', departmentId: 'itsc' }), 'validation_failed')
  assert.equal(await code({ action: 'staff.assign', userId: '', departmentId: 'itsc' }), 'validation_failed')
  assert.equal(await code({ action: 'staff.assign', userId: 'itsc1', departmentId: 'no-such' }), 'validation_failed')
  assert.equal(await code({ action: 'staff.assign', userId: 'itsc1', departmentId: 'cleaning', position: 'x'.repeat(101) }), 'validation_failed')
  assert.equal(await code({ action: 'staff.assign', userId: { a: 1 }, departmentId: 'cleaning' }), 'validation_failed')
  await t.a.server.updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.users, rowId: 'itsc1', data: { accountStatus: 'disabled' } })
  assert.equal(await code({ action: 'staff.assign', userId: 'itsc1', departmentId: 'cleaning' }), 'validation_failed', 'a disabled account')
  assert.ok(!(await call({ action: 'staff.candidates' })).body.candidates.some((c) => c.id === 'itsc1'))
  ok(await call({ action: 'department.update', departmentId: 'student-affairs', status: 'inactive' }))
  assert.equal(await code({ action: 'staff.assign', userId: 'clean1', departmentId: 'student-affairs' }), 'validation_failed', 'an inactive department')

  const list = (await call({ action: 'staff.list', departmentId: 'itsc' })).body.staff
  assert.deepEqual(list.map((s) => [s.userId, s.position]), [['itsc1', 'Staff'], ['free1', 'Technician']])
  assert.equal((await call({ action: 'staff.list', departmentId: 'no-such' })).status, 404)

  const id = assigned.body.staff.id
  assert.equal((await call({ action: 'staff.updatePosition', assignmentId: id, position: 'Head' })).body.staff.position, 'Head')
  assert.equal(await code({ action: 'staff.updatePosition', assignmentId: id, position: 'x'.repeat(101) }), 'validation_failed')
  assert.equal((await call({ action: 'staff.updatePosition', assignmentId: 'nope', position: 'Head' })).status, 404)
  ok(await call({ action: 'staff.remove', assignmentId: id }))
  assert.equal((await call({ action: 'staff.remove', assignmentId: id })).status, 404)
  assert.deepEqual((await call({ action: 'staff.list', departmentId: 'itsc' })).body.staff.map((s) => s.userId), ['itsc1'])
})

test('STAFF: concurrent duplicate assignments leave exactly one row; assigned staff immediately see their department’s complaints', async () => {
  const t = await setup()
  const results = await Promise.all([1, 2, 3].map(() => t.call('admin1', { action: 'staff.assign', userId: 'free1', departmentId: 'cleaning' })))
  assert.equal(results.filter((r) => r.body.ok).length, 1)
  assert.ok(results.filter((r) => !r.body.ok).every((r) => err(r) === 'conflict'))
  assert.equal(t.rows(TABLE_IDS.departmentUsers).filter((r) => r.userId === 'free1').length, 1)
  await t.submit('s001', 'cleaning-issues', 'Visible after assignment')
  const seen = await t.complaint('free1', { action: 'department.list' })
  assert.equal(seen.body.total, 1)
  const row = t.rows(TABLE_IDS.departmentUsers).find((r) => r.userId === 'free1')
  ok(await t.call('admin1', { action: 'staff.remove', assignmentId: row.$id }))
  assert.equal((await t.complaint('free1', { action: 'department.list' })).body.total, 0, 'and lose access when removed')
})

/* ============================================================== audit trail */

test('AUDIT: every sensitive change records who, when and what; the log is admin-only and never blocks', async () => {
  const t = await setup()
  await t.b.addAdmin('admin2')
  t.b.advance(5)
  const dep = (await t.call('admin1', { action: 'department.create', name: 'Library Services' })).body.department
  t.b.advance(5)
  await t.call('admin2', { action: 'department.update', departmentId: dep.id, status: 'inactive' })
  await t.call('admin1', { action: 'department.update', departmentId: dep.id, status: 'active' })
  await t.call('admin1', { action: 'category.create', name: 'Books', departmentId: dep.id })
  const staff = (await t.call('admin1', { action: 'staff.assign', userId: 'free1', departmentId: dep.id, position: 'Librarian' })).body.staff
  await t.call('admin1', { action: 'staff.remove', assignmentId: staff.id })
  await t.call('admin1', { action: 'department.create', name: 'A' }) // refused: must not be audited
  const entries = t.audit().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  assert.deepEqual(entries.map((e) => [e.action, e.actorId]), [
    ['department.create', 'admin1'],
    ['department.deactivate', 'admin2'],
    ['department.activate', 'admin1'],
    ['category.create', 'admin1'],
    ['staff.assign', 'admin1'],
    ['staff.remove', 'admin1'],
  ])
  assert.equal(entries[0].actorName, 'User admin1')
  assert.match(entries[0].summary, /Created the department “Library Services”/)
  assert.match(entries[4].summary, /Assigned User free1 to Library Services as Librarian/)
  assert.ok(entries.every((e) => e.createdAt && e.targetType && e.$permissions.join() === 'read("label:admin")'))
  assert.ok(new Date(entries[1].createdAt) > new Date(entries[0].createdAt), 'server time')

  const log = (await t.call('admin1', { action: 'audit.list', limit: 3 })).body.entries
  assert.equal(log.length, 3)
  assert.deepEqual(log.map((e) => e.action), ['staff.remove', 'staff.assign', 'category.create'], 'newest first')
  assert.ok(!JSON.stringify(log).includes('actorId'), 'IDs are not exposed')
  // only administrators can read it
  for (const who of ['s001', 'clean1']) assert.equal((await t.call(who, { action: 'audit.list' })).status, 403)
  const staffView = await t.b.fake.as({ id: 'clean1', labels: ['department'] }).listRows({ databaseId: t.b.db, tableId: TABLE_IDS.adminAudit }).then((r) => r.rows, () => [])
  assert.equal(staffView.length, 0)
  // a failing audit write never undoes or blocks the change
  t.a.control.failAudit = true
  ok(await t.call('admin1', { action: 'department.create', name: 'Quiet Department' }))
  assert.ok(t.b.logs.some((l) => l.includes('could not record the audit entry')))
  assert.equal(t.rows(TABLE_IDS.departments).some((d) => d.name === 'Quiet Department'), true)
})

/* ============================================================== complaint management */

test('COMPLAINTS: administrators view, search and filter every complaint; others cannot', async () => {
  const t = await setup()
  const titles = ['Broken ceiling fan', 'Blocked drain outside canteen', 'LMS quiz will not open', 'Smelly washroom', 'Grades missing in LMS', 'Hostel NOC delayed']
  const cats = ['cleaning-issues', 'cleaning-issues', 'lms-issues', 'cleaning-issues', 'lms-issues', 'student-affairs']
  const made = []
  for (const [i, title] of titles.entries()) made.push(await t.submit(`s00${(i % 3) + 1}`, cats[i], title))
  ok(await t.complaint('clean1', { action: 'complaint.updateStatus', complaintId: made[0].id, status: 'under_review', expectedStatus: 'submitted' }))
  const list = (extra) => t.complaint('admin1', { action: 'admin.listComplaints', ...extra })
  const names = (res) => res.body.complaints.map((c) => c.title)

  assert.equal((await list({ limit: 50 })).body.total, 6)
  assert.deepEqual(names(await list({ search: 'LMS' })).sort(), ['Grades missing in LMS', 'LMS quiz will not open'])
  assert.deepEqual(names(await list({ search: 'user s002' })).length, 2, 'by student name')
  assert.deepEqual(names(await list({ search: made[3].reference.toLowerCase() })), ['Smelly washroom'], 'by complaint ID')
  assert.deepEqual(names(await list({ status: 'under_review' })), ['Broken ceiling fan'])
  assert.equal((await list({ departmentId: 'cleaning', limit: 50 })).body.total, 3)
  assert.equal((await list({ departmentId: 'itsc', limit: 50 })).body.total, 2)
  assert.equal((await list({ categoryId: 'student-affairs' })).body.total, 1)
  assert.deepEqual(names(await list({ departmentId: 'cleaning', status: 'submitted', search: 'drain' })), ['Blocked drain outside canteen'])
  assert.equal((await list({ departmentId: 'cleaning', categoryId: 'lms-issues' })).body.total, 0)
  const newest = names(await list({ limit: 50 }))
  assert.equal(newest[0], 'Hostel NOC delayed')
  assert.deepEqual(names(await list({ sort: 'oldest', limit: 50 })), [...newest].reverse())
  const p1 = await list({ limit: 4 })
  const p2 = await list({ limit: 4, offset: 4 })
  assert.deepEqual([...names(p1), ...names(p2)], newest)
  const first = p1.body.complaints[0]
  assert.ok(first.studentName && first.priority && first.departmentName && first.reference, 'monitoring fields are present')
  // details and monitoring of one complaint
  const detail = await t.complaint('admin1', { action: 'complaint.get', complaintId: made[0].id })
  assert.equal(detail.body.complaint.status, 'under_review')
  assert.ok(detail.body.history.length >= 2)
  for (const who of ['s001', 'clean1']) assert.equal((await t.complaint(who, { action: 'admin.listComplaints' })).status, 403, who)
  for (const bad of [{ status: 'x' }, { categoryId: '../x' }, { departmentId: '../x' }, { departmentId: 5 }, { sort: 'size' }, { search: 'x'.repeat(101) }]) assert.equal((await list(bad)).status, 400, JSON.stringify(bad))
})

test('COMPLAINTS: an administrator can reassign any complaint without an AI suggestion; staff cannot', async () => {
  const t = await setup()
  const c = await t.submit('s001', 'cleaning-issues', 'Wrongly categorised complaint')
  assert.equal((await t.complaint('clean1', { action: 'complaint.reassign', complaintId: c.id, categoryId: 'lms-issues' })).status, 403)
  ok(await t.complaint('admin1', { action: 'complaint.reassign', complaintId: c.id, categoryId: 'lms-issues' }))
  const row = t.rows(TABLE_IDS.complaints)[0]
  assert.deepEqual([row.departmentId, row.categoryId, row.lastUpdatedBy], ['itsc', 'lms-issues', 'admin1'])
  assert.equal((await t.complaint('itsc1', { action: 'complaint.get', complaintId: c.id })).body.ok, true)
  assert.equal((await t.complaint('clean1', { action: 'complaint.get', complaintId: c.id })).status, 404)
})

/* ============================================================== users (profile-api) */

function profileSetup() {
  const p = createFakeBackend()
  p.addAccount({ id: 'admin1', labels: ['admin'], name: 'Admin One', email: 'admin1@uni.edu' })
  p.addAccount({ id: 'staff1', labels: ['department'], name: 'Staff One', email: 'staff1@uni.edu' })
  p.addAccount({ id: 'stu1', name: 'Student One', email: 'stu1@uni.edu' })
  const call = (who, body) => handleProfile(p.requestAs(who, body), p.deps)
  return { p, call }
}

test('USERS: administrators provision department staff and administrators; students register themselves', async () => {
  const { p, call } = profileSetup()
  const res = await call('admin1', { action: 'admin.createUser', name: '  Sara   Malik ', email: ' Sara.Malik@Uni.edu ', role: 'department' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual([res.body.profile.name, res.body.profile.email, res.body.profile.role, res.body.profile.status], ['Sara Malik', 'sara.malik@uni.edu', 'department', 'active'])
  assert.deepEqual(res.body.profile.assignments, [])
  const created = [...p.accounts.values()].find((a) => a.email === 'sara.malik@uni.edu')
  assert.deepEqual(created.labels, ['department'])
  assert.ok(p.rows.get(created.$id), 'the users row exists immediately (no duplicate later)')
  assert.equal(p.rows.get(created.$id).role, 'department')

  const password = res.body.temporaryPassword
  assert.match(password, /^[A-Za-z0-9#$%&*?]{14}$/)
  assert.ok(/[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[#$%&*?]/.test(password), 'upper, lower, digit and symbol')
  assert.equal(p.created.at(-1).password, password, 'the account was created with exactly that password')
  assert.notEqual(generateTemporaryPassword(), generateTemporaryPassword())
  // the password is shown once: it is nowhere else (not in the profile row, the audit trail or the logs)
  const everywhere = JSON.stringify([[...p.rows.values()], p.auditLog, p.logs, (await call('admin1', { action: 'admin.get', userId: created.$id })).body])
  assert.ok(!everywhere.includes(password))

  const admin = await call('admin1', { action: 'admin.createUser', name: 'Second Admin', email: 'admin2@uni.edu', role: 'admin' })
  assert.equal(admin.body.profile.role, 'admin')
  assert.deepEqual([...p.accounts.values()].find((a) => a.email === 'admin2@uni.edu').labels, ['admin'])
  assert.deepEqual(p.auditLog.map((e) => e.action), ['user.create', 'user.create'])
  assert.match(p.auditLog[0].summary, /department staff account for Sara Malik/)
  assert.equal(p.auditLog[0].actorId, 'admin1')
})

test('USERS: provisioning is validated and administrators-only', async () => {
  const { p, call } = profileSetup()
  const fields = async (body) => (await call('admin1', { action: 'admin.createUser', ...body })).body.error?.fields ?? {}
  assert.deepEqual(Object.keys(await fields({ name: '', email: 'x', role: 'student' })).sort(), ['email', 'name', 'role'])
  assert.deepEqual(Object.keys(await fields({ name: 'Valid Name', email: 'valid@uni.edu', role: 'student' })), ['role'], 'students are not provisioned by administrators')
  assert.ok((await fields({ name: 'Valid Name', email: 'a@b', role: 'admin' })).email)
  assert.ok((await fields({ name: 'Valid Name', email: `${'x'.repeat(250)}@uni.edu`, role: 'department' })).email)
  assert.ok((await fields({ name: 'N'.repeat(200), email: 'valid@uni.edu', role: 'department' })).name)
  const before = p.accounts.size
  const dup = await call('admin1', { action: 'admin.createUser', name: 'Another One', email: 'STAFF1@uni.edu', role: 'department' })
  assert.deepEqual([dup.status, dup.body.error.code], [409, 'email_taken'])
  for (const who of ['staff1', 'stu1']) {
    const res = await call(who, { action: 'admin.createUser', name: 'Evil Admin', email: 'evil@uni.edu', role: 'admin' })
    assert.equal(res.status, 403, who)
  }
  assert.equal(p.accounts.size, before, 'no account was created')
})

test('USERS: only authorized people can become administrators (optional allowlist)', async () => {
  assert.equal(isAuthorizedAdminEmail('anyone@x.com', []), true, 'no list = no restriction')
  assert.equal(isAuthorizedAdminEmail('A@uni.edu', ['a@uni.edu']), true)
  assert.equal(isAuthorizedAdminEmail('b@uni.edu', ['a@uni.edu']), false)
  assert.equal(isAuthorizedAdminEmail('b@uni.edu', ['@uni.edu']), true)
  assert.equal(isAuthorizedAdminEmail('b@evil-uni.edu', ['@uni.edu']), false)
  assert.equal(isAuthorizedAdminEmail('b@sub.uni.edu', ['@uni.edu']), false)
  assert.equal(isAuthorizedAdminEmail('', ['@uni.edu']), false)

  const { p, call } = profileSetup()
  p.adminAllowlist.push('@uni.edu', 'boss@outside.org')
  p.addAccount({ id: 'u2', name: 'Inside User', email: 'inside@uni.edu' })
  p.addAccount({ id: 'u3', name: 'Outside User', email: 'outside@gmail.com' })
  const denied = await call('admin1', { action: 'admin.setRole', userId: 'u3', role: 'admin' })
  assert.deepEqual([denied.status, denied.body.error.code], [403, 'admin_not_authorized'])
  assert.deepEqual(p.accounts.get('u3').labels, [])
  assert.equal((await call('admin1', { action: 'admin.setRole', userId: 'u2', role: 'admin' })).status, 200)
  const created = await call('admin1', { action: 'admin.createUser', name: 'New Admin', email: 'newadmin@gmail.com', role: 'admin' })
  assert.equal(created.body.error.code, 'admin_not_authorized')
  assert.equal((await call('admin1', { action: 'admin.createUser', name: 'Boss Person', email: 'boss@outside.org', role: 'admin' })).status, 200)
  // staff accounts are not restricted by the administrator allowlist
  assert.equal((await call('admin1', { action: 'admin.createUser', name: 'Staff Person', email: 'staff@gmail.com', role: 'department' })).status, 200)
})

test('USERS: the system always keeps an active administrator (self-changes are refused; a concurrent mutual demotion is undone)', async () => {
  const { p, call } = profileSetup()
  p.addAccount({ id: 'admin2', labels: ['admin'], name: 'Admin Two', email: 'admin2@uni.edu' })
  // you cannot demote or disable yourself
  assert.equal((await call('admin1', { action: 'admin.setRole', userId: 'admin1', role: 'student' })).status, 403)
  assert.equal((await call('admin1', { action: 'admin.updateAccount', userId: 'admin1', status: 'disabled' })).status, 403)
  // one administrator can demote another while they remain
  assert.equal((await call('admin1', { action: 'admin.setRole', userId: 'admin2', role: 'student' })).status, 200)
  assert.equal((await call('admin1', { action: 'admin.setRole', userId: 'admin2', role: 'admin' })).status, 200)

  // simulate the other administrator demoting THIS caller at the very same moment: when the first change lands, the caller is gone
  const realLabels = p.deps.users.updateLabels
  p.deps.users.updateLabels = async (id, labels) => {
    const result = await realLabels(id, labels)
    if (id === 'admin2' && !labels.includes('admin')) p.accounts.get('admin1').labels = []
    return result
  }
  const demote = await call('admin1', { action: 'admin.setRole', userId: 'admin2', role: 'student' })
  assert.deepEqual([demote.status, demote.body.error.code], [409, 'last_admin'])
  assert.deepEqual(p.accounts.get('admin2').labels, ['admin'], 'the change was undone: an administrator remains')
  p.deps.users.updateLabels = realLabels

  // the same for deactivation
  p.accounts.get('admin1').labels = ['admin']
  const realStatus = p.deps.users.updateStatus
  p.deps.users.updateStatus = async (id, active) => {
    const result = await realStatus(id, active)
    if (id === 'admin2' && !active) p.accounts.get('admin1').status = false
    return result
  }
  const disable = await call('admin1', { action: 'admin.updateAccount', userId: 'admin2', status: 'disabled' })
  assert.deepEqual([disable.status, disable.body.error.code], [409, 'last_admin'])
  assert.notEqual(p.accounts.get('admin2').status, false, 'the account is active again')
  p.deps.users.updateStatus = realStatus
  // disabled or demoted administrators cannot act at all
  p.accounts.get('admin1').status = false
  assert.equal((await call('admin1', { action: 'admin.list' })).status, 403)
})

/* ============================================================== screens & wiring */

test('the administrator screens exist, are admin-only, and talk only to the trusted functions', () => {
  const routes = read('../../src/routes/AppRoutes.jsx')
  const adminBlock = routes.split('allowedRoles={[ROLES.ADMIN]}')[1]
  for (const page of ['AdminDashboardPage', 'AdminDepartmentsPage', 'AdminCategoriesPage', 'AdminComplaintsPage', 'AdminReportsPage', 'UsersPage']) assert.ok(adminBlock.includes(page), `${page} is inside the administrator-only routes`)
  for (const page of ['AdminDashboardPage', 'AdminDepartmentsPage', 'AdminCategoriesPage', 'AdminReportsPage']) assert.ok(!routes.split('allowedRoles={[ROLES.STUDENT]}')[1].split('allowedRoles={[ROLES.DEPARTMENT]}')[0].includes(page))
  const service = read('../../src/services/adminService.js')
  for (const action of ACTIONS) assert.ok(service.includes(`'${action}'`), action)
  assert.ok(service.includes('ADMIN_FUNCTION_ID'))
  const pages = ['AdminDashboardPage', 'AdminDepartmentsPage', 'AdminCategoriesPage', 'AdminReportsPage', 'AdminComplaintsPage'].map((p) => read(`../../src/pages/admin/${p}.jsx`)).join('\n')
  assert.ok(!/updateRow|createRow|deleteRow|tablesDB/.test(pages), 'no direct database writes from the admin pages')
  assert.ok(!/services\/db\/index\.js/.test(read('../../src/pages/admin/AdminDepartmentsPage.jsx') + read('../../src/pages/admin/AdminCategoriesPage.jsx')), 'departments and categories are managed through admin-api, not the browser database client')
  for (const label of ['Total complaints', 'Pending', 'In progress', 'Resolved', 'Closed', 'Total students', 'Department staff', 'Departments']) assert.ok(read('../../src/pages/admin/AdminDashboardPage.jsx').includes(label), label)
  for (const label of ['Complaints by category', 'Complaints by department', 'Status distribution', 'Resolution']) assert.ok(read('../../src/pages/admin/AdminReportsPage.jsx').includes(label), label)
  const users = read('../../src/pages/admin/UsersPage.jsx') + read('../../src/components/admin/CreateUserModal.jsx')
  for (const label of ['Add staff or administrator', 'temporary password', 'Search', 'Role']) assert.ok(users.toLowerCase().includes(label.toLowerCase()), label)
  assert.ok(read('../../src/lib/navigation.js').includes('reports'))
})
