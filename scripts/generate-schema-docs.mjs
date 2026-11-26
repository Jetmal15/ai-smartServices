// Regenerates docs/DATABASE_SCHEMA.md from database/schema.js:  npm run db:docs
import { writeFileSync } from 'node:fs'
import { renderSchemaDocs } from '../database/render-docs.js'

const target = new URL('../docs/DATABASE_SCHEMA.md', import.meta.url)
writeFileSync(target, renderSchemaDocs() + '\n')
console.log('✓ Wrote docs/DATABASE_SCHEMA.md')
