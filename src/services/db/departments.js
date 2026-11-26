import { ENUMS, TABLE_IDS } from '../../../database/schema.js'
import { clean, conflict, fromRow, nameKey, notFound, paging, validationError } from './core.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Validates department input. With `partial`, only the keys present are checked. Returns cleaned values. */
export function validateDepartment(input, { partial = false } = {}) {
  const values = {}
  const fields = {}
  const has = (key) => !partial || key in input

  if (has('name')) {
    const name = clean(input.name)
    if (name.length < 2) fields.name = 'Enter the department name.'
    else if (name.length > 128) fields.name = 'Name must be at most 128 characters.'
    else values.name = name
  }
  if (has('description') && input.description !== undefined) {
    const description = clean(input.description)
    if (description.length > 1000) fields.description = 'Description must be at most 1000 characters.'
    else values.description = description
  }
  if (has('email') && input.email !== undefined) {
    const email = clean(input.email).toLowerCase()
    if (email && (email.length > 254 || !EMAIL_PATTERN.test(email))) fields.email = 'Enter a valid email address.'
    else values.email = email || null
  }
  if (has('status')) {
    const status = input.status ?? (partial ? undefined : 'active')
    if (!ENUMS.recordStatus.includes(status)) fields.status = 'Choose active or inactive.'
    else values.status = status
  }
  if (Object.keys(fields).length > 0) throw validationError(fields)
  return values
}

/**
 * Departments. They are never deleted (complaints and categories refer to them): deactivate instead.
 * Writing needs the `label:admin` table permission; every signed-in user may read.
 */
export function createDepartmentsService(db, { now }) {
  const { Query } = db
  const T = TABLE_IDS.departments

  /** Throws a conflict if another department already uses this name (case-insensitive). */
  async function assertNameFree(name, exceptId) {
    const taken = (await db.listAll(T)).some((row) => row.$id !== exceptId && nameKey(row.name) === nameKey(name))
    if (taken) throw conflict('A department with this name already exists.', { name: 'A department with this name already exists.' })
  }

  const service = {
    async get(departmentId) {
      const row = await db.find(T, departmentId)
      return fromRow(row)
    },

    /** Same as get() but throws not_found. */
    async require(departmentId) {
      const row = await service.get(departmentId)
      if (!row) throw notFound('Department')
      return row
    },

    /** Departments ordered by name. Filter: status. */
    async list({ status, limit, offset } = {}) {
      const page = paging({ limit, offset }, 100)
      const queries = [Query.orderAsc('name'), Query.limit(page.limit), Query.offset(page.offset)]
      if (status) queries.push(Query.equal('status', [status]))
      const { rows, total } = await db.list(T, queries)
      return { departments: rows.map(fromRow), total }
    },

    /**
     * Creates a department. `id` is optional (the seed data uses fixed IDs); otherwise Appwrite
     * generates one. Duplicate names are refused.
     */
    async create({ id, ...input }) {
      const values = validateDepartment(input)
      await assertNameFree(values.name)
      const data = { description: '', email: null, ...values, createdAt: now() }
      return fromRow(await db.create(T, id ?? db.newId(), data))
    },

    /** Updates name / description / email / status. Only the keys you pass change. */
    async update(departmentId, patch) {
      const allowed = ['name', 'description', 'email', 'status']
      const unknown = Object.keys(patch).filter((key) => !allowed.includes(key))
      if (unknown.length > 0) throw validationError({ [unknown[0]]: 'This field cannot be changed.' })
      const values = validateDepartment(patch, { partial: true })
      if (Object.keys(values).length === 0) throw validationError({}, 'Nothing to update.')
      const existing = await service.require(departmentId)
      if (values.name && nameKey(values.name) !== nameKey(existing.name)) await assertNameFree(values.name, departmentId)
      return fromRow(await db.update(T, departmentId, values))
    },

    activate: (departmentId) => service.update(departmentId, { status: 'active' }),
    deactivate: (departmentId) => service.update(departmentId, { status: 'inactive' }),
  }
  return service
}
