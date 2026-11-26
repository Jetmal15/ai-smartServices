import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + extra}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] })
const ctx = await browser.newContext()
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const path = () => new URL(page.url()).pathname
const text = () => page.locator('body').innerText()
const waitPath = (p, t = 5000) => page.waitForURL((u) => u.pathname === p, { timeout: t }).then(() => true, () => false)
const fill = async (label, v) => page.getByLabel(label, { exact: false }).first().fill(v)
const mockLog = () => fetch('http://localhost:4010/__log').then((r) => r.json())

// 1. guards
await page.goto(BASE + '/student/complaints')
check('guest on private route -> /login', await waitPath('/login'))

// 2. login validation (client-side)
await page.getByRole('button', { name: 'Log in' }).click()
let t = await text()
check('empty login shows validation errors', t.includes('Enter a valid email address.') && t.includes('Password is required.'))

// 3. register validation
await page.goto(BASE + '/register')
await page.getByRole('button', { name: 'Create account' }).click()
t = await text()
check('empty register shows all field errors', ['Full name is required.', 'Roll number is required.', 'Enter a valid email address.', 'Select your department.', 'Password is required.', 'Confirm your password.'].every((m) => t.includes(m)), t.slice(0, 400))
await fill('Full name', 'Ali Khan'); await fill('Roll number', '22SW001'); await fill('Email', 'ali@test.edu')
await page.getByLabel('Department').selectOption({ index: 1 })
await fill('Password', 'Secret123!'); await page.getByLabel('Confirm password').fill('Different1!')
await page.getByRole('button', { name: 'Create account' }).click()
check('password mismatch error', (await text()).includes('Passwords do not match.'))

// 4. successful registration
await page.getByLabel('Confirm password').fill('Secret123!')
await page.getByRole('button', { name: 'Create account' }).click()
check('register -> student dashboard', await waitPath('/student/dashboard'))
await page.waitForSelector('main')
t = await text()
check('welcome success message shown', t.includes('Account created. Welcome'))
check('topbar shows user name/email', t.includes('Ali Khan') && t.includes('ali@test.edu'))
const log = await mockLog()
const create = log.find((l) => l.route === 'POST /v1/account')
check('register request carries no role/labels', create && !('labels' in create.body) && !('role' in create.body), JSON.stringify(create?.body))
const prefs = log.find((l) => l.route === 'PATCH /v1/account/prefs')
check('roll number + department saved to prefs', prefs?.body?.prefs?.rollNumber === '22SW001' && !!prefs?.body?.prefs?.department, JSON.stringify(prefs?.body))

// 5. persistence
await page.reload()
await page.waitForLoadState('networkidle')
check('session persists across reload', path() === '/student/dashboard' && (await text()).includes('Ali Khan'))

// 6. role guard
await page.goto(BASE + '/admin/dashboard')
check('student blocked from /admin -> own dashboard', await waitPath('/student/dashboard'))
await page.goto(BASE + '/login')
check('logged-in user on /login redirected away', await waitPath('/student/dashboard'))

// 7. logout
await page.getByRole('link', { name: 'Log out' }).first().click()
check('logout -> /login', await waitPath('/login'))
await page.goto(BASE + '/student/dashboard')
check('after logout private route blocked', await waitPath('/login'))
check('server session deleted', (await mockLog()).some((l) => l.route === 'DELETE /v1/account/sessions/current'))

// 8. duplicate registration
await page.goto(BASE + '/register')
await fill('Full name', 'Ali Again'); await fill('Roll number', '22SW002'); await fill('Email', 'ali@test.edu')
await page.getByLabel('Department').selectOption({ index: 2 })
await fill('Password', 'Secret123!'); await page.getByLabel('Confirm password').fill('Secret123!')
await page.getByRole('button', { name: 'Create account' }).click()
await page.waitForTimeout(600)
check('duplicate email error shown on form', (await text()).includes('An account with this email already exists'))

// 9. wrong password, then correct, with redirect-back
await page.goto(BASE + '/student/complaints')
await waitPath('/login')
await fill('Email', 'ali@test.edu'); await fill('Password', 'wrongpass1')
await page.getByRole('button', { name: 'Log in' }).click()
await page.waitForTimeout(600)
check('wrong password -> friendly error', (await text()).includes('Incorrect email or password.'))
await fill('Password', 'Secret123!')
await page.getByRole('button', { name: 'Log in' }).click()
check('login redirects back to originally requested page', await waitPath('/student/complaints'))

// 10. expired session
await fetch('http://localhost:4010/__revoke', { method: 'POST' })
await page.evaluate(() => window.dispatchEvent(new Event('focus')))
check('expired session -> /login', await waitPath('/login'))
check('expired-session notice shown', (await text()).includes('Your session has expired'))

// 11. admin + staff roles from labels
for (const [email, dest] of [['admin@test.edu', '/admin/dashboard'], ['staff@test.edu', '/department/dashboard']]) {
  await page.goto(BASE + '/login')
  await fill('Email', email); await fill('Password', 'Passw0rd!seed')
  await page.getByRole('button', { name: 'Log in' }).click()
  check(`${email} -> ${dest}`, await waitPath(dest))
  await page.getByRole('link', { name: 'Log out' }).first().click()
  await waitPath('/login')
}

// 12. password recovery
await page.goto(BASE + '/login')
await page.getByRole('link', { name: 'Forgot password?' }).click()
check('forgot link -> /forgot-password', await waitPath('/forgot-password'))
await page.getByRole('button', { name: 'Send reset link' }).click()
check('forgot: invalid email validation', (await text()).includes('Enter a valid email address.'))
await fill('Email', 'ali@test.edu')
await page.getByRole('button', { name: 'Send reset link' }).click()
await page.waitForTimeout(500)
check('forgot: success message', (await text()).includes('Check your email'))
const rec = (await mockLog()).find((l) => l.route === 'POST /v1/account/recovery')
check('recovery url points to /reset-password', rec?.body?.url === BASE + '/reset-password', JSON.stringify(rec?.body))
await page.goto(BASE + '/reset-password')
check('reset without params -> invalid link', (await text()).includes('Invalid reset link'))
await page.goto(BASE + '/reset-password?userId=u_ali&secret=bad')
await page.getByLabel(/^New password/).fill('NewSecret99!'); await page.getByLabel(/^Confirm new/).fill('NewSecret99!')
await page.getByRole('button', { name: 'Update password' }).click()
await page.waitForTimeout(500)
check('reset with bad secret -> expired error', (await text()).includes('invalid or has expired'))
await page.goto(BASE + '/reset-password?userId=u_ali&secret=goodsecret')
await page.getByLabel(/^New password/).fill('NewSecret99!'); await page.getByLabel(/^Confirm new/).fill('NewSecret99!')
await page.getByRole('button', { name: 'Update password' }).click()
const okPath = await waitPath('/login')
await page.getByText('Password updated').waitFor({ timeout: 3000 }).catch(() => {})
check('reset success -> /login with notice', okPath && (await text()).includes('Password updated'))
await fill('Email', 'ali@test.edu'); await fill('Password', 'NewSecret99!')
await page.getByRole('button', { name: 'Log in' }).click()
check('login with new password works', await waitPath('/student/dashboard'))

check('no uncaught page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
