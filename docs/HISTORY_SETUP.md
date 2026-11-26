# Phase 9 – Complaint history and tracking: setup and security notes

Nothing here is done for you. Do the three steps below, then the checklist. Exact columns: [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md).

## What the student gets
- **My Complaints** (`/student/complaints`): complaint ID, title, category, department, submission date and current status for each complaint, with
  **search** (ID, title, category, department, location, details; every word must match), **filter by status** (with counts), **filter by category**,
  **sort by date** (newest/oldest), **pagination** (10 per page), a loading state, and two different empty states (no complaints yet / nothing matches, with “Clear filters”).
- **Complaint details** (`/student/complaints/:id`): ID, full description, category, department, submission date, current status, optional attachment, a
  **progress tracker** (Submitted → Under Review → In Progress → Resolved → Closed) and the **status history** with the date of every change and any
  **department remark** written for the student.
- Department staff and administrators open the same details page and see the same public timeline.

## 1. Create the two new tables
```powershell
$env:APPWRITE_API_KEY="<key>"; npm run db:setup -- --no-seed
```
Creates `complaint_history` (the public status timeline) and `complaint_notes` (prepared for internal department notes; nothing writes it yet). Existing tables are skipped.
Console route instead: create both tables as in `DATABASE_SCHEMA.md` (table permissions: `read` for `label:admin` only; Row security OFF).

## 2. Redeploy `complaint-api`
Redeploy `functions/complaint-api` (same function ID, same variables). Optional new variable: `COMPLAINT_HISTORY_TABLE_ID` (default `complaint_history`). The existing API key scopes are enough.

## 3. If you submitted complaints during Phase 8
Phase 8 let the student read their complaint row directly. Phase 9 closes that (so no field of the row can leak). Make existing rows administrator-only:
```powershell
$env:APPWRITE_API_KEY="<key>"; npm run db:lock-complaints
```
Safe to repeat. Old complaints have no history rows; their timeline simply starts with “Submitted” at the submission time. Without a Phase 8 complaint you can skip this step.

## Try tracking before the department screens exist
Changing a status belongs to the department phase. Until then, an administrator can move a complaint with the same server code the department feature will use
(it updates the complaint, writes the history entry and notifies the student):
```powershell
$env:APPWRITE_API_KEY="<key>"; npm run complaint:status -- CMP-20261122-K7M2QX under_review "We are looking into your complaint."
```
Allowed moves: Submitted → Under Review / In Progress / Closed · Under Review → In Progress / Resolved / Closed · In Progress → Under Review / Resolved / Closed · Resolved → In Progress / Closed · **Closed is final**.
The remark is **shown to the student** – never put private information in it.

## Verify against your real project
1. Sign in as a student with several complaints: the list shows ID, title, category, **department**, date, status. Try the search box (a title word, the complaint ID, a department name), each filter, sort, and the pager (submit 11+ complaints, or temporarily lower `PAGE_SIZE`).
2. Search for nonsense → “No complaints match” with a working **Clear filters**. A brand-new student sees “You have not submitted any complaints”.
3. Run `npm run complaint:status …` for one complaint, then reopen its details: the progress tracker advanced, the history shows the change with its date and your remark, and the status in the list changed.
4. Sign in as a **second student** and open the first student’s details URL: “not found”. Their list never shows the other student’s complaints.
5. In the console, `complaints`, `complaint_history` and `complaint_notes` show **no** `read` permission for users (only `label:admin`); a student can open none of them in the console’s API/permissions view. Put text in a `complaint_notes` row for a complaint: it never appears for the student.
6. Open DevTools → Network on the details page: the responses contain no `priority`, `assignedTo`, `studentId` or staff IDs.

## How it is secured
- **Students never query the database.** `complaint.listMine` / `complaint.get` run in the function with the server key and filter by the **verified login** (an ID in the request is ignored). Each response is built from an explicit field list, so a column added to a complaint later cannot reach a student by accident.
- **Internal notes cannot leak:** they live in a separate table (`complaint_notes`) that no student-facing code reads and that grants students nothing. The public timeline (`complaint_history`) has no field for internal text, only the status, date, a public remark and “System”/“Department” (never a staff name or ID).
- **Search runs in memory** over that one student’s complaints (up to 1,000): case-insensitive, no query syntax, no full-text index, nothing the student types reaches the database. Text like `.*`, `$gt` or `' OR 1=1` is just text.
- Filters, sort and paging are validated (unknown status/category/sort → error; limit capped at 50).
- A status change and its history entry are written together; if the history cannot be written the status is put back. A missing history entry never breaks a page (the “Submitted” step is rebuilt from the submission time).

## Known limitations
- **Not run against a live Appwrite project.** Tests use an in-memory stand-in built from the schema; `main.js` wiring, the React pages and the two new scripts were not executed here. Use the checklist above.
- Department screens to change a status, write remarks and internal notes are **not** part of this phase: for now use `npm run complaint:status` (administrator tool, public remarks only). `complaint_notes` is structure only.
- A student with more than 1,000 complaints would only see the newest 1,000 in search/filter results (rate limits make this practically unreachable).
- The details page shows the department’s remark exactly as written; remarks are plain text (HTML is shown as text, not run).
