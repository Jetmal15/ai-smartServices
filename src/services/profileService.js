import { AppwriteException } from 'appwrite'
import { assertAppwriteConfigured, functions, PROFILE_FUNCTION_ID } from '../lib/appwrite/index.js'

/**
 * Client for the `profile-api` Appwrite Function. All writes to the `users` table (profile creation,
 * profile edits, role management) go through it: the table gives browsers no write access, and the function checks
 * the caller's role on the server for every request.
 */

/** Error with a message that is safe to show. `fields` carries per-field messages for forms. */
export class ProfileError extends Error {
  constructor(message, { code = 'error', status = 0, fields } = {}) {
    super(message)
    this.name = 'ProfileError'
    this.code = code
    this.status = status
    this.fields = fields
  }
}

const UNREACHABLE = 'Cannot reach the server. Check your internet connection and try again.'

/** Converts anything thrown here into a ProfileError. A 401 from Appwrite itself is passed through. */
export function toProfileError(error, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof ProfileError) return error
  if (error instanceof AppwriteException) {
    if (error.code === 0 || error.type === '') return new ProfileError(UNREACHABLE)
    if (error.type === 'function_not_found') {
      return new ProfileError('The profile service is not set up yet. Ask the administrator to deploy it.', { code: 'service_missing', status: 404 })
    }
    return new ProfileError(error.code >= 500 ? fallback : error.message || fallback, { status: error.code })
  }
  if (error instanceof TypeError) return new ProfileError(UNREACHABLE)
  return new ProfileError(error?.message || fallback)
}

/** True when the failure means "your session ended" (Appwrite 401, or the function's own 401). */
export const isSessionError = (error) =>
  (error instanceof AppwriteException && error.code === 401) || (error instanceof ProfileError && error.status === 401)

async function call(action, payload = {}) {
  assertAppwriteConfigured()
  let execution
  try {
    execution = await functions.createExecution({
      functionId: PROFILE_FUNCTION_ID,
      body: JSON.stringify({ ...payload, action }),
      async: false,
    })
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 401) throw error
    throw toProfileError(error)
  }

  let data = null
  try {
    data = JSON.parse(execution.responseBody)
  } catch {
    /* handled below */
  }
  if (!data || typeof data !== 'object') {
    throw new ProfileError('The profile service did not respond correctly. Please try again.', { code: 'bad_response', status: execution.responseStatusCode })
  }
  if (!data.ok) {
    const { code, message, fields } = data.error ?? {}
    throw new ProfileError(message || 'Something went wrong. Please try again.', { code, status: execution.responseStatusCode, fields })
  }
  return data
}

/* ---- Any signed-in user: their OWN profile ---------------------------------------------- */

/**
 * Loads the signed-in user's profile, creating it on first use. `seed` (roll number, department)
 * is only used when the profile is first created, and only for students.
 * Returns { profile, rollNumberTaken }.
 */
export async function fetchMyProfile(seed = {}) {
  const { profile, rollNumberTaken = false } = await call('me', seed)
  return { profile, rollNumberTaken }
}

/** Updates the permitted fields of the signed-in user's own profile. Returns the new profile. */
export async function updateMyProfile(values) {
  const { profile } = await call('updateMe', values)
  return profile
}

/* ---- Administrators only (the server re-checks; others get a 403) ------------------------ */

/** params: { search, role, status, limit, offset } -> { profiles, total, counts } */
export async function adminListProfiles(params = {}) {
  const { profiles, total, counts } = await call('admin.list', params)
  return { profiles, total, counts }
}

export async function adminGetProfile(userId) {
  return (await call('admin.get', { userId })).profile
}

/**
 * Changes another user's role. Making someone department staff does not choose their department:
 * assign them to service departments afterwards (services/db → departmentUsers.assign).
 */
export async function adminSetRole({ userId, role }) {
  return (await call('admin.setRole', { userId, role })).profile
}

/** Updates a STUDENT's academic department / roll number and/or any account's status ('active' | 'disabled'). */
export async function adminUpdateAccount({ userId, ...changes }) {
  return (await call('admin.updateAccount', { userId, ...changes })).profile
}

/** Creates/repairs profile rows for every account. Returns { total, created, updated, failed }. */
/**
 * Administrators only: creates an account for department staff or an administrator (students register themselves).
 * Returns { profile, temporaryPassword }: the password is shown ONCE and is not stored anywhere.
 */
export async function adminCreateUser({ name, email, role }) {
  const { profile, temporaryPassword } = await call('admin.createUser', { name, email, role })
  return { profile, temporaryPassword }
}

export async function adminSyncProfiles() {
  const { total, created, updated, failed } = await call('admin.syncProfiles')
  return { total, created, updated, failed }
}
