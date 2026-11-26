// Phase 6 browser tests – real app, real function handler, mock Appwrite. See tests/phase6/README.md
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const MOCK = 'http://localhost:4010'
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + extra}`)
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] })
const errors = []

async function newSession() {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return {
    ctx,
    page,
    path: () => new URL(page.url()).pathname,
    text: () => page.locator('body').innerText(),
    waitPath: (p, t = 6000) => page.waitForURL((u) => u.pathname === p, { timeout: t }).then(() => true, () => false),
    fill: (label, v) => page.getByLabel(label, { exact: false }).first().fill(v),
    async login(email, password = 'Passw0rd!seed') {
      await page.goto(BASE + '/login')
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Password').first().fill(password)
      await page.getByRole('button', { name: 'Log in' }).click()
    },
    async logout() {
      await page.getByRole('link', { name: 'Log out' }).first().click()
      await page.waitForURL((u) => u.pathname === '/login')
    },
    /** Calls the profile-api function the way ANY browser user could (raw request, not via the UI). */
    api: (action, payload = {}) =>
      page.evaluate(async ({ action, payload }) => {
        const fb = JSON.parse(localStorage.getItem('cookieFallback') || '{}')
        const r = await fetch('http://localhost:4010/v1/functions/profile-api/executions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-appwrite-project': 'testproject', 'x-fallback-cookies': JSON.stringify(fb) },
          body: JSON.stringify({ body: JSON.stringify({ action, ...payload }), async: false }),
        })
        const ex = await r.json()
        return { http: r.status, fnStatus: ex.responseStatusCode, ...(ex.responseBody ? JSON.parse(ex.responseBody) : {}) }
      }, { action, payload }),
    /** Talks to the users TABLE directly, bypassing the function. */
    row: (method, rowId, data) =>
      page.evaluate(async ({ method, rowId, data }) => {
        const fb = JSON.parse(localStorage.getItem('cookieFallback') || '{}')
        const r = await fetch(`http://localhost:4010/v1/tablesdb/testdb/tables/users/rows/${rowId}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-appwrite-project': 'testproject', 'x-fallback-cookies': JSON.stringify(fb) },
          body: method === 'GET' ? undefined : JSON.stringify({ data }),
        })
        return r.status
      }, { method, rowId, data }),
  }
}
const accountOf = (email) => fetch(`${MOCK}/__account?email=${encodeURIComponent(email)}`).then((r) => r.json())
const mockLog = () => fetch(`${MOCK}/__log`).then((r) => r.json())
const noAccess = (t) => t.includes("You don't have access to that page")

/* ================================================================ guests */
const g = await newSession()
for (const p of ['/student/dashboard', '/department/dashboard', '/admin/dashboard', '/admin/users', '/student/profile', '/profile', '/dashboard']) {
  await g.page.goto(BASE + p)
  check(`guest on ${p} -> /login`, await g.waitPath('/login'))
}
await g.ctx.close()

/* ================================================================ bootstrap: admin signs in once so their profile row exists */
const boot = await newSession()
await boot.login('admin@test.edu')
check('admin login (bootstrap) -> admin dashboard', await boot.waitPath('/admin/dashboard'))
await boot.page.getByRole('heading', { name: 'System overview' }).waitFor().catch(() => {})
await boot.ctx.close()

/* ================================================================ student */
const s = await newSession()
await s.page.goto(BASE + '/register')
await s.fill('Full name', 'Ali Khan'); await s.fill('Roll number', '22sw001'); await s.fill('Email', 'ali@test.edu')
await s.page.getByLabel('Department').selectOption({ index: 1 })
await s.fill('Password', 'Secret123!'); await s.page.getByLabel('Confirm password').fill('Secret123!')
await s.page.getByRole('button', { name: 'Create account' }).click()
check('register -> student dashboard (role-based redirect)', await s.waitPath('/student/dashboard'))

let log = await mockLog()
const meCall = log.find((l) => l.route === 'POST /v1/functions/profile-api/executions' && JSON.parse(l.body.body).action === 'me' && JSON.parse(l.body.body).rollNumber)
const meBody = JSON.parse(meCall?.body.body ?? '{}')
check('registration links account -> profile via the function (roll + department only, no role)', meBody.rollNumber === '22SW001' && !!meBody.department && !('role' in meBody) && !('labels' in meBody), JSON.stringify(meBody))
check('browser never wrote to the table or account prefs directly', !log.some((l) => l.route.includes('/rows') || l.route === 'PATCH /v1/account/prefs'))
const aliAccount = await accountOf('ali@test.edu')
check('new account has no elevated label', aliAccount.labels.length === 0)

await s.page.goto(BASE + '/student/profile')
await s.page.getByRole('heading', { name: 'My profile' }).waitFor()
let t = await s.text()
check('student profile shows name, roll number, email, department, created date, role',
  ['Ali Khan', '22SW001', 'ali@test.edu', 'Software Engineering', 'Account created', 'Student'].every((x) => t.includes(x)), t.slice(0, 500))
check('student profile has no staff-only rows', !t.includes('Assigned department') && !t.includes('Account status'))
check('roll number is locked once set', await s.page.getByLabel('Roll number').isDisabled())

await s.page.getByLabel('Full name').fill('Ali Raza Khan')
await s.page.getByLabel('Department / program').selectOption('Information Technology')
await s.page.getByRole('button', { name: 'Save changes' }).click()
await s.page.getByText('Your profile has been updated.').waitFor({ timeout: 4000 }).catch(() => {})
t = await s.text()
check('student can update name + department', t.includes('Your profile has been updated.') && t.includes('Information Technology'), t.slice(0, 300))
check('topbar reflects the new name', (await s.page.locator('header.sticky').innerText()).includes('Ali Raza Khan'))
await s.page.reload(); await s.page.getByRole('heading', { name: 'My profile' }).waitFor()
check('update persists across reload', (await s.text()).includes('Ali Raza Khan'))
check('authoritative account name updated too', (await accountOf('ali@test.edu')).name === 'Ali Raza Khan')

await s.page.getByLabel('Full name').fill('A')
await s.page.getByRole('button', { name: 'Save changes' }).click()
check('client validation on profile form', (await s.text()).includes('Enter your full name.'))

await s.page.goto(BASE + '/dashboard')
check('/dashboard -> student dashboard', await s.waitPath('/student/dashboard'))
await s.page.goto(BASE + '/profile')
check('/profile -> student profile', await s.waitPath('/student/profile'))

for (const p of ['/department/dashboard', '/department/profile', '/admin/dashboard', '/admin/users', '/admin/profile']) {
  await s.page.goto(BASE + p)
  const back = await s.waitPath('/student/dashboard')
  await s.page.waitForTimeout(150)
  check(`student blocked from ${p}`, back && noAccess(await s.text()))
}

// Attacks a malicious student could try from their own browser
const myId = aliAccount.$id
const adminId = (await accountOf('admin@test.edu')).$id
const attempts = {
  'admin.list': await s.api('admin.list'),
  'admin.setRole (promote self)': await s.api('admin.setRole', { userId: myId, role: 'admin' }),
  'admin.setRole (promote other)': await s.api('admin.setRole', { userId: (await accountOf('legacy@test.edu')).$id, role: 'admin' }),
  'admin.updateAccount (disable other)': await s.api('admin.updateAccount', { userId: adminId, status: 'disabled' }),
  'admin.get (read admin profile)': await s.api('admin.get', { userId: adminId }),
  'admin.syncProfiles': await s.api('admin.syncProfiles'),
}
for (const [name, r] of Object.entries(attempts)) check(`student ATTACK ${name} -> 403`, r.fnStatus === 403 && r.error?.code === 'forbidden', JSON.stringify(r))
const selfRole = await s.api('updateMe', { name: 'Ali Raza Khan', role: 'admin' })
check('student ATTACK updateMe {role:"admin"} -> 403 role_change_forbidden', selfRole.fnStatus === 403 && selfRole.error?.code === 'role_change_forbidden', JSON.stringify(selfRole))
const selfStatus = await s.api('updateMe', { email: 'x@evil.test' })
check('student ATTACK updateMe {email} -> 403', selfStatus.fnStatus === 403, JSON.stringify(selfStatus))
check('student account still has no labels after the attacks', (await accountOf('ali@test.edu')).labels.length === 0)
check('student ATTACK write own table row directly -> denied', (await s.row('PATCH', myId, { role: 'admin' })) === 401)
check('student ATTACK write someone else’s row -> denied', (await s.row('PATCH', adminId, { role: 'student' })) === 401)
check('student can read own row directly', (await s.row('GET', myId)) === 200)
check('student ATTACK read admin’s private profile directly -> denied', (await s.row('GET', adminId)) === 401)

await s.logout()

/* ================================================================ second student: same roll number */
const s2 = await newSession()
await s2.page.goto(BASE + '/register')
await s2.fill('Full name', 'Sara Ahmed'); await s2.fill('Roll number', '22SW001'); await s2.fill('Email', 'sara@test.edu')
await s2.page.getByLabel('Department').selectOption({ index: 2 })
await s2.fill('Password', 'Secret123!'); await s2.page.getByLabel('Confirm password').fill('Secret123!')
await s2.page.getByRole('button', { name: 'Create account' }).click()
check('duplicate roll number: account still created -> dashboard', await s2.waitPath('/student/dashboard'))
await s2.page.waitForSelector('main')
check('student told roll number was not saved', (await s2.text()).includes('could not be saved'))
const saraId = (await accountOf('sara@test.edu')).$id
check('student ATTACK read another student’s private profile directly -> denied', (await s2.row('GET', myId)) === 401)
const peek = await s2.api('admin.get', { userId: myId })
check('student cannot read another student’s profile via the function', peek.fnStatus === 403 && !JSON.stringify(peek).includes('ali@test.edu'))
await s2.page.goto(BASE + '/student/profile')
await s2.page.getByRole('heading', { name: 'My profile' }).waitFor()
check('profile prompts to add the missing roll number', (await s2.text()).includes('Add your roll number'))
await s2.page.getByLabel('Roll number').fill('22sw001')
await s2.page.getByRole('button', { name: 'Save changes' }).click()
await s2.page.getByText('already registered').waitFor({ timeout: 4000 }).catch(() => {})
check('duplicate roll number refused (unique)', (await s2.text()).includes('already registered to another account'))
await s2.page.getByLabel('Roll number').fill('22SW002')
await s2.page.getByRole('button', { name: 'Save changes' }).click()
await s2.page.getByText('Your profile has been updated.').waitFor({ timeout: 4000 }).catch(() => {})
check('unique roll number saved, then locked', (await s2.text()).includes('22SW002') && (await s2.page.getByLabel('Roll number').isDisabled()))
await s2.logout()
await s2.ctx.close()

/* ================================================================ department staff */
const d = await newSession()
await d.login('staff@test.edu')
check('staff login -> department dashboard', await d.waitPath('/department/dashboard'))
await d.page.goto(BASE + '/department/profile')
await d.page.getByRole('heading', { name: 'My profile' }).waitFor()
t = await d.text()
check('staff profile shows name, email, assigned department, role, status',
  ['Staff Person', 'staff@test.edu', 'Assigned department', 'Not assigned yet', 'Department Staff', 'Account status', 'Active'].every((x) => t.includes(x)), t.slice(0, 500))
check('staff profile has no roll number', !t.includes('Roll number'))
check('staff can edit only their name (no department/roll fields)', (await d.page.getByLabel('Department / program').count()) === 0 && (await d.page.getByLabel('Roll number').count()) === 0)
await d.page.getByLabel('Full name').fill('Staff Renamed')
await d.page.getByRole('button', { name: 'Save changes' }).click()
await d.page.getByText('Your profile has been updated.').waitFor({ timeout: 4000 }).catch(() => {})
check('staff can update their name', (await d.text()).includes('Staff Renamed'))

await d.page.goto(BASE + '/dashboard'); check('/dashboard -> department dashboard', await d.waitPath('/department/dashboard'))
for (const p of ['/admin/dashboard', '/admin/users', '/admin/profile', '/student/dashboard', '/student/profile']) {
  await d.page.goto(BASE + p)
  const back = await d.waitPath('/department/dashboard')
  await d.page.waitForTimeout(150)
  check(`staff blocked from ${p}`, back && noAccess(await d.text()))
}
const staffId = (await accountOf('staff@test.edu')).$id
const staffAttacks = {
  'admin.list': await d.api('admin.list'),
  'admin.setRole (promote self)': await d.api('admin.setRole', { userId: staffId, role: 'admin' }),
  'admin.updateAccount': await d.api('admin.updateAccount', { userId: myId, status: 'disabled' }),
  'admin.get (read a student)': await d.api('admin.get', { userId: myId }),
}
for (const [name, r] of Object.entries(staffAttacks)) check(`staff ATTACK ${name} -> 403`, r.fnStatus === 403, JSON.stringify(r))
const staffRole = await d.api('updateMe', { role: 'admin' })
check('staff ATTACK updateMe {role:"admin"} -> 403', staffRole.fnStatus === 403 && staffRole.error?.code === 'role_change_forbidden')
const staffDept = await d.api('updateMe', { department: 'Software Engineering' })
check('staff ATTACK set own assigned department -> 403', staffDept.fnStatus === 403)
check('staff ATTACK read a student’s private profile directly -> denied', (await d.row('GET', myId)) === 401)
check('staff ATTACK write own row directly -> denied', (await d.row('PATCH', staffId, { role: 'admin' })) === 401)
check('staff account label unchanged', JSON.stringify((await accountOf('staff@test.edu')).labels) === '["department"]')
await d.logout()
await d.ctx.close()

/* ================================================================ administrator */
const a = await newSession()
await a.login('admin@test.edu')
check('admin login -> admin dashboard', await a.waitPath('/admin/dashboard'))
await a.page.goto(BASE + '/admin/profile')
await a.page.getByRole('heading', { name: 'My profile' }).waitFor()
t = await a.text()
check('admin profile shows name, email, role', ['Admin Person', 'admin@test.edu', 'Administrator'].every((x) => t.includes(x)))
check('admin profile has no student/staff rows', !t.includes('Roll number') && !t.includes('Assigned department'))
await a.page.goto(BASE + '/profile'); check('/profile -> admin profile', await a.waitPath('/admin/profile'))
for (const p of ['/student/dashboard', '/department/dashboard']) {
  await a.page.goto(BASE + p)
  const back = await a.waitPath('/admin/dashboard')
  await a.page.waitForTimeout(150)
  check(`admin sent from ${p} to own dashboard`, back && noAccess(await a.text()))
}
const adminSelf = await a.api('updateMe', { role: 'student' })
check('admin ATTACK demote self via updateMe -> 403', adminSelf.fnStatus === 403 && adminSelf.error?.code === 'role_change_forbidden')
const adminSelf2 = await a.api('admin.setRole', { userId: adminId, role: 'student' })
check('admin cannot change own role -> 403', adminSelf2.fnStatus === 403 && adminSelf2.error?.code === 'cannot_change_own_role')

// Users page
await a.page.goto(BASE + '/admin/users')
await a.page.getByRole('heading', { name: 'Users' }).waitFor()
await a.page.getByTestId('user-row-admin@test.edu').waitFor()
check('admin sees users page', true)
check('own row cannot be managed', await a.page.getByRole('button', { name: 'Manage Admin Person' }).isDisabled())
await a.page.getByRole('button', { name: 'Sync accounts' }).click()
await a.page.getByText(/Synced \d+ accounts/).waitFor({ timeout: 5000 })
await a.page.getByText('Legacy Student').waitFor({ timeout: 5000 }).catch(() => {})
t = await a.text()
check('sync creates profiles for existing (Phase 5) accounts', t.includes('Legacy Student') && /profiles created/.test(t), t.slice(0, 400))
const legacyRow = (await fetch(`${MOCK}/__rows`).then((r) => r.json())).find((r) => r.email === 'legacy@test.edu')
check('legacy roll number/department carried over from old prefs (validated, upper-cased)', legacyRow?.rollNumber === '20EE007' && legacyRow?.academicDepartment === 'Electronic Engineering', JSON.stringify(legacyRow))

await a.page.getByLabel('Search users').fill('sara')
await a.page.waitForTimeout(700)
t = await a.text()
check('search filters the list', t.includes('Sara Ahmed') && !t.includes('Legacy Student'))
await a.page.getByLabel('Search users').fill('')
await a.page.getByLabel('Filter by role').selectOption('department')
await a.page.waitForTimeout(500)
t = await a.text()
check('role filter works', t.includes('Staff Renamed') && !t.includes('Sara Ahmed'))
await a.page.getByLabel('Filter by role').selectOption('')
await a.page.waitForTimeout(500)

// Promote Ali (logged in elsewhere) to department staff
const ali = await newSession()
await ali.login('ali@test.edu', 'Secret123!')
check('Ali (student) logged in on another browser', await ali.waitPath('/student/dashboard'))
await ali.page.goto(BASE + '/student/profile')
await ali.page.getByRole('heading', { name: 'My profile' }).waitFor()

await a.page.getByRole('button', { name: 'Manage Ali Raza Khan' }).click()
await a.page.getByRole('dialog').getByLabel('Role').selectOption('department')
check('promoting to staff asks for no department (assignment is a separate step)', (await a.page.getByRole('dialog').getByLabel('Assigned department').count()) === 0)
await a.page.getByRole('button', { name: 'Save changes' }).click()
await a.page.getByRole('button', { name: 'Yes, apply' }).click()
await a.page.getByText('Updated Ali Raza Khan.').waitFor({ timeout: 5000 }).catch(() => {})
t = await a.text()
check('admin changed role (confirmation shown first)', t.includes('Updated Ali Raza Khan.'))
const aliNow = await accountOf('ali@test.edu')
check('role stored as Appwrite label on the account', JSON.stringify(aliNow.labels) === '["department"]', JSON.stringify(aliNow.labels))
const aliRow = (await fetch(`${MOCK}/__rows`).then((r) => r.json())).find((r) => r.email === 'ali@test.edu')
check('users row follows: role; academic department and roll number cleared', aliRow.role === 'department' && !aliRow.academicDepartment && !aliRow.rollNumber, JSON.stringify(aliRow))
check('row permissions: owner + admins read only', JSON.stringify(aliRow.$permissions) === JSON.stringify([`read("user:${aliNow.$id}")`, 'read("label:admin")']), JSON.stringify(aliRow.$permissions))

// The already-open student tab notices the role change
await ali.page.evaluate(() => window.dispatchEvent(new Event('focus')))
check('open tab of the promoted user is moved to the department area', await ali.waitPath('/department/dashboard'))
await ali.page.waitForTimeout(200)
check('…with an access notice', noAccess(await ali.text()))
const aliAdminTry = await ali.api('admin.list')
check('promoted staff still cannot use admin actions', aliAdminTry.fnStatus === 403)
await ali.page.goto(BASE + '/department/profile')
await ali.page.getByRole('heading', { name: 'My profile' }).waitFor()
t = await ali.text()
check('promoted user’s profile now shows staff fields', t.includes('Assigned department') && t.includes('Not assigned yet') && t.includes('Department Staff') && !t.includes('22SW001'))
await ali.ctx.close()

// Disable / re-enable Sara
await a.page.getByRole('button', { name: 'Manage Sara Ahmed' }).click()
await a.page.getByRole('dialog').getByLabel('Account status').selectOption('disabled')
await a.page.getByRole('button', { name: 'Save changes' }).click()
await a.page.getByRole('button', { name: 'Yes, apply' }).click()
await a.page.getByText('Updated Sara Ahmed.').waitFor({ timeout: 5000 }).catch(() => {})
check('admin can disable an account', (await accountOf('sara@test.edu')).status === false)
const blocked = await newSession()
await blocked.login('sara@test.edu', 'Secret123!')
await blocked.page.waitForTimeout(600)
check('disabled user cannot sign in', (await blocked.text()).includes('This account has been disabled'))
await blocked.ctx.close()
await a.page.getByRole('button', { name: 'Manage Sara Ahmed' }).click()
await a.page.getByRole('dialog').getByLabel('Account status').selectOption('active')
await a.page.getByRole('button', { name: 'Save changes' }).click()
await a.page.getByText('Updated Sara Ahmed.').waitFor({ timeout: 5000 }).catch(() => {})
check('admin can re-enable an account', (await accountOf('sara@test.edu')).status === true)

// Admin reads a student's profile through the function (authorized)
const adminGet = await a.api('admin.get', { userId: saraId })
check('admin may read any profile', adminGet.fnStatus === 200 && adminGet.profile.email === 'sara@test.edu')
check('admin can read a student row directly (label:admin permission)', (await a.row('GET', saraId)) === 200)
check('even admins cannot write the table directly (only the function can)', (await a.row('PATCH', saraId, { role: 'admin' })) === 401)

// Console label edit is picked up
await fetch(`${MOCK}/__setLabels`, { method: 'POST', body: JSON.stringify({ email: 'legacy@test.edu', labels: ['department'] }) })
await a.page.getByRole('button', { name: 'Sync accounts' }).click()
await a.page.getByText(/Synced \d+ accounts/).waitFor({ timeout: 5000 })
await a.page.waitForTimeout(400)
const row = await a.page.getByTestId('user-row-legacy@test.edu').innerText()
check('sync repairs a role changed in the Appwrite console', row.includes('Department Staff'), row)
await a.logout()
await a.ctx.close()

/* ================================================================ session expiry still handled */
const e = await newSession()
await e.login('admin@test.edu')
await e.waitPath('/admin/dashboard')
await fetch(`${MOCK}/__revoke`, { method: 'POST' })
await e.page.evaluate(() => window.dispatchEvent(new Event('focus')))
check('revoked session -> /login', await e.waitPath('/login'))
await e.ctx.close()

check('no uncaught page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
