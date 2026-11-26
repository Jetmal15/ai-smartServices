import { AppwriteException } from 'appwrite'
import { account, ID, assertAppwriteConfigured, isAppwriteConfigured } from '../lib/appwrite/index.js'
import { FET_DEPARTMENTS, ROLES, ROLE_LABELS } from '../lib/constants.js'
import { PATHS } from '../routes/paths.js'
import { getPasswordError, isValidEmail, isValidRollNumber } from '../utils/validators.js'
import { fetchMyProfile } from './profileService.js'

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** Error with a message that is safe to show to the user. */
export class AuthError extends Error {
  constructor(message, { code = 0, type = '' } = {}) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.type = type
  }
}

const MESSAGES_BY_TYPE = {
  user_invalid_credentials: 'Incorrect email or password.',
  user_already_exists: 'An account with this email already exists. Try logging in instead.',
  user_blocked: 'This account has been disabled. Contact the administrator.',
  user_invalid_token: 'This link is invalid or has expired. Request a new one.',
  user_not_found: 'Incorrect email or password.',
  general_rate_limit_exceeded: 'Too many attempts. Please wait a few minutes and try again.',
  password_personal_data: 'Password must not contain your name or email address.',
  password_dictionary: 'That password is too common. Choose a stronger one.',
  password_recently_used: 'You used this password recently. Choose a different one.',
  general_argument_invalid: 'Some of the details you entered are invalid.',
}

/** Converts anything thrown by Appwrite (or our own checks) into an AuthError. */
export function toAuthError(error, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof AuthError) return error
  if (error instanceof AppwriteException) {
    if (error.code === 0 || error.type === '') {
      return new AuthError('Cannot reach the server. Check your internet connection and try again.', { code: 0 })
    }
    const message = MESSAGES_BY_TYPE[error.type] ?? (error.code >= 500 ? fallback : error.message || fallback)
    return new AuthError(message, { code: error.code, type: error.type })
  }
  if (error instanceof TypeError) {
    // fetch() network failure
    return new AuthError('Cannot reach the server. Check your internet connection and try again.')
  }
  return new AuthError(error?.message || fallback)
}

/** True when an error means "no valid session" (guest or expired). */
export const isUnauthorizedError = (error) => error instanceof AppwriteException && error.code === 401

/* ------------------------------------------------------------------ *
 * User mapping
 * ------------------------------------------------------------------ */

export const getInitials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?'

/**
 * Role comes ONLY from Appwrite labels (not editable by the user).
 * Admin outranks department; everything else is a student.
 */
export function getRoleFromLabels(labels = []) {
  if (labels.includes(ROLE_LABELS[ROLES.ADMIN])) return ROLES.ADMIN
  if (labels.includes(ROLE_LABELS[ROLES.DEPARTMENT])) return ROLES.DEPARTMENT
  return ROLES.STUDENT
}

/**
 * Appwrite user -> app user. Identity + role only; roll number, department and account status
 * live in the user's profile record (see profileService / AuthProvider).
 */
export function mapUser(appwriteUser) {
  return {
    id: appwriteUser.$id,
    name: appwriteUser.name || appwriteUser.email,
    email: appwriteUser.email,
    initials: getInitials(appwriteUser.name || appwriteUser.email),
    role: getRoleFromLabels(appwriteUser.labels),
    emailVerified: Boolean(appwriteUser.emailVerification),
  }
}

/* ------------------------------------------------------------------ *
 * Session / user
 * ------------------------------------------------------------------ */

/**
 * Returns the signed-in user, or null when there is no valid session
 * (never signed in, logged out, or expired). Other failures (network, server)
 * are thrown so callers don't mistake an outage for a logout.
 */
export async function getCurrentUser() {
  if (!isAppwriteConfigured) return null
  try {
    return mapUser(await account.get())
  } catch (error) {
    if (isUnauthorizedError(error)) return null
    throw toAuthError(error)
  }
}

/** True when a valid session exists. */
export async function hasActiveSession() {
  return (await getCurrentUser()) !== null
}

/* ------------------------------------------------------------------ *
 * Register / login / logout
 * ------------------------------------------------------------------ */

/**
 * Public student registration. The ONLY public sign-up path:
 * - no role/label is ever sent, so the account is always a student
 *   (admin/department roles are assigned by an administrator through profile-api);
 * - the signed-in session is created immediately so the user lands in the app.
 */
export async function registerStudent({ fullName, rollNumber, email, password, department }) {
  assertAppwriteConfigured()
  const cleanEmail = String(email ?? '').trim().toLowerCase()
  const cleanName = String(fullName ?? '').trim()
  const cleanRoll = String(rollNumber ?? '').trim().toUpperCase()

  if (cleanName.length < 3 || cleanName.length > 128) throw new AuthError('Enter your full name.')
  if (!isValidRollNumber(cleanRoll)) throw new AuthError('Enter a valid roll number.')
  if (!isValidEmail(cleanEmail)) throw new AuthError('Enter a valid email address.')
  if (!FET_DEPARTMENTS.includes(department)) throw new AuthError('Select your department.')
  const passwordError = getPasswordError(password)
  if (passwordError) throw new AuthError(passwordError)

  try {
    await account.create({ userId: ID.unique(), email: cleanEmail, password, name: cleanName })
    await account.createEmailPasswordSession({ email: cleanEmail, password })
  } catch (error) {
    throw toAuthError(error, 'Could not create your account. Please try again.')
  }

  // The profile record is created by the trusted profile-api function, which needs a session.
  // A failure here must not undo a successful registration: the profile is created on the next
  // load, and the student can add a missing roll number / department from their profile page.
  let profile = null
  let profileSaved = true
  try {
    const result = await fetchMyProfile({ rollNumber: cleanRoll, department })
    profile = result.profile
    profileSaved = !result.rollNumberTaken
  } catch (error) {
    profileSaved = false
    console.warn('[auth] Account created but the profile was not saved:', error)
  }

  const user = await getCurrentUser()
  return { user, profile, profileSaved }
}

/** Email/password login. Returns the signed-in user. */
export async function login({ email, password }) {
  assertAppwriteConfigured()
  const cleanEmail = String(email ?? '').trim().toLowerCase()
  if (!isValidEmail(cleanEmail)) throw new AuthError('Enter a valid email address.')
  if (!password) throw new AuthError('Password is required.')

  try {
    await account.createEmailPasswordSession({ email: cleanEmail, password })
  } catch (error) {
    // A session already exists in this browser: reuse it rather than failing.
    if (!(error instanceof AppwriteException && error.type === 'user_session_already_exists')) {
      throw toAuthError(error, 'Could not log you in. Please try again.')
    }
  }
  const user = await getCurrentUser()
  if (!user) throw new AuthError('Could not start a session. Check that cookies/local storage are enabled.')
  return user
}

/** Ends the current session. Resolves even if the session was already gone. */
export async function logout() {
  if (!isAppwriteConfigured) return
  try {
    await account.deleteSession({ sessionId: 'current' })
  } catch (error) {
    if (!isUnauthorizedError(error)) throw toAuthError(error, 'Could not log you out cleanly.')
  }
}

/* ------------------------------------------------------------------ *
 * Password recovery
 * ------------------------------------------------------------------ */

/**
 * Sends a recovery email. The link points to /reset-password on THIS origin, which
 * must be registered as a Web platform in the Appwrite project.
 * Appwrite does not reveal whether the email exists, and neither do we.
 */
export async function requestPasswordReset(email) {
  assertAppwriteConfigured()
  const cleanEmail = String(email ?? '').trim().toLowerCase()
  if (!isValidEmail(cleanEmail)) throw new AuthError('Enter a valid email address.')
  try {
    await account.createRecovery({ email: cleanEmail, url: `${window.location.origin}${PATHS.resetPassword}` })
  } catch (error) {
    throw toAuthError(error, 'Could not send the recovery email. Please try again.')
  }
}

/** Completes recovery using the userId + secret from the email link. */
export async function completePasswordReset({ userId, secret, password }) {
  assertAppwriteConfigured()
  if (!userId || !secret) throw new AuthError('This reset link is invalid. Request a new one.')
  const passwordError = getPasswordError(password)
  if (passwordError) throw new AuthError(passwordError)
  try {
    await account.updateRecovery({ userId, secret, password })
  } catch (error) {
    throw toAuthError(error, 'Could not reset your password. Please try again.')
  }
}
