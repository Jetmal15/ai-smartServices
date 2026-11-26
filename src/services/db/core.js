/**
 * Shared plumbing for the database services (Phase 7).
 *
 * These modules take their Appwrite objects (`tablesDB`, `Query`, `ID`) as arguments instead of
 * importing them, so the same code runs in the browser (signed-in user), in Node scripts (API key)
 * and in the tests (in-memory stand-in). `index.js` wires the real browser client.
 */

/** Error with a message that is safe to show. `fields` carries per-field messages for forms. */
export class DbError extends Error {
  constructor(message, { code = 'error', status = 0, fields } = {}) {
    super(message)
    this.name = 'DbError'
    this.code = code
    this.status = status
    this.fields = fields
  }
}

const UNREACHABLE = 'Cannot reach the server. Check your internet connection and try again.'

/** Turns anything thrown by the SDK into a DbError (duck-typed, so no SDK import is needed). */
export function toDbError(error, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof DbError) return error
  const status = Number(error?.code) || 0
  const type = String(error?.type ?? '')
  // A missing table/database means the setup guide has not been followed yet – not a missing row.
  if (/^(table|database|collection)_not_found$/.test(type)) {
    return new DbError('The database is not set up yet. Ask the administrator to run the database setup.', { code: 'not_set_up', status })
  }
  if (status === 404) return new DbError('That record was not found.', { code: 'not_found', status })
  if (status === 409) return new DbError('That record already exists.', { code: 'conflict', status })
  // Appwrite answers 401 `user_unauthorized` when a signed-in user lacks permission; other 401s mean the session ended.
  if (status === 401 && type === 'user_unauthorized') return new DbError('You do not have permission to do that.', { code: 'forbidden', status })
  if (status === 401) return new DbError('Your session has ended. Please sign in again.', { code: 'unauthorized', status })
  if (status === 403) return new DbError('You do not have permission to do that.', { code: 'forbidden', status })
  if (status >= 500) return new DbError(fallback, { code: 'server_error', status })
  if (status === 0 && (error instanceof TypeError || error?.type === '' || error?.name === 'AppwriteException')) {
    return new DbError(UNREACHABLE, { code: 'unavailable' })
  }
  return new DbError(error?.message || fallback, { code: 'error', status })
}

/** True when the failure means "your session ended". */
export const isSessionError = (error) => error?.code === 'unauthorized'

export const validationError = (fields, message = 'Some of the details you entered are invalid.') =>
  new DbError(message, { code: 'validation_failed', status: 400, fields })

export const notFound = (what) => new DbError(`${what} was not found.`, { code: 'not_found', status: 404 })

export const conflict = (message, fields) => new DbError(message, { code: 'conflict', status: 409, fields })

/** Collapses whitespace and trims. */
export const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

/** Case/whitespace-insensitive key for duplicate-name checks. */
export const nameKey = (value) => clean(value).toLowerCase()

/** Row -> plain object: `$id` becomes `id`, every other Appwrite `$…` field is dropped. */
export function fromRow(row) {
  if (!row) return null
  const out = { id: row.$id }
  for (const [key, value] of Object.entries(row)) if (!key.startsWith('$')) out[key] = value
  return out
}

const PAGE = 100
/** Safety cap when reading a whole (small) table into memory. */
const MAX_ROWS = 5000

/**
 * Wraps the Appwrite TablesDB service: fills in the database ID, converts errors to DbError and
 * checks configuration first. Services use this and never call `tablesDB` directly.
 */
export function createTables({ tablesDB, databaseId, Query, ID, assertReady }) {
  const guard = async (operation) => {
    try {
      assertReady?.()
      return await operation()
    } catch (error) {
      throw toDbError(error)
    }
  }

  const tables = {
    Query,
    newId: () => ID.unique(),
    list: (tableId, queries = []) => guard(() => tablesDB.listRows({ databaseId, tableId, queries })),
    get: (tableId, rowId) => guard(() => tablesDB.getRow({ databaseId, tableId, rowId })),
    create: (tableId, rowId, data, permissions) =>
      guard(() => tablesDB.createRow({ databaseId, tableId, rowId, data, ...(permissions ? { permissions } : {}) })),
    update: (tableId, rowId, data) => guard(() => tablesDB.updateRow({ databaseId, tableId, rowId, data })),
    remove: (tableId, rowId) => guard(() => tablesDB.deleteRow({ databaseId, tableId, rowId })),

    /** Returns the row, or null when it does not exist. */
    async find(tableId, rowId) {
      try {
        return await tables.get(tableId, rowId)
      } catch (error) {
        if (error.code === 'not_found') return null
        throw error
      }
    },

    /** Reads every row matching `queries` (paged). Only for small tables. */
    async listAll(tableId, queries = []) {
      const rows = []
      while (rows.length < MAX_ROWS) {
        const page = await tables.list(tableId, [...queries, Query.limit(PAGE), Query.offset(rows.length)])
        rows.push(...page.rows)
        if (page.rows.length < PAGE || rows.length >= page.total) break
      }
      return rows
    },
  }
  return tables
}

/** Clamps paging input to sane values. */
export function paging({ limit, offset } = {}, defaultLimit = 25, maxLimit = 100) {
  return {
    limit: Math.min(Math.max(Number.parseInt(limit, 10) || defaultLimit, 1), maxLimit),
    offset: Math.max(Number.parseInt(offset, 10) || 0, 0),
  }
}
