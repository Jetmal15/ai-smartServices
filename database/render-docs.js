import { BUCKETS, TABLES } from './schema.js'

const typeLabel = (column) => {
  const base =
    column.type === 'string' ? `String (${column.size})`
    : column.type === 'enum' ? `Enum: ${column.elements.map((e) => `\`${e}\``).join(', ')}`
    : column.type === 'email' ? 'Email'
    : column.type === 'datetime' ? 'Datetime'
    : column.type === 'boolean' ? 'Boolean'
    : column.type === 'float' ? `Float${column.min !== undefined ? ` (min ${column.min}, max ${column.max})` : ''}`
    : column.type === 'integer' ? 'Integer'
    : column.type
  return column.array ? `${base}, **array**` : base
}

const perms = (list) => (list.length === 0 ? '_none_ (no table-level permission)' : list.map((p) => `\`${p}\``).join(', '))

/** Markdown reference for every table, generated from database/schema.js. Do not edit by hand. */
export function renderSchemaDocs() {
  const out = [
    '# Database schema (generated)',
    '',
    '> Generated from `database/schema.js` by `npm run db:docs`. **Do not edit by hand** – edit the schema and regenerate.',
    '> Setup steps: `docs/DATABASE_SETUP.md`.',
    '',
    'Reference columns (`userId`, `departmentId`, …) store the `$id` of the referenced row. They are plain indexed string columns, not Appwrite relationship columns (see the design notes in the setup guide).',
    '',
  ]
  for (const table of Object.values(TABLES)) {
    out.push(`## ${table.name} — table ID \`${table.id}\``, '', table.purpose, '')
    out.push(`- **Row security:** ${table.rowSecurity ? 'ON' : 'OFF'}`)
    out.push(`- **Table permissions:** ${perms(table.permissions)}`)
    if (table.rowPermissionsNote) out.push(`- **Row permissions:** ${table.rowPermissionsNote}`)
    out.push('', '| Column | Type | Required | Default | Notes |', '|---|---|---|---|---|')
    for (const c of table.columns) {
      const def = c.default === undefined ? '–' : `\`${String(c.default)}\``
      out.push(`| \`${c.key}\` | ${typeLabel(c)} | ${c.required ? 'yes' : 'no'} | ${def} | ${c.description ?? ''} |`)
    }
    out.push('', '| Index key | Type | Columns |', '|---|---|---|')
    for (const i of table.indexes) out.push(`| \`${i.key}\` | ${i.type === 'unique' ? 'Unique' : 'Key'} | ${i.columns.map((c) => `\`${c}\``).join(', ')} |`)
    out.push('')
  }
  for (const bucket of Object.values(BUCKETS)) {
    out.push(`## Storage bucket: ${bucket.name} — bucket ID \`${bucket.id}\``, '', bucket.purpose, '')
    out.push(`- **File security:** ${bucket.fileSecurity ? 'ON' : 'OFF'}`)
    out.push(`- **Bucket permissions:** ${perms(bucket.permissions)}`)
    out.push(`- **Maximum file size:** ${bucket.maximumFileSize} bytes (${bucket.maximumFileSize / 1024 / 1024} MB)`)
    out.push(`- **Allowed file extensions:** ${bucket.allowedFileExtensions.map((e) => `\`${e}\``).join(', ')}`)
    out.push(`- **Encryption:** ${bucket.encryption ? 'ON' : 'OFF'} · **Antivirus:** ${bucket.antivirus ? 'ON (if your Appwrite plan offers it)' : 'OFF'} · **Compression:** ${bucket.compression}`, '')
  }
  return out.join('\n')
}
