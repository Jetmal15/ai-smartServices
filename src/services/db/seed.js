import { CATEGORY_SEEDS, DEPARTMENT_SEEDS, TABLE_IDS } from '../../../database/schema.js'
import { nameKey } from './core.js'

/**
 * Creates the initial departments and categories. Safe to run any number of times:
 *   - a row whose fixed ID already exists is left exactly as it is (admin edits are never overwritten);
 *   - a row whose NAME is already used by a different row is reported, not duplicated.
 * Needs create permission on both tables: an administrator in the browser, or an API key in Node.
 * Returns { departments, categories } each as { created, existing, conflicts } (lists of IDs).
 */
export async function seedInitialData(db, { now }) {
  const report = () => ({ created: [], existing: [], conflicts: [] })
  const result = { departments: report(), categories: report() }

  const seedTable = async (tableId, seeds, outcome, build) => {
    const usedNames = new Set((await db.listAll(tableId)).map((row) => nameKey(row.name)))
    for (const seed of seeds) {
      if (await db.find(tableId, seed.id)) {
        outcome.existing.push(seed.id)
        continue
      }
      if (usedNames.has(nameKey(seed.name))) {
        outcome.conflicts.push(seed.id)
        continue
      }
      try {
        await db.create(tableId, seed.id, build(seed))
        usedNames.add(nameKey(seed.name))
        outcome.created.push(seed.id)
      } catch (error) {
        if (error.code !== 'conflict') throw error
        outcome.existing.push(seed.id) // created by someone else a moment ago
      }
    }
  }

  await seedTable(TABLE_IDS.departments, DEPARTMENT_SEEDS, result.departments, (seed) => ({
    name: seed.name,
    description: seed.description,
    status: 'active',
    createdAt: now(),
  }))

  await seedTable(TABLE_IDS.categories, CATEGORY_SEEDS, result.categories, (seed) => ({
    name: seed.name,
    description: seed.description,
    departmentId: seed.departmentId,
    status: 'active',
  }))

  return result
}
