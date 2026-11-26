
import { Account, Client, Functions, ID, Query, Storage, TablesDB, Users } from 'node-appwrite'
import { timingSafeEqual } from 'node:crypto'
import { handle } from './handler.js'
// import { analyzeComplaint, analysisPermissions } from './ai/handler.js'
import { analyzeComplaint } from './ai/handler.js'
import { createProvider, providerConfigFromEnv } from './ai/provider.js'

const PAGE_SIZE = 100
const MAX_ITEMS = 5000

const orNull = (error) => {
  if (error?.code === 404) return null
  throw error
}

async function listAllPages(fetchPage, max = MAX_ITEMS) {
  const items = []
  while (items.length < max) {
    const page = await fetchPage([Query.limit(PAGE_SIZE), Query.offset(items.length)])
    items.push(...page.rows)
    if (page.rows.length < PAGE_SIZE) break
  }
  return items
}

function secretMatches(received, expected) {
  if (!received || !expected) return false
  const a = Buffer.from(String(received))
  const b = Buffer.from(String(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}

function requestBody(req) {
  if (req.bodyJson && typeof req.bodyJson === 'object') return req.bodyJson
  if (req.body && typeof req.body === 'object') return req.body
  try {
    return JSON.parse(req.bodyText || req.body || '{}')
  } catch {
    return {}
  }
}

export function createDeps({ endpoint, projectId, apiKey, databaseId, ids, log, internalSecret, functionId }) {
  const admin = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey)
  const users = new Users(admin)
  const tables = new TablesDB(admin)
  const storage = new Storage(admin)
  const runner = new Functions(admin)

  const row = (tableId) => ({
    get: (rowId) => tables.getRow({ databaseId, tableId, rowId }).catch(orNull),
  })

  return {
    log,

    provider: createProvider(providerConfigFromEnv(process.env)),

    async verifyJwt(jwt) {
      const asUser = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt)
      return (await new Account(asUser).get()).$id
    },

    users: { get: (userId) => users.get({ userId }).catch(orNull) },
    userRows: row(ids.users),
    departments: row(ids.departments),
    categories: {
      ...row(ids.categories),
      async listActive() {
        const categories = await listAllPages((queries) =>
          tables.listRows({
            databaseId,
            tableId: ids.categories,
            queries: [Query.equal('status', ['active']), ...queries],
          }),
        )

        return Promise.all(categories.map(async (category) => {
          const department = await tables.getRow({
            databaseId,
            tableId: ids.departments,
            rowId: category.departmentId,
          }).catch(orNull)

          return {
            id: category.$id,
            name: category.name,
            description: category.description ?? '',
            departmentId: category.departmentId,
            departmentName: department?.name ?? '',
          }
        }))
      },
    },

    assignments: {
      listForUser: (userId) =>
        listAllPages((queries) =>
          tables.listRows({
            databaseId,
            tableId: ids.departmentUsers,
            queries: [Query.equal('userId', [userId]), ...queries],
          }),
        ),
    },

    complaints: {
      ...row(ids.complaints),
      create: (rowId, data, permissions) =>
        tables.createRow({ databaseId, tableId: ids.complaints, rowId, data, permissions }),
      update: (rowId, data) =>
        tables.updateRow({ databaseId, tableId: ids.complaints, rowId, data }),

      listAllByStudent: (studentId, max) =>
        listAllPages((queries) =>
          tables.listRows({
            databaseId,
            tableId: ids.complaints,
            queries: [Query.equal('studentId', [studentId]), Query.orderDesc('$createdAt'), ...queries],
          }), max),

      async listByStudent(studentId, limit) {
        const page = await tables.listRows({
          databaseId,
          tableId: ids.complaints,
          queries: [Query.equal('studentId', [studentId]), Query.orderDesc('$createdAt'), Query.limit(limit)],
        })
        return page.rows
      },

      async listByDepartments(departmentIds, { status, sort = 'newest', limit, offset }) {
        const queries = [
          Query.equal('departmentId', departmentIds),
          sort === 'oldest' ? Query.orderAsc('$createdAt') : Query.orderDesc('$createdAt'),
          Query.limit(limit),
          Query.offset(offset),
        ]
        if (status) queries.push(Query.equal('status', [status]))
        const page = await tables.listRows({ databaseId, tableId: ids.complaints, queries })
        return { rows: page.rows, total: page.total }
      },

      listAllByDepartments: (departmentIds, { status, max }) =>
        listAllPages((queries) =>
          tables.listRows({
            databaseId,
            tableId: ids.complaints,
            queries: [
              Query.equal('departmentId', departmentIds),
              ...(status ? [Query.equal('status', [status])] : []),
              Query.orderDesc('$createdAt'),
              ...queries,
            ],
          }), max),

      async countByDepartments(departmentIds, status) {
        const queries = [
          Query.equal('departmentId', departmentIds),
          ...(status ? [Query.equal('status', [status])] : []),
          Query.limit(1),
        ]
        return (await tables.listRows({ databaseId, tableId: ids.complaints, queries })).total
      },
    },

    aiSummaries: {
      get: (rowId) => tables.getRow({ databaseId, tableId: ids.aiSummaries, rowId }).catch(orNull),
      create: (rowId, data, permissions) =>
        tables.createRow({ databaseId, tableId: ids.aiSummaries, rowId, data, permissions }),
      update: (rowId, data) =>
        tables.updateRow({ databaseId, tableId: ids.aiSummaries, rowId, data }),
    },

    ai: {
      trigger: (complaintId, { force }) => {
        if (!internalSecret || !functionId) {
          throw new Error('Internal AI execution is not configured.')
        }
        return runner.createExecution({
          functionId,
          body: JSON.stringify({ action: 'internal.ai.analyze', complaintId, force: Boolean(force) }),
          async: true,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-ai-secret': internalSecret,
          },
        })
      },
    },

    notes: {
      create: (data, permissions) =>
        tables.createRow({ databaseId, tableId: ids.notes, rowId: ID.unique(), data, permissions }),
      listByComplaint: (complaintId) =>
        listAllPages((queries) =>
          tables.listRows({
            databaseId,
            tableId: ids.notes,
            queries: [Query.equal('complaintId', [complaintId]), Query.orderAsc('$createdAt'), ...queries],
          }), 200),
    },

    history: {
      create: (data, permissions) =>
        tables.createRow({ databaseId, tableId: ids.history, rowId: ID.unique(), data, permissions }),
      listByComplaint: (complaintId) =>
        listAllPages((queries) =>
          tables.listRows({
            databaseId,
            tableId: ids.history,
            queries: [Query.equal('complaintId', [complaintId]), Query.orderAsc('changedAt'), ...queries],
          }), 200),
    },

    notifications: {
      create: (data, permissions) =>
        tables.createRow({ databaseId, tableId: ids.notifications, rowId: ID.unique(), data, permissions }),
    },

    files: {
      get: (fileId) => storage.getFile({ bucketId: ids.bucket, fileId }).catch(orNull),
      lock: (fileId, permissions) =>
        storage.updateFile({ bucketId: ids.bucket, fileId, permissions }),
      download: (fileId) => storage.getFileDownload({ bucketId: ids.bucket, fileId }).catch(orNull),
    },

    // Administrator-only data access. These dependencies are consumed by the
    // integrated admin module; authorization is rechecked by admin/handler.js.
    admin: {
      log,
      async verifyJwt(jwt) {
        const asUser = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt)
        return (await new Account(asUser).get()).$id
      },
      users: { get: (userId) => users.get({ userId }).catch(orNull) },
      userRows: {
        get: (rowId) => tables.getRow({ databaseId, tableId: ids.users, rowId }).catch(orNull),
        count: async ({ role } = {}) => (await tables.listRows({
          databaseId, tableId: ids.users,
          queries: [...(role ? [Query.equal('role', [role])] : []), Query.limit(1)],
        })).total,
        listByRole: async (role, max = 1000) => listAllPages((queries) => tables.listRows({
          databaseId, tableId: ids.users, queries: [Query.equal('role', [role]), ...queries],
        }), max),
      },
      departments: {
        get: (rowId) => tables.getRow({ databaseId, tableId: ids.departments, rowId }).catch(orNull),
        listAll: () => listAllPages((queries) => tables.listRows({ databaseId, tableId: ids.departments, queries })),
        create: (data) => tables.createRow({ databaseId, tableId: ids.departments, rowId: ID.unique(), data }),
        update: (rowId, data) => tables.updateRow({ databaseId, tableId: ids.departments, rowId, data }),
        count: async ({ status } = {}) => (await tables.listRows({
          databaseId, tableId: ids.departments,
          queries: [...(status ? [Query.equal('status', [status])] : []), Query.limit(1)],
        })).total,
      },
      categories: {
        get: (rowId) => tables.getRow({ databaseId, tableId: ids.categories, rowId }).catch(orNull),
        listAll: () => listAllPages((queries) => tables.listRows({ databaseId, tableId: ids.categories, queries })),
        create: (data) => tables.createRow({ databaseId, tableId: ids.categories, rowId: ID.unique(), data }),
        update: (rowId, data) => tables.updateRow({ databaseId, tableId: ids.categories, rowId, data }),
        count: async ({ status } = {}) => (await tables.listRows({
          databaseId, tableId: ids.categories,
          queries: [...(status ? [Query.equal('status', [status])] : []), Query.limit(1)],
        })).total,
      },
      departmentUsers: {
        get: (rowId) => tables.getRow({ databaseId, tableId: ids.departmentUsers, rowId }).catch(orNull),
        listAll: () => listAllPages((queries) => tables.listRows({ databaseId, tableId: ids.departmentUsers, queries })),
        listByDepartment: (departmentId) => listAllPages((queries) => tables.listRows({
          databaseId, tableId: ids.departmentUsers,
          queries: [Query.equal('departmentId', [departmentId]), Query.orderAsc('$createdAt'), ...queries],
        })),
        listByUser: (userId) => listAllPages((queries) => tables.listRows({
          databaseId, tableId: ids.departmentUsers,
          queries: [Query.equal('userId', [userId]), ...queries],
        })),
        create: (data) => tables.createRow({ databaseId, tableId: ids.departmentUsers, rowId: ID.unique(), data }),
        update: (rowId, data) => tables.updateRow({ databaseId, tableId: ids.departmentUsers, rowId, data }),
        remove: (rowId) => tables.deleteRow({ databaseId, tableId: ids.departmentUsers, rowId }),
      },
      complaints: {
        count: async ({ status, statuses, categoryId, departmentId } = {}) => (await tables.listRows({
          databaseId, tableId: ids.complaints,
          queries: [
            ...(status ? [Query.equal('status', [status])] : []),
            ...(statuses ? [Query.equal('status', statuses)] : []),
            ...(categoryId ? [Query.equal('categoryId', [categoryId])] : []),
            ...(departmentId ? [Query.equal('departmentId', [departmentId])] : []),
            Query.limit(1),
          ],
        })).total,
        list: async ({ status, categoryId, departmentId, sort = 'newest', limit = 20, offset = 0 } = {}) => {
          const queries = [
            ...(status ? [Query.equal('status', [status])] : []),
            ...(categoryId ? [Query.equal('categoryId', [categoryId])] : []),
            ...(departmentId ? [Query.equal('departmentId', [departmentId])] : []),
            sort === 'oldest' ? Query.orderAsc('$createdAt') : Query.orderDesc('$createdAt'),
            Query.limit(limit), Query.offset(offset),
          ]
          const page = await tables.listRows({ databaseId, tableId: ids.complaints, queries })
          return { rows: page.rows, total: page.total }
        },
        listAll: ({ status, categoryId, departmentId, max = 2000, sort = 'newest' } = {}) => listAllPages((queries) => tables.listRows({
          databaseId, tableId: ids.complaints,
          queries: [
            ...(status ? [Query.equal('status', [status])] : []),
            ...(categoryId ? [Query.equal('categoryId', [categoryId])] : []),
            ...(departmentId ? [Query.equal('departmentId', [departmentId])] : []),
            sort === 'oldest' ? Query.orderAsc('$createdAt') : Query.orderDesc('$createdAt'),
            ...queries,
          ],
        }), max),
        listFinished: (max) => listAllPages((queries) => tables.listRows({
          databaseId, tableId: ids.complaints,
          queries: [Query.equal('status', ['resolved', 'closed']), Query.orderDesc('$createdAt'), ...queries],
        }), max),
      },
      audit: {
        record: (entry) => tables.createRow({
          databaseId, tableId: ids.adminAudit, rowId: ID.unique(), data: entry,
          permissions: ['read("label:admin")'],
        }),
        list: async (limit) => (await tables.listRows({
          databaseId, tableId: ids.adminAudit,
          queries: [Query.orderDesc('createdAt'), Query.orderDesc('$createdAt'), Query.limit(limit)],
        })).rows,
      },
    },
  }
}

export default async ({ req, res, error }) => {
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID
  const apiKey = process.env.APPWRITE_API_KEY
  const databaseId = process.env.DATABASE_ID
  const internalSecret = process.env.INTERNAL_AI_SECRET
  const functionId = process.env.COMPLAINT_API_FUNCTION_ID

  if (!endpoint || !projectId || !apiKey || !databaseId) {
    error('complaint-api is not configured: set APPWRITE_API_KEY and DATABASE_ID.')
    return res.json({
      ok: false,
      error: { code: 'server_misconfigured', message: 'The complaint service is not configured.' },
    }, 500)
  }

  const ids = {
    complaints: process.env.COMPLAINTS_TABLE_ID || 'complaints',
    history: process.env.COMPLAINT_HISTORY_TABLE_ID || 'complaint_history',
    notes: process.env.COMPLAINT_NOTES_TABLE_ID || 'complaint_notes',
    aiSummaries: process.env.AI_SUMMARIES_TABLE_ID || 'ai_summaries',
    users: process.env.USERS_TABLE_ID || 'users',
    departments: process.env.DEPARTMENTS_TABLE_ID || 'departments',
    categories: process.env.CATEGORIES_TABLE_ID || 'categories',
    departmentUsers: process.env.DEPARTMENT_USERS_TABLE_ID || 'department_users',
    notifications: process.env.NOTIFICATIONS_TABLE_ID || 'notifications',
    bucket: process.env.ATTACHMENTS_BUCKET_ID || 'complaint-attachments',
    adminAudit: process.env.ADMIN_AUDIT_TABLE_ID || 'admin_audit',
  }

  const deps = createDeps({
    endpoint, projectId, apiKey, databaseId, ids, log: error, internalSecret, functionId,
  })

  // Private server-to-server path. Normal users cannot invoke this action.
  if (secretMatches(req.headers?.['x-internal-ai-secret'], internalSecret)) {
    const body = requestBody(req)
    if (body.action !== 'internal.ai.analyze') {
      return res.json({ ok: false, error: { code: 'unknown_action', message: 'Unknown internal action.' } }, 400)
    }

    try {
      const result = await analyzeComplaint(deps, body.complaintId, { force: body.force === true })
      return res.json({ ok: true, ...result }, 200)
    } catch (e) {
      error(`Internal AI analysis failed: ${e?.message ?? e}`)
      return res.json({
        ok: false,
        error: { code: e.code || 'analysis_failed', message: e.message || 'Analysis failed.' },
      }, e.status || 500)
    }
  }

  const { status, body } = await handle({ req }, deps)
  return res.json(body, status)
}
