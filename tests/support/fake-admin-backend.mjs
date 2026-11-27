// Test backend for the integrated administrator module (functions/complaint-api/src/admin). Same schema-driven fake database as
// the complaint tests, so everything the module writes is validated against database/schema.js (columns, enums, unique indexes).
import { createComplaintBackend } from './fake-complaint-backend.mjs'

export function createAdminBackend() {
  const b = createComplaintBackend()
  return { b, deps: b.deps.admin, control: b.adminControl, server: b.fake.as('server') }
}
