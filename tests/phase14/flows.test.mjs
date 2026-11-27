// Phase 14 - COMPLAINT, AI and NOTIFICATION integration tests (browser services -> Appwrite SDK -> gateway -> real handlers).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TABLE_IDS } from '../../database/schema.js'
import { createDatabaseServices } from '../../src/services/db/factory.js'
import { bootstrap } from '../support/e2e.mjs'
import { PDF_BYTES, PNG_BYTES } from '../support/fake-appwrite-http.mjs'
import { ID, Query } from '../support/fake-tablesdb.mjs'

const t = await bootstrap()
const { g, b, signIn, complaints: C, notifications: N, admin: A } = t
const SECRET_KEY = 'sk-test-SECRET'
const form = (over = {}) => ({ title: 'Ceiling fan not working', description: 'The ceiling fan in Lab 3 has stopped working and the room is very hot.', location: 'Lab 3', categoryId: 'cleaning-issues', ...over })
const submit = async (who, over) => {
  await signIn(who)
  b.advance(6)
  return (await C.submitComplaint(form(over))).complaint
}
const rows = (table) => b.fake.rows(table)
const dbAs = (id, labels = []) => createDatabaseServices({ tablesDB: b.fake.as({ id, labels }), databaseId: b.db, Query, ID, now: () => b.deps.now().toISOString() })
const failsWith = (p, status, code) => assert.rejects(p, (e) => e.status === status && (!code || e.code === code), `expected ${status} ${code ?? ''}`)

/* ============================================================== complaints */

test('SUBMIT: a student submits a complaint with a file; it is routed by category and the file is locked read-only', async () => {
  await signIn('s001')
  const file = new File([PNG_BYTES], 'fan.png', { type: 'image/png' })
  b.advance(6)
  const { complaint, duplicate } = await C.submitComplaint(form({ file }))
  assert.equal(duplicate, false)
  assert.match(complaint.reference, /^CMP-\d{8}-[A-Z0-9]{6}$/)
  assert.equal(complaint.status, 'submitted')
  assert.equal(complaint.departmentId, 'cleaning', 'the department comes from the category, set by the server')
  assert.equal(complaint.attachment.name, 'fan.png')
  const row = rows(TABLE_IDS.complaints).find((r) => r.$id === complaint.id)
  assert.equal(row.studentId, 's001', 'the owner is set from the verified session')
  const stored = b.files.get(row.attachmentId)
  assert.ok(stored.$permissions.length > 0 && stored.$permissions.every((p) => p.startsWith('read(')), `the file is read-only for the student after submission: ${stored.$permissions}`)
})

test('SUBMIT: invalid input is refused with field errors; the same complaint twice is received once', async () => {
  await signIn('s001')
  for (const bad of [{ title: 'ab' }, { description: 'short' }, { location: 'x'.repeat(301) }, { categoryId: '' }, { categoryId: 'no-such-category' }]) {
    await assert.rejects(C.submitComplaint(form(bad)), (e) => e.code === 'validation_failed' || e.code === 'invalid_input' || e.status === 400, JSON.stringify(bad))
  }
  b.advance(6)
  const first = await C.submitComplaint(form({ title: 'Projector is broken in room 5' }))
  const again = await C.submitComplaint(form({ title: 'Projector is broken in room 5' }))
  assert.equal(again.duplicate, true)
  assert.equal(again.complaint.id, first.complaint.id)
})

test('HISTORY and TRACKING: a student sees only their own complaints, with a timeline, search, filter and paging', async () => {
  const mine = await submit('s002', { title: 'Wi-Fi is down in the library', categoryId: 'lms-issues', description: 'The Wi-Fi in the library has been down since morning, nobody can connect.' })
  await submit('s002', { title: 'LMS login page fails', categoryId: 'lms-issues', description: 'The LMS login page shows an error after I enter my password.' })
  await signIn('s002')
  const all = await C.listMyComplaints()
  assert.equal(all.total, 2)
  assert.ok(all.complaints.every((c) => rows(TABLE_IDS.complaints).find((r) => r.$id === c.id).studentId === 's002'))
  assert.equal((await C.listMyComplaints({ search: 'wi-fi' })).total, 1)
  assert.equal((await C.listMyComplaints({ status: 'resolved' })).total, 0)
  assert.equal((await C.listMyComplaints({ limit: 1 })).complaints.length, 1)
  const detail = await C.getComplaint(mine.id)
  assert.equal(detail.history[0].status, 'submitted')
  assert.deepEqual(detail.notes, [], 'a student never receives internal notes')
  assert.equal(detail.ai, null, 'a student never receives the AI analysis')
})

test('PRIVACY: another student cannot see, track, download or list someone else\'s complaint (it looks like it does not exist)', async () => {
  const c = await submit('s001', { title: 'Private matter about hostel', categoryId: 'cleaning-issues', file: new File([PDF_BYTES], 'proof.pdf', { type: 'application/pdf' }) })
  await signIn('s003')
  await failsWith(C.getComplaint(c.id), 404, 'not_found')
  await failsWith(C.fetchAttachment(c.id), 404)
  assert.equal((await C.listMyComplaints()).complaints.some((x) => x.id === c.id), false)
  await failsWith(C.getComplaint('does-not-exist'), 404, 'not_found') // same answer as a real-but-foreign complaint
  await failsWith(C.updateComplaintStatus({ complaintId: c.id, status: 'resolved', expectedStatus: 'submitted' }), 403)
  await failsWith(C.addComplaintRemark({ complaintId: c.id, remark: 'hello there' }), 403)
})

test('DEPARTMENT ASSIGNMENT: staff see only their own department; other departments, unassigned staff and students are kept out', async () => {
  const c = await submit('s001', { title: 'Network cable cut in lab', categoryId: 'lms-issues', description: 'A network cable is cut near the lab door and the PCs are offline.' })
  assert.equal(c.departmentId, 'itsc')
  await signIn('itsc1')
  assert.ok((await C.listDepartmentComplaints()).complaints.some((x) => x.id === c.id))
  assert.equal((await C.getComplaint(c.id)).complaint.id, c.id)
  await signIn('clean1')
  assert.equal((await C.listDepartmentComplaints()).complaints.some((x) => x.id === c.id), false, 'cleaning staff do not see IT complaints')
  await failsWith(C.getComplaint(c.id), 404)
  await failsWith(C.updateComplaintStatus({ complaintId: c.id, status: 'in_progress', expectedStatus: 'submitted' }), 404)
  await signIn('nodept')
  assert.equal((await C.listDepartmentComplaints()).complaints.length, 0, 'staff with no department see nothing')
})

test('STATUS UPDATE: staff move a complaint along legal steps with a remark; stale or illegal updates are refused; the student sees the result', async () => {
  const c = await submit('s001', { title: 'Broken chair in class 4', categoryId: 'cleaning-issues', description: 'Three chairs in class 4 are broken and unsafe to sit on.' })
  await signIn('clean1')
  await failsWith(C.updateComplaintStatus({ complaintId: c.id, status: 'resolved', expectedStatus: 'submitted', remark: 'Done already.' }), 409, 'invalid_transition') // must be reviewed first
  await failsWith(C.updateComplaintStatus({ complaintId: c.id, status: 'bogus', expectedStatus: 'submitted' }), 400)
  await failsWith(C.updateComplaintStatus({ complaintId: c.id, status: 'in_progress' }), 400) // the version the screen saw is required
  const started = await C.updateComplaintStatus({ complaintId: c.id, status: 'in_progress', expectedStatus: 'submitted', remark: 'Crew will fix it today.' })
  assert.equal(started.complaint.status, 'in_progress')
  await failsWith(C.updateComplaintStatus({ complaintId: c.id, status: 'resolved', expectedStatus: 'submitted', remark: 'Fixed it.' }), 409, 'stale_status') // someone else changed it
  await C.addComplaintNote({ complaintId: c.id, note: 'Internal: order replacement chairs.' })
  await C.updateComplaintStatus({ complaintId: c.id, status: 'resolved', expectedStatus: 'in_progress', remark: 'Chairs replaced.' })
  await signIn('s001')
  const seen = await C.getComplaint(c.id)
  assert.equal(seen.complaint.status, 'resolved')
  assert.deepEqual(seen.history.map((h) => h.status).filter(Boolean).slice(-2), ['in_progress', 'resolved'])
  assert.equal(JSON.stringify(seen).includes('order replacement chairs'), false, 'internal notes stay internal')
  await failsWith(C.updateComplaintStatus({ complaintId: c.id, status: 'closed', expectedStatus: 'resolved' }), 403)
})

test('ADMIN: administrators see every complaint and can reassign; the old department loses access, the new one gains it', async () => {
  const c = await submit('s003', { title: 'Printer not working in office', categoryId: 'cleaning-issues', description: 'The printer in the admin office prints blank pages every time.' })
  await signIn('admin1')
  assert.ok((await A.listAdminComplaints({ limit: 100 })).complaints.some((x) => x.id === c.id))
  assert.equal((await A.listAdminComplaints({ limit: 100 })).complaints.find((x) => x.id === c.id).reference, c.reference)
  const moved = await C.reassignComplaint({ complaintId: c.id, categoryId: 'lms-issues' })
  assert.equal(moved.complaint.departmentId, 'itsc')
  await signIn('clean1')
  await failsWith(C.getComplaint(c.id), 404)
  await signIn('itsc1')
  assert.equal((await C.getComplaint(c.id)).complaint.id, c.id)
})

/* ============================================================== AI */

const openai = (obj) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
const aiFetch = (respond) => {
  const fn = async (url, init) => {
    fn.calls.push({ url, init, body: JSON.parse(init.body) })
    return respond(fn.calls.at(-1))
  }
  fn.calls = []
  return fn
}
const keyOf = (call, name) => new RegExp(`(C\\d+): ${name} -`).exec(call.body.messages[1].content)[1]

test('AI: analysis produces a summary, a category and department suggestion and a priority - and changes nothing by itself', async () => {
  const fetch = aiFetch((call) => openai({ summary: 'The fan in Lab 3 is broken and the room is hot.', categoryKey: keyOf(call, 'Cleaning Issues'), priority: 'high', sentiment: 'negative', keywords: ['fan', 'heat'], confidence: 0.9, reason: 'Building maintenance.' }))
  t.aiReplies(fetch)
  const c = await submit('s001')
  await signIn('clean1')
  const { ai } = await C.getComplaint(c.id)
  assert.equal(ai.source, 'ai')
  assert.match(ai.summary, /fan in Lab 3/)
  assert.equal(ai.suggestedCategory.id, 'cleaning-issues')
  assert.equal(ai.suggestedDepartment.id, 'cleaning')
  assert.equal(ai.priority, 'high')
  const after = rows(TABLE_IDS.complaints).find((r) => r.$id === c.id)
  assert.equal(after.categoryId, 'cleaning-issues')
  assert.equal(after.status, 'submitted', 'the AI only suggests: category, department and status are unchanged')
  assert.notEqual(after.priority, 'high', 'the AI priority is applied only when a person chooses it')
  const applied = await C.applyAiPriority(c.id)
  assert.equal(applied.complaint.priority, 'high')
  await C.reviewAiAnalysis({ complaintId: c.id, decision: 'accepted' })
})

test('AI: the key never reaches the browser, and personal details are removed from what the provider sees', async () => {
  const fetch = aiFetch(() => openai({ summary: 'Wi-Fi is down.', categoryKey: 'C1', priority: 'medium', sentiment: 'neutral', keywords: ['wifi'], confidence: 0.8, reason: 'x' }))
  t.aiReplies(fetch)
  const c = await submit('s002', { title: 'Wi-Fi is down at hostel', categoryId: 'lms-issues', description: 'Call me on 0300-1234567 or mail ali.private@gmail.com because the hostel Wi-Fi is down.' })
  const sent = JSON.stringify(fetch.calls.map((x) => x.body))
  assert.ok(fetch.calls.length >= 1)
  assert.equal(/1234567|ali\.private@gmail\.com/.test(sent), false, 'phone numbers and e-mails are redacted before the provider')
  assert.equal(sent.includes('s002'), false, 'no user ID is sent')
  await signIn('itsc1')
  const everything = JSON.stringify([await C.getComplaint(c.id), await C.listDepartmentComplaints()])
  assert.equal(everything.includes(SECRET_KEY) || /sk-test|apiKey|Bearer/i.test(everything), false)
})

test('AI FAILURE: a provider error, timeout or garbage answer falls back to rules; the complaint is still saved and staff still get a suggestion', async () => {
  const failures = {
    'HTTP 500': () => new Response('boom', { status: 500 }),
    'rate limited': () => new Response('slow down', { status: 429 }),
    'invalid JSON': () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), { status: 200 }),
    'network error': () => {
      throw new TypeError('fetch failed')
    },
    'unknown category': () => openai({ summary: 'x y z', categoryKey: 'C999', priority: 'urgent!!', sentiment: 'happy', keywords: [], confidence: 7, reason: '' }),
  }
  for (const [name, respond] of Object.entries(failures)) {
    t.aiReplies(aiFetch(respond))
    const c = await submit('s003', { title: `Fan problem (${name})`, description: `The ceiling fan in Lab 3 is not working properly - case ${name}.` })
    assert.ok(rows(TABLE_IDS.complaints).some((r) => r.$id === c.id), `${name}: complaint saved`)
    await signIn('clean1')
    const { ai } = await C.getComplaint(c.id)
    assert.equal(ai.status, 'completed', name)
    assert.equal(ai.source, 'fallback', name)
    assert.ok(ai.summary.length > 5 && ['low', 'medium', 'high', 'urgent'].includes(ai.priority), name)
    assert.ok(ai.confidence >= 0 && ai.confidence <= 1, `${name}: confidence is clamped`)
  }
})

test('AI: only department staff (of that complaint) and administrators can run, review or apply it; students and other departments cannot', async () => {
  t.aiReplies(aiFetch(() => openai({ summary: 'Fan broken.', categoryKey: 'C1', priority: 'low', sentiment: 'neutral', keywords: [], confidence: 0.5, reason: '' })))
  const c = await submit('s001')
  for (const who of ['s001', 's002']) {
    await signIn(who)
    await failsWith(C.requestAiAnalysis(c.id), 403)
    await failsWith(C.reviewAiAnalysis({ complaintId: c.id, decision: 'accepted' }), 403)
    await failsWith(C.applyAiPriority(c.id), 403)
  }
  await signIn('itsc1')
  await failsWith(C.requestAiAnalysis(c.id), 404)
  await signIn('clean2')
  await C.requestAiAnalysis(c.id)
  await signIn('admin1')
  await C.requestAiAnalysis(c.id)
})

/* ============================================================== notifications */

const inbox = (id) => rows(TABLE_IDS.notifications).filter((n) => n.userId === id)

test('NOTIFICATIONS: submitting notifies the student and exactly the department\'s staff; nobody else', async () => {
  const before = rows(TABLE_IDS.notifications).length
  const c = await submit('s001', { title: 'Water leak in washroom', description: 'There is a water leak in the washroom on the first floor.' })
  const fresh = rows(TABLE_IDS.notifications).slice(before).filter((n) => n.relatedComplaintId === c.id)
  const who = fresh.map((n) => n.userId).sort()
  assert.deepEqual(who, ['clean1', 'clean2', 's001'], 'student + cleaning staff only')
  assert.ok(fresh.every((n) => n.isRead === false && n.createdAt))
  assert.equal(fresh.some((n) => n.userId === 'itsc1' || n.userId === 's002' || n.userId === 'admin1'), false)
})

test('NOTIFICATIONS: a status change and a remark notify the student; unread count, mark one, mark all', async () => {
  const c = await submit('s002', { title: 'Dust in the corridor', description: 'The corridor is full of dust and nobody has cleaned it for a week.' })
  await signIn('clean1')
  await C.updateComplaintStatus({ complaintId: c.id, status: 'in_progress', expectedStatus: 'submitted', remark: 'We are on it.' })
  await C.addComplaintRemark({ complaintId: c.id, remark: 'Please keep the area clear.' })
  await signIn('s002')
  const mineDb = dbAs('s002')
  const unread = await mineDb.notifications.countUnread('s002')
  assert.ok(unread >= 3, `confirmation + status + remark (got ${unread})`)
  const list = await mineDb.notifications.list('s002', { limit: 50 })
  assert.equal(list.total, inbox('s002').length)
  const one = list.notifications.find((n) => !n.isRead)
  const res = await N.markNotificationRead(one.id)
  assert.equal(res.notification.isRead, true)
  assert.equal(res.unreadCount, unread - 1)
  assert.equal((await N.markNotificationRead(one.id)).unreadCount, unread - 1, 'marking twice changes nothing')
  assert.ok((await N.markAllNotificationsRead()) >= 1)
  assert.equal(await mineDb.notifications.countUnread('s002'), 0)
  assert.ok(rows(TABLE_IDS.notifications).filter((n) => n.userId === 's001').some((n) => !n.isRead), "someone else's unread notifications are untouched")
})

test('NOTIFICATIONS: they are private - nobody can read, mark or enumerate another user\'s notifications', async () => {
  await submit('s001', { title: 'Another private issue', description: 'Something private that only I and the department should know about.' })
  const theirs = inbox('s001').find((n) => !n.isRead)
  await signIn('s003')
  await failsWith(N.markNotificationRead(theirs.$id), 404, 'not_found')
  await failsWith(N.markNotificationRead('does-not-exist'), 404, 'not_found')
  assert.equal(inbox('s001').find((n) => n.$id === theirs.$id).isRead, false, 'untouched')
  const asS003 = dbAs('s003')
  assert.equal((await asS003.notifications.list('s001', { limit: 50 })).total, 0, 'the database returns nothing for another user\'s ID')
  assert.equal(await asS003.notifications.get(theirs.$id), null)
  assert.equal(await asS003.notifications.countUnread('s001'), 0)
  const asGuest = b.fake.as(null)
  assert.deepEqual(await asGuest.listRows({ databaseId: b.db, tableId: TABLE_IDS.notifications }).then((r) => r.rows, () => []), [], 'a guest gets nothing')
  for (const method of ['createRow', 'updateRow', 'deleteRow']) {
    await assert.rejects(b.fake.as({ id: 's003', labels: [] })[method]({ databaseId: b.db, tableId: TABLE_IDS.notifications, rowId: theirs.$id, data: { userId: 's003', type: 'x', title: 'x', message: 'x', isRead: true }, permissions: ['read("user:s003")'] }), (e) => e.code === 401 || e.code === 403, `browsers cannot ${method} notifications`)
  }
})

test('ANNOUNCEMENTS: only administrators can send; the server picks the recipients; a repeat is not delivered twice', async () => {
  for (const who of ['s001', 'clean1']) {
    await signIn(who)
    await failsWith(N.sendAnnouncement({ audience: 'all_students', title: 'Free coffee', message: 'Everyone gets free coffee today.' }), 403)
  }
  await signIn('admin1')
  await assert.rejects(N.sendAnnouncement({ audience: 'everyone', title: 'Hello there', message: 'Valid message here.' }), (e) => e.status === 400)
  await assert.rejects(N.sendAnnouncement({ audience: 'all_students', title: '<', message: '' }), (e) => e.status === 400)
  const sent = await N.sendAnnouncement({ audience: 'all_staff', title: 'Maintenance window', message: 'Systems will be offline on Friday evening.' })
  assert.equal(sent.recipients, 4)
  assert.ok(inbox('clean1').some((n) => n.title === 'Maintenance window'))
  assert.equal(inbox('s001').some((n) => n.title === 'Maintenance window'), false)
  const again = await N.sendAnnouncement({ audience: 'all_staff', title: 'Maintenance window', message: 'Systems will be offline on Friday evening.' })
  assert.equal(again.created, 0)
  assert.equal(inbox('clean1').filter((n) => n.title === 'Maintenance window').length, 1)
  assert.ok(rows(TABLE_IDS.adminAudit).some((a) => a.action === 'notification.announce'), 'announcements are audited')
})

test.after(() => g.close())
