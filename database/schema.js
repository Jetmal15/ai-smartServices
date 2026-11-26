/**
 * Phase 7 – database schema: the SINGLE source of truth for the Appwrite TablesDB tables.
 *
 * Plain ESM with no imports, so it can be used by the browser app, Node scripts and tests.
 *   - scripts/setup-database.mjs  creates tables / columns / indexes from this file
 *   - docs/DATABASE_SCHEMA.md      is generated from it (`npm run db:docs`)
 *   - tests/phase7                 check it against the app's constants and the function
 *
 * Nothing here creates anything by itself. Tables exist only after you run the setup script
 * or follow docs/DATABASE_SETUP.md in the Appwrite console.
 *
 * Column kinds: string | email | enum | datetime | boolean | integer | float
 * Appwrite rule: a *required* column cannot have a default value.
 */

/** Reference columns (userId, departmentId, ...) hold the $id of the referenced row. */
const ID_SIZE = 36

const ref = (key, required = true, description = '') => ({ key, type: 'string', size: ID_SIZE, required, description })

/* ------------------------------------------------------------------ *
 * Enumerations (kept in sync with src/lib/constants.js by a test)
 * ------------------------------------------------------------------ */

export const ENUMS = Object.freeze({
  role: ['student', 'department', 'admin'],
  accountStatus: ['active', 'disabled'],
  recordStatus: ['active', 'inactive'],
  complaintStatus: ['submitted', 'under_review', 'in_progress', 'resolved', 'closed'],
  priority: ['low', 'medium', 'high', 'urgent'],
  sentiment: ['positive', 'neutral', 'negative'],
  analysisStatus: ['pending', 'completed', 'failed'],
  actorRole: ['system', 'department', 'admin'],
  historyKind: ['status', 'remark'],
  aiSource: ['ai', 'fallback'],
  aiReview: ['pending', 'accepted', 'dismissed'],
  notificationType: ['complaint_submitted', 'complaint_assigned', 'status_changed', 'complaint_in_progress', 'complaint_resolved', 'complaint_closed', 'admin_update', 'system'],
})

/* ------------------------------------------------------------------ *
 * Permission strings (same format as node-appwrite's Permission.*(Role.*))
 * ------------------------------------------------------------------ */

const ADMIN = 'label:admin'
const STAFF = 'label:department'
const p = (action, role) => `${action}("${role}")`

export const TABLE_IDS = Object.freeze({
  users: 'users',
  departments: 'departments',
  departmentUsers: 'department_users',
  categories: 'categories',
  complaints: 'complaints',
  complaintHistory: 'complaint_history',
  complaintNotes: 'complaint_notes',
  aiSummaries: 'ai_summaries',
  notifications: 'notifications',
  adminAudit: 'admin_audit',
})

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

export const TABLES = Object.freeze({
  users: {
    id: TABLE_IDS.users,
    name: 'Users',
    purpose:
      'One row per Appwrite account (row ID = the account ID). Mirrors name/email/role/status from Appwrite Auth; written only by the profile-api function. Replaces the Phase 6 `profiles` table.',
    rowSecurity: true,
    permissions: [],
    rowPermissionsNote: 'Set by profile-api when the row is created: read for the owner and for label:admin. Nobody gets update/delete.',
    columns: [
      ref('userId', true, 'Appwrite account ID (same as the row ID).'),
      { key: 'name', type: 'string', size: 128, required: true },
      { key: 'email', type: 'string', size: 320, required: true, description: 'Mirrors the account email.' },
      { key: 'rollNumber', type: 'string', size: 20, required: false, description: 'Students only. Empty (null) when unset.' },
      { key: 'role', type: 'enum', elements: ENUMS.role, required: true, description: 'Mirrors the account label (no label = student).' },
      { key: 'academicDepartment', type: 'string', size: 100, required: false, description: 'Students only: their academic program (an FET department).' },
      { key: 'accountStatus', type: 'enum', elements: ENUMS.accountStatus, required: true },
      { key: 'createdAt', type: 'datetime', required: true, description: 'When the account was created.' },
    ],
    indexes: [
      { key: 'user_id_unique', type: 'unique', columns: ['userId'] },
      { key: 'email_unique', type: 'unique', columns: ['email'] },
      { key: 'roll_number_unique', type: 'unique', columns: ['rollNumber'] },
      { key: 'role_idx', type: 'key', columns: ['role'] },
      { key: 'account_status_idx', type: 'key', columns: ['accountStatus'] },
    ],
  },

  departments: {
    id: TABLE_IDS.departments,
    name: 'Departments',
    purpose: 'Service departments that receive complaints (ITSC, Cleaning, ...). Never deleted: set status to inactive instead. Every signed-in user may read; changes are made only by the admin-api function (Phase 13), which validates them and keeps an audit trail.',
    rowSecurity: false,
    permissions: [p('read', 'users')],
    columns: [
      { key: 'name', type: 'string', size: 128, required: true },
      { key: 'description', type: 'string', size: 1000, required: false },
      { key: 'email', type: 'email', required: false, description: 'Contact address for the department. Left empty in the seed data.' },
      { key: 'status', type: 'enum', elements: ENUMS.recordStatus, required: true },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'name_unique', type: 'unique', columns: ['name'] },
      { key: 'status_idx', type: 'key', columns: ['status'] },
    ],
  },

  departmentUsers: {
    id: TABLE_IDS.departmentUsers,
    name: 'Department Users',
    purpose: 'Assigns department staff (users with role `department`) to service departments. One row per (user, department) pair. Staff and administrators may read; changes are made only by the admin-api function (Phase 13).',
    rowSecurity: false,
    permissions: [p('read', ADMIN), p('read', STAFF)],
    columns: [
      ref('userId', true, 'References users.userId.'),
      ref('departmentId', true, 'References departments row ID.'),
      { key: 'position', type: 'string', size: 100, required: false, default: 'Staff', description: 'e.g. Head, Technician, Clerk.' },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'user_department_unique', type: 'unique', columns: ['userId', 'departmentId'] },
      { key: 'department_idx', type: 'key', columns: ['departmentId'] },
      { key: 'user_idx', type: 'key', columns: ['userId'] },
    ],
  },

  categories: {
    id: TABLE_IDS.categories,
    name: 'Categories',
    purpose: 'Complaint categories. Each category belongs to exactly one department, which is where its complaints are routed. Every signed-in user may read; changes are made only by the admin-api function (Phase 13).',
    rowSecurity: false,
    permissions: [p('read', 'users')],
    columns: [
      { key: 'name', type: 'string', size: 128, required: true },
      { key: 'description', type: 'string', size: 1000, required: false },
      ref('departmentId', true, 'References departments row ID.'),
      { key: 'status', type: 'enum', elements: ENUMS.recordStatus, required: true },
    ],
    indexes: [
      { key: 'name_unique', type: 'unique', columns: ['name'] },
      { key: 'department_idx', type: 'key', columns: ['departmentId'] },
      { key: 'status_idx', type: 'key', columns: ['status'] },
    ],
  },

  complaints: {
    id: TABLE_IDS.complaints,
    name: 'Complaints',
    purpose:
      'One row per student complaint. Rows are created and changed ONLY by the complaint-api function (API key), which takes the student, department, status and dates from the server, never from the browser. Row ID = reference number. Students and department staff never read this table directly: they use complaint-api, which returns only the fields they are allowed to see (so internal fields can never leak). Only administrators can read it directly.',
    rowSecurity: true,
    permissions: [p('read', ADMIN)],
    rowPermissionsNote: 'Set by complaint-api: read for label:admin only (Phase 9; Phase 8 also granted the complainant read). Nobody gets update/delete from a browser.',
    columns: [
      { key: 'referenceNumber', type: 'string', size: 24, required: true, description: 'Unique complaint ID, e.g. CMP-20261122-K7M2QX. Same value as the row ID.' },
      ref('studentId', true, 'The authenticated complainant (users.userId), set by the server.'),
      { key: 'studentName', type: 'string', size: 128, required: true, description: 'Snapshot at submission time.' },
      { key: 'studentRollNumber', type: 'string', size: 20, required: false, description: 'Snapshot at submission time.' },
      { key: 'title', type: 'string', size: 200, required: true },
      { key: 'description', type: 'string', size: 5000, required: true },
      { key: 'location', type: 'string', size: 300, required: false, description: 'Location or other relevant details.' },
      ref('categoryId', true, 'References categories row ID.'),
      { key: 'categoryName', type: 'string', size: 128, required: true, description: 'Snapshot at submission time.' },
      ref('departmentId', true, 'The category’s department at submission time, looked up by the server.'),
      { key: 'departmentName', type: 'string', size: 128, required: true, description: 'Snapshot at submission time.' },
      { key: 'status', type: 'enum', elements: ENUMS.complaintStatus, required: true, description: 'Always `submitted` on creation.' },
      { key: 'priority', type: 'enum', elements: ENUMS.priority, required: false, default: 'medium' },
      { key: 'submittedAt', type: 'datetime', required: true, description: 'Server time of submission.' },
      ref('assignedTo', false, 'References users.userId (department staff handling it). Later phase.'),
      ref('lastUpdatedBy', false, 'Staff user ID of the last status change or remark. Private: never sent to students.'),
      { key: 'lastUpdatedByName', type: 'string', size: 128, required: false, description: 'Name of that staff member at the time.' },
      { key: 'lastUpdatedAt', type: 'datetime', required: false },
      ref('attachmentId', false, 'Appwrite Storage file ID in the complaint-attachments bucket.'),
      { key: 'attachmentName', type: 'string', size: 255, required: false, description: 'Taken from the stored file, not from the browser.' },
      { key: 'attachmentMime', type: 'string', size: 100, required: false },
      { key: 'attachmentSize', type: 'integer', required: false, min: 0, max: 52428800 },
      { key: 'resolutionNote', type: 'string', size: 2000, required: false },
      { key: 'resolvedAt', type: 'datetime', required: false },
    ],
    indexes: [
      { key: 'reference_number_unique', type: 'unique', columns: ['referenceNumber'] },
      { key: 'student_idx', type: 'key', columns: ['studentId'] },
      { key: 'department_status_idx', type: 'key', columns: ['departmentId', 'status'] },
      { key: 'category_idx', type: 'key', columns: ['categoryId'] },
      { key: 'status_idx', type: 'key', columns: ['status'] },
      { key: 'assigned_to_idx', type: 'key', columns: ['assignedTo'] },
    ],
  },

  complaintHistory: {
    id: TABLE_IDS.complaintHistory,
    name: 'Complaint History',
    purpose:
      'Status timeline of each complaint: one row per status (the first is `submitted`, written when the complaint is created). Contains ONLY information a student may see (status, date, public remark) – internal notes live in complaint_notes. Written by complaint-api; read through complaint-api only.',
    rowSecurity: false,
    permissions: [p('read', ADMIN)],
    columns: [
      ref('complaintId', true, 'References complaints row ID.'),
      { key: 'status', type: 'enum', elements: ENUMS.complaintStatus, required: true, description: 'The status the complaint moved TO.' },
      { key: 'previousStatus', type: 'enum', elements: ENUMS.complaintStatus, required: false },
      { key: 'kind', type: 'enum', elements: ENUMS.historyKind, required: false, default: 'status', description: '`status` = a status change; `remark` = a public remark without a status change.' },
      { key: 'remark', type: 'string', size: 1000, required: false, description: 'Public remark from the department, shown to the student.' },
      { key: 'actorRole', type: 'enum', elements: ENUMS.actorRole, required: true, description: 'Who made the change. Shown to students only as “Department” / “System”.' },
      ref('actorId', false, 'Staff user ID. Private: never sent to students.'),
      { key: 'actorName', type: 'string', size: 128, required: false, description: 'Staff name at the time. Private: shown to staff and administrators only.' },
      { key: 'changedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'complaint_changed_idx', type: 'key', columns: ['complaintId', 'changedAt'] },
      { key: 'actor_idx', type: 'key', columns: ['actorId'] },
    ],
  },

  complaintNotes: {
    id: TABLE_IDS.complaintNotes,
    name: 'Complaint Notes',
    purpose:
      'INTERNAL department notes about a complaint (Phase 10). Never readable by students: no student-facing code reads this table and its permissions grant them nothing. Staff read and write them only through complaint-api, for complaints of their own department.',
    rowSecurity: false,
    permissions: [p('read', ADMIN)],
    columns: [
      ref('complaintId', true, 'References complaints row ID.'),
      ref('authorId', true, 'Staff user ID.'),
      { key: 'authorName', type: 'string', size: 128, required: false },
      { key: 'note', type: 'string', size: 2000, required: true },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'complaint_idx', type: 'key', columns: ['complaintId'] },
      { key: 'author_idx', type: 'key', columns: ['authorId'] },
    ],
  },

  aiSummaries: {
    id: TABLE_IDS.aiSummaries,
    name: 'AI Summaries',
    purpose:
      'AI analysis of a complaint (Phase 11): short summary, SUGGESTED category, department and priority. One row per complaint (row ID = complaint ID; re-running updates it). Written only by the ai-analysis function; staff and administrators read it through complaint-api. Everything here is a suggestion: it never changes the complaint by itself. `source` says whether the AI provider or the rule-based fallback produced it.',
    rowSecurity: true,
    permissions: [p('read', ADMIN)],
    columns: [
      ref('complaintId', true, 'References complaints row ID (also the row ID).'),
      { key: 'status', type: 'enum', elements: ENUMS.analysisStatus, required: true, description: '`pending` while running, `completed` when a result (AI or fallback) is stored, `failed` only for unexpected errors.' },
      { key: 'source', type: 'enum', elements: ENUMS.aiSource, required: false, description: '`ai` = the configured AI provider; `fallback` = built-in keyword rules (used when the AI is unavailable, rate limited or returned something invalid).' },
      { key: 'summary', type: 'string', size: 2000, required: false, description: 'Short, clear summary (validated, max 400 characters).' },
      ref('suggestedCategoryId', false, 'Suggested category (one of the active categories). References categories row ID.'),
      ref('suggestedDepartmentId', false, 'The suggested category’s department. References departments row ID.'),
      { key: 'priority', type: 'enum', elements: ENUMS.priority, required: false, description: 'Suggested priority.' },
      { key: 'sentiment', type: 'enum', elements: ENUMS.sentiment, required: false },
      { key: 'keywords', type: 'string', size: 50, required: false, array: true },
      { key: 'confidence', type: 'float', required: false, min: 0, max: 1 },
      { key: 'reason', type: 'string', size: 500, required: false, description: 'Why this category/priority was suggested (validated, short).' },
      { key: 'model', type: 'string', size: 100, required: false, description: 'Provider/model that produced it, or `rule-based-fallback`.' },
      { key: 'errorMessage', type: 'string', size: 500, required: false, description: 'Why the AI was not used (fallback) or the analysis failed. Never contains secrets.' },
      { key: 'attempts', type: 'integer', required: false, min: 0, max: 1000, default: 0, description: 'How many times analysis was run (limits re-runs).' },
      { key: 'generatedAt', type: 'datetime', required: false },
      { key: 'reviewStatus', type: 'enum', elements: ENUMS.aiReview, required: false, default: 'pending', description: 'Whether a person has reviewed the suggestion.' },
      ref('reviewedBy', false, 'Staff/admin user ID who reviewed. Private.'),
      { key: 'reviewedByName', type: 'string', size: 128, required: false },
      { key: 'reviewedAt', type: 'datetime', required: false },
    ],
    indexes: [
      { key: 'complaint_unique', type: 'unique', columns: ['complaintId'] },
      { key: 'status_idx', type: 'key', columns: ['status'] },
    ],
  },

  adminAudit: {
    id: TABLE_IDS.adminAudit,
    name: 'Admin Audit',
    purpose:
      'Audit trail of sensitive administrator operations (Phase 13): creating accounts, role and status changes, department, category and staff-assignment changes. Written only by the server (admin-api, profile-api); only administrators can read it. Never contains passwords or other secrets.',
    rowSecurity: false,
    permissions: [p('read', ADMIN)],
    columns: [
      ref('actorId', true, 'The administrator who did it (taken from the verified login).'),
      { key: 'actorName', type: 'string', size: 128, required: false },
      { key: 'action', type: 'string', size: 64, required: true, description: 'e.g. department.create, user.setRole.' },
      { key: 'targetType', type: 'string', size: 32, required: true, description: 'user, department, category or staff.' },
      { key: 'targetId', type: 'string', size: 64, required: false },
      { key: 'summary', type: 'string', size: 500, required: true, description: 'A short sentence describing the change.' },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'created_idx', type: 'key', columns: ['createdAt'] },
      { key: 'actor_idx', type: 'key', columns: ['actorId'] },
    ],
  },

  notifications: {
    id: TABLE_IDS.notifications,
    name: 'Notifications',
    purpose:
      'In-app notifications (Phase 12). The row ID is the notificationId: a hash of the event, so the same event can never notify the same person twice. Created ONLY by complaint-api (API key). Each row is readable only by its recipient; nobody can update or delete it from a browser (marking as read goes through complaint-api, which changes nothing but isRead/readAt).',
    rowSecurity: true,
    permissions: [],
    rowPermissionsNote: 'Set by complaint-api when the row is created: read for the recipient only. No update, no delete.',
    columns: [
      ref('userId', true, 'The recipient. References users.userId.'),
      { key: 'type', type: 'enum', elements: ENUMS.notificationType, required: true },
      { key: 'title', type: 'string', size: 200, required: true },
      { key: 'message', type: 'string', size: 1000, required: true },
      ref('relatedComplaintId', false, 'The complaint this is about, if any. References complaints row ID.'),
      { key: 'isRead', type: 'boolean', required: false, default: false },
      { key: 'readAt', type: 'datetime', required: false },
      { key: 'createdAt', type: 'datetime', required: false, description: 'Server time the notification was created (always set; optional only so older rows can be upgraded).' },
    ],
    indexes: [
      { key: 'user_read_idx', type: 'key', columns: ['userId', 'isRead'] },
      { key: 'user_created_idx', type: 'key', columns: ['userId', 'createdAt'] },
      { key: 'related_complaint_idx', type: 'key', columns: ['relatedComplaintId'] },
    ],
  },
})

/* ------------------------------------------------------------------ *
 * Initial data
 * Fixed row IDs make seeding idempotent: running it twice creates nothing new and never
 * overwrites edits an administrator made later.
 * ------------------------------------------------------------------ */

export const DEPARTMENT_SEEDS = Object.freeze([
  { id: 'itsc', name: 'ITSC Department', description: 'Information Technology Services Centre – LMS and campus IT systems.' },
  { id: 'computer-technician', name: 'Computer Technician Department', description: 'Repair and maintenance of lab and office computers.' },
  { id: 'water-cooler', name: 'Water Cooler Maintenance', description: 'Water coolers and drinking water facilities.' },
  { id: 'clerk-job', name: 'Clerk Job Department', description: 'Clerical and administrative office services.' },
  { id: 'cleaning', name: 'Cleaning Department', description: 'Cleanliness of classrooms, labs, corridors and washrooms.' },
  { id: 'teacher-complaint', name: 'Concerned Teacher Complaint Department', description: 'Complaints about teaching staff, handled with care.' },
  { id: 'student-affairs', name: 'Student Affairs Department', description: 'Student welfare, discipline and general student matters.' },
])

export const CATEGORY_SEEDS = Object.freeze([
  { id: 'lms-issues', name: 'LMS Issues', departmentId: 'itsc', description: 'Problems with the learning management system.' },
  { id: 'computer-problems', name: 'Computer Problems', departmentId: 'computer-technician', description: 'Faulty or slow computers in labs and offices.' },
  { id: 'water-cooler-issues', name: 'Water Cooler Issues', departmentId: 'water-cooler', description: 'Broken, dirty or empty water coolers.' },
  { id: 'clerk-related-issues', name: 'Clerk-Related Issues', departmentId: 'clerk-job', description: 'Issues with clerical or office services.' },
  { id: 'cleaning-issues', name: 'Cleaning Issues', departmentId: 'cleaning', description: 'Areas that need cleaning or are unhygienic.' },
  { id: 'teacher-related-complaints', name: 'Teacher-Related Complaints', departmentId: 'teacher-complaint', description: 'Concerns about a teacher’s conduct or teaching.' },
  { id: 'student-affairs', name: 'Student Affairs', departmentId: 'student-affairs', description: 'General student affairs matters.' },
])

/** Appwrite custom row IDs: a-z A-Z 0-9 . - _ , max 36 chars, must not start with a special character. */
export const ROW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/

/* ------------------------------------------------------------------ *
 * Complaint submission rules (Phase 8)
 * Used by the browser form (early feedback) and mirrored in functions/complaint-api (the real check;
 * a test keeps both copies identical).
 * ------------------------------------------------------------------ */

export const COMPLAINT_RULES = Object.freeze({
  title: { min: 5, max: 150 },
  description: { min: 10, max: 5000 },
  location: { max: 300 },
  attachment: {
    maxBytes: 5 * 1024 * 1024,
    /** extension -> the MIME type Appwrite detects for that file */
    types: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' },
  },
  /** Search box on My Complaints. */
  search: { max: 100 },
  /** Remarks a department attaches to a status change (shown to the student). */
  remark: { max: 1000 },
  /** Internal department note (never shown to students). */
  note: { max: 2000 },
  /** Marking a complaint resolved needs a remark of at least this many characters, so the student learns what was done. */
  resolveRemarkMin: 5,
  /** A student may submit at most `max` complaints per `windowMinutes`. */
  rateLimit: { max: 5, windowMinutes: 10 },
  /** Re-sending the identical complaint within this many minutes returns the existing one (double-click / retry safe). */
  duplicateWindowMinutes: 2,
})

/* ------------------------------------------------------------------ *
 * Storage buckets
 * ------------------------------------------------------------------ */

export const BUCKETS = Object.freeze({
  complaintAttachments: {
    id: 'complaint-attachments',
    name: 'Complaint attachments',
    purpose:
      'Optional evidence file (photo or PDF) for a complaint. Students upload; the complaint-api function verifies the file and then locks its permissions to read-only for the owner and administrators. Department staff download through the function only.',
    fileSecurity: true,
    permissions: ['create("users")'],
    maximumFileSize: COMPLAINT_RULES.attachment.maxBytes,
    allowedFileExtensions: Object.keys(COMPLAINT_RULES.attachment.types),
    encryption: true,
    antivirus: true,
    compression: 'none',
  },
})

/* ------------------------------------------------------------------ *
 * AI analysis rules (Phase 11). Mirrored in functions/ai-analysis and functions/complaint-api (tests keep them equal).
 * ------------------------------------------------------------------ */

export const AI_RULES = Object.freeze({
  summaryMax: 400,
  reasonMax: 500,
  keywords: { max: 8, length: 30 },
  /** How many times one complaint may be analysed (first run + re-runs). */
  maxAttempts: 10,
  /** Only this much of the complaint text is ever sent to the AI provider. */
  input: { titleMax: 150, descriptionMax: 2000 },
})
