# AI SmartServices

AI-Based Complaint Management and Department Notification System.

**Stack:** React · Vite · JavaScript · Tailwind CSS 4 · React Router DOM · Lucide React

## Scripts

- `npm run dev` – start the dev server
- `npm run build` – production build
- `npm run lint` – lint with oxlint
- `npm run preview` – preview the production build
- `npm run appwrite:check` – ping Appwrite using the values in `.env`
- `npm run db:setup` – create/seed the Phase 7 tables in your Appwrite project (needs `APPWRITE_API_KEY` in your shell; `-- --dry-run` previews)
- `npm run db:docs` – regenerate `docs/DATABASE_SCHEMA.md` from `database/schema.js`
- `npm run db:migrate-profiles` – copy Phase 6 `profiles` rows into `users` (only if you ran Phase 6)
- `npm test` – function tests (Phase 6) and database tests (Phase 7)

## Structure

```
src/
  assets/  components/  layouts/  pages/  routes/
  context/ services/    lib/      hooks/  utils/
  App.jsx  main.jsx     index.css
```

Status: Phase 13 (administrator dashboard) complete.

## Phase 2 notes

- Reusable UI components: `src/components/ui/` (import from `components/ui/index.js`)
- Layout components (Navbar, Sidebar, Footer, Logo, DashboardTopbar): `src/components/layout/`
- Layouts: `src/layouts/` (Public, Auth, Student, Staff, Admin)
- Component showcase: `/design-system`
- Dashboard previews: `/student`, `/staff`, `/admin`
- Static preview data lives only in `src/mock/` and must be replaced by real services in `src/services/`.

## Phase 3 notes

- All paths live in `src/routes/paths.js` (`PATHS`, `ROLE_HOME`); routes are declared in `src/routes/AppRoutes.jsx`.
- `ProtectedRoute` (sign-in + role check) and `PublicRoute` (`restricted` for login/register) are layout routes.
- Unauthenticated users go to `/login` and return to the page they wanted after signing in; users with the wrong role are sent to their own dashboard.
- **Auth is a temporary stub** (`src/context/AuthProvider.jsx`, `src/hooks/useAuth.js`). The login page has a "UI preview only" sign-in for each role. Replace the provider internals with Appwrite later; the context shape stays the same.

## Phase 4 notes

- Appwrite SDK config lives in `src/lib/appwrite/` (`env.js`, `client.js`, `account.js`, `database.js`, `index.js`). Import from `src/lib/appwrite/index.js`.
- Database access uses **TablesDB** (`tablesDB.listRows({ databaseId, tableId, ... })`). No table IDs are defined yet.
- Copy `.env.example` to `.env` and fill it in; setup steps are in `docs/APPWRITE_SETUP.md`.
- Auth is still the temporary stub; `account` is configured but not used yet.

## Phase 5 notes

- Auth service: `src/services/authService.js` (registerStudent, login, logout, getCurrentUser, hasActiveSession, requestPasswordReset, completePasswordReset, friendly error mapping).
- `AuthProvider` restores the session on load, re-checks it on tab focus and every 5 minutes, and flags `sessionExpired` on a 401. Services can call `handleAuthError(err)` from `useAuth()` to do the same.
- Role = Appwrite **label** (`admin` / `department`); no label = student. Public sign-up can only create students.
- New pages: `/forgot-password`, `/reset-password`. The Phase 3 preview sign-in buttons are removed.
- Setup, manual checklist and known limitations: `docs/APPWRITE_SETUP.md`. Mock-based browser tests: `tests/phase5/`.

## Phase 6 notes

- Roles: `student` (no label), `department` and `admin` (Appwrite **labels**, never user-editable). Profiles live in the `profiles` table, one row per account (row ID = user ID).
- **All profile creation, profile edits and role changes go through the `profile-api` Appwrite Function** (`functions/profile-api/`). The table grants browsers no write permission, and the function re-reads the caller's role from their labels on every request.
- Row permissions: only the owner and `label:admin` can read a profile row. Students cannot read other students' rows; staff cannot read student rows or admin data.
- Frontend: `src/services/profileService.js`, `src/lib/permissions.js`, `ProfilePage` (all roles), `/admin/users` (role/department/status management), `/dashboard` and `/profile` role-aware redirects, access-denied notice on wrong-role navigation.
- Self-service: everyone can change their name; students can also change their program and set a missing roll number once. Nobody can change their own role, email, status or ID. Admins cannot change their own role or disable themselves.
- Setup (table, function, API key, first sync) and manual checks: `docs/APPWRITE_SETUP.md` → Phase 6. Tests: `npm run test:phase6` (function) and `tests/phase6/` (browser).

## Phase 7 notes

- `database/schema.js` is the single source of truth for the 7 tables (`users`, `departments`, `department_users`, `categories`, `complaints`, `ai_summaries`, `notifications`): columns, required flags, indexes, permissions, and the seed departments/categories. `docs/DATABASE_SCHEMA.md` is generated from it.
- **Nothing creates tables automatically.** Run `npm run db:setup` or follow `docs/DATABASE_SETUP.md` (console steps, verification checklist, design notes).
- `users` replaces Phase 6's `profiles` (row ID = account ID, unique `userId`/`email`/`rollNumber`), still written only by `profile-api`. Staff are assigned to service departments in `department_users`; only students have an academic department.
- Service functions: `src/services/db/` (`users` read-only, `departments`, `categories`, `departmentUsers`, `seedInitialData`). Import from `src/services/db/index.js`; the same code runs in Node with an API key.
- `complaints`, `ai_summaries`, `notifications` are structure only (default-deny) until their phases.
- Tests: `npm run test:phase7` (schema, permission matrix, services, seed, migration) against an in-memory stand-in for Appwrite. Not a substitute for the real-project checks in the setup guide.

## Phase 8 notes

- Student complaint module: Submit Complaint, My Complaints, Complaint Details; department staff get a read-only list of complaints for their assigned department(s).
- New Appwrite function `functions/complaint-api` is the **only** thing that creates complaints. It takes the student from the verified login, the department from the category, and sets the ID, status (`submitted`) and time itself; anything of that kind sent by the browser is ignored.
- Statuses are now Submitted, Under Review, In Progress, Resolved, Closed (`src/lib/constants.js`, `database/schema.js`). The `complaints` table changed: see `docs/COMPLAINTS_SETUP.md` to recreate it (it was empty) and create the `complaint-attachments` bucket.
- Setup, verification checklist and security notes: `docs/COMPLAINTS_SETUP.md`. Tests: `npm run test:phase8`.

## Phase 9 notes

- **My Complaints** now has search, status and category filters, date sorting, pagination, and loading/empty states; **Complaint details** shows the progress tracker and status history with department remarks.
- Students read complaints **only** through `complaint-api` (`complaint.listMine`, `complaint.get`), which returns whitelisted fields. Complaint rows are now administrator-read only (`npm run db:lock-complaints` fixes Phase 8 rows).
- New tables: `complaint_history` (public status timeline) and `complaint_notes` (internal notes, prepared, never student-readable). Run `npm run db:setup -- --no-seed`.
- `npm run complaint:status -- <ID> <status> "remark"` moves a complaint (administrator tool until the department phase).
- Setup, checklist and security notes: `docs/HISTORY_SETUP.md`. Tests: `npm run test:phase9`.

## Phase 10 notes

- **Department dashboard** (`/department/dashboard`) with per-status counts, and **department complaint management**: search, status filter, sorting, paging, details with history, status updates along the workflow, public remarks, internal notes, "mark as resolved".
- All staff actions go through `complaint-api` (`department.list`, `department.stats`, `complaint.updateStatus`, `complaint.addRemark`, `complaint.addNote`), which checks the verified login, the `department` role and the staff member's department assignments on every call. Staff never read or write the complaint tables from the browser.
- Who updated a complaint and when is recorded (history entry + "last updated"); students never see staff names or IDs.
- New columns on existing tables: run `npm run db:setup -- --no-seed`, then redeploy `complaint-api`. Setup, checklist, security notes and limitations: `docs/DEPARTMENT_SETUP.md`. Tests: `npm run test:phase10`.

## Phase 11 notes

- The AI module (`functions/complaint-api/src/ai`) is the only code that talks to the external AI provider; the API key is a secret of the `complaint-api` function and never reaches the browser. (There is no separate `ai-analysis` function: the analysis runs as an internal asynchronous execution of `complaint-api`.) With no key configured, a built-in rule-based **fallback** analyses complaints instead.
- Each complaint gets a stored analysis (`ai_summaries`): summary, suggested category, department, priority (Low/Medium/High/Urgent), tone, keywords, confidence, reason. It is **advice only**: staff of the department and administrators can review it, apply the suggested priority, and administrators can move the complaint to another category/department. Students never see AI output.
- Only the redacted complaint title and description are sent to the provider (no names, roll numbers, e-mails, IDs or files). AI answers are validated; errors and rate limits fall back safely.
- New admin screen: **Admin → Complaints** (all complaints, details with the AI panel and reassignment).
- Setup, safety design, verification checklist and limits: `docs/AI_SETUP.md`. Tests: `npm run test:phase11`.

## Phase 12 notes

- **In-app notifications** for the seven events (complaint submitted, assigned to a department, status updated, in progress, resolved, closed, important administrator update): a **bell with an unread count and dropdown** in every dashboard, a **notifications page** and **details page** for each role, **mark as read / mark all as read**, clear relative timestamps with the exact time on hover, loading and empty states. Administrators can also send announcements.
- Notifications are created **only by the server** (`complaint-api`), duplicates are impossible (the row ID is a hash of the event), users can read only their own, and nobody can edit or delete them from a browser (mark-as-read goes through the server).
- The `notifications` table changed (`relatedComplaintId`, `createdAt`, new types): run `npm run db:setup -- --no-seed`, edit the `type` enum in the console, run `npm run db:migrate-notifications`, then redeploy `complaint-api`. Details, checklist and limits: `docs/NOTIFICATIONS_SETUP.md`. Tests: `npm run test:phase12`.

## Phase 13 notes

- **Administrator dashboard** (statistics), **user management** (search, role filter, activate/deactivate, provision staff and administrators), **department, category and staff-assignment management**, **complaint monitoring with search/filters and reassignment**, and **reports** (by category, by department, status distribution, resolution statistics, department performance).
- The administrator module (`functions/complaint-api/src/admin`, no separate `admin-api` function) performs every administrator operation on departments, categories and staff and records an audit trail (`admin_audit`). Those tables are now read-only for browsers, even administrators. `profile-api` provisions accounts (one-time temporary password), enforces an optional administrator allowlist (`ADMIN_ALLOWLIST`) and keeps at least one active administrator.
- Setup (new table, tightening permissions, new function, new variables), verification checklist, security notes and limits: `docs/ADMIN_SETUP.md`. Tests: `npm run test:phase13`.

## Phase 14 notes

- **Security audit and integration tests**: `npm run test:phase14` (all phases: `npm test`). The tests run the real browser services and the real Appwrite web SDK against the real `profile-api` and `complaint-api` handlers through an in-process Appwrite gateway (`tests/support/fake-appwrite-http.mjs`).
- Covers registration, login, logout, session persistence, password recovery, role restrictions, complaints, AI (including provider failures), notifications, Appwrite permissions, input validation, file upload security, secret exposure, protected routes, and cross-user / cross-department access.
- Fixes in this phase: the notification actions (`notification.markRead`, `markAllRead`, `announce`) and notification creation are wired into `complaint-api`; request bodies are capped at 64 KB; the action name must be a string; attachment names are sanitised; the admin complaint list shows reference numbers.
- Full report, defects found, limitations and a manual checklist for the real Appwrite project: `docs/PHASE14_TEST_REPORT.md`.
