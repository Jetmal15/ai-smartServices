import { ENUMS, TABLE_IDS } from '../../../database/schema.js'
import { clean, conflict, fromRow, nameKey, notFound, paging, validationError } from './core.js'

/** Validates category input (`partial`: only the keys present). Returns cleaned values. */
export function validateCategory(input, { partial = false } = {}) {
  const values = {}
  const fields = {}
  const has = (key) => !partial || key in input

  if (has('name')) {
    const name = clean(input.name)
    if (name.length < 2) fields.name = 'Enter the category name.'
    else if (name.length > 128) fields.name = 'Name must be at most 128 characters.'
    else values.name = name
  }
  if (has('description') && input.description !== undefined) {
    const description = clean(input.description)
    if (description.length > 1000) fields.description = 'Description must be at most 1000 characters.'
    else values.description = description
  }
  if (has('departmentId')) {
    const id = clean(input.departmentId)
    if (!id || id.length > 36) fields.departmentId = 'Choose the department that handles this category.'
    else values.departmentId = id
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
 * Complaint categories. Each belongs to one ACTIVE department. Never deleted: deactivate instead.
 * Writing needs the `label:admin` table permission; every signed-in user may read.
 */
export function createCategoriesService(db, { departments }) {
  const { Query } = db
  const T = TABLE_IDS.categories

  async function assertDepartmentUsable(departmentId) {
    const department = await departments.get(departmentId)
    if (!department) throw validationError({ departmentId: 'That department does not exist.' })
    if (department.status !== 'active') throw validationError({ departmentId: 'That department is inactive.' })
    return department
  }

  async function assertNameFree(name, exceptId) {
    const taken = (await db.listAll(T)).some((row) => row.$id !== exceptId && nameKey(row.name) === nameKey(name))
    if (taken) throw conflict('A category with this name already exists.', { name: 'A category with this name already exists.' })
  }

  const service = {
    async get(categoryId) {
      return fromRow(await db.find(T, categoryId))
    },

    async require(categoryId) {
      const row = await service.get(categoryId)
      if (!row) throw notFound('Category')
      return row
    },

    /** Categories ordered by name. Filters: departmentId, status. */
    async list({ departmentId, status, limit, offset } = {}) {
      const page = paging({ limit, offset }, 100)
      const queries = [Query.orderAsc('name'), Query.limit(page.limit), Query.offset(page.offset)]
      if (departmentId) queries.push(Query.equal('departmentId', [departmentId]))
      if (status) queries.push(Query.equal('status', [status]))
      const { rows, total } = await db.list(T, queries)
      return { categories: rows.map(fromRow), total }
    },

    /**
     * What a complaint form may offer: active categories whose department is also active, each with
     * its department's name. Inactive categories/departments stay in the database but are hidden here.
     */
    async listAvailable() {
      const [{ categories }, { departments: depts }] = await Promise.all([service.list({ status: 'active' }), departments.list({ status: 'active' })])
      const byId = new Map(depts.map((department) => [department.id, department]))
      return categories.filter((category) => byId.has(category.departmentId)).map((category) => ({ ...category, departmentName: byId.get(category.departmentId).name }))
    },

    async create({ id, ...input }) {
      const values = validateCategory(input)
      await assertDepartmentUsable(values.departmentId)
      await assertNameFree(values.name)
      return fromRow(await db.create(T, id ?? db.newId(), { description: '', ...values }))
    },

    /** Updates name / description / departmentId / status. Re-routing to another department is allowed. */
    async update(categoryId, patch) {
      const allowed = ['name', 'description', 'departmentId', 'status']
      const unknown = Object.keys(patch).filter((key) => !allowed.includes(key))
      if (unknown.length > 0) throw validationError({ [unknown[0]]: 'This field cannot be changed.' })
      const values = validateCategory(patch, { partial: true })
      if (Object.keys(values).length === 0) throw validationError({}, 'Nothing to update.')
      const existing = await service.require(categoryId)
      if (values.name && nameKey(values.name) !== nameKey(existing.name)) await assertNameFree(values.name, categoryId)
      // Moving to another department, or switching back on, needs a usable department.
      const targetDepartment = values.departmentId ?? existing.departmentId
      if (values.departmentId || values.status === 'active') await assertDepartmentUsable(targetDepartment)
      return fromRow(await db.update(T, categoryId, values))
    },

    activate: (categoryId) => service.update(categoryId, { status: 'active' }),
    deactivate: (categoryId) => service.update(categoryId, { status: 'inactive' }),
  }
  return service
}
