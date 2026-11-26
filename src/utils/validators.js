export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())

/** Letters, digits, hyphen or slash; 3–20 chars (e.g. 22SW001, 22-SW-001). */
export const isValidRollNumber = (value) => /^[A-Za-z0-9][A-Za-z0-9\-/]{2,19}$/.test(String(value ?? '').trim())

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 256

/** Returns an error message, or '' when the password is acceptable. */
export function getPasswordError(password) {
  if (!password) return 'Password is required.'
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`
  return ''
}

/**
 * Field-level validation for the student registration form.
 * Returns an object of { field: message }; empty when valid.
 */
export function validateRegistration(values, departments) {
  const errors = {}
  const name = values.fullName.trim()
  if (!name) errors.fullName = 'Full name is required.'
  else if (name.length < 3) errors.fullName = 'Enter your full name.'
  else if (name.length > 128) errors.fullName = 'Name must be at most 128 characters.'

  if (!values.rollNumber.trim()) errors.rollNumber = 'Roll number is required.'
  else if (!isValidRollNumber(values.rollNumber)) errors.rollNumber = 'Use 3–20 letters, digits, hyphens or slashes.'

  if (!isValidEmail(values.email)) errors.email = 'Enter a valid email address.'
  if (!departments.includes(values.department)) errors.department = 'Select your department.'

  const passwordError = getPasswordError(values.password)
  if (passwordError) errors.password = passwordError
  if (!values.confirmPassword) errors.confirmPassword = 'Confirm your password.'
  else if (values.confirmPassword !== values.password) errors.confirmPassword = 'Passwords do not match.'
  return errors
}

/**
 * Field-level validation for the profile edit form. `fields` lists what this user may edit
 * (see lib/permissions.js). The server validates again and is the final authority.
 */
export function validateProfileUpdate(values, fields, departments) {
  const errors = {}
  if (fields.includes('name')) {
    const name = values.name.trim()
    if (!name) errors.name = 'Full name is required.'
    else if (name.length < 3) errors.name = 'Enter your full name.'
    else if (name.length > 128) errors.name = 'Name must be at most 128 characters.'
  }
  if (fields.includes('department') && !departments.includes(values.department)) errors.department = 'Select your department.'
  if (fields.includes('rollNumber') && values.rollNumber.trim() && !isValidRollNumber(values.rollNumber)) {
    errors.rollNumber = 'Use 3–20 letters, digits, hyphens or slashes.'
  }
  return errors
}
