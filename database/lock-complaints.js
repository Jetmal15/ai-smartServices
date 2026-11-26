/**
 * One-off for projects that submitted complaints in Phase 8: Phase 8 gave the complainant direct read access to their
 * complaint row. Phase 9 reads complaints only through the complaint-api function (which whitelists the fields), so this
 * sets every complaint row to administrator-read only. Idempotent. Runs with an API key (scripts/lock-complaints.mjs).
 */
const PAGE = 100

export async function lockComplaintRows({ tablesDB, databaseId, Query, tableId = 'complaints', log = () => {} }) {
  const result = { total: 0, updated: 0, failed: 0 }
  let offset = 0
  for (;;) {
    const page = await tablesDB.listRows({ databaseId, tableId, queries: [Query.limit(PAGE), Query.offset(offset)] })
    for (const row of page.rows) {
      result.total += 1
      try {
        await tablesDB.updateRow({ databaseId, tableId, rowId: row.$id, permissions: ['read("label:admin")'] })
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
