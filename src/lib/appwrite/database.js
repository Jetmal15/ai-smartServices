import { TablesDB, ID, Query } from 'appwrite'
import { client } from './client.js'
import { APPWRITE_DATABASE_ID } from './env.js'

/**
 * Appwrite TablesDB service (current API: databases contain *tables*, tables
 * contain *rows* – not the legacy Databases/collections/documents API).
 *
 * Usage in later phases (table IDs come from your own Appwrite console):
 *   await tablesDB.listRows({ databaseId: DATABASE_ID, tableId: '<table-id>', queries: [Query.limit(10)] })
 *   await tablesDB.createRow({ databaseId: DATABASE_ID, tableId: '<table-id>', rowId: ID.unique(), data: {...} })
 *
 * Table IDs are intentionally not defined here yet – they will be added once
 * the tables exist in your Appwrite project.
 */
export const tablesDB = new TablesDB(client)
export const DATABASE_ID = APPWRITE_DATABASE_ID

export { ID, Query }
