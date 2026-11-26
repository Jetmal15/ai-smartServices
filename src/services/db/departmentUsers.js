import { TABLE_IDS } from '../../../database/schema.js'
import { clean, conflict, fromRow, notFound, validationError } from './core.js'

const POSITION_MAX = 100
const DEFAULT_POSITION = 'Staff'

function cleanPosition(value) {
  const position = clean(value ?? DEFAULT_POSITION) || DEFAULT_POSITION
  if (position.length > POSITION_MAX) throw validationError({ position: `Position must be at most ${POSITION_MAX} characters.` })
  return position
}

/**
 * Assigns department staff to departments.
 *
 * Rules enforced here AND by the unique (userId, departmentId) index:
 *   - only users whose role is `department` and whose account is active can be assigned;
 *   - the department must exist and be active;
 *   - the same person cannot be assigned to the same department twice.
 * Reading needs label:admin or label:department; writing needs label:admin.
 * `assign` reads the `users` table, so it only works for administrators (who can read every user row).
 */
export function createDepartmentUsersService(db, { users, departments, now }) {
  const { Query } = db
  const T = TABLE_IDS.departmentUsers

  const service = {
    async get(assignmentId) {
      return fromRow(await db.find(T, assignmentId))
    },

    /** Staff assigned to a department (oldest first). */
    async listByDepartment(departmentId) {
      const rows = await db.listAll(T, [Query.equal('departmentId', [departmentId]), Query.orderAsc('$createdAt')])
      return rows.map(fromRow)
    },

    /** A staff member's assignments (oldest first). */
    async listByUser(userId) {
      const rows = await db.listAll(T, [Query.equal('userId', [userId]), Query.orderAsc('$createdAt')])
      return rows.map(fromRow)
    },

    /** A staff member's assignments with the department's name and status attached. */
    async listForUserWithDepartments(userId) {
      const assignments = await service.listByUser(userId)
      return Promise.all(
        assignments.map(async (assignment) => {
          const department = await departments.get(assignment.departmentId)
          return { ...assignment, departmentName: department?.name ?? '', departmentStatus: department?.status ?? 'inactive' }
        }),
      )
    },

    async assign({ userId, departmentId, position }) {
      const cleanUserId = clean(userId)
      if (!cleanUserId) throw validationError({ userId: 'Choose a staff member.' })
      const cleanedPosition = cleanPosition(position)

      const user = await users.get(cleanUserId)
      if (!user) throw validationError({ userId: 'That user does not exist.' })
      if (user.role !== 'department') throw validationError({ userId: 'Only users with the department staff role can be assigned. Change their role first.' })
      if (user.accountStatus !== 'active') throw validationError({ userId: 'That account is disabled.' })

      const department = await departments.get(departmentId)
      if (!department) throw validationError({ departmentId: 'That department does not exist.' })
      if (department.status !== 'active') throw validationError({ departmentId: 'That department is inactive.' })

      const existing = (await service.listByUser(cleanUserId)).find((row) => row.departmentId === departmentId)
      const duplicate = () => conflict('This person is already assigned to that department.', { userId: 'This person is already assigned to that department.' })
      if (existing) throw duplicate()

      try {
        return fromRow(await db.create(T, db.newId(), { userId: cleanUserId, departmentId, position: cleanedPosition, createdAt: now() }))
      } catch (error) {
        // The unique index closes the race between the check above and the insert.
        if (error.code === 'conflict') throw duplicate()
        throw error
      }
    },

    async updatePosition(assignmentId, position) {
      if (!(await service.get(assignmentId))) throw notFound('Assignment')
      return fromRow(await db.update(T, assignmentId, { position: cleanPosition(position) }))
    },

    async remove(assignmentId) {
      if (!(await service.get(assignmentId))) throw notFound('Assignment')
      await db.remove(T, assignmentId)
    },

    /** Removes every assignment of a user (e.g. after they stop being department staff). Returns how many. */
    async removeAllForUser(userId) {
      const rows = await service.listByUser(userId)
      for (const row of rows) await db.remove(T, row.id)
      return rows.length
    },
  }
  return service
}
