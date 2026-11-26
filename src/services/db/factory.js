import { createCategoriesService } from './categories.js'
import { createComplaintsService } from './complaints.js'
import { createTables } from './core.js'
import { createDepartmentUsersService } from './departmentUsers.js'
import { createDepartmentsService } from './departments.js'
import { createNotificationsService } from './notifications.js'
import { seedInitialData } from './seed.js'
import { createUsersService } from './users.js'

/**
 * Builds every database service from an Appwrite TablesDB instance.
 *
 *   browser:  createDatabaseServices({ tablesDB, databaseId, Query, ID })   (see ./index.js)
 *   Node:     the same, with a node-appwrite TablesDB that carries an API key
 *
 * Complaints and notifications are READ here; both are created by the complaint-api function. AI summaries have a table
 * (database/schema.js) but no browser service: staff read them through complaint-api.
 */
export function createDatabaseServices({ tablesDB, databaseId, Query, ID, assertReady, now = () => new Date().toISOString() }) {
  const db = createTables({ tablesDB, databaseId, Query, ID, assertReady })
  const users = createUsersService(db)
  const departments = createDepartmentsService(db, { now })
  const categories = createCategoriesService(db, { departments })
  const departmentUsers = createDepartmentUsersService(db, { users, departments, now })
  const complaints = createComplaintsService(db)
  const notifications = createNotificationsService(db)
  return {
    users,
    departments,
    categories,
    departmentUsers,
    complaints,
    notifications,
    seedInitialData: () => seedInitialData(db, { now }),
  }
}
