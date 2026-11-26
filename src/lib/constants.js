export const APP_NAME = 'AI SmartServices'
export const APP_TAGLINE = 'AI-Based Complaint Management and Department Notification System'

/** Sample FET department list – adjust to match the real faculty structure. */
export const FET_DEPARTMENTS = [
  'Software Engineering',
  'Computer Systems Engineering',
  'Electronic Engineering',
  'Telecommunication Engineering',
  'Information Technology',
]

/** Lifecycle order: Submitted -> Under Review -> In Progress -> Resolved -> Closed. New complaints start as `submitted`. */
export const COMPLAINT_STATUS = {
  submitted: { label: 'Submitted', variant: 'info' },
  under_review: { label: 'Under Review', variant: 'warning' },
  in_progress: { label: 'In Progress', variant: 'info' },
  resolved: { label: 'Resolved', variant: 'success' },
  closed: { label: 'Closed', variant: 'neutral' },
}

export const COMPLAINT_PRIORITY = {
  low: { label: 'Low', variant: 'neutral' },
  medium: { label: 'Medium', variant: 'info' },
  high: { label: 'High', variant: 'warning' },
  urgent: { label: 'Urgent', variant: 'danger' },
}

export const ROLES = {
  STUDENT: 'student',
  DEPARTMENT: 'department',
  ADMIN: 'admin',
}

/**
 * Appwrite user LABELS that grant elevated roles. Labels are read-only for
 * clients (only the console or a server API key can set them), so unlike
 * prefs they cannot be self-assigned. No label = student.
 */
export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'admin',
  [ROLES.DEPARTMENT]: 'department',
}

/** Human-readable role names. */
export const ROLE_TITLES = {
  [ROLES.STUDENT]: 'Student',
  [ROLES.DEPARTMENT]: 'Department Staff',
  [ROLES.ADMIN]: 'Administrator',
}

export const ACCOUNT_STATUS = {
  active: { label: 'Active', variant: 'success' },
  disabled: { label: 'Disabled', variant: 'danger' },
}

/** Badge colour for each role. */
export const ROLE_BADGE_VARIANT = {
  [ROLES.STUDENT]: 'neutral',
  [ROLES.DEPARTMENT]: 'info',
  [ROLES.ADMIN]: 'warning',
}
