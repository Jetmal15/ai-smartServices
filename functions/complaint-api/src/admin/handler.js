/**
 * admin-api – trusted backend for the administrator dashboard (Phase 13). Runs inside an Appwrite Function with a server API key.
 *
 *   - dashboard statistics and reports (read-only aggregation across tables)
 *   - departments, categories and department-staff assignments: the ONLY writer of those three tables (browsers, including
 *     administrators, can only read them), so every change is validated here and recorded in the audit trail
 *
 * Every action requires a signed-in ADMINISTRATOR: the caller comes from the verified login and the role is re-read from the
 * account's labels on every call. Nothing about identity or role is taken from the request body.
 * User accounts (roles, activation, provisioning) are handled by profile-api; complaints by complaint-api.
 *
 * Pure logic over injected `deps` (see main.js and tests/support/fake-admin-backend.mjs).
 */

export const ROLES = { STUDENT: 'student', DEPARTMENT: 'department', ADMIN: 'admin' }
export const STATUSES = ['submitted', 'under_review', 'in_progress', 'resolved', 'closed']
const RECORD_STATUSES = ['active', 'inactive']
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const POSITION_MAX = 100
const DEFAULT_POSITION = 'Staff'
/** The resolution report reads at most this many resolved/closed complaints. */
const MAX_RESOLUTION_SAMPLE = 2000

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

const invalid = (fields, message = 'Please correct the highlighted fields.') => new HttpError(400, 'validation_failed', message, fields)

export function roleFromLabels(labels = []) {
  if (labels.includes(ROLES.ADMIN)) return ROLES.ADMIN
  if (labels.includes(ROLES.DEPARTMENT)) return ROLES.DEPARTMENT
  return ROLES.STUDENT
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const clean = (value) => String(value ?? '').replace(CONTROL, ' ').trim().replace(/\s+/g, ' ')
const nameKey = (value) => clean(value).toLowerCase()
const isText = (value) => value === undefined || value === null || typeof value === 'string'

/* ------------------------------------------------------------------ *
 * Authentication: administrators only
 * ------------------------------------------------------------------ */

function parseBody(req) {
  if (req.bodyJson && typeof req.bodyJson === 'object' && !Array.isArray(req.bodyJson)) return req.bodyJson
  try {
    const parsed = JSON.parse(req.bodyText ?? (typeof req.body === 'string' ? req.body : '') ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'invalid_request', 'Request body must be a JSON object.')
}

async function authenticateAdmin(req, deps) {
  const headers = req.headers ?? {}
  const userId = headers['x-appwrite-user-id']
  const jwt = headers['x-appwrite-user-jwt']
  const unauthenticated = () => new HttpError(401, 'unauthenticated', 'Your session is not valid. Please sign in again.')
  if (!userId || !jwt) throw new HttpError(401, 'unauthenticated', 'You must be signed in.')
  let verified
  try {
    verified = await deps.verifyJwt(jwt)
  } catch {
    throw unauthenticated()
  }
  if (verified !== userId) throw unauthenticated()
  const account = await deps.users.get(userId)
  if (!account) throw unauthenticated()
  if (account.status === false) throw new HttpError(403, 'account_disabled', 'This account has been disabled. Contact the administrator.')
  if (roleFromLabels(account.labels) !== ROLES.ADMIN) throw new HttpError(403, 'forbidden', 'Only administrators can do that.')
  return { id: userId, name: String(account.name ?? '').slice(0, 128) || null }
}

const stamp = (deps) => (deps.now ? deps.now() : new Date()).toISOString()

/** Audit trail. Best effort: a failed audit write is logged and never undoes a change that already happened. */
async function audit(deps, admin, { action, targetType, targetId, summary }) {
  try {
    await deps.audit.record({ actorId: admin.id, actorName: admin.name, action, targetType, targetId: targetId ?? null, summary: String(summary).slice(0, 500), createdAt: stamp(deps) })
  } catch (error) {
    deps.log?.(`could not record the audit entry for ${action}: ${error?.message ?? error}`)
  }
}

/* ------------------------------------------------------------------ *
 * Validation (same rules as the Phase 7 browser services)
 * ------------------------------------------------------------------ */

function validateRecord(input, { partial, withEmail, withDepartment }) {
  const values = {}
  const fields = {}
  for (const key of ['name', 'description', 'email', 'status', 'departmentId']) if (!isText(input[key])) fields[key] = 'This must be text.'
  if (Object.keys(fields).length > 0) throw invalid(fields)
  const has = (key) => !partial || key in input

  if (has('name')) {
    const name = clean(input.name)
    if (name.length < 2) fields.name = 'Enter the name.'
    else if (name.length > 128) fields.name = 'Name must be at most 128 characters.'
    else values.name = name
  }
  if (has('description') && input.description !== undefined && input.description !== null) {
    const description = clean(input.description)
    if (description.length > 1000) fields.description = 'Description must be at most 1000 characters.'
    else values.description = description
  }
  if (withEmail && has('email') && input.email !== undefined && input.email !== null) {
    const email = clean(input.email).toLowerCase()
    if (email && (email.length > 254 || !EMAIL_PATTERN.test(email))) fields.email = 'Enter a valid email address.'
    else values.email = email || null
  }
  if (withDepartment && has('departmentId')) {
    const id = clean(input.departmentId)
    if (!ID_PATTERN.test(id)) fields.departmentId = 'Choose the department that handles this category.'
    else values.departmentId = id
  }
  if (has('status')) {
    const status = input.status ?? (partial ? undefined : 'active')
    if (!RECORD_STATUSES.includes(status)) fields.status = 'Choose active or inactive.'
    else values.status = status
  }
  if (Object.keys(fields).length > 0) throw invalid(fields)
  return values
}

function cleanPosition(value) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw invalid({ position: 'The position must be text.' })
  const position = clean(value ?? DEFAULT_POSITION) || DEFAULT_POSITION
  if (position.length > POSITION_MAX) throw invalid({ position: `Position must be at most ${POSITION_MAX} characters.` })
  return position
}

const requireId = (value, label) => {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!ID_PATTERN.test(id)) throw new HttpError(404, 'not_found', `${label} was not found.`)
  return id
}

/* ------------------------------------------------------------------ *
 * Administrator complaint listing
 * ------------------------------------------------------------------ */

async function actionComplaintList(admin, body, deps) {
  const fields = {}
  const status = body.status == null || body.status === '' ? '' : body.status
  const departmentId = body.departmentId == null || body.departmentId === '' ? '' : body.departmentId
  const categoryId = body.categoryId == null || body.categoryId === '' ? '' : body.categoryId
  const search = body.search == null ? '' : body.search
  const sort = body.sort || 'newest'
  if (status && !STATUSES.includes(status)) fields.status = 'Choose a valid status.'
  if (departmentId && (typeof departmentId !== 'string' || !ID_PATTERN.test(departmentId))) fields.departmentId = 'Choose a valid department.'
  if (categoryId && (typeof categoryId !== 'string' || !ID_PATTERN.test(categoryId))) fields.categoryId = 'Choose a valid category.'
  if (typeof search !== 'string' || search.length > 120) fields.search = 'Search must be at most 120 characters.'
  if (!['newest', 'oldest'].includes(sort)) fields.sort = 'Choose a valid sort order.'
  if (Object.keys(fields).length) throw invalid(fields)

  const limit = Math.min(Math.max(Number.parseInt(body.limit, 10) || 20, 1), 100)
  const offset = Math.max(Number.parseInt(body.offset, 10) || 0, 0)
  const filters = { status: status || undefined, departmentId: departmentId || undefined, categoryId: categoryId || undefined, sort }
  if (!search.trim()) {
    const page = await deps.complaints.list({ ...filters, limit, offset })
    return { complaints: page.rows.map(toAdminComplaint), total: page.total, sampled: false }
  }

  // Text search is intentionally bounded to the 2,000 newest matching records.
  const rows = await deps.complaints.listAll({ ...filters, max: 2000 })
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = rows.filter((row) => {
    const haystack = [row.$id, row.referenceNumber, row.title, row.studentName, row.studentRollNumber, row.categoryName, row.description]
      .filter(Boolean).join(' ').toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
  return {
    complaints: matches.slice(offset, offset + limit).map(toAdminComplaint),
    total: matches.length,
    sampled: rows.length >= 2000,
  }
}

function toAdminComplaint(row) {
  return {
    id: row.$id,
    referenceNumber: row.referenceNumber,
    title: row.title,
    studentName: row.studentName ?? 'Student',
    studentRollNumber: row.studentRollNumber ?? '',
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    status: row.status,
    priority: row.priority ?? 'medium',
    submittedAt: row.submittedAt,
    resolvedAt: row.resolvedAt ?? null,
    description: row.description,
  }
}

/* ------------------------------------------------------------------ *
 * Dashboard and reports
 * ------------------------------------------------------------------ */

async function actionDashboardStats(admin, body, deps) {
  const counts = await Promise.all(STATUSES.map((status) => deps.complaints.count({ status })))
  const byStatus = Object.fromEntries(STATUSES.map((status, i) => [status, counts[i]]))
  const [total, students, staff, admins, departments, activeDepartments, categories, activeCategories] = await Promise.all([
    deps.complaints.count({}),
    deps.userRows.count({ role: ROLES.STUDENT }),
    deps.userRows.count({ role: ROLES.DEPARTMENT }),
    deps.userRows.count({ role: ROLES.ADMIN }),
    deps.departments.count({}),
    deps.departments.count({ status: 'active' }),
    deps.categories.count({}),
    deps.categories.count({ status: 'active' }),
  ])
  const recentActivity = await deps.audit.list(5)
  return {
    stats: {
      complaints: {
        total,
        // "Pending" = not yet being worked on: newly submitted or under review.
        pending: byStatus.submitted + byStatus.under_review,
        ...byStatus,
      },
      users: { students, staff, admins },
      departments: { total: departments, active: activeDepartments },
      categories: { total: categories, active: activeCategories },
    },
    recentActivity: recentActivity.map((r) => ({
      id: r.$id,
      actorName: r.actorName ?? 'Administrator',
      action: r.action,
      targetType: r.targetType,
      summary: r.summary,
      createdAt: r.createdAt,
    })),
  }
}

const round1 = (n) => Math.round(n * 10) / 10
const median = (sorted) => (sorted.length === 0 ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)

function resolutionStats(hours) {
  const sorted = [...hours].sort((a, b) => a - b)
  if (sorted.length === 0) return { count: 0, averageHours: null, medianHours: null, within24h: null, within72h: null }
  const share = (limit) => round1((sorted.filter((h) => h <= limit).length / sorted.length) * 100)
  return {
    count: sorted.length,
    averageHours: round1(sorted.reduce((sum, h) => sum + h, 0) / sorted.length),
    medianHours: round1(median(sorted)),
    within24h: share(24),
    within72h: share(72),
  }
}

/**
 * Complaints by category, by department (with performance), status distribution and resolution statistics.
 * Counts use database count queries; only resolution times need rows (resolved/closed complaints, capped at 2,000).
 */
async function actionReportsSummary(admin, body, deps) {
  const [categories, departments] = await Promise.all([deps.categories.listAll(), deps.departments.listAll()])
  const counts = await Promise.all(STATUSES.map((status) => deps.complaints.count({ status })))
  const statusDistribution = Object.fromEntries(STATUSES.map((status, i) => [status, counts[i]]))
  const total = counts.reduce((sum, n) => sum + n, 0)

  const byCategory = await Promise.all(categories.map(async (c) => ({ categoryId: c.$id, name: c.name, departmentId: c.departmentId, status: c.status, total: await deps.complaints.count({ categoryId: c.$id }) })))
  const departmentCounts = await Promise.all(
    departments.map(async (d) => {
      const [all, finished] = await Promise.all([deps.complaints.count({ departmentId: d.$id }), deps.complaints.count({ departmentId: d.$id, statuses: ['resolved', 'closed'] })])
      return { all, finished }
    }),
  )

  const finishedRows = await deps.complaints.listFinished(MAX_RESOLUTION_SAMPLE)
  const hoursOf = (row) => (new Date(row.resolvedAt) - new Date(row.submittedAt)) / 3_600_000
  const timed = finishedRows.filter((row) => row.resolvedAt && row.submittedAt && hoursOf(row) >= 0)
  const hoursByDepartment = new Map()
  for (const row of timed) hoursByDepartment.set(row.departmentId, [...(hoursByDepartment.get(row.departmentId) ?? []), hoursOf(row)])

  const byDepartment = departments
    .map((d, i) => {
      const { all, finished } = departmentCounts[i]
      const stats = resolutionStats(hoursByDepartment.get(d.$id) ?? [])
      return { departmentId: d.$id, name: d.name, status: d.status, total: all, open: all - finished, resolved: finished, resolutionRate: all === 0 ? null : round1((finished / all) * 100), averageResolutionHours: stats.averageHours, resolvedWithTime: stats.count }
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  const resolved = statusDistribution.resolved + statusDistribution.closed
  return {
    report: {
      generatedAt: stamp(deps),
      total,
      statusDistribution,
      byCategory: byCategory.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
      byDepartment,
      resolution: { ...resolutionStats(timed.map(hoursOf)), resolvedOrClosed: resolved, resolutionRate: total === 0 ? null : round1((resolved / total) * 100), sampled: finishedRows.length >= MAX_RESOLUTION_SAMPLE },
    },
  }
}

/* ------------------------------------------------------------------ *
 * Departments
 * ------------------------------------------------------------------ */

async function assertUniqueName(rows, name, exceptId, what) {
  if (rows.some((row) => row.$id !== exceptId && nameKey(row.name) === nameKey(name))) {
    const message = `A ${what} with this name already exists.`
    throw new HttpError(409, 'conflict', message, { name: message })
  }
}

const toDepartment = (row, extra = {}) => ({ id: row.$id, name: row.name, description: row.description ?? '', email: row.email ?? '', status: row.status, createdAt: row.createdAt ?? null, ...extra })

async function actionDepartmentList(admin, body, deps) {
  const [departments, assignments, categories] = await Promise.all([deps.departments.listAll(), deps.departmentUsers.listAll(), deps.categories.listAll()])
  const staff = new Map()
  const cats = new Map()
  for (const a of assignments) staff.set(a.departmentId, (staff.get(a.departmentId) ?? 0) + 1)
  for (const c of categories) cats.set(c.departmentId, (cats.get(c.departmentId) ?? 0) + 1)
  return { departments: departments.sort((a, b) => a.name.localeCompare(b.name)).map((d) => toDepartment(d, { staffCount: staff.get(d.$id) ?? 0, categoryCount: cats.get(d.$id) ?? 0 })) }
}

async function actionDepartmentCreate(admin, body, deps) {
  const values = validateRecord(body, { partial: false, withEmail: true })
  await assertUniqueName(await deps.departments.listAll(), values.name, null, 'department')
  const row = await deps.departments.create({ description: '', email: null, ...values, createdAt: stamp(deps) })
  await audit(deps, admin, { action: 'department.create', targetType: 'department', targetId: row.$id, summary: `Created the department “${row.name}”.` })
  return { department: toDepartment(row, { staffCount: 0, categoryCount: 0 }) }
}

async function actionDepartmentUpdate(admin, body, deps) {
  const id = requireId(body.departmentId, 'The department')
  const existing = await deps.departments.get(id)
  if (!existing) throw new HttpError(404, 'not_found', 'The department was not found.')
  const values = validateRecord(body, { partial: true, withEmail: true })
  for (const key of Object.keys(values)) if (values[key] === (existing[key] ?? (key === 'email' ? null : undefined))) delete values[key]
  if (Object.keys(values).length === 0) throw invalid({}, 'Nothing to update.')
  if (values.name) await assertUniqueName(await deps.departments.listAll(), values.name, id, 'department')
  const row = await deps.departments.update(id, values)
  const changed = Object.keys(values).join(', ')
  await audit(deps, admin, {
    action: values.status ? `department.${values.status === 'active' ? 'activate' : 'deactivate'}` : 'department.update',
    targetType: 'department',
    targetId: id,
    summary: values.status && Object.keys(values).length === 1 ? `${values.status === 'active' ? 'Activated' : 'Deactivated'} the department “${row.name}”.` : `Updated the department “${row.name}” (${changed}).`,
  })
  return { department: toDepartment(row) }
}

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

const toCategory = (row, departmentName = '') => ({ id: row.$id, name: row.name, description: row.description ?? '', departmentId: row.departmentId, departmentName, status: row.status })

async function usableDepartment(departmentId, deps) {
  const department = await deps.departments.get(departmentId)
  if (!department) throw invalid({ departmentId: 'That department does not exist.' })
  if (department.status !== 'active') throw invalid({ departmentId: 'That department is inactive.' })
  return department
}

async function actionCategoryList(admin, body, deps) {
  const [categories, departments] = await Promise.all([deps.categories.listAll(), deps.departments.listAll()])
  const names = new Map(departments.map((d) => [d.$id, d.name]))
  return { categories: categories.sort((a, b) => a.name.localeCompare(b.name)).map((c) => toCategory(c, names.get(c.departmentId) ?? '')) }
}

async function actionCategoryCreate(admin, body, deps) {
  const values = validateRecord(body, { partial: false, withDepartment: true })
  const department = await usableDepartment(values.departmentId, deps)
  await assertUniqueName(await deps.categories.listAll(), values.name, null, 'category')
  const row = await deps.categories.create({ description: '', ...values })
  await audit(deps, admin, { action: 'category.create', targetType: 'category', targetId: row.$id, summary: `Created the category “${row.name}” for ${department.name}.` })
  return { category: toCategory(row, department.name) }
}

async function actionCategoryUpdate(admin, body, deps) {
  const id = requireId(body.categoryId, 'The category')
  const existing = await deps.categories.get(id)
  if (!existing) throw new HttpError(404, 'not_found', 'The category was not found.')
  const values = validateRecord(body, { partial: true, withDepartment: true })
  for (const key of Object.keys(values)) if (values[key] === existing[key]) delete values[key]
  if (Object.keys(values).length === 0) throw invalid({}, 'Nothing to update.')
  if (values.name) await assertUniqueName(await deps.categories.listAll(), values.name, id, 'category')
  // A category must always point at a usable department: when moved to another one, or switched back on.
  const target = values.departmentId ?? existing.departmentId
  const department = values.departmentId || values.status === 'active' ? await usableDepartment(target, deps) : await deps.departments.get(target)
  const row = await deps.categories.update(id, values)
  await audit(deps, admin, {
    action: values.status && Object.keys(values).length === 1 ? `category.${values.status === 'active' ? 'activate' : 'deactivate'}` : 'category.update',
    targetType: 'category',
    targetId: id,
    summary: values.status && Object.keys(values).length === 1 ? `${values.status === 'active' ? 'Activated' : 'Deactivated'} the category “${row.name}”.` : `Updated the category “${row.name}” (${Object.keys(values).join(', ')}).`,
  })
  return { category: toCategory(row, department?.name ?? '') }
}

/* ------------------------------------------------------------------ *
 * Department staff
 * ------------------------------------------------------------------ */

async function describeAssignments(rows, deps) {
  const people = new Map()
  for (const userId of new Set(rows.map((r) => r.userId))) people.set(userId, await deps.userRows.get(userId))
  return rows.map((r) => ({ id: r.$id, userId: r.userId, name: people.get(r.userId)?.name ?? 'Unknown user', email: people.get(r.userId)?.email ?? '', departmentId: r.departmentId, position: r.position ?? DEFAULT_POSITION, createdAt: r.createdAt ?? null }))
}

/** Active users with the department-staff role: who can be assigned. */
async function actionStaffCandidates(admin, body, deps) {
  const rows = await deps.userRows.listByRole(ROLES.DEPARTMENT, 1000)
  return { candidates: rows.filter((r) => r.accountStatus === 'active').map((r) => ({ id: r.$id, name: r.name, email: r.email })).sort((a, b) => a.name.localeCompare(b.name)) }
}

async function actionStaffList(admin, body, deps) {
  const departmentId = requireId(body.departmentId, 'The department')
  if (!(await deps.departments.get(departmentId))) throw new HttpError(404, 'not_found', 'The department was not found.')
  return { staff: await describeAssignments(await deps.departmentUsers.listByDepartment(departmentId), deps) }
}

async function actionStaffAssign(admin, body, deps) {
  if (!isText(body.userId) || !isText(body.departmentId)) throw invalid({}, 'The assignment contains invalid data.')
  const userId = clean(body.userId)
  if (!userId) throw invalid({ userId: 'Choose a staff member.' })
  const position = cleanPosition(body.position)
  const user = ID_PATTERN.test(userId) ? await deps.userRows.get(userId) : null
  if (!user) throw invalid({ userId: 'That user does not exist.' })
  if (user.role !== ROLES.DEPARTMENT) throw invalid({ userId: 'Only users with the department staff role can be assigned. Change their role first.' })
  if (user.accountStatus !== 'active') throw invalid({ userId: 'That account is disabled.' })
  const departmentId = clean(body.departmentId)
  const department = ID_PATTERN.test(departmentId) ? await deps.departments.get(departmentId) : null
  if (!department) throw invalid({ departmentId: 'That department does not exist.' })
  if (department.status !== 'active') throw invalid({ departmentId: 'That department is inactive.' })

  const duplicate = () => new HttpError(409, 'conflict', 'This person is already assigned to that department.', { userId: 'This person is already assigned to that department.' })
  if ((await deps.departmentUsers.listByUser(userId)).some((r) => r.departmentId === departmentId)) throw duplicate()
  let row
  try {
    row = await deps.departmentUsers.create({ userId, departmentId, position, createdAt: stamp(deps) })
  } catch (error) {
    if (error?.code === 409) throw duplicate() // the unique (userId, departmentId) index closes the race
    throw error
  }
  await audit(deps, admin, { action: 'staff.assign', targetType: 'staff', targetId: row.$id, summary: `Assigned ${user.name} to ${department.name} as ${position}.` })
  return { staff: (await describeAssignments([row], deps))[0] }
}

async function actionStaffUpdatePosition(admin, body, deps) {
  const id = requireId(body.assignmentId, 'The assignment')
  const existing = await deps.departmentUsers.get(id)
  if (!existing) throw new HttpError(404, 'not_found', 'The assignment was not found.')
  const position = cleanPosition(body.position)
  const row = await deps.departmentUsers.update(id, { position })
  await audit(deps, admin, { action: 'staff.updatePosition', targetType: 'staff', targetId: id, summary: `Changed a staff position to ${position}.` })
  return { staff: (await describeAssignments([row], deps))[0] }
}

async function actionStaffRemove(admin, body, deps) {
  const id = requireId(body.assignmentId, 'The assignment')
  const existing = await deps.departmentUsers.get(id)
  if (!existing) throw new HttpError(404, 'not_found', 'The assignment was not found.')
  const user = await deps.userRows.get(existing.userId)
  const department = await deps.departments.get(existing.departmentId)
  await deps.departmentUsers.remove(id)
  await audit(deps, admin, { action: 'staff.remove', targetType: 'staff', targetId: id, summary: `Removed ${user?.name ?? 'a staff member'} from ${department?.name ?? 'a department'}.` })
  return { removed: true }
}

/* ------------------------------------------------------------------ *
 * Audit trail
 * ------------------------------------------------------------------ */

async function actionAuditList(admin, body, deps) {
  const limit = Math.min(Math.max(Number.parseInt(body.limit, 10) || 15, 1), 100)
  const rows = await deps.audit.list(limit)
  return { entries: rows.map((r) => ({ id: r.$id, actorName: r.actorName ?? 'Administrator', action: r.action, targetType: r.targetType, summary: r.summary, createdAt: r.createdAt })) }
}

const ACTIONS = {
  'dashboard.stats': actionDashboardStats,
  'reports.summary': actionReportsSummary,
  'admin.complaints.list': actionComplaintList,
  'department.list': actionDepartmentList,
  'department.create': actionDepartmentCreate,
  'department.update': actionDepartmentUpdate,
  'category.list': actionCategoryList,
  'category.create': actionCategoryCreate,
  'category.update': actionCategoryUpdate,
  'staff.candidates': actionStaffCandidates,
  'staff.list': actionStaffList,
  'staff.assign': actionStaffAssign,
  'staff.updatePosition': actionStaffUpdatePosition,
  'staff.remove': actionStaffRemove,
  'audit.list': actionAuditList,
}

/**
 * @param {{ req: { headers?: object, bodyJson?: object, bodyText?: string, body?: any } }} context
 * @param {object} deps
 */
export async function handle({ req }, deps) {
  try {
    const admin = await authenticateAdmin(req, deps)
    const body = parseBody(req)
    if (!Object.hasOwn(ACTIONS, String(body.action))) throw new HttpError(400, 'unknown_action', 'Unknown action.')
    return { status: 200, body: { ok: true, ...(await ACTIONS[body.action](admin, body, deps)) } }
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, body: { ok: false, error: { code: error.code, message: error.message, fields: error.fields } } }
    deps.log?.(`unexpected error: ${error?.stack ?? error}`)
    return { status: 500, body: { ok: false, error: { code: 'server_error', message: 'Something went wrong. Please try again.' } } }
  }
}
