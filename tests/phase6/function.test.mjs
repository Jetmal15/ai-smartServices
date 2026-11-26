// Phase 6 (updated for the Phase 7 `users` table) – profile-api function tests. Run: npm run test:phase6
// Exercises the REAL handler against an in-memory Appwrite stand-in, for all three roles.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DEPARTMENTS, handle, labelsForRole, profilePermissions, roleFromLabels } from '../../functions/profile-api/src/handler.js'
import { createFakeBackend, PERMISSIONS_FROM_SDK } from '../support/fake-backend.mjs'

const DEPT = DEPARTMENTS[0]

function setup() {
  const backend = createFakeBackend()
  backend.addAccount({ id: 'stu1', name: 'Ali Khan', email: 'ali@test.edu' })
  backend.addAccount({ id: 'stu2', name: 'Sara Ahmed', email: 'sara@test.edu' })
  backend.addAccount({ id: 'staff1', name: 'Staff Person', email: 'staff@test.edu', labels: ['department'] })
  backend.addAccount({ id: 'admin1', name: 'Admin Person', email: 'admin@test.edu', labels: ['admin'] })
  backend.addAccount({ id: 'admin2', name: 'Second Admin', email: 'admin2@test.edu', labels: ['admin', 'betaTester'] })
  const call = async (userId, body, opts) => handle(backend.requestAs(userId, body, opts), backend.deps)
  return { ...backend, call }
}

const err = (res) => res.body.error?.code

/* ---------------------------------------------------------------- helpers */

test('permission strings match the real SDK output', () => {
  assert.deepEqual(profilePermissions('abc'), PERMISSIONS_FROM_SDK('abc'))
})

test('role helpers: admin outranks department, no label = student, other labels preserved', () => {
  assert.equal(roleFromLabels([]), 'student')
  assert.equal(roleFromLabels(['x']), 'student')
  assert.equal(roleFromLabels(['department']), 'department')
  assert.equal(roleFromLabels(['department', 'admin']), 'admin')
  assert.deepEqual(labelsForRole(['admin', 'beta'], 'department'), ['beta', 'department'])
  assert.deepEqual(labelsForRole(['admin', 'beta'], 'student'), ['beta'])
})

test('function and frontend department lists are identical', () => {
  const source = readFileSync(new URL('../../src/lib/constants.js', import.meta.url), 'utf8')
  const block = source.match(/FET_DEPARTMENTS = \[([\s\S]*?)\]/)[1]
  const frontend = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(frontend, [...DEPARTMENTS])
})

/* ---------------------------------------------------------------- authentication */

test('unauthenticated / spoofed callers are rejected', async () => {
  const t = setup()
  assert.equal((await handle({ req: { headers: {}, bodyText: '{"action":"me"}' } }, t.deps)).status, 401)
  // user-id header without a JWT
  assert.equal((await handle({ req: { headers: { 'x-appwrite-user-id': 'admin1' }, bodyText: '{"action":"admin.list"}' } }, t.deps)).status, 401)
  // forged JWT
  assert.equal((await handle({ req: { headers: { 'x-appwrite-user-id': 'admin1', 'x-appwrite-user-jwt': 'forged' }, bodyText: '{"action":"admin.list"}' } }, t.deps)).status, 401)
  // a student's valid JWT paired with the admin's user id
  const stolen = t.requestAs('stu1', { action: 'admin.list' })
  stolen.req.headers['x-appwrite-user-id'] = 'admin1'
  assert.equal((await handle(stolen, t.deps)).status, 401)
})

test('disabled accounts are rejected; unknown actions and bad bodies give 400', async () => {
  const t = setup()
  t.accounts.get('stu2').status = false
  assert.equal(err(await t.call('stu2', { action: 'me' })), 'account_disabled')
  assert.equal(err(await t.call('stu1', { action: 'nope' })), 'unknown_action')
  assert.equal(err(await t.call('stu1', { action: '__proto__' })), 'unknown_action')
  assert.equal((await handle({ req: { ...t.requestAs('stu1', {}).req, bodyText: 'not json' } }, t.deps)).status, 400)
})

/* ---------------------------------------------------------------- profile creation / linking */

test('student: profile is created from the account, seeded with roll number + department', async () => {
  const t = setup()
  const res = await t.call('stu1', { action: 'me', rollNumber: '22sw001', department: DEPT })
  assert.equal(res.status, 200)
  assert.deepEqual(
    { ...res.body.profile, accountCreatedAt: undefined },
    { id: 'stu1', name: 'Ali Khan', email: 'ali@test.edu', role: 'student', status: 'active', rollNumber: '22SW001', department: DEPT, accountCreatedAt: undefined },
  )
  assert.ok(res.body.profile.accountCreatedAt)
  assert.deepEqual(t.rows.get('stu1').$permissions, PERMISSIONS_FROM_SDK('stu1'), 'row readable only by owner + admins, no write permissions')
  const stored = t.rows.get('stu1')
  assert.deepEqual(
    Object.keys(stored).filter((k) => !k.startsWith('$')).sort(),
    ['academicDepartment', 'accountStatus', 'createdAt', 'email', 'name', 'role', 'rollNumber', 'userId'],
    'stored fields are exactly the Phase 7 users columns',
  )
  assert.equal(stored.userId, stored.$id, 'row ID = account ID')
  assert.equal(JSON.stringify(res.body).includes('$permissions'), false, 'Appwrite internals are not exposed')
})

test('staff and admin profiles: role comes from labels; seed values are ignored', async () => {
  const t = setup()
  const staff = await t.call('staff1', { action: 'me', rollNumber: 'HACK-1', department: DEPT })
  assert.equal(staff.body.profile.role, 'department')
  assert.equal(staff.body.profile.rollNumber, '')
  assert.equal(staff.body.profile.department, '', 'assigned department is set only by an admin')
  const admin = await t.call('admin1', { action: 'me' })
  assert.equal(admin.body.profile.role, 'admin')
})

test('a role in the request body can never become the stored role', async () => {
  const t = setup()
  const res = await t.call('stu1', { action: 'me', role: 'admin', labels: ['admin'], status: 'active' })
  assert.equal(res.body.profile.role, 'student')
  assert.deepEqual(t.accounts.get('stu1').labels, [])
})

test('duplicate roll number at sign-up: account still gets a profile, flagged, roll left empty', async () => {
  const t = setup()
  await t.call('stu1', { action: 'me', rollNumber: '22SW001', department: DEPT })
  const res = await t.call('stu2', { action: 'me', rollNumber: '22SW001', department: DEPT })
  assert.equal(res.status, 200)
  assert.equal(res.body.rollNumberTaken, true)
  assert.equal(res.body.profile.rollNumber, '')
  assert.equal(res.body.profile.department, DEPT)
})

test('legacy Phase 5 account: roll number/department seeded from prefs once, validated', async () => {
  const t = setup()
  t.addAccount({ id: 'old1', name: 'Old Timer', email: 'old@test.edu', prefs: { rollNumber: '20ee007', department: DEPARTMENTS[2] } })
  t.addAccount({ id: 'old2', name: 'Bad Prefs', email: 'bad@test.edu', prefs: { rollNumber: '<script>', department: 'Hacking' } })
  const a = await t.call('old1', { action: 'me' })
  assert.equal(a.body.profile.rollNumber, '20EE007')
  const b = await t.call('old2', { action: 'me' })
  assert.equal(b.body.profile.rollNumber, '')
  assert.equal(b.body.profile.department, '')
})

test('calling me repeatedly / concurrently never duplicates or errors', async () => {
  const t = setup()
  const results = await Promise.all([1, 2, 3, 4].map(() => t.call('stu1', { action: 'me', rollNumber: '22SW001', department: DEPT })))
  assert.ok(results.every((r) => r.status === 200))
  assert.equal([...t.rows.values()].filter((r) => r.userId === 'stu1').length, 1)
})

test('profile heals when the account changed elsewhere (console label edit, name, blocked)', async () => {
  const t = setup()
  await t.call('stu1', { action: 'me' })
  t.accounts.get('stu1').labels = ['department']
  t.accounts.get('stu1').name = 'Ali K. Khan'
  const res = await t.call('stu1', { action: 'me' })
  assert.equal(res.body.profile.role, 'department')
  assert.equal(res.body.profile.name, 'Ali K. Khan')
})

/* ---------------------------------------------------------------- self-service updates */

test('student can update name and department; email and id stay put', async () => {
  const t = setup()
  await t.call('stu1', { action: 'me', rollNumber: '22SW001', department: DEPT })
  const res = await t.call('stu1', { action: 'updateMe', name: '  Ali   Raza Khan ', department: DEPARTMENTS[3] })
  assert.equal(res.status, 200)
  assert.equal(res.body.profile.name, 'Ali Raza Khan')
  assert.equal(res.body.profile.department, DEPARTMENTS[3])
  assert.equal(t.accounts.get('stu1').name, 'Ali Raza Khan', 'authoritative account name updated too')
  assert.equal(res.body.profile.email, 'ali@test.edu')
})

test('self-update validation errors are field-level', async () => {
  const t = setup()
  const res = await t.call('stu1', { action: 'updateMe', name: 'A', department: 'Nope' })
  assert.equal(res.status, 400)
  assert.ok(res.body.error.fields.name && res.body.error.fields.department)
})

test('PRIVILEGE ESCALATION: nobody can change their own role, status, email or id', async () => {
  const t = setup()
  for (const who of ['stu1', 'staff1', 'admin1']) {
    for (const attempt of [{ role: 'admin' }, { role: 'student' }, { labels: ['admin'] }]) {
      const res = await t.call(who, { action: 'updateMe', name: 'Same Name', ...attempt })
      assert.equal(res.status, 403, `${who} ${JSON.stringify(attempt)}`)
      assert.equal(err(res), 'role_change_forbidden')
    }
    for (const field of ['status', 'email', 'userId', 'accountCreatedAt']) {
      const res = await t.call(who, { action: 'updateMe', [field]: 'x' })
      assert.equal(err(res), 'field_not_editable', `${who} ${field}`)
    }
  }
  assert.deepEqual(t.accounts.get('stu1').labels, [])
  assert.deepEqual(t.accounts.get('staff1').labels, ['department'])
})

test('staff and admin can only edit their name (not department / roll number)', async () => {
  const t = setup()
  const ok = await t.call('staff1', { action: 'updateMe', name: 'Staff Renamed' })
  assert.equal(ok.status, 200)
  assert.equal((await t.call('staff1', { action: 'updateMe', department: DEPT })).status, 403)
  assert.equal((await t.call('staff1', { action: 'updateMe', rollNumber: '22SW009' })).status, 403)
  assert.equal((await t.call('admin1', { action: 'updateMe', department: DEPT })).status, 403)
})

test('roll number: settable once while empty, then locked; duplicates refused', async () => {
  const t = setup()
  await t.call('stu1', { action: 'me' })
  await t.call('stu2', { action: 'me' })
  assert.equal((await t.call('stu1', { action: 'updateMe', rollNumber: '22SW001' })).status, 200)
  assert.equal(err(await t.call('stu1', { action: 'updateMe', rollNumber: '22SW999' })), 'roll_number_locked')
  assert.equal((await t.call('stu1', { action: 'updateMe', rollNumber: '22sw001', name: 'Ali Khan' })).status, 200, 'same value is a no-op')
  assert.equal(err(await t.call('stu2', { action: 'updateMe', rollNumber: '22SW001' })), 'roll_number_taken')
})

/* ---------------------------------------------------------------- admin-only actions */

test('students and department staff cannot use ANY admin action', async () => {
  const t = setup()
  const actions = [
    { action: 'admin.list' },
    { action: 'admin.get', userId: 'stu2' },
    { action: 'admin.setRole', userId: 'stu2', role: 'admin' },
    { action: 'admin.updateAccount', userId: 'stu2', status: 'disabled' },
    { action: 'admin.syncProfiles' },
  ]
  for (const who of ['stu1', 'staff1']) {
    for (const body of actions) {
      const res = await t.call(who, body)
      assert.equal(res.status, 403, `${who} ${body.action}`)
      assert.equal(err(res), 'forbidden')
    }
  }
  assert.deepEqual(t.accounts.get('stu2').labels, [], 'target untouched')
  assert.equal(t.accounts.get('stu2').status, true)
})

test('a student cannot read another student’s profile through the function', async () => {
  const t = setup()
  await t.call('stu2', { action: 'me', rollNumber: '22SW002' })
  const res = await t.call('stu1', { action: 'admin.get', userId: 'stu2' })
  assert.equal(res.status, 403)
  assert.equal(JSON.stringify(res.body).includes('22SW002'), false)
  // `me` always returns the caller's own record, whatever userId is sent
  const mine = await t.call('stu1', { action: 'me', userId: 'stu2' })
  assert.equal(mine.body.profile.id, 'stu1')
})

test('admin: sync creates rows for every account; list/search/filter/paginate', async () => {
  const t = setup()
  const sync = await t.call('admin1', { action: 'admin.syncProfiles' })
  assert.deepEqual({ total: sync.body.total, created: sync.body.created, failed: sync.body.failed }, { total: 5, created: 5, failed: 0 })
  const again = await t.call('admin1', { action: 'admin.syncProfiles' })
  assert.equal(again.body.created, 0)

  const all = await t.call('admin1', { action: 'admin.list' })
  assert.equal(all.body.total, 5)
  assert.deepEqual(all.body.counts, { total: 5, student: 2, department: 1, admin: 2 })
  assert.deepEqual(all.body.profiles.map((p) => p.name), [...all.body.profiles.map((p) => p.name)].sort())
  assert.equal((await t.call('admin1', { action: 'admin.list', role: 'student' })).body.total, 2)
  assert.equal((await t.call('admin1', { action: 'admin.list', search: 'SARA@' })).body.profiles[0].id, 'stu2')
  const page = await t.call('admin1', { action: 'admin.list', limit: 2, offset: 4 })
  assert.equal(page.body.profiles.length, 1)
})

test('admin can assign roles: label changes, other labels kept, row follows, student fields cleared', async () => {
  const t = setup()
  await t.call('stu1', { action: 'me', rollNumber: '22SW001', department: DEPT })

  // Becoming staff needs no department any more: service departments are assigned separately (department_users).
  const promoted = await t.call('admin1', { action: 'admin.setRole', userId: 'stu1', role: 'department', department: 'ignored' })
  assert.equal(promoted.status, 200)
  assert.equal(promoted.body.profile.role, 'department')
  assert.equal(promoted.body.profile.department, '', 'a student program is not a staff assignment')
  assert.equal(promoted.body.profile.rollNumber, '')
  assert.deepEqual(promoted.body.profile.assignments, [])
  assert.equal(t.rows.get('stu1').academicDepartment, null)
  assert.deepEqual(t.accounts.get('stu1').labels, ['department'])

  const admin2 = await t.call('admin1', { action: 'admin.setRole', userId: 'staff1', role: 'admin' })
  assert.equal(admin2.body.profile.role, 'admin')
  assert.equal('assignments' in admin2.body.profile, false)
  assert.deepEqual(t.accounts.get('staff1').labels, ['admin'])

  const demoted = await t.call('admin1', { action: 'admin.setRole', userId: 'admin2', role: 'student' })
  assert.equal(demoted.body.profile.role, 'student')
  assert.deepEqual(t.accounts.get('admin2').labels, ['betaTester'], 'unrelated labels preserved')

  // new role is effective immediately for the target
  assert.equal(err(await t.call('admin2', { action: 'admin.list' })), 'forbidden')
  assert.equal((await t.call('stu1', { action: 'admin.list' })).status, 403)
})

test('department staff: profile lists their service-department assignments', async () => {
  const t = setup()
  t.addAssignment('staff1', 'itsc', 'ITSC Department', 'Head')
  t.addAssignment('staff1', 'cleaning', 'Cleaning Department')
  t.addAssignment('someone-else', 'itsc', 'ITSC Department')
  const me = await t.call('staff1', { action: 'me' })
  assert.deepEqual(me.body.profile.assignments, [
    { departmentId: 'itsc', departmentName: 'ITSC Department', position: 'Head' },
    { departmentId: 'cleaning', departmentName: 'Cleaning Department', position: 'Staff' },
  ])
  const viaAdmin = await t.call('admin1', { action: 'admin.get', userId: 'staff1' })
  assert.equal(viaAdmin.body.profile.assignments.length, 2)
  const renamed = await t.call('staff1', { action: 'updateMe', name: 'Staff Renamed' })
  assert.equal(renamed.body.profile.assignments.length, 2)
  assert.equal('assignments' in (await t.call('stu1', { action: 'me' })).body.profile, false, 'students have none')
})

test('a failure loading assignments never blocks the staff member from signing in', async () => {
  const t = setup()
  t.deps.assignments.listForUser = async () => { throw new Error('table missing') }
  const me = await t.call('staff1', { action: 'me' })
  assert.equal(me.status, 200)
  assert.deepEqual(me.body.profile.assignments, [])
  assert.ok(t.logs.some((l) => l.includes('table missing')))
})

test('removing someone from the staff role removes their department assignments (no stale rows)', async () => {
  const t = setup()
  t.addAssignment('staff1', 'itsc', 'ITSC Department')
  t.addAssignment('staff1', 'cleaning', 'Cleaning Department')
  t.addAssignment('other', 'itsc', 'ITSC Department')
  assert.equal((await t.call('admin1', { action: 'admin.setRole', userId: 'staff1', role: 'student' })).status, 200)
  assert.deepEqual(t.assignmentRows.map((a) => a.userId), ['other'])
  // changing a student to staff (no previous assignments) or staff to admin also leaves others alone
  await t.call('admin1', { action: 'admin.setRole', userId: 'stu1', role: 'department' })
  assert.deepEqual(t.assignmentRows.map((a) => a.userId), ['other'])
})

test('admin cannot change their own role or disable themselves; invalid inputs rejected', async () => {
  const t = setup()
  assert.equal(err(await t.call('admin1', { action: 'admin.setRole', userId: 'admin1', role: 'student' })), 'cannot_change_own_role')
  assert.equal(err(await t.call('admin1', { action: 'admin.updateAccount', userId: 'admin1', status: 'disabled' })), 'cannot_disable_self')
  assert.equal((await t.call('admin1', { action: 'admin.setRole', userId: 'stu1', role: 'superuser' })).status, 400)
  assert.equal(err(await t.call('admin1', { action: 'admin.setRole', userId: 'ghost', role: 'student' })), 'user_not_found')
  assert.deepEqual(t.accounts.get('admin1').labels, ['admin'])
})

test('the only administrator cannot be demoted or disabled by anyone', async () => {
  const t = setup()
  t.accounts.get('admin2').labels = [] // admin1 is now the only admin
  const attempts = [
    { action: 'admin.setRole', userId: 'admin1', role: 'student' },
    { action: 'admin.updateAccount', userId: 'admin1', status: 'disabled' },
  ]
  for (const who of ['stu1', 'staff1', 'admin1']) {
    for (const body of attempts) assert.equal((await t.call(who, body)).status, 403, `${who} ${body.action}`)
  }
  assert.deepEqual(t.accounts.get('admin1').labels, ['admin'])
  assert.equal(t.accounts.get('admin1').status, true)
})

test('admin can disable/enable accounts, set a student program, correct a roll number', async () => {
  const t = setup()
  await t.call('stu1', { action: 'me', rollNumber: '22SW001', department: DEPT })
  await t.call('staff1', { action: 'me' })

  const dept = await t.call('admin1', { action: 'admin.updateAccount', userId: 'stu1', department: DEPARTMENTS[4] })
  assert.equal(dept.body.profile.department, DEPARTMENTS[4])
  assert.equal(t.rows.get('stu1').academicDepartment, DEPARTMENTS[4])
  assert.equal((await t.call('admin1', { action: 'admin.updateAccount', userId: 'staff1', department: DEPARTMENTS[4] })).status, 400, 'staff have no academic department')

  const roll = await t.call('admin1', { action: 'admin.updateAccount', userId: 'stu1', rollNumber: '22sw100' })
  assert.equal(roll.body.profile.rollNumber, '22SW100')
  assert.equal((await t.call('admin1', { action: 'admin.updateAccount', userId: 'staff1', rollNumber: '22SW555' })).status, 400, 'staff have no roll number')

  const off = await t.call('admin1', { action: 'admin.updateAccount', userId: 'stu1', status: 'disabled' })
  assert.equal(off.body.profile.status, 'disabled')
  assert.equal(t.accounts.get('stu1').status, false)
  assert.equal(err(await t.call('stu1', { action: 'me' })), 'account_disabled')
  const on = await t.call('admin1', { action: 'admin.updateAccount', userId: 'stu1', status: 'active' })
  assert.equal(on.body.profile.status, 'active')
})

test('unexpected backend failures return a generic 500 without leaking details', async () => {
  const t = setup()
  t.deps.rows.get = async () => { throw new Error('database password is hunter2') }
  const res = await t.call('stu1', { action: 'me' })
  assert.equal(res.status, 500)
  assert.equal(JSON.stringify(res.body).includes('hunter2'), false)
  assert.ok(t.logs.some((l) => l.includes('hunter2')), 'details go to the server log only')
})
