# Phase 10 – Department staff dashboard: setup and security notes

Nothing here is done for you. Do steps 1–3, then the checklist. Exact columns: [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md).

## What department staff get
- **Dashboard** (`/department/dashboard`): Total, **New** (= Submitted), Under Review, In Progress, Resolved and Closed counts for *their* department(s), the department names, and the newest complaints waiting for review.
- **Complaints** (`/department/complaints`): search (complaint ID, title, student name, roll number, category, details), filter by status (with counts), sort by date, pagination, loading and empty states.
- **Complaint details** with the full status history (who changed what and when, with remarks) and a **Manage this complaint** panel:
  - **Update status** along the workflow Submitted → Under Review → In Progress → Resolved → Closed (only valid next steps are offered), with an optional remark for the student.
  - **Mark as resolved** – needs a remark (at least 5 characters) so the student learns what was done.
  - **Add a remark** – a public remark the student sees, without changing the status (not on closed complaints).
  - **Internal notes** – visible to department staff and administrators only, never to students.
- Every status change notifies the student.

Allowed moves: Submitted → Under Review / In Progress / Closed · Under Review → In Progress / Resolved / Closed · In Progress → Under Review / Resolved / Closed · Resolved → In Progress / Closed · **Closed is final.**

## 1. Add the new columns (existing tables)
```powershell
$env:APPWRITE_API_KEY="<key>"; npm run db:setup -- --no-seed
```
Adds the missing columns to the tables you already have (it never changes or deletes anything that exists):
`complaints` → `lastUpdatedBy`, `lastUpdatedByName`, `lastUpdatedAt` · `complaint_history` → `kind` (enum `status`/`remark`, default `status`), `actorName` · `complaint_notes` → `authorName`.
By hand: add those columns in the console exactly as listed in `DATABASE_SCHEMA.md` (all optional). No data migration is needed; older history rows without `kind` are treated as status changes.

## 2. Redeploy `complaint-api`
Redeploy `functions/complaint-api` (same function ID and variables). Optional new variable: `COMPLAINT_NOTES_TABLE_ID` (default `complaint_notes`). The existing API key scopes are enough.

## 3. Make sure staff are assigned
A staff member sees complaints only for the departments they are **assigned to** (table `department_users`; see `DATABASE_SETUP.md` step 4). The account needs the `department` role. Until an administrator assigns them, the dashboard says so and shows zeros.

## Verify against your real project
1. Sign in as staff assigned to **Cleaning Department**; as a student submit one *Cleaning Issues* and one *LMS Issues* complaint. Staff sees the cleaning complaint only (dashboard: New = 1, Total = 1; list; details). Open the LMS complaint’s URL by hand → “not found”.
2. Sign in as staff of **ITSC Department**: the reverse.
3. Update the status step by step to Under Review → In Progress; try to resolve **without** a remark → refused; add a remark → Resolved; then Closed. After closing, the status form says it is final.
4. Details → history shows each change with the staff member’s name and time; the complaint shows “Last updated … by …”.
5. Sign in as the student: the same history shows only “Department”/“System” (no names), the remark text, the new status, and a notification row exists. Add an **internal note** as staff: it is visible to staff, not to the student (check the student’s details page and My Complaints search).
6. Open the same complaint in two browsers as two staff of the department; change status in one, then in the other without reloading → “updated by someone else. Reload it and try again.”
7. As a staff user, in DevTools, try calling the Appwrite database directly for `complaints`, `complaint_history`, `complaint_notes`: no rows come back.
8. A staff account cannot reach the Users admin page, and calling `profile-api` with `admin.setRole` returns 403.

## How it is secured
- **Every staff action runs in `complaint-api` with a server key** after checking the verified login, the `department` role and the staff member’s **assignments** (read server-side from `department_users`). The complaint’s department is read from the database, never from the request; a complaint of another department answers “not found” (404) for details, attachments, status changes, remarks and notes. A `departmentId` in a list request can only narrow the list to a department you are assigned to (otherwise 403).
- **Staff cannot read or write the complaint tables from the browser** (`complaints`, `complaint_history`, `complaint_notes` grant only `label:admin` read, nothing else), so all changes are validated by the function.
- **Validated transitions.** The workflow is enforced on the server for every pair of statuses; `closed` is final. The browser also sends the status it was looking at (`expectedStatus`); if a colleague already changed the complaint the update is refused rather than overwritten.
- **Audit trail.** Every status change and remark writes a history entry with the staff member’s ID and name (taken from the verified login, never from the request), the role and a server timestamp; the complaint also stores who/when it was last updated. Students never receive staff IDs or names.
- **No account management.** The complaint function has no action that touches users or roles. `profile-api` allows role changes to administrators only and refuses a staff member who tries to change their own role (tests cover both).

## Known limitations
- **Not run against a live Appwrite project.** The tests use an in-memory stand-in built from the schema; `main.js` (SDK wiring), the React pages and the setup script were not executed here. Use the checklist above.
- Administrators cannot yet change a complaint’s status from the app (use `npm run complaint:status …`); there is no screen yet for administrators to read complaints or assign staff.
- The stale-update check is read-then-write, so two simultaneous updates within a few milliseconds could still both pass; the history keeps both entries.
- Staff search looks through the newest 2,000 complaints of their department(s) (the page says so when it truncates). Plain listing and the dashboard counts use database queries and have no such limit.
- Notifications are created for students but there is no notification screen yet.
