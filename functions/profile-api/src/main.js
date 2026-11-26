/**
 * Appwrite Function entrypoint: wires the real node-appwrite SDK into handler.js.
 *
 * Environment variables (set on the FUNCTION in the Appwrite console – never in the frontend):
 *   APPWRITE_API_KEY    server API key with scopes: users.read, users.write, rows.read, rows.write
 *                       (the Appwrite console may label the last two "Databases rows/documents")
 *   DATABASE_ID         the database that holds the tables below
 *   USERS_TABLE_ID              optional, defaults to "users"
 *   DEPARTMENTS_TABLE_ID        optional, defaults to "departments"
 *   DEPARTMENT_USERS_TABLE_ID   optional, defaults to "department_users"
 *   ADMIN_AUDIT_TABLE_ID        optional, defaults to "admin_audit"
 *   ADMIN_ALLOWLIST             optional, comma-separated e-mail addresses or @domains: when set, ONLY these can become administrators
 * Provided automatically by Appwrite: APPWRITE_FUNCTION_API_ENDPOINT, APPWRITE_FUNCTION_PROJECT_ID.
 */
import { Account, Client, ID, Query, TablesDB, Users } from 'node-appwrite'
import { handle } from './handler.js'

const PAGE_SIZE = 100
/** Safety cap for in-memory listing (campus scale). */
const MAX_ITEMS = 5000

const orNull = (error) => {
  if (error?.code === 404) return null
  throw error
}

async function listAllPages(fetchPage, key) {
  const items = []
  while (items.length < MAX_ITEMS) {
    const page = await fetchPage([Query.limit(PAGE_SIZE), Query.offset(items.length)])
    items.push(...page[key])
    if (page[key].length < PAGE_SIZE) break
  }
  return items
}

function createDeps({ endpoint, projectId, apiKey, databaseId, tableId, departmentsTableId, assignmentsTableId, auditTableId, adminAllowlist, log }) {
  const admin = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey)
  const users = new Users(admin)
  const tables = new TablesDB(admin)

  return {
    log,
    adminAllowlist,
    /** Audit trail of sensitive administrator operations (admin_audit table). */
    audit: {
      record: (entry) => tables.createRow({ databaseId, tableId: auditTableId, rowId: ID.unique(), data: entry, permissions: ['read("label:admin")'] }),
    },
    /** Verifies the caller's JWT with Appwrite and returns the user id it belongs to. */
    async verifyJwt(jwt) {
      const asUser = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt)
      return (await new Account(asUser).get()).$id
    },
    users: {
      get: (userId) => users.get({ userId }).catch(orNull),
      listAll: () => listAllPages((queries) => users.list({ queries }), 'users'),
      updateLabels: (userId, labels) => users.updateLabels({ userId, labels }),
      updateName: (userId, name) => users.updateName({ userId, name }),
      updateStatus: (userId, status) => users.updateStatus({ userId, status }),
      create: ({ name, email, password }) => users.create({ userId: ID.unique(), email, password, name }),
    },
    rows: {
      get: (rowId) => tables.getRow({ databaseId, tableId, rowId }).catch(orNull),
      create: (rowId, data, permissions) => tables.createRow({ databaseId, tableId, rowId, data, permissions }),
      update: (rowId, data) => tables.updateRow({ databaseId, tableId, rowId, data }),
      listAll: () => listAllPages((queries) => tables.listRows({ databaseId, tableId, queries }), 'rows'),
    },
    /** Department staff assignments (department_users table), joined with the department's name. */
    assignments: {
      async listForUser(userId) {
        const rows = await listAllPages(
          (queries) => tables.listRows({ databaseId, tableId: assignmentsTableId, queries: [Query.equal('userId', [userId]), ...queries] }),
          'rows',
        )
        return Promise.all(
          rows.map(async (row) => {
            const department = await tables.getRow({ databaseId, tableId: departmentsTableId, rowId: row.departmentId }).catch(orNull)
            return { departmentId: row.departmentId, departmentName: department?.name ?? '', position: row.position ?? 'Staff' }
          }),
        )
      },
      async removeForUser(userId) {
        const rows = await listAllPages(
          (queries) => tables.listRows({ databaseId, tableId: assignmentsTableId, queries: [Query.equal('userId', [userId]), ...queries] }),
          'rows',
        )
        for (const row of rows) await tables.deleteRow({ databaseId, tableId: assignmentsTableId, rowId: row.$id })
      },
    },
  }
}

export default async ({ req, res, error }) => {
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID
  const apiKey = process.env.APPWRITE_API_KEY
  const databaseId = process.env.DATABASE_ID
  const tableId = process.env.USERS_TABLE_ID || 'users'
  const departmentsTableId = process.env.DEPARTMENTS_TABLE_ID || 'departments'
  const assignmentsTableId = process.env.DEPARTMENT_USERS_TABLE_ID || 'department_users'
  const auditTableId = process.env.ADMIN_AUDIT_TABLE_ID || 'admin_audit'
  const adminAllowlist = String(process.env.ADMIN_ALLOWLIST || '').split(',').map((entry) => entry.trim()).filter(Boolean)

  if (!endpoint || !projectId || !apiKey || !databaseId) {
    error('profile-api is not configured: set APPWRITE_API_KEY and DATABASE_ID in the function settings.')
    return res.json({ ok: false, error: { code: 'server_misconfigured', message: 'The profile service is not configured.' } }, 500)
  }

  const deps = createDeps({ endpoint, projectId, apiKey, databaseId, tableId, departmentsTableId, assignmentsTableId, auditTableId, adminAllowlist, log: error })
  const { status, body } = await handle({ req }, deps)
  return res.json(body, status)
}
