import { assertAppwriteConfigured, DATABASE_ID, ID, Query, tablesDB } from '../../lib/appwrite/index.js'
import { createDatabaseServices } from './factory.js'

/**
 * Ready-to-use database services for the browser, bound to the signed-in user's session.
 * What each call may do is decided by Appwrite's table/row permissions, not by this code.
 *
 *   import { departments, categories } from '../services/db/index.js'
 */
const services = createDatabaseServices({ tablesDB, databaseId: DATABASE_ID, Query, ID, assertReady: assertAppwriteConfigured })

export const { users, departments, categories, departmentUsers, complaints, notifications, seedInitialData } = services
export { DbError, isSessionError, toDbError } from './core.js'
