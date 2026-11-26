// Creates the Phase 7 tables, columns, indexes and permissions in YOUR Appwrite project, then seeds the
// initial departments and categories. Everything comes from database/schema.js.
//
//   PowerShell:  $env:APPWRITE_API_KEY="<key>"; npm run db:setup
//   macOS/Linux: APPWRITE_API_KEY=<key> npm run db:setup
//   Preview only (no network, no key):  npm run db:setup -- --dry-run
//   Skip the seed data:                 npm run db:setup -- --no-seed
//
// API key scopes: databases.read, databases.write, tables.read, tables.write, columns.read, columns.write,
// indexes.read, indexes.write, rows.read, rows.write (names vary slightly between Appwrite versions – grant
// the database/table/column/index/row scopes). The key is read from the environment ONLY: never put it in
// `.env`, never in a VITE_ variable.
//
// Safe to re-run: anything that already exists is skipped (never modified or deleted). If you change the
// schema later, change existing tables in the console (or add new columns with this script).
import { BUCKETS, TABLES } from '../database/schema.js'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const seed = !args.has('--no-seed')

const tableList = Object.values(TABLES)
const columnCount = tableList.reduce((n, t) => n + t.columns.length, 0)
const indexCount = tableList.reduce((n, t) => n + t.indexes.length, 0)

if (dryRun) {
  console.log(`Dry run – nothing is sent to Appwrite. Would ensure ${tableList.length} tables, ${columnCount} columns, ${indexCount} indexes${seed ? ', then seed 7 departments and 7 categories' : ''}:\n`)
  for (const b of Object.values(BUCKETS)) {
    console.log(`  bucket ${b.id}: max ${b.maximumFileSize / 1024 / 1024} MB, extensions [${b.allowedFileExtensions.join(', ')}], fileSecurity=${b.fileSecurity ? 'on' : 'off'}, permissions=[${b.permissions.join(', ')}]`)
  }
  for (const t of tableList) {
    console.log(`  ${t.id.padEnd(17)} ${String(t.columns.length).padStart(2)} columns  ${String(t.indexes.length).padStart(2)} indexes  rowSecurity=${t.rowSecurity ? 'on ' : 'off'} permissions=[${t.permissions.join(', ')}]`)
  }
  process.exit(0)
}

const need = (name, value) => {
  if (!value) {
    console.error(`✗ Missing ${name}. See docs/DATABASE_SETUP.md.`)
    process.exit(1)
  }
  return value
}
const endpoint = need('VITE_APPWRITE_ENDPOINT (in .env)', process.env.VITE_APPWRITE_ENDPOINT?.trim())
const projectId = need('VITE_APPWRITE_PROJECT_ID (in .env)', process.env.VITE_APPWRITE_PROJECT_ID?.trim())
const databaseId = need('VITE_APPWRITE_DATABASE_ID (in .env)', process.env.VITE_APPWRITE_DATABASE_ID?.trim())
const apiKey = need('APPWRITE_API_KEY (environment variable)', process.env.APPWRITE_API_KEY?.trim())

const { Client, ID, Query, Storage, TablesDB } = await import('node-appwrite')
const { createDatabaseServices } = await import('../src/services/db/factory.js')

const admin = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey)
const tablesDB = new TablesDB(admin)
const storage = new Storage(admin)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs `create`; a 409 means "already exists" and is reported, not failed. Returns true when created. */
async function ensure(label, create) {
  try {
    await create()
    console.log(`  + ${label}`)
    return true
  } catch (error) {
    if (error?.code === 409) {
      console.log(`  = ${label} (already exists)`)
      return false
    }
    console.error(`  ✗ ${label}: ${error?.message ?? error}`)
    throw error
  }
}

function createColumn(tableId, c) {
  const base = { databaseId, tableId, key: c.key, required: c.required }
  const withDefault = c.default === undefined ? {} : { xdefault: c.default }
  const array = c.array ? { array: true } : {}
  switch (c.type) {
    case 'string':
      return tablesDB.createStringColumn({ ...base, size: c.size, ...withDefault, ...array })
    case 'email':
      return tablesDB.createEmailColumn({ ...base, ...withDefault, ...array })
    case 'enum':
      return tablesDB.createEnumColumn({ ...base, elements: c.elements, ...withDefault, ...array })
    case 'datetime':
      return tablesDB.createDatetimeColumn({ ...base, ...withDefault, ...array })
    case 'boolean':
      return tablesDB.createBooleanColumn({ ...base, ...withDefault, ...array })
    case 'float':
      return tablesDB.createFloatColumn({ ...base, ...(c.min !== undefined ? { min: c.min, max: c.max } : {}), ...withDefault, ...array })
    case 'integer':
      return tablesDB.createIntegerColumn({ ...base, ...(c.min !== undefined ? { min: c.min, max: c.max } : {}), ...withDefault, ...array })
    default:
      throw new Error(`Unsupported column type ${c.type}`)
  }
}

/** Columns are created asynchronously by Appwrite; indexes can only be built once they are "available". */
async function waitForColumns(tableId, keys) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { columns } = await tablesDB.listColumns({ databaseId, tableId })
    const byKey = new Map(columns.map((column) => [column.key, column.status]))
    const failed = keys.filter((key) => byKey.get(key) === 'failed')
    if (failed.length > 0) throw new Error(`Column(s) failed to build in ${tableId}: ${failed.join(', ')}`)
    if (keys.every((key) => byKey.get(key) === 'available')) return
    await sleep(1000)
  }
  throw new Error(`Timed out waiting for the columns of ${tableId} to become available.`)
}

/** Existing tables are never changed. Report differences so you can fix them in the console. */
async function reportDrift(table) {
  const { columns } = await tablesDB.listColumns({ databaseId, tableId: table.id })
  const actual = new Map(columns.map((column) => [column.key, column]))
  const wanted = new Set(table.columns.map((c) => c.key))
  for (const c of table.columns) {
    const found = actual.get(c.key)
    if (!found) continue
    if (c.type === 'enum' && JSON.stringify([...(found.elements ?? [])].sort()) !== JSON.stringify([...c.elements].sort())) {
      console.warn(`  ⚠ ${table.id}.${c.key}: allowed values differ (have ${(found.elements ?? []).join(', ')}; want ${c.elements.join(', ')}). Update the column in the console.`)
    }
    if (Boolean(found.required) !== Boolean(c.required)) console.warn(`  ⚠ ${table.id}.${c.key}: required should be ${c.required}.`)
  }
  for (const key of actual.keys()) if (!wanted.has(key)) console.warn(`  ⚠ ${table.id}.${key}: column is not in the schema any more (harmless; delete it if unused).`)
}

// for (const bucket of Object.values(BUCKETS)) {
//   console.log(`\nBucket ${bucket.name} (${bucket.id})`)
//   await ensure('bucket', () =>
//     storage.createBucket({
//       bucketId: bucket.id,
//       name: bucket.name,
//       permissions: bucket.permissions,
//       fileSecurity: bucket.fileSecurity,
//       enabled: true,
//       maximumFileSize: bucket.maximumFileSize,
//       allowedFileExtensions: bucket.allowedFileExtensions,
//       compression: bucket.compression,
//       encryption: bucket.encryption,
//       antivirus: bucket.antivirus,
//     }),
//   )
// }


for (const bucket of Object.values(BUCKETS)) {
  console.log(`\nBucket ${bucket.name} (${bucket.id})`)

  try {
    await storage.getBucket({ bucketId: bucket.id })
    console.log('  ✓ bucket already exists — skipped')
  } catch (error) {
    if (error.code === 404) {
      await ensure('bucket', () =>
        storage.createBucket({
          bucketId: bucket.id,
          name: bucket.name,
          permissions: bucket.permissions,
          fileSecurity: bucket.fileSecurity,
          enabled: true,
          maximumFileSize: bucket.maximumFileSize,
          allowedFileExtensions: bucket.allowedFileExtensions,
          compression: bucket.compression,
          encryption: bucket.encryption,
          antivirus: bucket.antivirus,
        }),
      )
    } else {
      throw error
    }
  }
}


console.log(`Setting up ${tableList.length} tables in database "${databaseId}"…`)
for (const table of tableList) {
  console.log(`\n${table.name} (${table.id})`)
  await ensure(`table`, () =>
    tablesDB.createTable({ databaseId, tableId: table.id, name: table.name, permissions: table.permissions, rowSecurity: table.rowSecurity, enabled: true }),
  )
  for (const column of table.columns) await ensure(`column ${column.key}`, () => createColumn(table.id, column))
  await waitForColumns(table.id, table.columns.map((c) => c.key))
  await reportDrift(table)
  for (const index of table.indexes) {
    await ensure(`index ${index.key}`, () =>
      tablesDB.createIndex({ databaseId, tableId: table.id, key: index.key, type: index.type, columns: index.columns, orders: index.columns.map(() => 'asc') }),
    )
  }
}

if (seed) {
  console.log('\nSeeding departments and categories…')
  // Indexes build in the background; give Appwrite a moment so the unique-name indexes are ready.
  await sleep(3000)
  const services = createDatabaseServices({ tablesDB, databaseId, Query, ID })
  const report = await services.seedInitialData()
  for (const [name, r] of Object.entries(report)) {
    console.log(`  ${name}: ${r.created.length} created, ${r.existing.length} already existed${r.conflicts.length ? `, ${r.conflicts.length} skipped (name already used: ${r.conflicts.join(', ')})` : ''}`)
  }
}

console.log('\n✓ Done. Next: deploy the updated profile-api function and follow docs/DATABASE_SETUP.md → “Verify”.')
