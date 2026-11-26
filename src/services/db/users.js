import { TABLE_IDS } from '../../../database/schema.js'
import { clean, fromRow, paging } from './core.js'

/**
 * READ-ONLY access to the `users` table.
 *
 * There is deliberately no create/update/delete here: user rows are written only by the
 * `profile-api` function (one row per Appwrite account, row ID = account ID), which is what
 * guarantees there are never duplicate user records. What a caller can read is decided by the row
 * permissions: an owner sees their own row, administrators see all rows.
 */
export function createUsersService(db) {
  const { Query } = db
  const T = TABLE_IDS.users

  const firstMatch = async (queries) => {
    const { rows } = await db.list(T, [...queries, Query.limit(1)])
    return fromRow(rows[0])
  }

  return {
    /** One user by account ID. null when the row is missing OR the caller is not allowed to read it. */
    async get(userId) {
      try {
        return fromRow(await db.find(T, userId))
      } catch (error) {
        if (error.code === 'forbidden') return null
        throw error
      }
    },

    /** Users, newest first. Filters: role, accountStatus. Administrators only in practice. */
    async list({ role, accountStatus, limit, offset } = {}) {
      const page = paging({ limit, offset })
      const queries = [Query.orderDesc('$createdAt'), Query.limit(page.limit), Query.offset(page.offset)]
      if (role) queries.push(Query.equal('role', [role]))
      if (accountStatus) queries.push(Query.equal('accountStatus', [accountStatus]))
      const { rows, total } = await db.list(T, queries)
      return { users: rows.map(fromRow), total }
    },

    findByRollNumber: (rollNumber) => firstMatch([Query.equal('rollNumber', [clean(rollNumber).toUpperCase()])]),
    findByEmail: (email) => firstMatch([Query.equal('email', [clean(email).toLowerCase()])]),
  }
}
