/**
 * profile-api – trusted backend logic for user records and role management (Phase 6, moved to the
 * Phase 7 `users` table).
 *
 * This runs inside an Appwrite Function with a server API key. It is the ONLY code that
 * writes to the `users` table and the ONLY code that changes roles (Appwrite user labels).
 * One row per Appwrite account (row ID = account ID), so user records can never be duplicated.
 *
 * Row fields follow database/schema.js (userId, name, email, rollNumber, role, academicDepartment,
 * accountStatus, createdAt). The shape returned to the browser is unchanged from Phase 6
 * (`department`, `status`, `accountCreatedAt`) – see toProfile().
 * The browser can never do either directly:
 *   - the table grants clients no create/update/delete permission at all;
 *   - labels cannot be set from the client SDK.
 *
 * Trust model:
 *   - Caller identity comes from Appwrite (user-id header + a JWT that is verified with Appwrite).
 *   - The caller's role is re-read from their Appwrite labels on EVERY call. Nothing about
 *     role, status or identity is ever taken from the request body.
 *
 * `handle()` is pure logic over injected `deps`, so it can be tested without Appwrite
 * (see tests/phase6). `main.js` wires the real node-appwrite SDK.
 */

import { randomInt } from 'node:crypto'

export const ROLES = Object.freeze({ STUDENT: 'student', DEPARTMENT: 'department', ADMIN: 'admin' })

/** Labels this function manages. Any other label on an account is left untouched. */
export const MANAGED_LABELS = Object.freeze([ROLES.ADMIN, ROLES.DEPARTMENT])

/** Students' academic programs. KEEP IN SYNC with FET_DEPARTMENTS in src/lib/constants.js (a test checks this). */
export const DEPARTMENTS = Object.freeze([
  'Software Engineering',
  'Computer Systems Engineering',
  'Electronic Engineering',
  'Telecommunication Engineering',
  'Information Technology',
])

export const STATUSES = Object.freeze({ ACTIVE: 'active', DISABLED: 'disabled' })

/** Same rule as the frontend validator: 3–20 letters/digits/hyphen/slash. */
const ROLL_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-/]{2,19}$/
const NAME_MIN = 3
const NAME_MAX = 128
const LIST_DEFAULT_LIMIT = 25
const LIST_MAX_LIMIT = 100

/** Fields each role may edit on their OWN profile. Everything else is rejected. */
export const SELF_EDITABLE_FIELDS = Object.freeze({
  [ROLES.STUDENT]: ['name', 'department', 'rollNumber'],
  [ROLES.DEPARTMENT]: ['name'],
  [ROLES.ADMIN]: ['name'],
})

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

const isConflict = (error) => error?.code === 409

/* ------------------------------------------------------------------ *
 * Roles, permissions, validation helpers
 * ------------------------------------------------------------------ */

/** Admin outranks department; no managed label means student. */
export function roleFromLabels(labels = []) {
  if (labels.includes(ROLES.ADMIN)) return ROLES.ADMIN
  if (labels.includes(ROLES.DEPARTMENT)) return ROLES.DEPARTMENT
  return ROLES.STUDENT
}

/** Existing labels with the managed ones replaced to match `role`. */
export function labelsForRole(labels = [], role) {
  const others = labels.filter((label) => !MANAGED_LABELS.includes(label))
  return role === ROLES.STUDENT ? others : [...others, role]
}

/**
 * Row-level permissions for a profile row: the owner and administrators may READ it.
 * Nobody gets update/delete – writes happen only here, with the API key.
 * Format is identical to node-appwrite's Permission.read(Role.user(id)) / Role.label('admin').
 */
export function profilePermissions(userId) {
  return [`read("user:${userId}")`, `read("label:${ROLES.ADMIN}")`]
}

const cleanName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

function validateName(value) {
  const name = cleanName(value)
  if (name.length < NAME_MIN) return { error: 'Enter your full name.' }
  if (name.length > NAME_MAX) return { error: `Name must be at most ${NAME_MAX} characters.` }
  return { value: name }
}

function validateDepartment(value) {
  if (!DEPARTMENTS.includes(value)) return { error: 'Select a valid department.' }
  return { value }
}

function validateRollNumber(value) {
  const roll = String(value ?? '').trim().toUpperCase()
  if (!ROLL_NUMBER_PATTERN.test(roll)) return { error: 'Use 3–20 letters, digits, hyphens or slashes.' }
  return { value: roll }
}

/** Runs validators and throws a 400 with per-field messages. Returns the cleaned values. */
function validateFields(input, validators) {
  const values = {}
  const fields = {}
  for (const [key, validate] of Object.entries(validators)) {
    if (!(key in input)) continue
    const result = validate(input[key])
    if (result.error) fields[key] = result.error
    else values[key] = result.value
  }
  if (Object.keys(fields).length > 0) {
    throw new HttpError(400, 'validation_failed', 'Some of the details you entered are invalid.', fields)
  }
  return values
}

/*
 * Admin safety: an administrator can never change their own role or disable themselves, and only
 * administrators can reach these actions. So the caller is always a DIFFERENT, active admin and the
 * last administrator can never be removed through this function.
 */
const rollNumberTaken = () =>
  new HttpError(409, 'roll_number_taken', 'That roll number is already registered to another account.', {
    rollNumber: 'That roll number is already registered to another account.',
  })

/** Row -> safe client shape. Appwrite internals ($permissions, $databaseId…) are not exposed. */
export function toProfile(row, assignments) {
  const profile = {
    id: row.userId ?? row.$id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.accountStatus,
    rollNumber: row.rollNumber ?? '',
    // Students: their academic program. Department staff have none; their service departments
    // are in `assignments` (department_users table).
    department: row.academicDepartment ?? '',
    accountCreatedAt: row.createdAt ?? null,
  }
  if (row.role === ROLES.DEPARTMENT) profile.assignments = assignments ?? []
  return profile
}

/** Staff assignments for the response: [{ departmentId, departmentName, position }]. */
async function assignmentsFor(row, deps) {
  if (row.role !== ROLES.DEPARTMENT) return undefined
  try {
    return await deps.assignments.listForUser(row.$id ?? row.userId)
  } catch (error) {
    // A staff member must still be able to sign in if the department tables are not set up yet.
    deps.log?.(`could not load assignments for ${row.$id}: ${error?.message ?? error}`)
    return []
  }
}

/* ------------------------------------------------------------------ *
 * Profile <-> account synchronisation
 * ------------------------------------------------------------------ */

/** What the profile row must say, derived ONLY from the authoritative Appwrite account. */
function desiredFromAccount(account) {
  return {
    userId: account.$id,
    name: cleanName(account.name) || account.email,
    email: account.email,
    role: roleFromLabels(account.labels),
    accountStatus: account.status === false ? STATUSES.DISABLED : STATUSES.ACTIVE,
    createdAt: account.registration ?? account.$createdAt ?? null,
  }
}

/** Optional first-time values (roll number / department) – validated, never trusted. */
function cleanSeed(seed = {}) {
  const out = {}
  if (typeof seed.department === 'string' && DEPARTMENTS.includes(seed.department)) out.academicDepartment = seed.department
  const roll = String(seed.rollNumber ?? '').trim().toUpperCase()
  if (ROLL_NUMBER_PATTERN.test(roll)) out.rollNumber = roll
  return out
}

/**
 * Makes sure `account` has an up-to-date profile row and returns it.
 * Creates the row if missing (students may be seeded with roll number / department);
 * otherwise repairs drift (name/email changes, labels edited in the console, blocked status).
 * Returns { row, created, updated, rollNumberTaken }.
 */
async function ensureProfile(account, deps, seed) {
  const desired = desiredFromAccount(account)
  let row = await deps.rows.get(account.$id)

  if (!row) {
    const data = { ...desired }
    const seeded = desired.role === ROLES.STUDENT ? cleanSeed(seed) : {}
    if (seeded.academicDepartment) data.academicDepartment = seeded.academicDepartment
    if (seeded.rollNumber) data.rollNumber = seeded.rollNumber

    try {
      row = await deps.rows.create(account.$id, data, profilePermissions(account.$id))
      return { row, created: true, updated: false, rollNumberTaken: false }
    } catch (error) {
      if (!isConflict(error)) throw error
      // 409 = either a concurrent request created this row, or the roll number is taken.
      row = await deps.rows.get(account.$id)
      if (!row) {
        if (!data.rollNumber) throw error
        delete data.rollNumber
        row = await deps.rows.create(account.$id, data, profilePermissions(account.$id))
        return { row, created: true, updated: false, rollNumberTaken: true }
      }
    }
  }

  const patch = {}
  for (const [key, value] of Object.entries(desired)) {
    if ((row[key] ?? null) !== (value ?? null)) patch[key] = value
  }
  // A roll number and an academic program only belong to students.
  if (desired.role !== ROLES.STUDENT) {
    if (row.rollNumber) patch.rollNumber = null
    if (row.academicDepartment) patch.academicDepartment = null
  }

  if (Object.keys(patch).length === 0) return { row, created: false, updated: false, rollNumberTaken: false }
  row = await deps.rows.update(account.$id, patch)
  return { row, created: false, updated: true, rollNumberTaken: false }
}

/* ------------------------------------------------------------------ *
 * Request parsing + authentication
 * ------------------------------------------------------------------ */

function parseBody(req) {
  if (req.bodyJson && typeof req.bodyJson === 'object') return req.bodyJson
  const raw = req.bodyText ?? (typeof req.body === 'string' ? req.body : '')
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'invalid_request', 'Request body must be a JSON object.')
}

/**
 * Identifies the caller. Fails closed:
 *   - needs Appwrite's user-id header AND a JWT;
 *   - the JWT is verified with Appwrite and must belong to the same user;
 *   - role and blocked status are read from the account (labels), not from the request.
 */
async function authenticate(req, deps) {
  const headers = req.headers ?? {}
  const userId = headers['x-appwrite-user-id']
  const jwt = headers['x-appwrite-user-jwt']
  if (!userId || !jwt) throw new HttpError(401, 'unauthenticated', 'You must be signed in.')

  let verifiedId
  try {
    verifiedId = await deps.verifyJwt(jwt)
  } catch {
    throw new HttpError(401, 'unauthenticated', 'Your session is not valid. Please sign in again.')
  }
  if (verifiedId !== userId) throw new HttpError(401, 'unauthenticated', 'Your session is not valid. Please sign in again.')

  const account = await deps.users.get(userId)
  if (!account) throw new HttpError(401, 'unauthenticated', 'Your session is not valid. Please sign in again.')
  if (account.status === false) throw new HttpError(403, 'account_disabled', 'This account has been disabled. Contact the administrator.')

  return { id: userId, account, role: roleFromLabels(account.labels) }
}

/* ------------------------------------------------------------------ *
 * Administrator safeguards (Phase 13)
 * ------------------------------------------------------------------ */

/**
 * `allowlist` = the entries of the ADMIN_ALLOWLIST function variable: exact e-mail addresses or "@domain" entries. Empty = no
 * restriction. When set, only listed people can ever be made administrators ("authorized administrator accounts").
 */
export function isAuthorizedAdminEmail(email, allowlist = []) {
  if (allowlist.length === 0) return true
  const address = String(email ?? '').trim().toLowerCase()
  return allowlist.some((entry) => {
    const item = String(entry).trim().toLowerCase()
    return item.startsWith('@') ? address.endsWith(item) : address === item
  })
}

function requireAuthorizedAdmin(email, deps) {
  if (!isAuthorizedAdminEmail(email, deps.adminAllowlist ?? [])) {
    throw new HttpError(403, 'admin_not_authorized', 'This e-mail address is not on the list of authorized administrators.')
  }
}

/** The system must always keep at least one active administrator. */
async function requireAnotherActiveAdmin(targetId, deps) {
  const everyone = await deps.users.listAll()
  const others = everyone.filter((account) => account.$id !== targetId && account.status !== false && roleFromLabels(account.labels) === ROLES.ADMIN)
  if (others.length === 0) {
    throw new HttpError(409, 'last_admin', 'This is the only active administrator. Make another administrator first.')
  }
}

/** True when at least one active administrator exists. */
async function hasActiveAdmin(deps) {
  return (await deps.users.listAll()).some((account) => account.status !== false && roleFromLabels(account.labels) === ROLES.ADMIN)
}

/** Audit trail of sensitive administrator operations. Best effort: it never blocks the operation. */
async function recordAudit(deps, caller, { action, targetType, targetId, summary }) {
  try {
    await deps.audit?.record({ actorId: caller.id, actorName: String(caller.account.name ?? '').slice(0, 128) || null, action, targetType, targetId: targetId ?? null, summary: String(summary).slice(0, 500), createdAt: (deps.now ? deps.now() : new Date()).toISOString() })
  } catch (error) {
    deps.log?.(`could not record the audit entry for ${action}: ${error?.message ?? error}`)
  }
}

function requireAdmin(caller) {
  if (caller.role !== ROLES.ADMIN) {
    throw new HttpError(403, 'forbidden', 'You do not have permission to do that.')
  }
}

/* ------------------------------------------------------------------ *
 * Actions: any signed-in user (own profile only)
 * ------------------------------------------------------------------ */

/** Returns (creating/repairing if needed) the caller's own profile. */
async function actionMe(caller, body, deps) {
  // First-time values: the sign-up form's, else (accounts from Phase 5) the old account prefs.
  const prefs = caller.account.prefs ?? {}
  const seed = { rollNumber: body.rollNumber ?? prefs.rollNumber, department: body.department ?? prefs.department }
  const { row, rollNumberTaken: taken } = await ensureProfile(caller.account, deps, seed)
  return { profile: toProfile(row, await assignmentsFor(row, deps)), rollNumberTaken: taken }
}

/** Updates the caller's own permitted fields. Role/status/email/id are never editable here. */
async function actionUpdateMe(caller, body, deps) {
  const input = { ...body }
  delete input.action

  if ('role' in input || 'labels' in input) {
    throw new HttpError(403, 'role_change_forbidden', 'You cannot change your own role.')
  }
  const allowed = SELF_EDITABLE_FIELDS[caller.role]
  const forbidden = Object.keys(input).filter((key) => !allowed.includes(key))
  if (forbidden.length > 0) {
    throw new HttpError(403, 'field_not_editable', `You cannot change: ${forbidden.join(', ')}.`)
  }
  if (Object.keys(input).length === 0) throw new HttpError(400, 'nothing_to_update', 'Nothing to update.')

  const values = validateFields(input, {
    name: validateName,
    department: validateDepartment,
    rollNumber: validateRollNumber,
  })

  const { row } = await ensureProfile(caller.account, deps)
  const patch = {}

  if ('name' in values && values.name !== row.name) {
    // Update the authoritative account first; the row follows (and self-heals on the next call).
    await deps.users.updateName(caller.id, values.name)
    patch.name = values.name
  }
  if ('department' in values && values.department !== (row.academicDepartment ?? '')) patch.academicDepartment = values.department
  if ('rollNumber' in values && values.rollNumber !== (row.rollNumber ?? '')) {
    if (row.rollNumber) throw new HttpError(403, 'roll_number_locked', 'Your roll number is already set. Ask an administrator to change it.')
    patch.rollNumber = values.rollNumber
  }

  if (Object.keys(patch).length === 0) return { profile: toProfile(row, await assignmentsFor(row, deps)) }
  try {
    const updated = await deps.rows.update(caller.id, patch)
    return { profile: toProfile(updated, await assignmentsFor(updated, deps)) }
  } catch (error) {
    if (isConflict(error) && patch.rollNumber) throw rollNumberTaken()
    throw error
  }
}

/* ------------------------------------------------------------------ *
 * Actions: administrators only
 * ------------------------------------------------------------------ */

async function getTargetAccount(userId, deps) {
  if (typeof userId !== 'string' || !userId) throw new HttpError(400, 'invalid_request', 'userId is required.')
  const account = await deps.users.get(userId)
  if (!account) throw new HttpError(404, 'user_not_found', 'User not found.')
  return account
}

async function actionAdminList(caller, body, deps) {
  requireAdmin(caller)
  const limit = Math.min(Math.max(Number.parseInt(body.limit, 10) || LIST_DEFAULT_LIMIT, 1), LIST_MAX_LIMIT)
  const offset = Math.max(Number.parseInt(body.offset, 10) || 0, 0)
  const search = String(body.search ?? '').trim().toLowerCase()

  const everyone = (await deps.rows.listAll()).map(toProfile)
  const counts = { total: everyone.length, student: 0, department: 0, admin: 0 }
  for (const profile of everyone) counts[profile.role] = (counts[profile.role] ?? 0) + 1

  const matches = everyone
    .filter((profile) => !body.role || profile.role === body.role)
    .filter((profile) => !body.status || profile.status === body.status)
    .filter(
      (profile) =>
        !search ||
        [profile.name, profile.email, profile.rollNumber, profile.department].some((value) => (value ?? '').toLowerCase().includes(search)),
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  return { profiles: matches.slice(offset, offset + limit), total: matches.length, counts }
}

async function actionAdminGet(caller, body, deps) {
  requireAdmin(caller)
  const account = await getTargetAccount(body.userId, deps)
  const { row } = await ensureProfile(account, deps, { rollNumber: account.prefs?.rollNumber, department: account.prefs?.department })
  return { profile: toProfile(row, await assignmentsFor(row, deps)) }
}

async function actionAdminSetRole(caller, body, deps) {
  requireAdmin(caller)
  if (body.userId === caller.id) {
    throw new HttpError(403, 'cannot_change_own_role', 'You cannot change your own role. Ask another administrator.')
  }
  if (!Object.values(ROLES).includes(body.role)) throw new HttpError(400, 'validation_failed', 'Choose a valid role.', { role: 'Choose a valid role.' })

  const target = await getTargetAccount(body.userId, deps)
  const currentRole = roleFromLabels(target.labels)

  if (body.role === ROLES.ADMIN && currentRole !== ROLES.ADMIN) requireAuthorizedAdmin(target.email, deps)
  if (currentRole === ROLES.ADMIN && body.role !== ROLES.ADMIN && target.status !== false) await requireAnotherActiveAdmin(target.$id, deps)

  // The label is the source of truth for the role: change it first, then bring the row in line.
  // Which service department(s) a staff member belongs to is a separate step (department_users),
  // done by an administrator after the role change.
  let account = target
  if (currentRole !== body.role) {
    account = await deps.users.updateLabels(target.$id, labelsForRole(target.labels, body.role))
    if (currentRole === ROLES.ADMIN && body.role !== ROLES.ADMIN && !(await hasActiveAdmin(deps))) {
      // Two administrators changing each other at the same moment must not leave the system without one: undo this change.
      await deps.users.updateLabels(target.$id, target.labels)
      throw new HttpError(409, 'last_admin', 'This is the only active administrator. Make another administrator first.')
    }
    // Someone who is no longer department staff must not keep department assignments.
    if (currentRole === ROLES.DEPARTMENT) await deps.assignments.removeForUser(target.$id)
    await recordAudit(deps, caller, { action: 'user.setRole', targetType: 'user', targetId: target.$id, summary: `Changed the role of ${target.name || target.email} from ${currentRole} to ${body.role}.` })
  }
  const { row } = await ensureProfile(account, deps)
  return { profile: toProfile(row, await assignmentsFor(row, deps)) }
}

async function actionAdminUpdateAccount(caller, body, deps) {
  requireAdmin(caller)
  const values = validateFields(body, {
    department: validateDepartment,
    rollNumber: validateRollNumber,
    status: (value) =>
      Object.values(STATUSES).includes(value) ? { value } : { error: 'Choose active or disabled.' },
  })
  if (Object.keys(values).length === 0) throw new HttpError(400, 'nothing_to_update', 'Nothing to update.')

  const target = await getTargetAccount(body.userId, deps)
  const targetRole = roleFromLabels(target.labels)

  if (values.status === STATUSES.DISABLED) {
    if (target.$id === caller.id) throw new HttpError(403, 'cannot_disable_self', 'You cannot disable your own account.')
    if (targetRole === ROLES.ADMIN && target.status !== false) await requireAnotherActiveAdmin(target.$id, deps)
  }
  if ('rollNumber' in values && targetRole !== ROLES.STUDENT) {
    throw new HttpError(400, 'validation_failed', 'Only students have a roll number.', { rollNumber: 'Only students have a roll number.' })
  }
  if ('department' in values && targetRole !== ROLES.STUDENT) {
    throw new HttpError(400, 'validation_failed', 'Only students have an academic department. Staff are assigned to service departments separately.', {
      department: 'Only students have an academic department.',
    })
  }

  let account = target
  if (values.status) {
    account = await deps.users.updateStatus(target.$id, values.status === STATUSES.ACTIVE)
    if (values.status === STATUSES.DISABLED && targetRole === ROLES.ADMIN && !(await hasActiveAdmin(deps))) {
      await deps.users.updateStatus(target.$id, target.status !== false)
      throw new HttpError(409, 'last_admin', 'This is the only active administrator. Make another administrator first.')
    }
    if (target.status !== account.status) {
      await recordAudit(deps, caller, { action: 'user.setStatus', targetType: 'user', targetId: target.$id, summary: `${values.status === STATUSES.ACTIVE ? 'Activated' : 'Deactivated'} the account of ${target.name || target.email}.` })
    }
  }

  const { row } = await ensureProfile(account, deps)
  const patch = {}
  if (values.department && values.department !== row.academicDepartment) patch.academicDepartment = values.department
  if (values.rollNumber && values.rollNumber !== row.rollNumber) patch.rollNumber = values.rollNumber
  if (Object.keys(patch).length === 0) return { profile: toProfile(row, await assignmentsFor(row, deps)) }

  try {
    const updated = await deps.rows.update(target.$id, patch)
    return { profile: toProfile(updated, await assignmentsFor(updated, deps)) }
  } catch (error) {
    if (isConflict(error) && patch.rollNumber) throw rollNumberTaken()
    throw error
  }
}

/**
 * Creates/repairs a users row for EVERY account. Run it once after deploying this phase
 * (accounts created in Phase 5 have no row yet) and after editing labels in the console.
 */
async function actionAdminSync(caller, _body, deps) {
  requireAdmin(caller)
  const accounts = await deps.users.listAll()
  const result = { total: accounts.length, created: 0, updated: 0, failed: 0 }
  for (const account of accounts) {
    try {
      const outcome = await ensureProfile(account, deps, { rollNumber: account.prefs?.rollNumber, department: account.prefs?.department })
      if (outcome.created) result.created += 1
      else if (outcome.updated) result.updated += 1
    } catch (error) {
      result.failed += 1
      deps.log?.(`sync failed for ${account.$id}: ${error?.message ?? error}`)
    }
  }
  return result
}

/** A random temporary password: 14 characters with upper and lower case letters, digits and a symbol. Shown once, never stored or logged. */
export function generateTemporaryPassword() {
  const pick = (chars) => chars[randomInt(chars.length)]
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '#$%&*?']
  const all = sets.join('')
  const chars = [...sets.map(pick), ...Array.from({ length: 10 }, () => pick(all))]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Provisions an account for department staff or an administrator (students register themselves). The account gets a random
 * temporary password that is returned ONCE; the person should use "Forgot password" or change it after signing in.
 */
async function actionAdminCreateUser(caller, body, deps) {
  requireAdmin(caller)
  const fields = {}
  const name = validateName(body.name)
  if (name.error) fields.name = name.error
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) fields.email = 'Enter a valid e-mail address.'
  if (![ROLES.DEPARTMENT, ROLES.ADMIN].includes(body.role)) fields.role = 'Choose department staff or administrator.'
  if (Object.keys(fields).length > 0) throw new HttpError(400, 'validation_failed', 'Please correct the highlighted fields.', fields)
  if (body.role === ROLES.ADMIN) requireAuthorizedAdmin(email, deps)

  const temporaryPassword = generateTemporaryPassword()
  let account
  try {
    account = await deps.users.create({ name: name.value, email, password: temporaryPassword })
  } catch (error) {
    if (isConflict(error)) throw new HttpError(409, 'email_taken', 'An account with this e-mail address already exists.', { email: 'An account with this e-mail address already exists.' })
    throw error
  }
  account = await deps.users.updateLabels(account.$id, labelsForRole(account.labels ?? [], body.role))
  const { row } = await ensureProfile(account, deps)
  await recordAudit(deps, caller, { action: 'user.create', targetType: 'user', targetId: account.$id, summary: `Created a ${body.role === ROLES.ADMIN ? 'administrator' : 'department staff'} account for ${name.value} (${email}).` })
  return { profile: toProfile(row, await assignmentsFor(row, deps)), temporaryPassword }
}

const ACTIONS = {
  'admin.createUser': actionAdminCreateUser,
  me: actionMe,
  updateMe: actionUpdateMe,
  'admin.list': actionAdminList,
  'admin.get': actionAdminGet,
  'admin.setRole': actionAdminSetRole,
  'admin.updateAccount': actionAdminUpdateAccount,
  'admin.syncProfiles': actionAdminSync,
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * @param {{ req: { headers?: object, bodyJson?: object, bodyText?: string, body?: any } }} context
 * @param {object} deps injected backend (see main.js and tests/support/fake-backend.mjs)
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handle({ req }, deps) {
  try {
    const caller = await authenticate(req, deps)
    const body = parseBody(req)
    if (!Object.hasOwn(ACTIONS, String(body.action))) throw new HttpError(400, 'unknown_action', 'Unknown action.')
    return { status: 200, body: { ok: true, ...(await ACTIONS[body.action](caller, body, deps)) } }
  } catch (error) {
    if (error instanceof HttpError) {
      return { status: error.status, body: { ok: false, error: { code: error.code, message: error.message, fields: error.fields } } }
    }
    deps.log?.(`unexpected error: ${error?.stack ?? error}`)
    return { status: 500, body: { ok: false, error: { code: 'server_error', message: 'Something went wrong. Please try again.' } } }
  }
}
