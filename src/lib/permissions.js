import { ROLES } from './constants.js'
import { PATHS } from '../routes/paths.js'

/**
 * Role checks for the UI.
 *
 * IMPORTANT: these decide what to SHOW and where to NAVIGATE – they are not security.
 * Real enforcement happens in Appwrite (labels, table/row permissions) and in the
 * `profile-api` function, which re-checks the caller's role on every request.
 */

/** True when `role` is one of `allowed`. */
export const hasRole = (role, ...allowed) => allowed.includes(role)

export const isStudent = (role) => role === ROLES.STUDENT
export const isDepartmentStaff = (role) => role === ROLES.DEPARTMENT
export const isAdmin = (role) => role === ROLES.ADMIN

/** Only administrators may manage other users and roles. */
export const canManageUsers = (role) => isAdmin(role)

/** Each role's URL area (/student, /department, /admin). */
const roleArea = (role) => PATHS[role]?.base

/** True when `pathname` is inside the area that belongs to `role`. */
export function canAccessPath(role, pathname) {
  const area = roleArea(role)
  if (!area || typeof pathname !== 'string') return false
  return pathname === area || pathname.startsWith(`${area}/`)
}

/** Profile fields each role may edit on their OWN profile (mirrors the function; the server decides). */
export const SELF_EDITABLE_FIELDS = {
  [ROLES.STUDENT]: ['name', 'department', 'rollNumber'],
  [ROLES.DEPARTMENT]: ['name'],
  [ROLES.ADMIN]: ['name'],
}

export const canEditField = (role, field) => (SELF_EDITABLE_FIELDS[role] ?? []).includes(field)
