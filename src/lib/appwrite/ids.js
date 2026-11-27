/**
 * Fixed Appwrite resource IDs. Create the tables / function in the console (or with
 * `npm run db:setup`) with EXACTLY these IDs – see docs/DATABASE_SETUP.md. IDs are public
 * identifiers, not secrets. The table IDs come from database/schema.js, the single source of truth.
 */
import { BUCKETS, TABLE_IDS } from '../../../database/schema.js'

export const USERS_TABLE_ID = TABLE_IDS.users
export const DEPARTMENTS_TABLE_ID = TABLE_IDS.departments
export const DEPARTMENT_USERS_TABLE_ID = TABLE_IDS.departmentUsers
export const CATEGORIES_TABLE_ID = TABLE_IDS.categories
export const COMPLAINTS_TABLE_ID = TABLE_IDS.complaints
export const AI_SUMMARIES_TABLE_ID = TABLE_IDS.aiSummaries
export const NOTIFICATIONS_TABLE_ID = TABLE_IDS.notifications

export const COMPLAINT_ATTACHMENTS_BUCKET_ID = BUCKETS.complaintAttachments.id

export const PROFILE_FUNCTION_ID = 'profile-api'
export const COMPLAINT_FUNCTION_ID = 'complaint-api'
export const ADMIN_FUNCTION_ID = 'complaint-api'
