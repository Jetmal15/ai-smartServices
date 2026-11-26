import { COMPLAINT_RULES as RULES } from '../../database/schema.js'

/**
 * Early feedback for the complaint form. The complaint-api function repeats every check on the server
 * and is the one that counts: never rely on this file for security.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const hasContent = (text) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3
const cleanLine = (value) => String(value ?? '').replace(CONTROL_CHARS, ' ').trim().replace(/\s+/g, ' ')
const cleanBlock = (value) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const ATTACHMENT_EXTENSIONS = Object.keys(RULES.attachment.types)
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(',')
export const ATTACHMENT_MAX_MB = RULES.attachment.maxBytes / 1024 / 1024

/** Returns { values, errors }: cleaned values and per-field messages (empty `errors` = OK). */
export function validateComplaintForm({ title, description, location, categoryId }) {
  const errors = {}
  const values = {}

  const t = cleanLine(title)
  if (!t) errors.title = 'Enter a title for your complaint.'
  else if (t.length < RULES.title.min) errors.title = `The title must be at least ${RULES.title.min} characters.`
  else if (t.length > RULES.title.max) errors.title = `The title must be at most ${RULES.title.max} characters.`
  else if (!hasContent(t)) errors.title = 'The title must contain real words.'
  else values.title = t

  const d = cleanBlock(description)
  if (!d) errors.description = 'Describe your complaint.'
  else if (d.length < RULES.description.min) errors.description = `The description must be at least ${RULES.description.min} characters.`
  else if (d.length > RULES.description.max) errors.description = `The description must be at most ${RULES.description.max} characters.`
  else if (!hasContent(d)) errors.description = 'The description must contain real words.'
  else values.description = d

  const l = cleanLine(location)
  if (l.length > RULES.location.max) errors.location = `Location details must be at most ${RULES.location.max} characters.`
  else values.location = l

  if (!cleanLine(categoryId)) errors.categoryId = 'Choose a category.'
  else values.categoryId = cleanLine(categoryId)

  return { values, errors }
}

/** Returns an error message, or '' when the file may be uploaded. `file` needs { name, size }. */
export function validateAttachmentFile(file) {
  if (!file) return ''
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(file.name ?? '')?.[1]?.toLowerCase()
  if (!extension || !RULES.attachment.types[extension]) return `Only ${ATTACHMENT_EXTENSIONS.join(', ').toUpperCase()} files are allowed.`
  if (!(file.size > 0)) return 'That file is empty.'
  if (file.size > RULES.attachment.maxBytes) return `The file must be smaller than ${ATTACHMENT_MAX_MB} MB.`
  return ''
}
