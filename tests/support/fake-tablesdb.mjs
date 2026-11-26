// In-memory stand-in for Appwrite TablesDB, driven by database/schema.js (TEST ONLY).
//
// It models the documented behaviour the app relies on, so tests can prove that the schema and the
// permissions in database/schema.js do what the docs say:
//   - columns: unknown column, required, type, size, enum, min/max, array and default handling
//   - unique indexes (single and composite; null values never collide) -> 409
//   - table-level + row-level permissions per actor (guest / signed-in user / labels) -> 401
//   - queries: equal, notEqual, isNull, isNotNull, orderAsc, orderDesc, limit, offset
//   - it REFUSES to filter on a column that has no index (so every service query is index-backed)
// It does NOT prove anything about a real Appwrite server – use the manual checks in the docs for that.
import { randomBytes } from 'node:crypto'
import { ROW_ID_PATTERN } from '../../database/schema.js'

/** Builds query strings in the same JSON format as the Appwrite SDK's `Query` helper. */
const q = (method, attribute, values) => JSON.stringify({ method, ...(attribute !== undefined ? { attribute } : {}), ...(values !== undefined ? { values } : {}) })
export const Query = {
  equal: (attribute, values) => q('equal', attribute, [].concat(values)),
  notEqual: (attribute, values) => q('notEqual', attribute, [].concat(values)),
  isNull: (attribute) => q('isNull', attribute),
  isNotNull: (attribute) => q('isNotNull', attribute),
  orderAsc: (attribute) => q('orderAsc', attribute),
  orderDesc: (attribute) => q('orderDesc', attribute),
  limit: (n) => q('limit', undefined, [n]),
  offset: (n) => q('offset', undefined, [n]),
}
export const ID = { unique: () => 'unique()' }

const fail = (code, type, message) => Object.assign(new Error(message), { code, type, name: 'AppwriteException' })
const SYSTEM_ATTRIBUTES = new Set(['$id', '$createdAt', '$updatedAt'])

export function createFakeTablesDB({ tables, databaseId = 'testdb', clock = () => new Date() }) {
  const defs = new Map(Object.values(tables).map((table) => [table.id, table]))
  const data = new Map([...defs.keys()].map((id) => [id, new Map()])) // tableId -> rowId -> row
  let sequence = 0

  const rolesOf = (actor) => {
    if (actor === 'server') return null // API key: bypasses permissions
    if (!actor) return new Set(['any', 'guests'])
    return new Set(['any', 'users', `user:${actor.id}`, ...(actor.labels ?? []).map((label) => `label:${label}`)])
  }
  const parsePermission = (permission) => {
    const match = /^(read|create|update|delete)\("([^"]+)"\)$/.exec(permission)
    if (!match) throw fail(400, 'general_argument_invalid', `Invalid permission string: ${permission}`)
    return { action: match[1], role: match[2] }
  }
  const allows = (permissions, action, roles) => permissions.map(parsePermission).some((p) => p.action === action && roles.has(p.role))

  const tableOf = (tableId) => {
    const table = defs.get(tableId)
    if (!table) throw fail(404, 'table_not_found', `Table ${tableId} not found`)
    return table
  }
  const checkDb = (id) => {
    if (id !== databaseId) throw fail(404, 'database_not_found', 'Database not found')
  }
  const unauthorized = () => fail(401, 'user_unauthorized', 'The current user is not authorized to perform the requested action.')

  /** May `actor` perform `action` on `row` (undefined for create)? */
  const can = (actor, table, action, row) => {
    const roles = rolesOf(actor)
    if (!roles) return true
    if (allows(table.permissions, action, roles)) return true
    return table.rowSecurity && row !== undefined && allows(row.$permissions, action, roles)
  }

  /* ----- column validation ----- */
  function checkValue(column, value) {
    const bad = (why) => fail(400, 'document_invalid_structure', `Invalid value for "${column.key}": ${why}`)
    const one = (item) => {
      switch (column.type) {
        case 'string':
        case 'email':
          if (typeof item !== 'string') throw bad('must be a string')
          if (column.type === 'string' && item.length > column.size) throw bad(`longer than ${column.size}`)
          if (column.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) throw bad('not a valid email')
          return
        case 'enum':
          if (!column.elements.includes(item)) throw bad(`must be one of ${column.elements.join(', ')}`)
          return
        case 'datetime':
          if (typeof item !== 'string' || Number.isNaN(Date.parse(item))) throw bad('must be an ISO datetime')
          return
        case 'boolean':
          if (typeof item !== 'boolean') throw bad('must be a boolean')
          return
        case 'integer':
        case 'float':
          if (typeof item !== 'number' || (column.type === 'integer' && !Number.isInteger(item))) throw bad('must be a number')
          if (column.min !== undefined && item < column.min) throw bad(`below ${column.min}`)
          if (column.max !== undefined && item > column.max) throw bad(`above ${column.max}`)
          return
        default:
          throw new Error(`unsupported column type ${column.type}`)
      }
    }
    if (column.array) {
      if (!Array.isArray(value)) throw bad('must be an array')
      value.forEach(one)
    } else {
      if (Array.isArray(value)) throw bad('must not be an array')
      one(value)
    }
  }

  function validate(table, input, { partial }) {
    const known = new Map(table.columns.map((column) => [column.key, column]))
    for (const key of Object.keys(input)) {
      if (!known.has(key)) throw fail(400, 'document_invalid_structure', `Unknown attribute: ${key}`)
    }
    const out = {}
    for (const column of table.columns) {
      const present = Object.hasOwn(input, column.key)
      if (!present) {
        if (partial) continue
        if (column.required) throw fail(400, 'document_invalid_structure', `Missing required attribute: ${column.key}`)
        out[column.key] = column.default ?? (column.array ? [] : null)
        continue
      }
      const value = input[column.key]
      if (value === null) {
        if (column.required) throw fail(400, 'document_invalid_structure', `Attribute "${column.key}" is required`)
        out[column.key] = null
        continue
      }
      checkValue(column, value)
      out[column.key] = value
    }
    return out
  }

  function assertUnique(table, rows, candidate, exceptId) {
    for (const index of table.indexes.filter((i) => i.type === 'unique')) {
      const values = index.columns.map((column) => candidate[column])
      if (values.some((v) => v === null || v === undefined)) continue
      const clash = [...rows.values()].some((row) => row.$id !== exceptId && index.columns.every((column, i) => row[column] === values[i]))
      if (clash) throw fail(409, 'document_already_exists', `Unique index "${index.key}" violated`)
    }
  }

  /* ----- queries ----- */
  function applyQueries(table, rows, queries = []) {
    const parsed = queries.map((query) => JSON.parse(query))
    const indexed = new Set(table.indexes.flatMap((index) => index.columns))
    let result = [...rows]
    let limit = 25
    let offset = 0
    const orders = []
    const needIndex = (attribute) => {
      if (SYSTEM_ATTRIBUTES.has(attribute)) return
      if (!table.columns.some((column) => column.key === attribute)) throw fail(400, 'general_query_invalid', `Unknown attribute in query: ${attribute}`)
      if (!indexed.has(attribute)) throw fail(400, 'general_query_invalid', `Query on "${attribute}" needs an index (table ${table.id})`)
    }
    for (const query of parsed) {
      switch (query.method) {
        case 'equal':
          needIndex(query.attribute)
          result = result.filter((row) => query.values.includes(row[query.attribute]))
          break
        case 'notEqual':
          needIndex(query.attribute)
          result = result.filter((row) => !query.values.includes(row[query.attribute]))
          break
        case 'isNull':
          needIndex(query.attribute)
          result = result.filter((row) => row[query.attribute] === null || row[query.attribute] === undefined)
          break
        case 'isNotNull':
          needIndex(query.attribute)
          result = result.filter((row) => row[query.attribute] !== null && row[query.attribute] !== undefined)
          break
        case 'orderAsc':
        case 'orderDesc':
          needIndex(query.attribute)
          orders.push([query.attribute, query.method === 'orderAsc' ? 1 : -1])
          break
        case 'limit':
          limit = query.values[0]
          break
        case 'offset':
          offset = query.values[0]
          break
        default:
          throw fail(400, 'general_query_invalid', `Unsupported query method in fake: ${query.method}`)
      }
    }
    for (const [attribute, direction] of [...orders].reverse()) {
      result.sort((a, b) => (a[attribute] > b[attribute] ? direction : a[attribute] < b[attribute] ? -direction : 0))
    }
    return { total: result.length, rows: result.slice(offset, offset + limit) }
  }

  const present = (row) => structuredClone(row)

  /** TablesDB-shaped service acting as `actor`: null = guest, {id, labels} = user, 'server' = API key. */
  const as = (actor) => ({
    async listRows({ databaseId: db, tableId, queries }) {
      checkDb(db)
      const table = tableOf(tableId)
      const roles = rolesOf(actor)
      const all = [...data.get(tableId).values()]
      let visible
      if (!roles || allows(table.permissions, 'read', roles)) visible = all
      else if (table.rowSecurity) visible = all.filter((row) => allows(row.$permissions, 'read', roles))
      else throw unauthorized()
      const { rows, total } = applyQueries(table, visible, queries)
      return { total, rows: rows.map(present) }
    },

    async getRow({ databaseId: db, tableId, rowId }) {
      checkDb(db)
      const table = tableOf(tableId)
      const row = data.get(tableId).get(rowId)
      const roles = rolesOf(actor)
      if (roles && !allows(table.permissions, 'read', roles) && !(table.rowSecurity && row && allows(row.$permissions, 'read', roles))) {
        if (!table.rowSecurity) throw unauthorized()
        if (row) throw unauthorized()
      }
      if (!row) throw fail(404, 'row_not_found', 'Row not found')
      return present(row)
    },

    async createRow({ databaseId: db, tableId, rowId, data: input, permissions = [] }) {
      checkDb(db)
      const table = tableOf(tableId)
      const roles = rolesOf(actor)
      if (!can(actor, table, 'create')) throw unauthorized()
      // As far as documented, a user cannot grant row permissions to roles they do not hold themselves.
      if (roles) for (const permission of permissions) if (!roles.has(parsePermission(permission).role)) throw unauthorized()
      const id = rowId === 'unique()' ? randomBytes(10).toString('hex') : rowId
      if (!ROW_ID_PATTERN.test(id)) throw fail(400, 'general_argument_invalid', `Invalid row ID: ${id}`)
      const rows = data.get(tableId)
      if (rows.has(id)) throw fail(409, 'document_already_exists', 'Row already exists')
      const values = validate(table, input, { partial: false })
      assertUnique(table, rows, values)
      const stamp = new Date(clock().getTime() + ++sequence).toISOString()
      const row = { ...values, $id: id, $createdAt: stamp, $updatedAt: stamp, $permissions: [...permissions] }
      rows.set(id, row)
      return present(row)
    },

    async updateRow({ databaseId: db, tableId, rowId, data: input = {}, permissions }) {
      checkDb(db)
      const table = tableOf(tableId)
      const rows = data.get(tableId)
      const row = rows.get(rowId)
      if (!row) throw fail(404, 'row_not_found', 'Row not found')
      if (!can(actor, table, 'update', row)) throw unauthorized()
      const values = validate(table, input, { partial: true })
      assertUnique(table, rows, { ...row, ...values }, rowId)
      Object.assign(row, values, { $updatedAt: new Date(clock().getTime() + ++sequence).toISOString() })
      if (permissions) row.$permissions = [...permissions]
      return present(row)
    },

    async deleteRow({ databaseId: db, tableId, rowId }) {
      checkDb(db)
      const table = tableOf(tableId)
      const rows = data.get(tableId)
      const row = rows.get(rowId)
      if (!row) throw fail(404, 'row_not_found', 'Row not found')
      if (!can(actor, table, 'delete', row)) throw unauthorized()
      rows.delete(rowId)
      return {}
    },
  })

  return { as, databaseId, rows: (tableId) => [...data.get(tableId).values()].map(present), raw: data }
}
