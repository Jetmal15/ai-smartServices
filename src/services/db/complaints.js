import { TABLE_IDS } from '../../../database/schema.js'
import { fromRow, paging } from './core.js'

/**
 * READ-ONLY access to the `complaints` table from the browser.
 *
 * Complaints are created only by the `complaint-api` function (see services/complaintService.js), so there is
 * deliberately no create/update/delete here. Reads are limited by Appwrite itself: a signed-in student's queries return
 * only THEIR complaints (row permissions), an administrator's return everything, and department staff get nothing
 * here (they use the function, which filters by their assignments). Newest first.
 */
export function createComplaintsService(db) {
  const { Query } = db
  const T = TABLE_IDS.complaints

  const page = async (queries, { limit, offset }) => {
    const paged = paging({ limit, offset })
    const { rows, total } = await db.list(T, [...queries, Query.orderDesc('$createdAt'), Query.limit(paged.limit), Query.offset(paged.offset)])
    return { complaints: rows.map(fromRow), total }
  }

  return {
    /** One complaint by ID (null when missing or not readable by the caller). */
    async get(complaintId) {
      try {
        return fromRow(await db.find(T, complaintId))
      } catch (error) {
        if (error.code === 'forbidden') return null
        throw error
      }
    },

    /** A student's own complaints. Filters: status. */
    listByStudent(studentId, { status, limit, offset } = {}) {
      const queries = [Query.equal('studentId', [studentId])]
      if (status) queries.push(Query.equal('status', [status]))
      return page(queries, { limit, offset })
    },

    /** Administrators: all complaints. Filters: status, departmentId, categoryId. */
    list({ status, departmentId, categoryId, limit, offset } = {}) {
      const queries = []
      if (status) queries.push(Query.equal('status', [status]))
      if (departmentId) queries.push(Query.equal('departmentId', [departmentId]))
      if (categoryId) queries.push(Query.equal('categoryId', [categoryId]))
      return page(queries, { limit, offset })
    },
  }
}
