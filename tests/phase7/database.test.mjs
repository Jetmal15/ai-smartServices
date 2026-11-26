// Phase 7 – database foundation tests. Run: npm run test:phase7
// Runs the REAL service code against an in-memory TablesDB that is built from database/schema.js,
// so the schema, indexes, permissions and services are checked together. No network, no SDK.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { CATEGORY_SEEDS, DEPARTMENT_SEEDS, ENUMS, ROW_ID_PATTERN, TABLE_IDS, TABLES } from '../../database/schema.js'
import { createDatabaseServices } from '../../src/services/db/factory.js'
import { DbError, toDbError } from '../../src/services/db/core.js'
import { createFakeTablesDB, ID, Query } from '../support/fake-tablesdb.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const T = TABLES

/* ---------- actors ---------- */
const GUEST = null
const SERVER = 'server'
const admin = { id: 'admin1', labels: ['admin'] }
const staff = { id: 'staff1', labels: ['department'] }
const student = { id: 'stu1', labels: [] }
const student2 = { id: 'stu2', labels: [] }

function setup() {
  const fake = createFakeTablesDB({ tables: TABLES, clock: () => new Date('2026-11-22T10:00:00Z') })
  const services = (actor) =>
    createDatabaseServices({ tablesDB: fake.as(actor), databaseId: fake.databaseId, Query, ID, now: () => '2026-11-22T10:00:00.000Z' })
  // Users rows are written only by the profile-api function (API key) – mimic that for the fixtures.
  const addUser = (id, role, extra = {}) =>
    fake.as(SERVER).createRow({
      databaseId: fake.databaseId,
      tableId: TABLE_IDS.users,
      rowId: id,
      data: { userId: id, name: `User ${id}`, email: `${id}@test.edu`, role, accountStatus: 'active', createdAt: '2026-11-01T09:00:00.000Z', ...extra },
      permissions: [`read("user:${id}")`, 'read("label:admin")'],
    })
  // Since Phase 13 departments, categories and staff assignments are written only by the server (admin-api). `asAdmin` runs the same
  // service code with server rights, which is what the admin-api function does; browsers (including administrators) cannot write.
  return { fake, services, asAdmin: services(SERVER), asServer: services(SERVER), addUser }
}

const rejects = (promise, code) => assert.rejects(promise, (error) => error instanceof DbError && error.code === code, `expected DbError(${code})`)
const rawCall = (fake, actor, method, args) => fake.as(actor)[method]({ databaseId: fake.databaseId, ...args })
const denied = (promise) => assert.rejects(promise, (error) => error.code === 401)

/* ======================================================================= schema integrity */

test('the required tables exist with the required fields', () => {
  const expected = {
    users: ['userId', 'name', 'email', 'rollNumber', 'role', 'academicDepartment', 'accountStatus', 'createdAt'],
    departments: ['name', 'description', 'email', 'status', 'createdAt'],
    departmentUsers: ['userId', 'departmentId', 'position', 'createdAt'],
    categories: ['name', 'description', 'departmentId', 'status'],
  }
  for (const [key, columns] of Object.entries(expected)) {
    assert.deepEqual(T[key].columns.map((c) => c.key), columns, key)
  }
  assert.deepEqual(Object.keys(T).sort(), ['adminAudit', 'aiSummaries', 'categories', 'complaintHistory', 'complaintNotes', 'complaints', 'departmentUsers', 'departments', 'notifications', 'users'])
})

test('schema is internally consistent (Appwrite rules)', () => {
  const ids = new Set()
  for (const table of Object.values(T)) {
    assert.ok(!ids.has(table.id), `duplicate table id ${table.id}`)
    ids.add(table.id)
    assert.match(table.id, ROW_ID_PATTERN)
    const keys = table.columns.map((c) => c.key)
    assert.equal(new Set(keys).size, keys.length, `${table.id}: duplicate column`)
    for (const column of table.columns) {
      assert.ok(!column.key.startsWith('$'), 'no $ prefix')
      if (column.required) assert.equal(column.default, undefined, `${table.id}.${column.key}: required columns cannot have a default`)
      if (column.type === 'string') assert.ok(column.size > 0, `${table.id}.${column.key} needs a size`)
      if (column.type === 'enum') assert.ok(column.elements.length > 0)
      if (column.type === 'enum' && column.default !== undefined) assert.ok(column.elements.includes(column.default))
    }
    const indexKeys = table.indexes.map((i) => i.key)
    assert.equal(new Set(indexKeys).size, indexKeys.length, `${table.id}: duplicate index key`)
    for (const index of table.indexes) {
      for (const column of index.columns) {
        const def = table.columns.find((c) => c.key === column)
        assert.ok(def, `${table.id}.${index.key}: unknown column ${column}`)
        assert.ok(!def.array, `${table.id}.${index.key}: array columns are not indexed`)
      }
    }
  }
})

test('every reference column is indexed (user/department/category/complaint lookups)', () => {
  for (const table of Object.values(T)) {
    // Required references and complaint routing columns are looked up constantly; optional "suggested…" ones are not.
    for (const column of table.columns.filter((c) => (/Id$/.test(c.key) && c.required) || c.key === 'assignedTo')) {
      if (column.array) continue
      assert.ok(table.indexes.some((i) => i.columns[0] === column.key), `${table.id}.${column.key} has no index`)
    }
  }
})

test('enums match the application constants', () => {
  const constants = read('../../src/lib/constants.js')
  const keysOf = (name) => [...constants.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\}`))[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(keysOf('COMPLAINT_STATUS'), ENUMS.complaintStatus)
  assert.deepEqual(keysOf('COMPLAINT_PRIORITY'), ENUMS.priority)
  assert.deepEqual(keysOf('ACCOUNT_STATUS'), ENUMS.accountStatus)
  assert.deepEqual([...constants.match(/ROLES = \{([\s\S]*?)\}/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]), ENUMS.role)
})

test('frontend table IDs equal the schema IDs', async () => {
  const ids = read('../../src/lib/appwrite/ids.js')
  for (const [name, id] of Object.entries({ USERS: 'users', DEPARTMENTS: 'departments', DEPARTMENT_USERS: 'department_users', CATEGORIES: 'categories', COMPLAINTS: 'complaints', AI_SUMMARIES: 'ai_summaries', NOTIFICATIONS: 'notifications' })) {
    assert.ok(ids.includes(`${name}_TABLE_ID`), name)
    assert.equal(Object.values(TABLE_IDS).includes(id), true)
  }
  assert.ok(!ids.includes("'profiles'"), 'the Phase 6 profiles table is replaced by users')
})

test('seed data: 7 departments and 7 categories, mapped as specified', () => {
  assert.deepEqual(
    DEPARTMENT_SEEDS.map((d) => d.name),
    ['ITSC Department', 'Computer Technician Department', 'Water Cooler Maintenance', 'Clerk Job Department', 'Cleaning Department', 'Concerned Teacher Complaint Department', 'Student Affairs Department'],
  )
  const deptName = (id) => DEPARTMENT_SEEDS.find((d) => d.id === id)?.name
  assert.deepEqual(
    CATEGORY_SEEDS.map((c) => [c.name, deptName(c.departmentId)]),
    [
      ['LMS Issues', 'ITSC Department'],
      ['Computer Problems', 'Computer Technician Department'],
      ['Water Cooler Issues', 'Water Cooler Maintenance'],
      ['Clerk-Related Issues', 'Clerk Job Department'],
      ['Cleaning Issues', 'Cleaning Department'],
      ['Teacher-Related Complaints', 'Concerned Teacher Complaint Department'],
      ['Student Affairs', 'Student Affairs Department'],
    ],
  )
  for (const seed of [...DEPARTMENT_SEEDS, ...CATEGORY_SEEDS]) assert.match(seed.id, ROW_ID_PATTERN)
  assert.equal(new Set(DEPARTMENT_SEEDS.map((d) => d.id)).size, 7)
  for (const seed of DEPARTMENT_SEEDS) assert.ok(seed.name.length <= T.departments.columns.find((c) => c.key === 'name').size)
})

test('the profile-api function uses the same table and field names as the schema', () => {
  const handler = read('../../functions/profile-api/src/handler.js')
  const main = read('../../functions/profile-api/src/main.js')
  for (const column of T.users.columns) assert.ok(handler.includes(column.key), `handler never mentions users.${column.key}`)
  assert.ok(main.includes("'users'") && main.includes("'department_users'") && main.includes("'departments'"))
  for (const value of ENUMS.role) assert.ok(handler.includes(`'${value}'`))
})

/* ======================================================================= the fake itself */

test('fake database enforces the schema (so the other tests mean something)', async () => {
  const { fake } = setup()
  const create = (data, rowId = 'x1') => rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.departments, rowId, data })
  const ok = { name: 'A', status: 'active', createdAt: '2026-11-22T10:00:00.000Z' }
  await assert.rejects(create({ ...ok, bogus: 1 }), /Unknown attribute/)
  await assert.rejects(create({ name: 'A', status: 'active' }), /required/)
  await assert.rejects(create({ ...ok, status: 'deleted' }), /one of/)
  await assert.rejects(create({ ...ok, name: 'x'.repeat(129) }), /longer than/)
  await create(ok)
  await assert.rejects(create(ok, 'x2'), (e) => e.code === 409, 'unique name index')
  await assert.rejects(rawCall(fake, SERVER, 'listRows', { tableId: TABLE_IDS.complaints, queries: [Query.equal('resolutionNote', ['x'])] }), /needs an index/)
  await assert.rejects(rawCall(fake, SERVER, 'listRows', { tableId: 'nope' }), (e) => e.type === 'table_not_found')
})

/* ======================================================================= permissions matrix */

test('PERMISSIONS departments & categories: everyone signed in reads; nobody writes from a browser (only the server does)', async () => {
  const { fake, asServer } = setup()
  await asServer.seedInitialData()
  for (const tableId of [TABLE_IDS.departments, TABLE_IDS.categories]) {
    await denied(rawCall(fake, GUEST, 'listRows', { tableId }))
    for (const actor of [student, staff, admin]) assert.ok((await rawCall(fake, actor, 'listRows', { tableId })).total >= 7)
  }
  const dept = { name: 'Hacked', status: 'active', createdAt: '2026-11-22T10:00:00.000Z' }
  for (const actor of [GUEST, student, staff, admin]) {
    await denied(rawCall(fake, actor, 'createRow', { tableId: TABLE_IDS.departments, rowId: 'h1', data: dept }))
    await denied(rawCall(fake, actor, 'updateRow', { tableId: TABLE_IDS.departments, rowId: 'itsc', data: { status: 'inactive' } }))
    await denied(rawCall(fake, actor, 'updateRow', { tableId: TABLE_IDS.categories, rowId: 'lms-issues', data: { departmentId: 'cleaning' } }))
    await denied(rawCall(fake, actor, 'deleteRow', { tableId: TABLE_IDS.departments, rowId: 'itsc' }))
    await denied(rawCall(fake, actor, 'deleteRow', { tableId: TABLE_IDS.categories, rowId: 'lms-issues' }))
  }
  await rawCall(fake, SERVER, 'updateRow', { tableId: TABLE_IDS.departments, rowId: 'itsc', data: { description: 'edited by the server' } })
})

test('PERMISSIONS users: owner and admins read their rows; no browser can write', async () => {
  const { fake, addUser } = setup()
  await addUser('stu1', 'student')
  await addUser('stu2', 'student')
  await addUser('admin1', 'admin')
  const list = (actor) => rawCall(fake, actor, 'listRows', { tableId: TABLE_IDS.users }).then((r) => r.rows.map((x) => x.$id).sort())
  assert.deepEqual(await list(student), ['stu1'], 'a student sees only their own row')
  assert.deepEqual(await list(student2), ['stu2'])
  assert.deepEqual(await list(admin), ['admin1', 'stu1', 'stu2'])
  assert.deepEqual(await list(staff), [], 'staff cannot see any student or admin row')
  assert.deepEqual(await list(GUEST), [], 'a guest sees nothing')
  await denied(rawCall(fake, student, 'getRow', { tableId: TABLE_IDS.users, rowId: 'stu2' }))
  assert.equal((await rawCall(fake, student, 'getRow', { tableId: TABLE_IDS.users, rowId: 'stu1' })).email, 'stu1@test.edu')
  const data = { userId: 'zz', name: 'Zed', email: 'z@test.edu', role: 'admin', accountStatus: 'active', createdAt: '2026-11-22T10:00:00.000Z' }
  for (const actor of [student, staff, admin]) {
    await denied(rawCall(fake, actor, 'createRow', { tableId: TABLE_IDS.users, rowId: 'zz', data }))
    await denied(rawCall(fake, actor, 'updateRow', { tableId: TABLE_IDS.users, rowId: actor.id === 'admin1' ? 'admin1' : 'stu1', data: { role: 'admin' } }))
    await denied(rawCall(fake, actor, 'deleteRow', { tableId: TABLE_IDS.users, rowId: 'stu1' }))
  }
})

test('PERMISSIONS department_users: staff and admins read; only the server writes', async () => {
  const { fake } = setup()
  const row = { userId: 'staff1', departmentId: 'itsc', createdAt: '2026-11-22T10:00:00.000Z' }
  await denied(rawCall(fake, student, 'listRows', { tableId: TABLE_IDS.departmentUsers }))
  await denied(rawCall(fake, GUEST, 'listRows', { tableId: TABLE_IDS.departmentUsers }))
  await rawCall(fake, staff, 'listRows', { tableId: TABLE_IDS.departmentUsers })
  await rawCall(fake, admin, 'listRows', { tableId: TABLE_IDS.departmentUsers })
  for (const actor of [GUEST, student, staff, admin]) await denied(rawCall(fake, actor, 'createRow', { tableId: TABLE_IDS.departmentUsers, rowId: 'a1', data: row }))
  await rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.departmentUsers, rowId: 'a1', data: row })
  for (const actor of [staff, admin]) {
    await denied(rawCall(fake, actor, 'updateRow', { tableId: TABLE_IDS.departmentUsers, rowId: 'a1', data: { position: 'Head' } }))
    await denied(rawCall(fake, actor, 'deleteRow', { tableId: TABLE_IDS.departmentUsers, rowId: 'a1' }))
  }
  await rawCall(fake, SERVER, 'deleteRow', { tableId: TABLE_IDS.departmentUsers, rowId: 'a1' })
})

test('PERMISSIONS prepared tables are default-deny for browsers (complaints, AI summaries, notifications)', async () => {
  const { fake } = setup()
  const complaint = {
    referenceNumber: 'CMP-20261122-ABC234', studentId: 'stu1', studentName: 'Student One', title: 'Broken fan', description: 'The fan in lab 3 is broken.',
    categoryId: 'cleaning-issues', categoryName: 'Cleaning Issues', departmentId: 'cleaning', departmentName: 'Cleaning Department', status: 'submitted', submittedAt: '2026-11-22T10:00:00.000Z',
  }
  // Nobody in a browser can create rows in these tables yet.
  for (const actor of [GUEST, student, staff, admin]) {
    await denied(rawCall(fake, actor, 'createRow', { tableId: TABLE_IDS.complaints, rowId: 'c1', data: complaint }))
    await denied(rawCall(fake, actor, 'createRow', { tableId: TABLE_IDS.aiSummaries, rowId: 's1', data: { complaintId: 'c1', status: 'pending' } }))
    await denied(rawCall(fake, actor, 'createRow', { tableId: TABLE_IDS.notifications, rowId: 'n1', data: { userId: 'stu1', type: 'system', title: 't', message: 'm' } }))
  }
  // A server (API key) can write them; row permissions then decide who reads.
  await rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.complaints, rowId: 'c1', data: complaint, permissions: ['read("user:stu1")', 'read("label:admin")'] })
  await rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.aiSummaries, rowId: 's1', data: { complaintId: 'c1', status: 'completed', summary: 'Fan broken.', confidence: 0.9, keywords: ['fan', 'lab'] } })
  const total = (actor, tableId) => rawCall(fake, actor, 'listRows', { tableId }).then((r) => r.total)
  assert.equal(await total(student, TABLE_IDS.complaints), 1, 'the complainant sees their own')
  assert.equal(await total(student2, TABLE_IDS.complaints), 0, 'another student sees nothing')
  assert.equal(await total(staff, TABLE_IDS.complaints), 0, 'staff see nothing until the complaint phase grants it')
  assert.equal(await total(GUEST, TABLE_IDS.complaints), 0)
  assert.equal(await total(admin, TABLE_IDS.complaints), 1)
  assert.equal(await total(admin, TABLE_IDS.aiSummaries), 1)
  for (const actor of [GUEST, student, staff]) assert.equal(await total(actor, TABLE_IDS.aiSummaries), 0, 'AI summaries are not readable by browsers yet')
  await denied(rawCall(fake, student, 'updateRow', { tableId: TABLE_IDS.complaints, rowId: 'c1', data: { status: 'resolved' } }))
  await denied(rawCall(fake, student, 'deleteRow', { tableId: TABLE_IDS.complaints, rowId: 'c1' }))
  await assert.rejects(rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.aiSummaries, rowId: 's2', data: { complaintId: 'c1', status: 'pending' } }), (e) => e.code === 409, 'one AI summary per complaint')
  await assert.rejects(rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.aiSummaries, rowId: 's3', data: { complaintId: 'c2', status: 'completed', confidence: 1.5 } }), /above 1/)
  await assert.rejects(rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.complaints, rowId: 'c9', data: { ...complaint, status: 'archived' } }), /one of/)
})

test('PERMISSIONS notifications: only the recipient reads; nobody edits or deletes from a browser; others see nothing', async () => {
  const { fake } = setup()
  const base = { type: 'status_changed', title: 'Update', message: 'Your complaint moved.' }
  const perms = (id) => [`read("user:${id}")`]
  await rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.notifications, rowId: 'n1', data: { ...base, userId: 'stu1' }, permissions: perms('stu1') })
  await rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.notifications, rowId: 'n2', data: { ...base, userId: 'stu2' }, permissions: perms('stu2') })
  const mine = await rawCall(fake, student, 'listRows', { tableId: TABLE_IDS.notifications, queries: [Query.equal('userId', ['stu1']), Query.equal('isRead', [false])] })
  assert.deepEqual(mine.rows.map((r) => r.$id), ['n1'])
  assert.equal(mine.rows[0].isRead, false, 'default applied')
  await denied(rawCall(fake, student, 'getRow', { tableId: TABLE_IDS.notifications, rowId: 'n2' }))
  await denied(rawCall(fake, student, 'updateRow', { tableId: TABLE_IDS.notifications, rowId: 'n2', data: { isRead: true } }))
  await denied(rawCall(fake, student, 'deleteRow', { tableId: TABLE_IDS.notifications, rowId: 'n1' }))
  await denied(rawCall(fake, student, 'createRow', { tableId: TABLE_IDS.notifications, rowId: 'n3', data: { ...base, userId: 'stu1' } }))
  await denied(rawCall(fake, student, 'updateRow', { tableId: TABLE_IDS.notifications, rowId: 'n1', data: { isRead: true } })) // marking as read goes through the server (Phase 12)
  assert.equal((await rawCall(fake, admin, 'listRows', { tableId: TABLE_IDS.notifications })).total, 0, 'even admins do not read other people’s notifications')
})

test('browsers cannot hand out row permissions they do not hold', async () => {
  const { fake } = setup()
  // an admin creating a department row with a permission for someone else is refused
  await denied(rawCall(fake, admin, 'createRow', { tableId: TABLE_IDS.departments, rowId: 'd9', data: { name: 'D', status: 'active', createdAt: '2026-11-22T10:00:00.000Z' }, permissions: ['read("user:other")'] }))
})

/* ======================================================================= seeding */

test('seed creates the 7 departments and 7 categories, and is idempotent', async () => {
  const { asAdmin, fake } = setup()
  const first = await asAdmin.seedInitialData()
  assert.equal(first.departments.created.length, 7)
  assert.equal(first.categories.created.length, 7)
  const second = await asAdmin.seedInitialData()
  assert.deepEqual([second.departments.created.length, second.departments.existing.length, second.categories.created.length, second.categories.existing.length], [0, 7, 0, 7])
  assert.equal(fake.rows(TABLE_IDS.departments).length, 7)
  assert.equal(fake.rows(TABLE_IDS.categories).length, 7)
  const itsc = fake.rows(TABLE_IDS.departments).find((r) => r.$id === 'itsc')
  assert.deepEqual([itsc.name, itsc.status, itsc.email], ['ITSC Department', 'active', null], 'email is left empty, nothing invented')
})

test('seed never overwrites admin edits and reports name clashes instead of duplicating', async () => {
  const { asAdmin, fake } = setup()
  await asAdmin.seedInitialData()
  await asAdmin.departments.update('itsc', { name: 'IT Services', description: 'Edited', status: 'inactive' })
  const again = await asAdmin.seedInitialData()
  assert.equal(again.departments.created.length, 0)
  const itsc = fake.rows(TABLE_IDS.departments).find((r) => r.$id === 'itsc')
  assert.deepEqual([itsc.name, itsc.status], ['IT Services', 'inactive'])

  const other = setup()
  await other.asAdmin.departments.create({ name: 'cleaning department' }) // same name as a seed, different ID
  const report = await other.asAdmin.seedInitialData()
  assert.deepEqual(report.departments.conflicts, ['cleaning'])
  assert.equal(other.fake.rows(TABLE_IDS.departments).length, 7, 'no duplicate created')
})

test('seed by a non-admin is refused', async () => {
  const { services } = setup()
  await rejects(services(student).seedInitialData(), 'forbidden')
})

/* ======================================================================= departments service */

test('departments: create, read, list, update, activate/deactivate', async () => {
  const { asAdmin, services } = setup()
  const created = await asAdmin.departments.create({ name: '  Library   Services ', description: 'Books', email: 'Library@Test.edu' })
  assert.deepEqual([created.name, created.email, created.status, created.createdAt], ['Library Services', 'library@test.edu', 'active', '2026-11-22T10:00:00.000Z'])
  assert.equal('$id' in created || '$permissions' in created, false, 'Appwrite internals stripped')

  assert.equal((await services(student).departments.get(created.id)).name, 'Library Services', 'students can read')
  assert.equal(await asAdmin.departments.get('nope'), null)

  const updated = await asAdmin.departments.update(created.id, { description: 'Books and journals', email: '' })
  assert.deepEqual([updated.description, updated.email, updated.name], ['Books and journals', null, 'Library Services'])
  assert.equal((await asAdmin.departments.deactivate(created.id)).status, 'inactive')
  assert.equal((await asAdmin.departments.activate(created.id)).status, 'active')

  await asAdmin.departments.create({ name: 'Admissions' })
  const all = await asAdmin.departments.list()
  assert.deepEqual(all.departments.map((d) => d.name), ['Admissions', 'Library Services'], 'ordered by name')
  await asAdmin.departments.deactivate(created.id)
  assert.deepEqual((await asAdmin.departments.list({ status: 'active' })).departments.map((d) => d.name), ['Admissions'])
  assert.equal((await asAdmin.departments.list({ limit: 1, offset: 1 })).departments[0].name, 'Library Services')
})

test('departments: duplicate names (any case/spacing) refused; validation is field-level', async () => {
  const { asAdmin } = setup()
  await asAdmin.departments.create({ name: 'Cleaning Department' })
  await rejects(asAdmin.departments.create({ name: ' cleaning   DEPARTMENT ' }), 'conflict')
  const other = await asAdmin.departments.create({ name: 'Other' })
  await rejects(asAdmin.departments.update(other.id, { name: 'CLEANING department' }), 'conflict')
  assert.equal((await asAdmin.departments.update(other.id, { name: 'OTHER' })).name, 'OTHER', 'renaming to your own name is fine')

  const bad = await asAdmin.departments.create({ name: 'A', email: 'nope', status: 'gone' }).catch((e) => e)
  assert.equal(bad.code, 'validation_failed')
  assert.deepEqual(Object.keys(bad.fields).sort(), ['email', 'name', 'status'])
  await rejects(asAdmin.departments.update('missing', { name: 'Fine Name' }), 'not_found')
  await rejects(asAdmin.departments.update(other.id, {}), 'validation_failed')
  await rejects(asAdmin.departments.update(other.id, { createdAt: 'x' }), 'validation_failed')
})

test('departments: students and staff cannot write (Appwrite refuses)', async () => {
  const { asAdmin, services } = setup()
  const dept = await asAdmin.departments.create({ name: 'Protected' })
  for (const actor of [student, staff, GUEST]) {
    await rejects(services(actor).departments.create({ name: 'Mine' }), actor === GUEST ? 'forbidden' : 'forbidden')
    await rejects(services(actor).departments.update(dept.id, { status: 'inactive' }), 'forbidden')
  }
  assert.equal((await asAdmin.departments.get(dept.id)).status, 'active')
})

/* ======================================================================= categories service */

test('categories: create/list/update with department rules', async () => {
  const { asAdmin } = setup()
  await asAdmin.seedInitialData()
  const cat = await asAdmin.categories.create({ name: 'Wi-Fi Issues', departmentId: 'itsc', description: 'Campus Wi-Fi' })
  assert.deepEqual([cat.departmentId, cat.status], ['itsc', 'active'])
  assert.equal((await asAdmin.categories.list({ departmentId: 'itsc' })).total, 2)
  assert.equal((await asAdmin.categories.list()).total, 8)
  assert.equal((await asAdmin.categories.update(cat.id, { departmentId: 'computer-technician' })).departmentId, 'computer-technician')

  await rejects(asAdmin.categories.create({ name: 'wi-fi issues', departmentId: 'itsc' }), 'conflict')
  await rejects(asAdmin.categories.create({ name: 'Ghost', departmentId: 'no-such-dept' }), 'validation_failed')
  await rejects(asAdmin.categories.create({ name: '', departmentId: '' }), 'validation_failed')
  await rejects(asAdmin.categories.update(cat.id, { departmentId: 'no-such-dept' }), 'validation_failed')

  await asAdmin.departments.deactivate('cleaning')
  await rejects(asAdmin.categories.create({ name: 'Dust', departmentId: 'cleaning' }), 'validation_failed')
  await rejects(asAdmin.categories.update(cat.id, { departmentId: 'cleaning' }), 'validation_failed')
  await asAdmin.categories.deactivate('cleaning-issues')
  await rejects(asAdmin.categories.activate('cleaning-issues'), 'validation_failed') // department still inactive
  await asAdmin.departments.activate('cleaning')
  assert.equal((await asAdmin.categories.activate('cleaning-issues')).status, 'active')
})

test('categories.listAvailable hides inactive categories and inactive departments (what the complaint form shows)', async () => {
  const { asAdmin, services } = setup()
  await asAdmin.seedInitialData()
  await asAdmin.categories.deactivate('lms-issues')
  await asAdmin.departments.deactivate('cleaning')
  const available = await services(student).categories.listAvailable()
  const names = available.map((c) => c.name)
  assert.equal(names.length, 5)
  assert.ok(!names.includes('LMS Issues') && !names.includes('Cleaning Issues'))
  assert.equal(available.find((c) => c.id === 'computer-problems').departmentName, 'Computer Technician Department')
})

/* ======================================================================= department staff assignments */

test('assign staff to departments: rules, duplicates, listing, removal', async () => {
  const { asAdmin, addUser } = setup()
  await asAdmin.seedInitialData()
  await addUser('staff1', 'department')
  await addUser('staff2', 'department')
  await addUser('stu1', 'student')
  await addUser('off1', 'department', { accountStatus: 'disabled' })

  const a = await asAdmin.departmentUsers.assign({ userId: 'staff1', departmentId: 'itsc', position: ' Head ' })
  assert.deepEqual([a.userId, a.departmentId, a.position], ['staff1', 'itsc', 'Head'])
  assert.equal((await asAdmin.departmentUsers.assign({ userId: 'staff1', departmentId: 'cleaning' })).position, 'Staff', 'default position')
  await asAdmin.departmentUsers.assign({ userId: 'staff2', departmentId: 'itsc', position: 'Technician' })

  await rejects(asAdmin.departmentUsers.assign({ userId: 'staff1', departmentId: 'itsc' }), 'conflict')
  await rejects(asAdmin.departmentUsers.assign({ userId: 'stu1', departmentId: 'itsc' }), 'validation_failed')
  await rejects(asAdmin.departmentUsers.assign({ userId: 'off1', departmentId: 'itsc' }), 'validation_failed')
  await rejects(asAdmin.departmentUsers.assign({ userId: 'ghost', departmentId: 'itsc' }), 'validation_failed')
  await rejects(asAdmin.departmentUsers.assign({ userId: 'staff2', departmentId: 'nope' }), 'validation_failed')
  await asAdmin.departments.deactivate('student-affairs')
  await rejects(asAdmin.departmentUsers.assign({ userId: 'staff2', departmentId: 'student-affairs' }), 'validation_failed')
  await rejects(asAdmin.departmentUsers.assign({ userId: 'staff2', departmentId: 'cleaning', position: 'x'.repeat(101) }), 'validation_failed')

  assert.deepEqual((await asAdmin.departmentUsers.listByDepartment('itsc')).map((r) => r.userId), ['staff1', 'staff2'])
  const mine = await asAdmin.departmentUsers.listForUserWithDepartments('staff1')
  assert.deepEqual(mine.map((r) => [r.departmentName, r.position]), [['ITSC Department', 'Head'], ['Cleaning Department', 'Staff']])

  assert.equal((await asAdmin.departmentUsers.updatePosition(a.id, 'Director')).position, 'Director')
  await asAdmin.departmentUsers.remove(a.id)
  assert.equal((await asAdmin.departmentUsers.listByUser('staff1')).length, 1)
  await rejects(asAdmin.departmentUsers.remove(a.id), 'not_found')
  assert.equal(await asAdmin.departmentUsers.removeAllForUser('staff1'), 1)
  assert.equal((await asAdmin.departmentUsers.listByUser('staff1')).length, 0)
})

test('concurrent duplicate assignment: the unique index leaves exactly one row', async () => {
  const { asAdmin, addUser, fake } = setup()
  await asAdmin.seedInitialData()
  await addUser('staff1', 'department')
  const results = await Promise.allSettled([1, 2, 3].map(() => asAdmin.departmentUsers.assign({ userId: 'staff1', departmentId: 'itsc' })))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'conflict'))
  assert.equal(fake.rows(TABLE_IDS.departmentUsers).length, 1)
})

test('only administrators can assign staff (staff and students cannot)', async () => {
  const { services, addUser, asAdmin } = setup()
  await asAdmin.seedInitialData()
  await addUser('staff1', 'department')
  // A staff member can read their own user row, passes the service's checks, and is then refused by Appwrite's table permission.
  await rejects(services(staff).departmentUsers.assign({ userId: 'staff1', departmentId: 'itsc' }), 'forbidden')
  // A student cannot read that user row at all, so the service fails closed.
  await rejects(services(student).departmentUsers.assign({ userId: 'staff1', departmentId: 'itsc' }), 'validation_failed')
  assert.equal((await asAdmin.departmentUsers.listByUser('staff1')).length, 0)
  // and even if someone skipped the service, Appwrite refuses the write
  const row = { userId: 'staff1', departmentId: 'itsc', createdAt: '2026-11-22T10:00:00.000Z' }
  await rejects(services(staff).departmentUsers.updatePosition('x', 'Boss'), 'not_found')
  await denied(rawCall(setup().fake, staff, 'createRow', { tableId: TABLE_IDS.departmentUsers, rowId: 'z', data: row }))
})

/* ======================================================================= users (read-only) + no duplicates */

test('users service reads by ID / roll number / email and lists with filters', async () => {
  const { services, addUser } = setup()
  await addUser('stu1', 'student', { rollNumber: '22SW001', academicDepartment: 'Software Engineering' })
  await addUser('stu2', 'student', { rollNumber: '22SW002' })
  await addUser('staff1', 'department')
  const adminUsers = services(admin).users
  assert.equal((await adminUsers.get('stu1')).rollNumber, '22SW001')
  assert.equal((await adminUsers.findByRollNumber(' 22sw002 ')).id, 'stu2')
  assert.equal((await adminUsers.findByEmail('STAFF1@test.edu')).id, 'staff1')
  assert.equal(await adminUsers.findByRollNumber('NOPE-1'), null)
  assert.equal((await adminUsers.list()).total, 3)
  assert.deepEqual((await adminUsers.list({ role: 'student' })).users.map((u) => u.id).sort(), ['stu1', 'stu2'])
  assert.equal((await adminUsers.list({ accountStatus: 'disabled' })).total, 0)
  // a student reads their own row only
  assert.equal((await services(student).users.get('stu1')).id, 'stu1')
  assert.equal(await services(student).users.get('stu2'), null)
  assert.equal((await services(student).users.list()).total, 1)
  assert.equal('$permissions' in (await adminUsers.get('stu1')), false)
  assert.equal(typeof services(admin).users.create, 'undefined', 'the service has no write methods')
})

test('NO DUPLICATE USER RECORDS: row ID = account ID, and unique indexes on userId, email and rollNumber', async () => {
  const { fake, addUser } = setup()
  await addUser('stu1', 'student', { rollNumber: '22SW001' })
  const data = (over) => ({ userId: 'stu1', name: 'Ali', email: 'ali@test.edu', role: 'student', accountStatus: 'active', createdAt: '2026-11-22T10:00:00.000Z', ...over })
  const create = (rowId, over) => rawCall(fake, SERVER, 'createRow', { tableId: TABLE_IDS.users, rowId, data: data(over) })
  await assert.rejects(create('stu1', { email: 'new@test.edu' }), (e) => e.code === 409, 'same row ID')
  await assert.rejects(create('other', { email: 'new@test.edu' }), (e) => e.code === 409, 'same userId under another row ID')
  await assert.rejects(create('other', { userId: 'other', email: 'stu1@test.edu' }), (e) => e.code === 409, 'same email')
  await assert.rejects(create('other', { userId: 'other', email: 'new@test.edu', rollNumber: '22SW001' }), (e) => e.code === 409, 'same roll number')
  await create('s2', { userId: 's2', email: 's2@test.edu' })
  await create('s3', { userId: 's3', email: 's3@test.edu' }) // many rows without a roll number are fine
  assert.equal(fake.rows(TABLE_IDS.users).length, 3)
})

/* ======================================================================= error mapping */

test('toDbError maps Appwrite failures to friendly, typed errors', () => {
  const ex = (code, type = '') => Object.assign(new Error('raw sdk text'), { code, type, name: 'AppwriteException' })
  assert.equal(toDbError(ex(404, 'row_not_found')).code, 'not_found')
  assert.equal(toDbError(ex(404, 'table_not_found')).code, 'not_set_up')
  assert.equal(toDbError(ex(404, 'database_not_found')).code, 'not_set_up')
  assert.equal(toDbError(ex(409)).code, 'conflict')
  assert.equal(toDbError(ex(401, 'user_unauthorized')).code, 'forbidden')
  assert.equal(toDbError(ex(401, 'user_jwt_invalid')).code, 'unauthorized')
  assert.equal(toDbError(ex(403)).code, 'forbidden')
  assert.equal(toDbError(ex(500)).message.includes('raw sdk'), false)
  assert.equal(toDbError(new TypeError('Failed to fetch')).code, 'unavailable')
  assert.equal(toDbError(ex(0)).code, 'unavailable')
})

test('services report a missing table clearly and honour assertReady', async () => {
  const fake = createFakeTablesDB({ tables: {} })
  const svc = createDatabaseServices({ tablesDB: fake.as(SERVER), databaseId: fake.databaseId, Query, ID })
  await rejects(svc.departments.list(), 'not_set_up')
  const notReady = createDatabaseServices({ tablesDB: fake.as(SERVER), databaseId: fake.databaseId, Query, ID, assertReady: () => { throw new Error('Appwrite is not configured.') } })
  await assert.rejects(notReady.departments.list(), /not configured/)
})

test('every query the services send is backed by an index', async () => {
  // The fake refuses un-indexed filters/orders, so exercising every read path proves it.
  const { asAdmin, addUser } = setup()
  await asAdmin.seedInitialData()
  await addUser('staff1', 'department')
  await asAdmin.departmentUsers.assign({ userId: 'staff1', departmentId: 'itsc' })
  await asAdmin.departments.list({ status: 'active' })
  await asAdmin.categories.list({ departmentId: 'itsc', status: 'active' })
  await asAdmin.categories.listAvailable()
  await asAdmin.departmentUsers.listByDepartment('itsc')
  await asAdmin.departmentUsers.listByUser('staff1')
  await asAdmin.users.list({ role: 'department', accountStatus: 'active' })
  await asAdmin.users.findByEmail('a@b.c')
  await asAdmin.users.findByRollNumber('X-1')
})

/* ======================================================================= docs + migration */

test('docs/DATABASE_SCHEMA.md is in sync with database/schema.js (run `npm run db:docs`)', async () => {
  const { renderSchemaDocs } = await import('../../database/render-docs.js')
  assert.equal(read('../../docs/DATABASE_SCHEMA.md'), renderSchemaDocs() + '\n')
})

test('migration: Phase 6 profiles -> users keeps IDs, maps fields, is idempotent, never duplicates', async () => {
  const { migrateProfilesToUsers, mapProfileToUser } = await import('../../database/migrate.js')
  const profiles = {
    id: 'profiles',
    rowSecurity: true,
    permissions: [],
    columns: [
      { key: 'userId', type: 'string', size: 36, required: true },
      { key: 'name', type: 'string', size: 128, required: true },
      { key: 'email', type: 'string', size: 320, required: true },
      { key: 'role', type: 'enum', elements: ENUMS.role, required: true },
      { key: 'status', type: 'enum', elements: ENUMS.accountStatus, required: true },
      { key: 'rollNumber', type: 'string', size: 20, required: false },
      { key: 'department', type: 'string', size: 100, required: false },
      { key: 'accountCreatedAt', type: 'datetime', required: false },
    ],
    indexes: [],
  }
  const fake = createFakeTablesDB({ tables: { ...TABLES, profiles } })
  const server = fake.as(SERVER)
  const put = (id, data) => server.createRow({ databaseId: fake.databaseId, tableId: 'profiles', rowId: id, data: { userId: id, accountCreatedAt: '2026-10-01T08:00:00.000Z', ...data }, permissions: [`read("user:${id}")`] })
  await put('stu1', { name: 'Ali Khan', email: 'ali@test.edu', role: 'student', status: 'active', rollNumber: '22SW001', department: 'Software Engineering' })
  await put('staff1', { name: 'Staff', email: 'staff@test.edu', role: 'department', status: 'disabled', department: 'Software Engineering' })
  await put('admin1', { name: 'Admin', email: 'admin@test.edu', role: 'admin', status: 'active' })

  const run = () => migrateProfilesToUsers({ tablesDB: server, databaseId: fake.databaseId, Query })
  assert.deepEqual(await run(), { total: 3, created: 3, skipped: 0, failed: 0 })
  assert.deepEqual(await run(), { total: 3, created: 0, skipped: 3, failed: 0 }, 'second run changes nothing')
  const users = fake.rows(TABLE_IDS.users)
  assert.equal(users.length, 3)
  const ali = users.find((u) => u.$id === 'stu1')
  assert.deepEqual(
    [ali.userId, ali.rollNumber, ali.academicDepartment, ali.accountStatus, ali.createdAt],
    ['stu1', '22SW001', 'Software Engineering', 'active', '2026-10-01T08:00:00.000Z'],
  )
  const st = users.find((u) => u.$id === 'staff1')
  assert.deepEqual([st.accountStatus, st.academicDepartment, st.rollNumber], ['disabled', null, null], 'staff carry no academic program')
  assert.deepEqual(ali.$permissions, ['read("user:stu1")', 'read("label:admin")'])
  assert.equal(mapProfileToUser({ $id: 'x', $createdAt: '2026-01-01T00:00:00.000Z', name: 'N', email: 'n@t.edu', role: 'student', status: 'active' }).createdAt, '2026-01-01T00:00:00.000Z')
  assert.equal(fake.rows('profiles').length, 3, 'old table untouched')
})
