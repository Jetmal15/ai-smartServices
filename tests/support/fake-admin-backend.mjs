// Test backend for functions/admin-api (TEST ONLY). Same schema-driven fake database as the complaint tests, so everything the
// function writes is validated against database/schema.js (columns, enums, unique indexes).
import { TABLE_IDS } from '../../database/schema.js'
import { createComplaintBackend } from './fake-complaint-backend.mjs'
import { Query } from './fake-tablesdb.mjs'

export function createAdminBackend() {
  const b = createComplaintBackend()
  const server = b.fake.as('server')
  const db = b.db
  const control = { failAudit: false }

  const list = (tableId, queries = []) => server.listRows({ databaseId: db, tableId, queries })
  const get = (tableId, rowId) => server.getRow({ databaseId: db, tableId, rowId }).catch((e) => (e?.code === 404 ? null : Promise.reject(e)))
  const all = async (tableId, queries = [], max = 5000) => {
    const rows = []
    while (rows.length < max) {
      const page = await list(tableId, [...queries, Query.limit(100), Query.offset(rows.length)])
      rows.push(...page.rows)
      if (page.rows.length < 100) break
    }
    return rows
  }
  const count = async (tableId, queries = []) => (await list(tableId, [...queries, Query.limit(1)])).total
  const records = (tableId) => ({
    get: (id) => get(tableId, id),
    listAll: () => all(tableId),
    create: (data) => server.createRow({ databaseId: db, tableId, rowId: 'unique()', data }),
    update: (id, data) => server.updateRow({ databaseId: db, tableId, rowId: id, data }),
    count: ({ status } = {}) => count(tableId, status ? [Query.equal('status', [status])] : []),
  })

  const deps = {
    log: (m) => b.logs.push(m),
    now: () => b.deps.now(),
    verifyJwt: b.deps.verifyJwt,
    users: b.deps.users,
    userRows: {
      get: (id) => get(TABLE_IDS.users, id),
      count: ({ role }) => count(TABLE_IDS.users, [Query.equal('role', [role])]),
      listByRole: (role, max) => all(TABLE_IDS.users, [Query.equal('role', [role])], max),
    },
    departments: records(TABLE_IDS.departments),
    categories: records(TABLE_IDS.categories),
    departmentUsers: {
      get: (id) => get(TABLE_IDS.departmentUsers, id),
      listAll: () => all(TABLE_IDS.departmentUsers),
      listByDepartment: (departmentId) => all(TABLE_IDS.departmentUsers, [Query.equal('departmentId', [departmentId]), Query.orderAsc('$createdAt')]),
      listByUser: (userId) => all(TABLE_IDS.departmentUsers, [Query.equal('userId', [userId])]),
      create: (data) => server.createRow({ databaseId: db, tableId: TABLE_IDS.departmentUsers, rowId: 'unique()', data }),
      update: (id, data) => server.updateRow({ databaseId: db, tableId: TABLE_IDS.departmentUsers, rowId: id, data }),
      remove: (id) => server.deleteRow({ databaseId: db, tableId: TABLE_IDS.departmentUsers, rowId: id }),
    },
    complaints: {
      count: ({ status, statuses, categoryId, departmentId }) =>
        count(TABLE_IDS.complaints, [
          ...(status ? [Query.equal('status', [status])] : []),
          ...(statuses ? [Query.equal('status', statuses)] : []),
          ...(categoryId ? [Query.equal('categoryId', [categoryId])] : []),
          ...(departmentId ? [Query.equal('departmentId', [departmentId])] : []),
        ]),
      listFinished: (max) => all(TABLE_IDS.complaints, [Query.equal('status', ['resolved', 'closed']), Query.orderDesc('$createdAt')], max),
    },
    audit: {
      record: (entry) => {
        if (control.failAudit) return Promise.reject(new Error('audit down'))
        return server.createRow({ databaseId: db, tableId: TABLE_IDS.adminAudit, rowId: 'unique()', data: entry, permissions: ['read("label:admin")'] })
      },
      list: async (limit) => (await list(TABLE_IDS.adminAudit, [Query.orderDesc('createdAt'), Query.orderDesc('$createdAt'), Query.limit(limit)])).rows,
    },
  }
  return { b, deps, control, server }
}
