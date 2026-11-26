// Phase 12 – notification system tests. Run: npm run test:phase12
// The REAL complaint-api handler (notification creation, mark as read, announcements) against an in-memory backend built from
// database/schema.js, so what is written is validated against the real columns/enums and read access is evaluated per user.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { migrateNotifications } from '../../database/migrate-notifications.js'
import { ENUMS, ROW_ID_PATTERN, TABLE_IDS, TABLES } from '../../database/schema.js'
import { handle } from '../../functions/complaint-api/src/handler.js'
import * as notify from '../../functions/complaint-api/src/notifications.js'
import { NOTIFICATION_TYPES, notificationId, notificationPermissions, sendNotification } from '../../functions/complaint-api/src/notifications.js'
import { formatRelativeTime } from '../../src/lib/format.js'
import { complaintPathFor, NOTIFICATION_TYPE_LABELS, NOTIFICATION_TYPE_VARIANTS, notificationPathFor } from '../../src/lib/notifications.js'
import { createDatabaseServices } from '../../src/services/db/factory.js'
import { createComplaintBackend } from '../support/fake-complaint-backend.mjs'
import { createFakeTablesDB, ID, Query } from '../support/fake-tablesdb.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const NOW = '2026-11-22T10:00:00.000Z'

async function setup() {
  const b = createComplaintBackend()
  const dbServices = (actor) => createDatabaseServices({ tablesDB: b.fake.as(actor), databaseId: b.db, Query, ID, now: () => NOW })
  await dbServices('server').seedInitialData()
  for (const id of ['s001', 's002', 's003']) await b.addStudent(id)
  await b.addStaff('clean1', ['cleaning'])
  await b.addStaff('clean2', ['cleaning'])
  await b.addStaff('itsc1', ['itsc'])
  await b.addStaff('nodept')
  await b.addAdmin('admin1')
  const call = (who, body, opts) => handle(b.request(who, body, opts), b.deps)
  const submit = async (who = 's001', over = {}) => {
    b.advance(3)
    const res = await call(who, { action: 'complaint.submit', title: 'Ceiling fan not working', categoryId: 'cleaning-issues', description: 'The ceiling fan in Lab 3 has stopped working and the room is very hot.', ...over })
    assert.equal(res.body.ok, true, JSON.stringify(res.body))
    return res.body.complaint
  }
  const move = (who, id, status, remark, expectedStatus) => call(who, { action: 'complaint.updateStatus', complaintId: id, status, remark, expectedStatus })
  const all = () => b.fake.rows(TABLE_IDS.notifications)
  const of = (userId) => all().filter((n) => n.userId === userId)
  const server = b.fake.as('server')
  return { b, call, submit, move, all, of, dbServices, server }
}
const err = (res) => res.body.error?.code
const ok = (res) => assert.equal(res.body.ok, true, JSON.stringify(res.body))

/* ============================================================== structure */

test('the notification table has the required fields, readable by the recipient only', () => {
  const t = TABLES.notifications
  for (const key of ['userId', 'title', 'message', 'relatedComplaintId', 'isRead', 'createdAt', 'type', 'readAt']) assert.ok(t.columns.some((c) => c.key === key), key)
  assert.equal(t.columns.find((c) => c.key === 'isRead').default, false)
  assert.deepEqual(t.permissions, [], 'no table-level access for anyone')
  assert.equal(t.rowSecurity, true)
  assert.ok(!t.columns.some((c) => c.key === 'complaintId'), 'complaintId is now relatedComplaintId')
  assert.deepEqual([...NOTIFICATION_TYPES].sort(), [...ENUMS.notificationType].sort(), 'function and schema agree on the types')
  for (const type of ENUMS.notificationType) assert.ok(NOTIFICATION_TYPE_LABELS[type] && NOTIFICATION_TYPE_VARIANTS[type], `screen label for ${type}`)
  for (const index of [['userId', 'isRead'], ['userId', 'createdAt']]) assert.ok(t.indexes.some((i) => i.columns.join() === index.join()), index.join())
  assert.deepEqual(notificationPermissions('u1'), ['read("user:u1")'])
})

test('notification IDs are deterministic, valid Appwrite IDs, and differ per event', () => {
  const a = notificationId('status', 'CMP-1', 'resolved', '2026-01-01T00:00:00.000Z', 's001')
  assert.equal(a, notificationId('status', 'CMP-1', 'resolved', '2026-01-01T00:00:00.000Z', 's001'))
  assert.match(a, ROW_ID_PATTERN)
  assert.equal(a.length, 33)
  const others = [notificationId('status', 'CMP-1', 'resolved', '2026-01-01T00:00:01.000Z', 's001'), notificationId('status', 'CMP-1', 'resolved', '2026-01-01T00:00:00.000Z', 's002'), notificationId('status', 'CMP-2', 'resolved', '2026-01-01T00:00:00.000Z', 's001'), notificationId('submitted', 'CMP-1', 's001')]
  assert.equal(new Set([a, ...others]).size, 5)
})

/* ============================================================== generation: the seven events */

test('EVENT 1: a student submits a complaint → the student gets a confirmation', async () => {
  const t = await setup()
  const c = await t.submit('s001')
  const [n] = t.of('s001')
  assert.deepEqual([n.type, n.title, n.relatedComplaintId, n.isRead, n.readAt], ['complaint_submitted', 'Complaint submitted', c.id, false, null])
  assert.match(n.message, new RegExp(`${c.reference}.*Ceiling fan not working.*Cleaning Department`))
  assert.equal(n.createdAt, '2026-11-22T10:03:00.000Z', 'the time is set by the server')
  assert.deepEqual(n.$permissions, ['read("user:s001")'])
  assert.match(n.$id, ROW_ID_PATTERN)
  assert.equal(t.of('s001').length, 1)
})

test('EVENT 2: a complaint is assigned to a department → that department’s staff, and only they, are told', async () => {
  const t = await setup()
  const c = await t.submit('s001')
  for (const staff of ['clean1', 'clean2']) {
    const [n] = t.of(staff)
    assert.deepEqual([n.type, n.title, n.relatedComplaintId, n.isRead], ['complaint_assigned', 'New complaint for your department', c.id, false], staff)
    assert.match(n.message, new RegExp(`${c.reference}.*Cleaning Issues.*Cleaning Department`))
    assert.deepEqual(n.$permissions, [`read("user:${staff}")`])
    assert.ok(!n.message.includes('User s001') && !n.message.includes('s001'), 'no student identity in the notification')
  }
  for (const nobody of ['itsc1', 'nodept', 'admin1', 's002', 's003']) assert.equal(t.of(nobody).length, 0, nobody)
  assert.equal(t.all().length, 3)
  // another category goes to another department
  const lms = await t.submit('s002', { categoryId: 'lms-issues', title: 'LMS will not open', description: 'The LMS does not open on any browser today.' })
  assert.deepEqual(t.of('itsc1').map((n) => n.relatedComplaintId), [lms.id])
  assert.equal(t.of('clean1').length, 1)
})

test('EVENTS 3-6: status updates notify the student; in progress, resolved and closed have their own notifications', async () => {
  const t = await setup()
  const c = await t.submit('s001')
  const steps = [['under_review', 'We are reviewing it.', 'status_changed', 'Your complaint is under review', 'submitted'], ['in_progress', '', 'complaint_in_progress', 'Your complaint is now in progress', 'under_review'], ['resolved', 'The fan was replaced and tested.', 'complaint_resolved', 'Your complaint has been resolved', 'in_progress'], ['closed', '', 'complaint_closed', 'Your complaint has been closed', 'resolved']]
  for (const [status, remark, type, title, from] of steps) {
    t.b.advance(5)
    ok(await t.move('clean1', c.id, status, remark, from))
    const n = t.of('s001').filter((x) => x.type === type).at(-1)
    assert.ok(n, status)
    assert.deepEqual([n.title, n.relatedComplaintId, n.isRead], [title, c.id, false], status)
    assert.ok(n.message.includes(status.replace('_', ' ')), status)
    if (remark) assert.ok(n.message.includes(remark), 'the public remark is included')
    assert.deepEqual(n.$permissions, ['read("user:s001")'])
  }
  assert.deepEqual(t.of('s001').map((n) => n.type), ['complaint_submitted', 'status_changed', 'complaint_in_progress', 'complaint_resolved', 'complaint_closed'])
  // only the student is notified of updates (not colleagues, other departments, other students)
  assert.equal(t.of('clean1').length, 1)
  assert.equal(t.of('clean2').length, 1)
  for (const nobody of ['itsc1', 's002', 'admin1']) assert.equal(t.of(nobody).length, 0, nobody)
})

test('EVENT 3: a public remark notifies the student; an internal note notifies nobody', async () => {
  const t = await setup()
  const c = await t.submit('s001')
  ok(await t.call('clean1', { action: 'complaint.addRemark', complaintId: c.id, remark: 'We ordered the spare part.' }))
  const n = t.of('s001').find((x) => x.title === 'New remark on your complaint')
  assert.ok(n.message.includes('We ordered the spare part.'))
  const before = t.all().length
  ok(await t.call('clean1', { action: 'complaint.addNote', complaintId: c.id, note: 'Caretaker says the motor is burnt.' }))
  assert.equal(t.all().length, before, 'internal notes never notify')
})

test('EVENT 7: an administrator moves a complaint → student, new department and old department are told what concerns them', async () => {
  const t = await setup()
  const c = await t.submit('s001', { categoryId: 'cleaning-issues' })
  t.b.advance(5)
  ok(await t.call('admin1', { action: 'complaint.reassign', complaintId: c.id, categoryId: 'lms-issues' }))
  const student = t.of('s001').find((n) => n.title === 'Your complaint was forwarded')
  assert.deepEqual([student.type, student.relatedComplaintId], ['complaint_assigned', c.id])
  assert.match(student.message, /forwarded to ITSC Department/)
  const itsc = t.of('itsc1').find((n) => n.type === 'complaint_assigned')
  assert.match(itsc.message, /assigned to ITSC Department by an administrator/)
  for (const old of ['clean1', 'clean2']) {
    const moved = t.of(old).find((n) => n.type === 'admin_update')
    assert.deepEqual([moved.title, moved.relatedComplaintId], ['A complaint was moved out of your department', c.id], old)
    assert.match(moved.message, /Cleaning Department to ITSC Department/)
  }
  for (const nobody of ['nodept', 's002', 's003', 'admin1']) assert.equal(t.of(nobody).length, 0, nobody)
})

test('EVENT 7: administrator announcements reach exactly the chosen audience', async () => {
  const t = await setup()
  const c = await t.submit('s001')
  t.all().length = 0
  const send = (body) => t.call('admin1', { action: 'notification.announce', title: 'Campus closed Friday', message: 'The campus is closed on Friday for maintenance.', ...body })
  const recipients = (title = 'Campus closed Friday') => t.all().filter((n) => n.title === title).map((n) => n.userId).sort()

  let res = await send({ audience: 'all_students' })
  ok(res)
  assert.deepEqual([res.body.recipients, res.body.created, res.body.duplicate, res.body.failed], [3, 3, 0, 0])
  assert.deepEqual(recipients(), ['s001', 's002', 's003'])
  const n = t.of('s002').find((x) => x.title === 'Campus closed Friday')
  assert.deepEqual([n.type, n.relatedComplaintId, n.isRead, n.message], ['admin_update', null, false, 'The campus is closed on Friday for maintenance.'])

  res = await send({ audience: 'all_staff', title: 'Staff meeting', message: 'All staff meet on Monday at 10.' })
  assert.deepEqual(t.all().filter((n) => n.title === 'Staff meeting').map((x) => x.userId).sort(), ['clean1', 'clean2', 'itsc1', 'nodept'])

  res = await send({ audience: 'department', departmentId: 'cleaning', title: 'Cleaning rota', message: 'New cleaning rota starts today.' })
  assert.deepEqual(t.all().filter((n) => n.title === 'Cleaning rota').map((x) => x.userId).sort(), ['clean1', 'clean2'])

  res = await send({ audience: 'complaint', complaintId: c.id, title: 'About your complaint', message: 'The administrator is following up on your complaint.' })
  const about = t.all().filter((n) => n.title === 'About your complaint')
  assert.deepEqual(about.map((x) => [x.userId, x.relatedComplaintId]), [['s001', c.id]])

  // disabled users are skipped
  await t.server.updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.users, rowId: 's003', data: { accountStatus: 'disabled' } })
  res = await send({ audience: 'all_students', title: 'Second notice', message: 'A second notice for active students.' })
  assert.deepEqual(res.body.recipients, 2)
})

test('announcements: only administrators; strict validation; nobody to notify is reported', async () => {
  const t = await setup()
  const c = await t.submit('s001')
  const body = { action: 'notification.announce', audience: 'all_students', title: 'Valid title', message: 'A valid message body.' }
  for (const who of ['s001', 'clean1']) assert.equal((await t.call(who, body)).status, 403, who)
  assert.equal((await t.call('s001', body, { jwt: 'jwt-s002' })).status, 401)
  const before = t.all().length
  const bad = async (over) => err(await t.call('admin1', { ...body, ...over }))
  assert.equal(await bad({ title: '' }), 'validation_failed')
  assert.equal(await bad({ title: 'x'.repeat(121) }), 'validation_failed')
  assert.equal(await bad({ title: '!!!' }), 'validation_failed')
  assert.equal(await bad({ message: 'ab' }), 'validation_failed')
  assert.equal(await bad({ message: 'm'.repeat(1001) }), 'validation_failed')
  assert.equal(await bad({ audience: 'everyone' }), 'validation_failed')
  assert.equal(await bad({ audience: undefined }), 'validation_failed')
  assert.equal(await bad({ audience: 'department' }), 'validation_failed')
  assert.equal(await bad({ audience: 'department', departmentId: 'no-such' }), 'validation_failed')
  assert.equal(await bad({ audience: 'complaint', complaintId: 'CMP-NOPE' }), 'validation_failed')
  assert.equal(await bad({ audience: 'complaint', complaintId: '../x' }), 'validation_failed')
  assert.equal(await bad({ title: { a: 1 } }), 'validation_failed')
  assert.equal(t.all().length, before, 'nothing was sent')
  assert.equal(await bad({ audience: 'department', departmentId: 'student-affairs' }), 'no_recipients', 'a department with no staff')
  assert.ok(c.id)
})

/* ============================================================== duplicates */

test('DUPLICATES: the same event never notifies the same person twice', async () => {
  const t = await setup()
  const c = await t.submit('s001')
  const row = t.b.fake.rows(TABLE_IDS.complaints)[0]
  const count = () => t.all().length
  const before = count()
  // retrying the very same status event (same time) is a no-op
  await notify.statusChanged(t.b.deps, row, { status: 'in_progress', remark: '', stamp: '2026-11-22T11:00:00.000Z' })
  assert.equal(count(), before + 1)
  await notify.statusChanged(t.b.deps, row, { status: 'in_progress', remark: '', stamp: '2026-11-22T11:00:00.000Z' })
  await notify.statusChanged(t.b.deps, row, { status: 'in_progress', remark: 'different text, same event', stamp: '2026-11-22T11:00:00.000Z' })
  assert.equal(count(), before + 1, 'same event, same stamp: one notification')
  // a genuinely later event notifies again (e.g. resolved, re-opened, resolved again)
  await notify.statusChanged(t.b.deps, row, { status: 'resolved', remark: '', stamp: '2026-11-22T12:00:00.000Z' })
  await notify.statusChanged(t.b.deps, row, { status: 'resolved', remark: '', stamp: '2026-11-22T14:00:00.000Z' })
  assert.equal(count(), before + 3)
  // re-sending the initial complaint events adds nothing
  await notify.complaintSubmitted(t.b.deps, row)
  assert.equal(count(), before + 3)
  const direct = await sendNotification(t.b.deps, { userId: 's001', type: 'system', title: 'x', message: 'y', key: ['custom', '1'] })
  assert.equal(direct, 'created')
  assert.equal(await sendNotification(t.b.deps, { userId: 's001', type: 'system', title: 'x', message: 'y', key: ['custom', '1'] }), 'duplicate')
  assert.equal(await sendNotification(t.b.deps, { userId: 's002', type: 'system', title: 'x', message: 'y', key: ['custom', '1'] }), 'created', 'the same event for a different person is separate')
  assert.ok(c.id)
})

test('DUPLICATES: double-click on submit and double-sent announcements do not multiply notifications', async () => {
  const t = await setup()
  await t.submit('s001')
  const afterFirst = t.all().length
  t.b.advance(1)
  const again = await t.call('s001', { action: 'complaint.submit', title: 'Ceiling fan not working', categoryId: 'cleaning-issues', description: 'The ceiling fan in Lab 3 has stopped working and the room is very hot.' })
  assert.equal(again.body.duplicate, true)
  assert.equal(t.all().length, afterFirst)

  const send = (over) => t.call('admin1', { action: 'notification.announce', audience: 'all_staff', title: 'Fire drill today', message: 'There is a fire drill at noon.', ...over })
  const first = await send()
  assert.deepEqual([first.body.created, first.body.duplicate], [4, 0])
  const second = await send()
  assert.deepEqual([second.body.created, second.body.duplicate], [0, 4], 'sending it again within minutes creates nothing')
  assert.equal(t.all().filter((n) => n.title === 'Fire drill today').length, 4)
  assert.equal((await send({ message: 'There is a fire drill at one.' })).body.created, 4, 'a different message is a different announcement')
  t.b.advance(6)
  assert.equal((await send()).body.created, 4, 'the same text much later is a new announcement')
})

test('a failing notification never blocks the complaint or the update', async () => {
  const t = await setup()
  t.b.notificationControl.fail = true
  const c = await t.submit('s001')
  assert.ok(c.id)
  assert.equal(t.all().length, 0)
  assert.ok(t.b.logs.some((l) => l.includes('could not create a notification')))
  ok(await t.move('clean1', c.id, 'under_review', '', 'submitted'))
  assert.equal(t.b.fake.rows(TABLE_IDS.complaints)[0].status, 'under_review')
})

/* ============================================================== mark as read & permissions */

test('MARK AS READ: the owner marks their notification (only isRead/readAt change); repeating it is harmless', async () => {
  const t = await setup()
  await t.submit('s001')
  const [n] = t.of('s001')
  t.b.advance(30)
  const res = await t.call('s001', { action: 'notification.markRead', notificationId: n.$id, title: 'HACKED', message: 'hacked', userId: 's002', isRead: false, relatedComplaintId: 'X', type: 'system' })
  ok(res)
  assert.deepEqual([res.body.notification.isRead, res.body.unreadCount], [true, 0])
  const stored = t.of('s001')[0]
  assert.deepEqual([stored.isRead, stored.title, stored.message, stored.userId, stored.type, stored.relatedComplaintId], [true, n.title, n.message, 's001', n.type, n.relatedComplaintId])
  assert.equal(stored.readAt, '2026-11-22T10:33:00.000Z')
  t.b.advance(30)
  const again = await t.call('s001', { action: 'notification.markRead', notificationId: n.$id })
  ok(again)
  assert.equal(t.of('s001')[0].readAt, '2026-11-22T10:33:00.000Z', 'the first read time is kept')
})

test('MARK AS READ: other people’s notifications look like missing ones and are never changed', async () => {
  const t = await setup()
  await t.submit('s001')
  const [n] = t.of('s001')
  for (const who of ['s002', 'clean1', 'admin1', 'nodept']) {
    const res = await t.call(who, { action: 'notification.markRead', notificationId: n.$id })
    assert.equal(res.status, 404, who)
    assert.equal(err(res), 'not_found')
  }
  assert.equal(t.of('s001')[0].isRead, false)
  for (const id of ['', undefined, '../x', 'n'.repeat(80), 12, { a: 1 }]) assert.equal((await t.call('s001', { action: 'notification.markRead', notificationId: id })).status, 404, JSON.stringify(id))
  assert.equal((await t.call('s001', { action: 'notification.markRead', notificationId: n.$id }, { jwt: 'jwt-s002' })).status, 401)
  assert.equal((await handle({ req: { headers: {}, bodyJson: { action: 'notification.markRead', notificationId: n.$id } } }, t.b.deps)).status, 401)
})

test('MARK ALL AS READ: only the caller’s notifications, in batches, for every role', async () => {
  const t = await setup()
  await t.submit('s001')
  await t.submit('s002', { title: 'Another complaint here' })
  await t.call('clean1', { action: 'complaint.addRemark', complaintId: t.b.fake.rows(TABLE_IDS.complaints)[0].$id, remark: 'Remark for the first student.' })
  assert.equal(t.of('s001').filter((n) => !n.isRead).length, 2)
  const res = await t.call('s001', { action: 'notification.markAllRead' })
  ok(res)
  assert.deepEqual([res.body.marked, res.body.unreadCount, res.body.more], [2, 0, false])
  assert.ok(t.of('s001').every((n) => n.isRead && n.readAt))
  assert.ok(t.of('s002').every((n) => !n.isRead), 'another user’s notifications are untouched')
  assert.ok(t.of('clean1').every((n) => !n.isRead))
  assert.equal((await t.call('s001', { action: 'notification.markAllRead' })).body.marked, 0)
  assert.equal((await t.call('clean1', { action: 'notification.markAllRead' })).body.marked, 2, 'staff mark their own (one per complaint routed to their department)')
  assert.equal((await t.call('admin1', { action: 'notification.markAllRead' })).body.marked, 0)
  // batching: 250 unread need two rounds
  for (let i = 0; i < 250; i++) await t.server.createRow({ databaseId: t.b.db, tableId: TABLE_IDS.notifications, rowId: notificationId('bulk', i), data: { userId: 's003', type: 'system', title: `n${i}`, message: 'm', createdAt: NOW }, permissions: ['read("user:s003")'] })
  const first = await t.call('s003', { action: 'notification.markAllRead' })
  assert.deepEqual([first.body.marked, first.body.more, first.body.unreadCount], [200, true, 50])
  const second = await t.call('s003', { action: 'notification.markAllRead' })
  assert.deepEqual([second.body.marked, second.body.more, second.body.unreadCount], [50, false, 0])
})

test('PERMISSIONS: users read only their own notifications; nobody can create, edit or delete from a browser', async () => {
  const t = await setup()
  await t.submit('s001')
  await t.submit('s002', { title: 'Another complaint here' })
  const as = (id, labels = []) => t.b.fake.as({ id, labels })
  const own = (id, labels) => as(id, labels).listRows({ databaseId: t.b.db, tableId: TABLE_IDS.notifications }).then((r) => r.rows.map((x) => x.userId))
  assert.deepEqual([...new Set(await own('s001'))], ['s001'])
  assert.deepEqual([...new Set(await own('s002'))], ['s002'])
  assert.deepEqual([...new Set(await own('clean1', ['department']))], ['clean1'])
  assert.deepEqual(await own('admin1', ['admin']), [], 'even administrators cannot read other people’s notifications')
  assert.deepEqual(await t.b.fake.as(null).listRows({ databaseId: t.b.db, tableId: TABLE_IDS.notifications }).then((r) => r.rows, () => []), [])
  const mine = t.of('s001')[0]
  await assert.rejects(as('s002').getRow({ databaseId: t.b.db, tableId: TABLE_IDS.notifications, rowId: mine.$id }), (e) => e.code === 401)
  // no direct writes, not even by the owner or an administrator
  const denied = (p) => assert.rejects(p, (e) => e.code === 401)
  for (const [id, labels] of [['s001', []], ['clean1', ['department']], ['admin1', ['admin']]]) {
    await denied(as(id, labels).updateRow({ databaseId: t.b.db, tableId: TABLE_IDS.notifications, rowId: mine.$id, data: { isRead: true } }))
    await denied(as(id, labels).deleteRow({ databaseId: t.b.db, tableId: TABLE_IDS.notifications, rowId: mine.$id }))
    await denied(as(id, labels).createRow({ databaseId: t.b.db, tableId: TABLE_IDS.notifications, rowId: 'nforged', data: { userId: 's001', type: 'system', title: 't', message: 'm' }, permissions: [`read("user:${id}")`] }))
  }
  assert.equal(t.of('s001')[0].isRead, false)
})

test('DATABASE SERVICE: newest first, unread filter, paging, unread count, own notifications only', async () => {
  const t = await setup()
  const make = (userId, i, isRead = false) =>
    t.server.createRow({ databaseId: t.b.db, tableId: TABLE_IDS.notifications, rowId: notificationId('seed', userId, i), data: { userId, type: 'system', title: `Title ${i}`, message: `Message ${i}`, isRead, createdAt: new Date(Date.UTC(2026, 10, 1, 10, i)).toISOString() }, permissions: [`read("user:${userId}")`] })
  for (let i = 1; i <= 12; i++) await make('s001', i, i <= 4)
  await make('s002', 99)
  const svc = (id, labels = []) => createDatabaseServices({ tablesDB: t.b.fake.as({ id, labels }), databaseId: t.b.db, Query, ID }).notifications
  const mine = svc('s001')
  const first = await mine.list('s001', { limit: 5 })
  assert.deepEqual(first.notifications.map((n) => n.title), ['Title 12', 'Title 11', 'Title 10', 'Title 9', 'Title 8'])
  assert.equal(first.total, 12)
  assert.deepEqual((await mine.list('s001', { limit: 5, offset: 10 })).notifications.map((n) => n.title), ['Title 2', 'Title 1'])
  const unread = await mine.list('s001', { unreadOnly: true, limit: 50 })
  assert.equal(unread.total, 8)
  assert.ok(unread.notifications.every((n) => !n.isRead))
  assert.equal(await mine.countUnread('s001'), 8)
  assert.deepEqual(Object.keys(first.notifications[0]).sort(), ['createdAt', 'id', 'isRead', 'message', 'readAt', 'relatedComplaintId', 'title', 'type'])
  // another user's notifications cannot be reached, even by naming their ID
  assert.equal((await mine.list('s002')).total, 0)
  assert.equal(await mine.countUnread('s002'), 0)
  assert.equal(await mine.get(notificationId('seed', 's002', 99)), null)
  assert.equal((await mine.get(notificationId('seed', 's001', 3))).title, 'Title 3')
  assert.equal(await mine.get('nope'), null)
  assert.equal(await svc('admin1', ['admin']).get(notificationId('seed', 's001', 3)), null)
  assert.equal(typeof mine.create, 'undefined')
  assert.equal(typeof mine.update, 'undefined')
  assert.equal(typeof mine.markRead, 'undefined')
})

/* ============================================================== presentation helpers */

test('TIMESTAMPS: clear relative times with the exact time available', () => {
  const now = new Date(2026, 10, 22, 15, 30, 0)
  const ago = (ms) => new Date(now.getTime() - ms).toISOString()
  assert.equal(formatRelativeTime(ago(10_000), now), 'Just now')
  assert.equal(formatRelativeTime(ago(60_000), now), '1 minute ago')
  assert.equal(formatRelativeTime(ago(5 * 60_000), now), '5 minutes ago')
  assert.equal(formatRelativeTime(ago(59 * 60_000), now), '59 minutes ago')
  assert.equal(formatRelativeTime(new Date(2026, 10, 22, 12, 30).toISOString(), now), '3 hours ago')
  assert.equal(formatRelativeTime(new Date(2026, 10, 22, 14, 0).toISOString(), now), '1 hour ago')
  assert.match(formatRelativeTime(new Date(2026, 10, 21, 23, 50).toISOString(), now), /^Yesterday at /)
  assert.match(formatRelativeTime(new Date(2026, 10, 19, 9, 40).toISOString(), now), /^[A-Za-z]+ at /)
  assert.match(formatRelativeTime(new Date(2026, 9, 1, 9, 40).toISOString(), now), /2026/)
  assert.equal(formatRelativeTime(null, now), '—')
  assert.equal(formatRelativeTime('garbage', now), '—')
  assert.equal(formatRelativeTime(new Date(now.getTime() + 5000).toISOString(), now), 'Just now', 'a clock a few seconds ahead is not shown as the future')
})

test('links: each role goes to its own complaint and notification pages', () => {
  assert.equal(complaintPathFor('student', 'CMP-1'), '/student/complaints/CMP-1')
  assert.equal(complaintPathFor('department', 'CMP-1'), '/department/complaints/CMP-1')
  assert.equal(complaintPathFor('admin', 'CMP-1'), '/admin/complaints/CMP-1')
  assert.equal(complaintPathFor('student', null), null)
  assert.equal(complaintPathFor('nobody', 'CMP-1'), null)
  assert.equal(notificationPathFor('student', 'n1'), '/student/notifications/n1')
  assert.equal(notificationPathFor('admin', 'n1'), '/admin/notifications/n1')
})

/* ============================================================== screens & wiring */

test('the bell, dropdown, page and details are wired to the server and offer every feature', () => {
  const bell = read('../../src/components/notifications/NotificationBell.jsx')
  for (const text of ['aria-label', 'unread', 'Mark all as read', 'View all notifications', 'You have no notifications yet', 'Loading notifications', 'Escape']) assert.ok(bell.includes(text), `bell: ${text}`)
  assert.ok(read('../../src/components/layout/DashboardTopbar.jsx').includes('NotificationBell'))
  assert.ok(read('../../src/layouts/DashboardLayout.jsx').includes('NotificationsProvider'))
  const page = read('../../src/pages/notifications/NotificationsPage.jsx')
  for (const text of ['Mark all as read', 'Mark as read', 'No notifications yet', 'No unread notifications', 'Loading notifications', 'Unread', 'Pager', 'NotificationTime']) assert.ok(page.includes(text), `page: ${text}`)
  const detail = read('../../src/pages/notifications/NotificationDetailPage.jsx')
  for (const text of ['markRead', 'View complaint', 'Notification not found', 'formatDateTime', 'Back to notifications']) assert.ok(detail.includes(text), `details: ${text}`)
  assert.ok(read('../../src/components/notifications/NotificationTime.jsx').includes('title={formatDateTime'), 'exact time in a tooltip')
  const routes = read('../../src/routes/AppRoutes.jsx')
  for (const role of ['student', 'department', 'admin']) {
    assert.ok(routes.includes(`${role}.notifications`) && routes.includes(`${role}.notificationDetails`), role)
  }
  assert.equal((routes.match(/canAnnounce/g) ?? []).length, 1, 'only the administrator route can send announcements')
  assert.ok(routes.includes('<NotificationsPage canAnnounce />'))
})

test('the browser can only READ notifications directly; every write goes through the server', () => {
  const provider = read('../../src/context/NotificationsProvider.jsx')
  const service = read('../../src/services/notificationService.js')
  const dbService = read('../../src/services/db/notifications.js')
  for (const source of [provider, service, dbService, read('../../src/pages/notifications/NotificationsPage.jsx'), read('../../src/components/notifications/NotificationBell.jsx')]) {
    assert.ok(!/updateRow|createRow|deleteRow|tablesDB\.(update|create|delete)/.test(source), 'no direct database writes in the browser')
  }
  for (const action of ['notification.markRead', 'notification.markAllRead', 'notification.announce']) assert.ok(service.includes(`'${action}'`), action)
  assert.ok(provider.includes('POLL_MS') && provider.includes('visibilitychange'), 'the unread count refreshes by itself')
  const announce = read('../../src/components/notifications/AnnouncementForm.jsx')
  assert.ok(!/userId|recipients\s*:/.test(announce.replace(/recipients\b/g, '')) || !announce.includes('userIds'), 'the form never chooses recipients itself')
})

/* ============================================================== migration */

test('MIGRATION: Phase 7-11 notifications are upgraded (relatedComplaintId, createdAt, read-only) and nothing breaks', async () => {
  const legacy = { ...TABLES.notifications, columns: [...TABLES.notifications.columns, { key: 'complaintId', type: 'string', size: 36, required: false }] }
  const fake = createFakeTablesDB({ tables: { ...TABLES, notifications: legacy } })
  const server = fake.as('server')
  const db = fake.databaseId
  const old = (id, userId, extra) => server.createRow({ databaseId: db, tableId: 'notifications', rowId: id, data: { userId, type: 'status_changed', title: 'Old', message: 'Old message', isRead: false, ...extra }, permissions: [`read("user:${userId}")`, `update("user:${userId}")`] })
  await old('old1', 's001', { complaintId: 'CMP-1' })
  await old('old2', 's002', {})
  await server.createRow({ databaseId: db, tableId: 'notifications', rowId: 'current1', data: { userId: 's003', type: 'system', title: 'New', message: 'New message', relatedComplaintId: 'CMP-3', createdAt: NOW }, permissions: ['read("user:s003")'] })
  const run = () => migrateNotifications({ tablesDB: server, databaseId: db, Query })
  assert.deepEqual(await run(), { total: 3, updated: 2, unchanged: 1, failed: 0 })
  assert.deepEqual(await run(), { total: 3, updated: 0, unchanged: 3, failed: 0 }, 'idempotent')
  const rows = fake.rows('notifications')
  const one = rows.find((r) => r.$id === 'old1')
  assert.deepEqual([one.relatedComplaintId, one.createdAt === one.$createdAt, one.$permissions], ['CMP-1', true, ['read("user:s001")']])
  const owner = fake.as({ id: 's001', labels: [] })
  await assert.rejects(owner.updateRow({ databaseId: db, tableId: 'notifications', rowId: 'old1', data: { isRead: true } }), (e) => e.code === 401, 'the owner can no longer edit it')
  assert.equal((await owner.listRows({ databaseId: db, tableId: 'notifications' })).total, 1, 'but can still read it')
})
