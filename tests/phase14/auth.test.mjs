// Phase 14 - AUTHENTICATION and ROLE tests. Run: npm run test:phase14
// The REAL browser services (authService, profileService, complaintService...) and the REAL Appwrite web SDK talk through an
// in-process Appwrite gateway (tests/support/fake-appwrite-http.mjs) to the REAL profile-api and complaint-api handlers.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootstrap } from '../support/e2e.mjs'

const t = await bootstrap()
const { auth, g, signIn, guest, complaints, profiles, admin, notifications } = t
const FET = 'Software Engineering'
const STRONG = 'Str0ng!Pass#1'
const reject = (p, pattern) => assert.rejects(p, (e) => (pattern ? pattern.test(e.message) : true))

/* ============================================================== registration */

test('REGISTER: a student registers, is signed in at once, and gets a student profile (never a privileged role)', async () => {
  guest()
  const r = await auth.registerStudent({ fullName: '  Ali   Khan ', rollNumber: '22sw900', email: ' Ali.Khan@Test.edu ', password: STRONG, department: FET })
  assert.equal(r.user.role, 'student')
  assert.equal(r.user.email, 'ali.khan@test.edu', 'the e-mail is normalised')
  assert.equal(r.profileSaved, true)
  assert.deepEqual([r.profile.role, r.profile.status, r.profile.rollNumber], ['student', 'active', '22SW900'])
  assert.deepEqual(g.users.get(r.user.id).labels, [], 'registration never sends or receives a role label')
  assert.equal((await auth.getCurrentUser()).id, r.user.id, 'signed in straight away')
})

test('REGISTER: invalid input is refused before anything is created; duplicates get a friendly message', async () => {
  guest()
  const base = { fullName: 'Sara Malik', rollNumber: '22SW901', email: 'sara@test.edu', password: STRONG, department: FET }
  const before = g.users.size
  await reject(auth.registerStudent({ ...base, fullName: 'ab' }), /full name/i)
  await reject(auth.registerStudent({ ...base, rollNumber: '!!' }), /roll number/i)
  await reject(auth.registerStudent({ ...base, email: 'not-an-email' }), /valid email/i)
  await reject(auth.registerStudent({ ...base, department: 'Hacking' }), /department/i)
  await reject(auth.registerStudent({ ...base, password: 'short' }), /at least 8/)
  await reject(auth.registerStudent({ ...base, password: 'x'.repeat(300) }), /at most 256/)
  assert.equal(g.users.size, before, 'nothing was created')
  await reject(auth.registerStudent({ ...base, email: 'ali.khan@test.edu' }), /already exists/i)
  // the same roll number twice: the account exists, the profile keeps the first owner and the student is told
  guest()
  const dup = await auth.registerStudent({ ...base, email: 'sara2@test.edu', rollNumber: '22SW900' })
  assert.equal(dup.profileSaved, false, 'roll numbers are unique')
})

test('ROLES: the role comes only from server-set labels; a student cannot promote themselves', async () => {
  assert.equal(auth.getRoleFromLabels([]), 'student')
  assert.equal(auth.getRoleFromLabels(['department']), 'department')
  assert.equal(auth.getRoleFromLabels(['department', 'admin']), 'admin')
  assert.equal(auth.getRoleFromLabels(['student', 'superuser']), 'student')
  await signIn('s002')
  const before = structuredClone(g.users.get('s002'))
  // the server REFUSES a request that tries to set privileged fields (it does not silently accept or ignore it)
  for (const evil of [{ role: 'admin' }, { labels: ['admin'] }, { accountStatus: 'disabled' }, { userId: 'admin1' }]) {
    await assert.rejects(profiles.updateMyProfile({ name: 'Renamed Student', ...evil }), (e) => e.status === 400 || e.status === 403 || /cannot/i.test(e.message), JSON.stringify(evil))
  }
  assert.equal(g.users.get('s002').name, before.name, 'a refused request changes nothing')
  const after = await profiles.updateMyProfile({ name: 'Renamed Student' })
  assert.equal(after.role, 'student')
  assert.equal(after.name, 'Renamed Student')
  assert.deepEqual(g.users.get('s002').labels, before.labels, 'labels untouched')
  assert.equal((await auth.getCurrentUser()).role, 'student')
})

/* ============================================================== login */

test('LOGIN: each role signs in and is recognised from its labels', async () => {
  for (const [id, role] of [['s001', 'student'], ['clean1', 'department'], ['admin1', 'admin']]) {
    guest()
    const user = await auth.login({ email: `${id}@test.edu`, password: 'Passw0rd!x' })
    assert.equal(user.role, role, id)
  }
})

test('LOGIN: wrong password and unknown e-mail give the SAME message (no account enumeration); bad input is refused locally', async () => {
  guest()
  const wrong = await auth.login({ email: 's001@test.edu', password: 'nope-nope-nope' }).catch((e) => e)
  const unknown = await auth.login({ email: 'ghost@test.edu', password: 'nope-nope-nope' }).catch((e) => e)
  assert.equal(wrong.message, 'Incorrect email or password.')
  assert.equal(unknown.message, wrong.message)
  assert.equal(await auth.hasActiveSession(), false)
  await reject(auth.login({ email: 'bad', password: 'x' }), /valid email/i)
  await reject(auth.login({ email: 's001@test.edu', password: '' }), /required/i)
})

test('LOGIN: a disabled account cannot sign in', async () => {
  guest()
  g.block('s003')
  await reject(auth.login({ email: 's003@test.edu', password: 'Passw0rd!x' }), /disabled/i)
  assert.equal(await auth.hasActiveSession(), false)
  g.users.get('s003').status = true
})

/* ============================================================== session */

test('SESSION: it persists across reloads of the same browser, and is not shared with other browsers', async () => {
  await signIn('s001')
  const mine = g.browser
  assert.equal((await auth.getCurrentUser()).id, 's001', 'after a reload the session is still there')
  assert.equal(await auth.hasActiveSession(), true)
  guest() // another device
  assert.equal(await auth.getCurrentUser(), null)
  g.useBrowser(mine)
  assert.equal((await auth.getCurrentUser()).id, 's001')
  // a second login in the same browser reuses the session instead of failing
  assert.equal((await auth.login({ email: 's001@test.edu', password: 'Passw0rd!x' })).id, 's001')
})

test('SESSION: an expired or revoked session is a clean logout, not an error', async () => {
  await signIn('s002')
  g.sessions.clear() // the server forgot the session
  assert.equal(await auth.getCurrentUser(), null)
  await assert.rejects(complaints.listMyComplaints(), (e) => complaints.isSessionError(e))
})

test('LOGOUT: ends the session; the app and the functions refuse the old browser afterwards; logging out twice is harmless', async () => {
  await signIn('s001')
  assert.equal((await complaints.listMyComplaints()).total >= 0, true)
  await auth.logout()
  assert.equal(await auth.getCurrentUser(), null)
  assert.equal(g.sessions.size >= 0, true)
  await assert.rejects(complaints.listMyComplaints(), (e) => complaints.isSessionError(e))
  await auth.logout()
})

test('LOGOUT: signing out one person does not sign out another', async () => {
  await signIn('s001')
  const first = g.browser
  await signIn('clean1')
  await auth.logout()
  g.useBrowser(first)
  assert.equal((await auth.getCurrentUser()).id, 's001')
})

/* ============================================================== password recovery */

test('RECOVERY: the link points at this app, is single-use, and sets a new password', async () => {
  guest()
  const before = g.sent.length
  await auth.requestPasswordReset(' S001@Test.edu ')
  const mail = g.sent[g.sent.length - 1]
  assert.equal(g.sent.length, before + 1)
  assert.equal(mail.url, 'http://localhost:5173/reset-password')
  await reject(auth.completePasswordReset({ userId: mail.userId, secret: mail.secret, password: 'short' }), /at least 8/)
  await reject(auth.completePasswordReset({ userId: '', secret: '', password: STRONG }), /invalid/i)
  await auth.completePasswordReset({ userId: mail.userId, secret: mail.secret, password: STRONG })
  await reject(auth.login({ email: 's001@test.edu', password: 'Passw0rd!x' }), /Incorrect/)
  assert.equal((await auth.login({ email: 's001@test.edu', password: STRONG })).id, 's001')
  await reject(auth.completePasswordReset({ userId: mail.userId, secret: mail.secret, password: 'An0ther!Pass#2' }), /invalid|expired/i)
  g.users.get('s001').password = 'Passw0rd!x'
})

test('RECOVERY: an unknown e-mail looks identical and sends nothing; a wrong token or user cannot reset anyone', async () => {
  guest()
  const before = g.sent.length
  await auth.requestPasswordReset('nobody@test.edu')
  assert.equal(g.sent.length, before, 'no e-mail for an unknown address, and no error that would reveal it')
  await reject(auth.requestPasswordReset('not-an-email'), /valid email/i)
  await auth.requestPasswordReset('s002@test.edu')
  const mail = g.sent[g.sent.length - 1]
  await reject(auth.completePasswordReset({ userId: mail.userId, secret: 'wrong-secret', password: STRONG }), /invalid|expired/i)
  await reject(auth.completePasswordReset({ userId: 'admin1', secret: mail.secret, password: STRONG }), /invalid|expired/i)
  assert.equal(g.users.get('admin1').password, 'Passw0rd!x', "someone else's token never changes another account")
})

test('RECOVERY: resetting a password signs the account out of other devices', async () => {
  await signIn('s003')
  const device = g.browser
  guest()
  await auth.requestPasswordReset('s003@test.edu')
  const mail = g.sent[g.sent.length - 1]
  await auth.completePasswordReset({ userId: mail.userId, secret: mail.secret, password: STRONG })
  g.useBrowser(device)
  assert.equal(await auth.getCurrentUser(), null)
  g.users.get('s003').password = 'Passw0rd!x'
})

/* ============================================================== unauthorized access */

test('UNAUTHORIZED: a guest is refused by every server action (401), reads and writes alike', async () => {
  guest()
  const actions = [
    () => complaints.listMyComplaints(),
    () => complaints.submitComplaint({ title: 'Ceiling fan not working', description: 'The fan in Lab 3 is not working at all.', location: 'Lab 3', categoryId: 'cleaning-issues' }),
    () => complaints.getComplaint('CMP-1'),
    () => complaints.listDepartmentComplaints(),
    () => complaints.getDepartmentStats(),
    () => complaints.requestAiAnalysis('CMP-1'),
    () => complaints.reassignComplaint({ complaintId: 'CMP-1', categoryId: 'lms-issues' }),
    () => notifications.markAllNotificationsRead(),
    () => notifications.sendAnnouncement({ audience: 'all_students', title: 'Hello everyone', message: 'A message for everybody.' }),
    () => admin.getDashboardStats(),
    () => admin.createDepartment({ name: 'Invented Dept', description: '', email: '', status: 'active' }),
    () => profiles.fetchMyProfile(),
    () => profiles.adminListProfiles(),
    () => profiles.adminSetRole({ userId: 's001', role: 'admin' }),
  ]
  for (const [i, run] of actions.entries()) await assert.rejects(run(), (e) => complaints.isSessionError(e) || e.status === 401 || e.code === 'unauthenticated' || e.name === 'AppwriteException', `guest action #${i}`)
  assert.ok(g.calls.filter((c) => c.userId === null).every((c) => c.status === 401), 'every guest call reached the function and was refused with 401')
})

test('UNAUTHORIZED: a student cannot use any staff or administrator action (403), and nothing changes', async () => {
  await signIn('s001')
  const refused = [
    () => complaints.listDepartmentComplaints(),
    () => complaints.getDepartmentStats(),
    () => complaints.reassignComplaint({ complaintId: 'CMP-1', categoryId: 'lms-issues' }),
    () => complaints.requestAiAnalysis('CMP-1'),
    () => notifications.sendAnnouncement({ audience: 'all_students', title: 'Free coffee', message: 'Everyone gets free coffee today.' }),
    () => admin.getDashboardStats(),
    () => admin.getReport(),
    () => admin.listAudit(),
    () => admin.listAdminComplaints(),
    () => admin.createCategory({ name: 'Invented', description: '', departmentId: 'cleaning', status: 'active' }),
    () => admin.assignStaff({ userId: 's001', departmentId: 'cleaning', position: 'Staff' }),
    () => profiles.adminListProfiles(),
    () => profiles.adminSetRole({ userId: 's001', role: 'admin' }),
    () => profiles.adminCreateUser({ name: 'Evil Admin', email: 'evil@test.edu', role: 'admin' }),
  ]
  for (const [i, run] of refused.entries()) await assert.rejects(run(), (e) => e.status === 403 || e.code === 'forbidden', `student action #${i}`)
  assert.deepEqual(g.users.get('s001').labels, [])
  assert.ok(![...g.users.values()].some((u) => u.email === 'evil@test.edu'))
})

test('UNAUTHORIZED: department staff cannot use administrator actions', async () => {
  await signIn('clean1')
  for (const run of [() => admin.getDashboardStats(), () => admin.listAdminComplaints(), () => admin.createDepartment({ name: 'Invented Dept', description: '', email: '', status: 'active' }), () => admin.removeStaff('x'), () => profiles.adminSetRole({ userId: 'clean1', role: 'admin' }), () => notifications.sendAnnouncement({ audience: 'all_students', title: 'Hello everyone', message: 'A message for everybody.' }), () => complaints.reassignComplaint({ complaintId: 'CMP-1', categoryId: 'lms-issues' })]) {
    await assert.rejects(run(), (e) => e.status === 403 || e.code === 'forbidden')
  }
  assert.deepEqual(g.users.get('clean1').labels, ['department'])
})

test('UNAUTHORIZED: a disabled account is locked out of the functions even with a live session', async () => {
  await signIn('s002')
  g.block('s002')
  await assert.rejects(complaints.listMyComplaints(), (e) => complaints.isSessionError(e) || e.status === 401)
  g.users.get('s002').status = true
})

test.after(() => g.close())
