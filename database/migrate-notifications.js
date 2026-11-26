/**
 * One-off for projects that ran Phases 7-11: upgrades existing notification rows to the Phase 12 shape.
 *   complaintId  -> relatedComplaintId
 *   (no createdAt) -> createdAt = the row's creation time
 *   permissions  -> read for the recipient only (the owner could update their rows before; marking as read now goes through the server)
 * Idempotent. The old `complaintId` column is left in place (harmless; delete it in the console if you like).
 * Runs with an API key (scripts/migrate-notifications.mjs); `tablesDB` is a node-appwrite TablesDB.
 */
const PAGE = 100

export async function migrateNotifications({ tablesDB, databaseId, Query, tableId = 'notifications', log = () => {} }) {
  const result = { total: 0, updated: 0, unchanged: 0, failed: 0 }
  let offset = 0
  for (;;) {
    const page = await tablesDB.listRows({ databaseId, tableId, queries: [Query.limit(PAGE), Query.offset(offset)] })
    for (const row of page.rows) {
      result.total += 1
      const data = {}
      if (!row.relatedComplaintId && row.complaintId) data.relatedComplaintId = row.complaintId
      if (!row.createdAt) data.createdAt = row.$createdAt
      const permissions = [`read("user:${row.userId}")`]
      const samePermissions = JSON.stringify([...(row.$permissions ?? [])].sort()) === JSON.stringify(permissions)
      if (Object.keys(data).length === 0 && samePermissions) {
        result.unchanged += 1
        continue
      }
      try {
        await tablesDB.updateRow({ databaseId, tableId, rowId: row.$id, data, permissions })
        result.updated += 1
      } catch (error) {
        result.failed += 1
        log(`could not update ${row.$id}: ${error?.message ?? error}`)
      }
    }
    offset += page.rows.length
    if (page.rows.length < PAGE || offset >= page.total) break
  }
  return result
}
