/**
 * One-off migration for projects that ran Phase 6: copies every row of the old `profiles` table
 * into the Phase 7 `users` table, keeping the SAME row ID (= account ID), so no user is duplicated.
 *
 *   profiles.status           -> users.accountStatus
 *   profiles.department       -> users.academicDepartment   (students only)
 *   profiles.accountCreatedAt -> users.createdAt
 *
 * Idempotent: rows that already exist in `users` are skipped. The old table is never modified or deleted.
 * Runs with an API key (see scripts/migrate-profiles-to-users.mjs); `tablesDB` is a node-appwrite TablesDB.
 */
const PAGE = 100

/** Maps one Phase 6 profiles row to the data for a Phase 7 users row. */
export function mapProfileToUser(row) {
  const isStudent = row.role === 'student'
  return {
    userId: row.userId ?? row.$id,
    name: row.name,
    email: row.email,
    rollNumber: isStudent ? (row.rollNumber ?? null) : null,
    role: row.role,
    academicDepartment: isStudent ? (row.department ?? null) : null,
    accountStatus: row.status ?? 'active',
    createdAt: row.accountCreatedAt ?? row.$createdAt,
  }
}

export async function migrateProfilesToUsers({ tablesDB, databaseId, Query, sourceTableId = 'profiles', targetTableId = 'users', log = () => {} }) {
  const result = { total: 0, created: 0, skipped: 0, failed: 0 }
  let offset = 0
  for (;;) {
    const page = await tablesDB.listRows({ databaseId, tableId: sourceTableId, queries: [Query.limit(PAGE), Query.offset(offset), Query.orderAsc('$createdAt')] })
    for (const row of page.rows) {
      result.total += 1
      const rowId = row.userId ?? row.$id
      try {
        await tablesDB.createRow({
          databaseId,
          tableId: targetTableId,
          rowId,
          data: mapProfileToUser(row),
          // Same rule as the profile-api function: the owner and administrators may read; nobody may write.
          permissions: [`read("user:${rowId}")`, 'read("label:admin")'],
        })
        result.created += 1
      } catch (error) {
        if (error?.code === 409) result.skipped += 1 // already migrated (or the roll number/email is already used)
        else {
          result.failed += 1
          log(`could not migrate ${rowId}: ${error?.message ?? error}`)
        }
      }
    }
    offset += page.rows.length
    if (page.rows.length < PAGE || offset >= page.total) break
  }
  return result
}
