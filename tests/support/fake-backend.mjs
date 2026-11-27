// In-memory stand-in for Appwrite Users + TablesDB, used by the Phase 6/7 function tests (TEST ONLY).
// Rows use the Phase 7 `users` table fields (accountStatus, academicDepartment, createdAt).
// It mimics the behaviours the function relies on: unique roll numbers (409), 404 for
// missing rows/users, label-based roles, and row permissions being recorded at creation.
import { Permission, Role } from 'node-appwrite'

export const PERMISSIONS_FROM_SDK = (id) => [Permission.read(Role.user(id)), Permission.read(Role.label('admin'))]

export function createFakeBackend() {
  const accounts = new Map() // $id -> account
  const rows = new Map() // $id -> row
  const jwts = new Map() // jwt -> user id
  const logs = []
  /** department_users rows: { id, userId, departmentId, departmentName, position } */
  const assignmentRows = []
  let counter = 0

  const addAccount = ({ id, name, email, labels = [], status = true, prefs = {}, registration }) => {
    const account = {
      $id: id,
      name,
      email,
      labels: [...labels],
      status,
      prefs,
      registration: registration ?? `2026-11-0${(++counter % 9) + 1}T09:00:00.000+00:00`,
    }
    accounts.set(id, account)
    return account
  }

  const notFound = () => Object.assign(new Error('not found'), { code: 404 })
  const conflict = () => Object.assign(new Error('conflict'), { code: 409 })
  const rollTaken = (rollNumber, exceptId) =>
    Boolean(rollNumber) && [...rows.values()].some((row) => row.rollNumber === rollNumber && row.$id !== exceptId)

  const addAssignment = (userId, departmentId, departmentName, position = 'Staff') =>
    assignmentRows.push({ id: `a${assignmentRows.length + 1}`, userId, departmentId, departmentName, position })

  const auditLog = []
  const created = [] // accounts created through users.create (so tests can look at the temporary password)
  const adminAllowlist = []
  const deps = {
    log: (message) => logs.push(message),
    adminAllowlist,
    audit: { record: async (entry) => void auditLog.push(structuredClone(entry)) },
    async verifyJwt(jwt) {
      const id = jwts.get(jwt)
      if (!id) throw Object.assign(new Error('invalid jwt'), { code: 401 })
      return id
    },
    users: {
      create: async ({ name, email, password }) => {
        if ([...accounts.values()].some((a) => a.email === email)) throw conflict()
        created.push({ email, password })
        return structuredClone(addAccount({ id: `new${accounts.size + 1}`, name, email }))
      },
      get: async (id) => (accounts.has(id) ? structuredClone(accounts.get(id)) : null),
      listAll: async () => [...accounts.values()].map((a) => structuredClone(a)),
      updateLabels: async (id, labels) => {
        if (!accounts.has(id)) throw notFound()
        accounts.get(id).labels = [...labels]
        return structuredClone(accounts.get(id))
      },
      updateName: async (id, name) => {
        if (!accounts.has(id)) throw notFound()
        accounts.get(id).name = name
        return structuredClone(accounts.get(id))
      },
      updateStatus: async (id, status) => {
        if (!accounts.has(id)) throw notFound()
        accounts.get(id).status = status
        return structuredClone(accounts.get(id))
      },
    },
    assignments: {
      listForUser: async (userId) =>
        assignmentRows.filter((a) => a.userId === userId).map(({ departmentId, departmentName, position }) => ({ departmentId, departmentName, position })),
      removeForUser: async (userId) => {
        for (let i = assignmentRows.length - 1; i >= 0; i--) if (assignmentRows[i].userId === userId) assignmentRows.splice(i, 1)
      },
    },
    rows: {
      get: async (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
      listAll: async () => [...rows.values()].map((r) => structuredClone(r)),
      create: async (id, data, permissions) => {
        if (rows.has(id) || rollTaken(data.rollNumber, id)) throw conflict()
        const row = { ...data, $id: id, $permissions: permissions }
        rows.set(id, row)
        return structuredClone(row)
      },
      update: async (id, data) => {
        if (!rows.has(id)) throw notFound()
        if (rollTaken(data.rollNumber, id)) throw conflict()
        Object.assign(rows.get(id), data)
        return structuredClone(rows.get(id))
      },
    },
  }

  /** Builds the request Appwrite would hand the function for a signed-in user. */
  const requestAs = (userId, body, { headers } = {}) => {
    const jwt = `jwt_${userId}`
    jwts.set(jwt, userId)
    return { req: { headers: { 'x-appwrite-user-id': userId, 'x-appwrite-user-jwt': jwt, ...headers }, bodyText: JSON.stringify(body) } }
  }

  return { deps, accounts, rows, jwts, logs, auditLog, adminAllowlist, created, assignmentRows, addAssignment, addAccount, requestAs }
}
