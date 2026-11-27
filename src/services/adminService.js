import { ADMIN_FUNCTION_ID } from '../lib/appwrite/index.js'
import { callFunction } from './complaintService.js'

/**
 * Client for the administrator module of the `complaint-api` Appwrite Function: dashboard numbers, reports, and the ONLY way departments, categories and staff
 * assignments are changed. The function checks on the server, for every call, that the signed-in user is an administrator,
 * validates the input, and records the change in the audit trail. (Accounts and roles: services/profileService.js.)
 */
export { isSessionError, toComplaintError as toAdminError } from './complaintService.js'

const call = (action, payload = {}) => callFunction(ADMIN_FUNCTION_ID, action, payload)

export async function getDashboardStats() {
  return (await call('dashboard.stats')).stats
}

/** Complaints by category and department, status distribution and resolution statistics. */
export async function getReport() {
  return (await call('reports.summary')).report
}

/** The newest administrator activity (who changed what and when). */
export async function listAudit(limit = 10) {
  return (await call('audit.list', { limit })).entries
}

/* ---- Departments --------------------------------------------------------------------- */

export async function listDepartments() {
  return (await call('department.list')).departments
}
export async function createDepartment({ name, description, email, status }) {
  return (await call('department.create', { name, description, email, status })).department
}
/** Only the keys you pass change. */
export async function updateDepartment(departmentId, changes) {
  return (await call('department.update', { departmentId, ...changes })).department
}

/* ---- Categories ---------------------------------------------------------------------- */

export async function listCategories() {
  return (await call('category.list')).categories
}
export async function createCategory({ name, description, departmentId, status }) {
  return (await call('category.create', { name, description, departmentId, status })).category
}
export async function updateCategory(categoryId, changes) {
  return (await call('category.update', { categoryId, ...changes })).category
}

/* ---- Department staff ---------------------------------------------------------------- */

/** Active users with the department-staff role (who can be assigned). */
export async function listStaffCandidates() {
  return (await call('staff.candidates')).candidates
}
export async function listDepartmentStaff(departmentId) {
  return (await call('staff.list', { departmentId })).staff
}
export async function assignStaff({ userId, departmentId, position }) {
  return (await call('staff.assign', { userId, departmentId, position })).staff
}
export async function updateStaffPosition(assignmentId, position) {
  return (await call('staff.updatePosition', { assignmentId, position })).staff
}
export async function removeStaff(assignmentId) {
  await call('staff.remove', { assignmentId })
}


/** Administrators only: every complaint, with search, filters and paging. */
export async function listAdminComplaints(params = {}) {
  const { complaints, total, sampled } = await call('admin.complaints.list', params)
  return { complaints, total, sampled: Boolean(sampled) }
}