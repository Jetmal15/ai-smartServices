// Test backend for functions/complaint-api (TEST ONLY).
// Complaint, user, department, category, assignment and notification rows live in the schema-driven fake TablesDB
// (tests/support/fake-tablesdb.mjs), so everything the function writes is validated against database/schema.js
// (columns, sizes, enums, unique indexes) and read permissions are evaluated per actor. Storage is a tiny in-memory fake.
import { TABLE_IDS, TABLES } from '../../database/schema.js'
import { analyzeComplaint } from '../../functions/ai-analysis/src/handler.js'
import { createProvider } from '../../functions/ai-analysis/src/provider.js'
import { createFakeTablesDB, Query } from './fake-tablesdb.mjs'

export function createComplaintBackend({ now = new Date('2026-11-22T10:00:00.000Z') } = {}) {
  let clock = new Date(now)
  const fake = createFakeTablesDB({ tables: TABLES, clock: () => clock })
  const server = fake.as('server')
  const db = fake.databaseId
  const accounts = new Map()
  const jwts = new Map()
  const files = new Map() // id -> { $id, name, mimeType, sizeOriginal, $permissions, bytes }
  const logs = []
  const randomQueue = []
  const failHistory = { on: false }
  const notificationControl = { fail: false }
  const aiRuns = [] // every request to analyse a complaint: { complaintId, force }
  const aiControl = { mode: 'inline', failTrigger: false, provider: createProvider({ provider: 'openai', apiKey: '', model: '', baseUrl: '', timeoutMs: 1000, enabled: true }) }

  const orNull = (error) => {
    if (error?.code === 404) return null
    throw error
  }
  const row = (tableId) => ({ get: (rowId) => server.getRow({ databaseId: db, tableId, rowId }).catch(orNull) })
  const create = (tableId, rowId, data, permissions) => server.createRow({ databaseId: db, tableId, rowId, data, permissions })

  // The ai-analysis function's backend (same fake database). Its AI provider is swapped by tests via aiControl.provider.
  const aiDeps = {
    log: (m) => logs.push(`[ai] ${m}`),
    now: () => new Date(clock),
    get provider() {
      return aiControl.provider
    },
    complaints: { get: (rowId) => server.getRow({ databaseId: db, tableId: TABLE_IDS.complaints, rowId }).catch(orNull) },
    categories: {
      listActive: async () => {
        const cats = (await server.listRows({ databaseId: db, tableId: TABLE_IDS.categories, queries: [Query.equal('status', ['active']), Query.limit(100)] })).rows
        const depts = (await server.listRows({ databaseId: db, tableId: TABLE_IDS.departments, queries: [Query.equal('status', ['active']), Query.limit(100)] })).rows
        const byId = new Map(depts.map((d) => [d.$id, d]))
        return cats
          .filter((c) => byId.has(c.departmentId))
          .map((c) => ({ id: c.$id, name: c.name, description: c.description ?? '', departmentId: c.departmentId, departmentName: byId.get(c.departmentId).name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      },
    },
    aiSummaries: {
      get: (rowId) => server.getRow({ databaseId: db, tableId: TABLE_IDS.aiSummaries, rowId }).catch(orNull),
      create: (rowId, data, permissions) => create(TABLE_IDS.aiSummaries, rowId, data, permissions),
      update: (rowId, data) => server.updateRow({ databaseId: db, tableId: TABLE_IDS.aiSummaries, rowId, data }),
    },
  }

  const deps = {
    log: (m) => logs.push(m),
    now: () => new Date(clock),
    randomChars: (attempt) => randomQueue[attempt],
    verifyJwt: async (jwt) => {
      if (!jwts.has(jwt)) throw new Error('bad jwt')
      return jwts.get(jwt)
    },
    users: { get: async (id) => accounts.get(id) ?? null },
    userRows: {
      ...row(TABLE_IDS.users),
      listIdsByRole: async (role, max) =>
        (await server.listRows({ databaseId: db, tableId: TABLE_IDS.users, queries: [Query.equal('role', [role]), Query.equal('accountStatus', ['active']), Query.limit(max)] })).rows.map((r) => r.$id),
    },
    departments: row(TABLE_IDS.departments),
    categories: row(TABLE_IDS.categories),
    assignments: {
      listUsersOfDepartment: async (departmentId) =>
        (await server.listRows({ databaseId: db, tableId: TABLE_IDS.departmentUsers, queries: [Query.equal('departmentId', [departmentId]), Query.limit(500)] })).rows.map((r) => r.userId),
      listForUser: async (userId) => (await server.listRows({ databaseId: db, tableId: TABLE_IDS.departmentUsers, queries: [Query.equal('userId', [userId])] })).rows,
    },
    complaints: {
      ...row(TABLE_IDS.complaints),
      create: (rowId, data, permissions) => create(TABLE_IDS.complaints, rowId, data, permissions),
      update: (rowId, data) => server.updateRow({ databaseId: db, tableId: TABLE_IDS.complaints, rowId, data }),
      listAllByStudent: async (studentId, max) =>
        (await server.listRows({ databaseId: db, tableId: TABLE_IDS.complaints, queries: [Query.equal('studentId', [studentId]), Query.orderDesc('$createdAt'), Query.limit(max)] })).rows,
      listByStudent: async (studentId, limit) =>
        (await server.listRows({ databaseId: db, tableId: TABLE_IDS.complaints, queries: [Query.equal('studentId', [studentId]), Query.orderDesc('$createdAt'), Query.limit(limit)] })).rows,
      listByDepartments: async (departmentIds, { status, sort = 'newest', limit, offset }) => {
        const queries = [Query.equal('departmentId', departmentIds), sort === 'oldest' ? Query.orderAsc('$createdAt') : Query.orderDesc('$createdAt'), Query.limit(limit), Query.offset(offset)]
        if (status) queries.push(Query.equal('status', [status]))
        const page = await server.listRows({ databaseId: db, tableId: TABLE_IDS.complaints, queries })
        return { rows: page.rows, total: page.total }
      },
      listFiltered: async ({ status, departmentId, categoryId, sort = 'newest', limit, offset }) => {
        const queries = [sort === 'oldest' ? Query.orderAsc('$createdAt') : Query.orderDesc('$createdAt'), Query.limit(limit), Query.offset(offset)]
        if (status) queries.push(Query.equal('status', [status]))
        if (departmentId) queries.push(Query.equal('departmentId', [departmentId]))
        if (categoryId) queries.push(Query.equal('categoryId', [categoryId]))
        const page = await server.listRows({ databaseId: db, tableId: TABLE_IDS.complaints, queries })
        return { rows: page.rows, total: page.total }
      },
      listAllFiltered: async ({ status, departmentId, categoryId, max }) =>
        (await server.listRows({ databaseId: db, tableId: TABLE_IDS.complaints, queries: [...(status ? [Query.equal('status', [status])] : []), ...(departmentId ? [Query.equal('departmentId', [departmentId])] : []), ...(categoryId ? [Query.equal('categoryId', [categoryId])] : []), Query.orderDesc('$createdAt'), Query.limit(max)] })).rows,
      listAllByDepartments: async (departmentIds, { status, max }) =>
        (await server.listRows({ databaseId: db, tableId: TABLE_IDS.complaints, queries: [Query.equal('departmentId', departmentIds), ...(status ? [Query.equal('status', [status])] : []), Query.orderDesc('$createdAt'), Query.limit(max)] })).rows,
      countByDepartments: async (departmentIds, status) =>
        (await server.listRows({ databaseId: db, tableId: TABLE_IDS.complaints, queries: [Query.equal('departmentId', departmentIds), ...(status ? [Query.equal('status', [status])] : []), Query.limit(1)] })).total,
    },
    aiSummaries: aiDeps.aiSummaries,
    ai: {
      trigger: async (complaintId, { force }) => {
        if (aiControl.failTrigger) throw new Error('functions down')
        aiRuns.push({ complaintId, force })
        if (aiControl.mode === 'inline') await analyzeComplaint(aiDeps, complaintId, { force }).catch((e) => logs.push(`[ai] run failed: ${e.message}`))
      },
    },
    notes: {
      create: (data, permissions) => create(TABLE_IDS.complaintNotes, 'unique()', data, permissions),
      listByComplaint: async (complaintId) =>
        (await server.listRows({ databaseId: db, tableId: TABLE_IDS.complaintNotes, queries: [Query.equal('complaintId', [complaintId]), Query.orderAsc('$createdAt'), Query.limit(200)] })).rows,
    },
    history: {
      create: (data, permissions) => {
        if (failHistory.on) return Promise.reject(new Error('history down'))
        return create(TABLE_IDS.complaintHistory, 'unique()', data, permissions)
      },
      listByComplaint: async (complaintId) =>
        (await server.listRows({ databaseId: db, tableId: TABLE_IDS.complaintHistory, queries: [Query.equal('complaintId', [complaintId]), Query.orderAsc('changedAt'), Query.limit(200)] })).rows,
    },
    notifications: {
      create: (rowId, data, permissions) => {
        if (notificationControl.fail) return Promise.reject(new Error('notifications down'))
        return create(TABLE_IDS.notifications, rowId, data, permissions)
      },
      get: (rowId) => server.getRow({ databaseId: db, tableId: TABLE_IDS.notifications, rowId }).catch(orNull),
      update: (rowId, data) => server.updateRow({ databaseId: db, tableId: TABLE_IDS.notifications, rowId, data }),
      listUnread: async (userId, max) => (await server.listRows({ databaseId: db, tableId: TABLE_IDS.notifications, queries: [Query.equal('userId', [userId]), Query.equal('isRead', [false]), Query.limit(max)] })).rows,
      countUnread: async (userId) => (await server.listRows({ databaseId: db, tableId: TABLE_IDS.notifications, queries: [Query.equal('userId', [userId]), Query.equal('isRead', [false]), Query.limit(1)] })).total,
    },
    files: {
      get: async (id) => (files.has(id) ? structuredClone({ ...files.get(id), bytes: undefined }) : null),
      lock: async (id, permissions) => {
        files.get(id).$permissions = [...permissions]
      },
      download: async (id) => files.get(id)?.bytes ?? null,
    },
  }

  const addAccount = (id, { labels = [], status = true, name = `User ${id}` } = {}) => {
    accounts.set(id, { $id: id, name, labels, status })
    jwts.set(`jwt-${id}`, id)
  }
  /** A user ROW (what profile-api writes), so the function can snapshot name and roll number. */
  const addUserRow = (id, role = 'student', extra = {}) =>
    create(
      TABLE_IDS.users,
      id,
      { userId: id, name: `User ${id}`, email: `${id}@test.edu`, role, accountStatus: 'active', createdAt: '2026-11-01T09:00:00.000Z', ...extra },
      [`read("user:${id}")`, 'read("label:admin")'],
    )
  const addStudent = async (id, extra = {}) => {
    addAccount(id)
    await addUserRow(id, 'student', { rollNumber: `22SW-${id}`.slice(0, 20), ...extra })
  }
  const addStaff = async (id, departmentIds = []) => {
    addAccount(id, { labels: ['department'] })
    await addUserRow(id, 'department')
    for (const departmentId of departmentIds) {
      await create(TABLE_IDS.departmentUsers, 'unique()', { userId: id, departmentId, position: 'Staff', createdAt: '2026-11-02T09:00:00.000Z' })
    }
  }
  const addAdmin = async (id) => {
    addAccount(id, { labels: ['admin'] })
    await addUserRow(id, 'admin')
  }
  /** A file as Appwrite stores it right after the browser uploaded it (uploader holds read/update/delete). */
  const addFile = (id, { ownerId, name = 'photo.png', mimeType = 'image/png', size = 1024, bytes = Buffer.from('fake-bytes'), permissions } = {}) =>
    files.set(id, {
      $id: id,
      name,
      mimeType,
      sizeOriginal: size,
      bytes,
      $permissions: permissions ?? [`read("user:${ownerId}")`, `update("user:${ownerId}")`, `delete("user:${ownerId}")`],
    })

  const request = (userId, body, { jwt } = {}) => ({
    req: { headers: { 'x-appwrite-user-id': userId, 'x-appwrite-user-jwt': jwt ?? `jwt-${userId}` }, bodyJson: body },
  })

  return {
    fake,
    deps,
    db,
    logs,
    files,
    randomQueue,
    failHistory,
    notificationControl,
    aiRuns,
    aiControl,
    aiDeps,
    accounts,
    addAccount,
    addStudent,
    addStaff,
    addAdmin,
    addFile,
    request,
    advance: (minutes) => {
      clock = new Date(clock.getTime() + minutes * 60_000)
    },
    setClock: (date) => {
      clock = new Date(date)
    },
  }
}
