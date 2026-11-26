export { client, pingAppwrite } from './client.js'
export { account } from './account.js'
export { tablesDB, DATABASE_ID, ID, Query } from './database.js'
export { functions } from './functions.js'
export { storage } from './storage.js'
export {
  USERS_TABLE_ID,
  DEPARTMENTS_TABLE_ID,
  DEPARTMENT_USERS_TABLE_ID,
  CATEGORIES_TABLE_ID,
  COMPLAINTS_TABLE_ID,
  AI_SUMMARIES_TABLE_ID,
  NOTIFICATIONS_TABLE_ID,
  COMPLAINT_ATTACHMENTS_BUCKET_ID,
  PROFILE_FUNCTION_ID,
  COMPLAINT_FUNCTION_ID,
  ADMIN_FUNCTION_ID,
} from './ids.js'
export {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  isAppwriteConfigured,
  MISSING_ENV_VARS,
  assertAppwriteConfigured,
} from './env.js'
