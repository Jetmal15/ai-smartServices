# Phase 7 – Database setup guide

**Nothing in this guide has been done for you, and the app never creates tables by itself.** The tables exist
only after you run the setup script (Option A) or create them in the Appwrite console (Option B).
The exact columns, types, indexes and permissions of every table are in
[`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md), generated from `database/schema.js` (the single source of truth).

## What Phase 7 adds

| Table (ID) | Purpose | Browser access |
|---|---|---|
| `users` | One row per Appwrite account. **Replaces the Phase 6 `profiles` table.** | Read own row (admins: all). No writes. |
| `departments` | Service departments (ITSC, Cleaning, …) | Signed-in users read; written only by `admin-api` (Phase 13) |
| `department_users` | Which staff belong to which department | Staff + admins read; written only by `admin-api` (Phase 13) |
| `categories` | Complaint categories → each routed to one department | Signed-in users read; written only by `admin-api` (Phase 13) |
| `complaints` | Student complaints (**Phase 8**, see `COMPLAINTS_SETUP.md`) | Owner + admins read; created only by `complaint-api` |
| `ai_summaries`, `notifications` | **Structure only** (notifications are first used by Phase 8's confirmation) | Default-deny / recipient only |

Initial data (created by the seed, 7 + 7 rows):

| Category | Department |
|---|---|
| LMS Issues | ITSC Department |
| Computer Problems | Computer Technician Department |
| Water Cooler Issues | Water Cooler Maintenance |
| Clerk-Related Issues | Clerk Job Department |
| Cleaning Issues | Cleaning Department |
| Teacher-Related Complaints | Concerned Teacher Complaint Department |
| Student Affairs | Student Affairs Department |

Department contact emails are left **empty** – fill them in yourself (console, or `departments.update`).

## Before you start
- Phase 4: project, Web platform, database, `.env` filled in (`VITE_APPWRITE_DATABASE_ID` must be set).
- Phase 6: the `profile-api` function exists (you will redeploy it in step 3 below).
- You can sign in as an `admin`-labelled user.
- Run `npm install` once (this phase adds the `node-appwrite` dev dependency for the setup scripts).

---

## 1. Create the tables

### Option A – script (recommended)
1. Console → **Overview → API keys → Create API key** (name it e.g. `db-setup`). Grant the **database / table / column / index / row** scopes
   (names differ slightly between Appwrite versions: `databases`, `tables`, `columns`, `indexes`, `rows`, each read + write).
2. Preview, no network and no key needed:
   ```bash
   npm run db:setup -- --dry-run
   ```
3. Run it (the key goes in your shell only – never in `.env`):
   ```powershell
   # Windows PowerShell
   $env:APPWRITE_API_KEY="<your key>"; npm run db:setup
   ```
   ```bash
   # macOS / Linux
   APPWRITE_API_KEY=<your key> npm run db:setup
   ```
4. It creates each table, waits for its columns to become *Available*, builds the indexes, then seeds the 7 departments and 7 categories.
   It is safe to re-run: existing things are skipped, never modified or deleted. `--no-seed` skips the seed.
5. **Delete the API key** in the console when finished (or keep it only for later setup runs).

> The script was written against the documented node-appwrite TablesDB API but could **not** be run against a live Appwrite project while this phase was built. If a step fails, the message names the table/column; fix it in the console (Option B) and re-run – completed parts are skipped.

### Option B – console, by hand
For **each** table in `DATABASE_SCHEMA.md` (create `users` first):
1. Databases → your database → **Create table**. **Table ID must be exactly** the ID shown (e.g. `department_users`). Name: as shown.
2. Table **Settings → Permissions**: add exactly the listed permissions and nothing else.
   - `read("users")` = role **All users** · `label:admin` / `label:department` = role **Label** (type the label name).
   - “_none_” means add **no** table-level permission.
3. Table **Settings → Row security**: ON/OFF as listed.
4. **Columns**: create every column with the listed type, size, required flag, default, and (for enums) the elements in the same order.
   Mark **Array** only where listed. Wait until every column shows **Available**.
5. **Indexes** (only after the columns are Available): create each index with the listed key, type (Key / Unique) and column(s).
6. Seed data: create the rows listed above yourself (Row ID = the fixed IDs from `database/schema.js` → `DEPARTMENT_SEEDS`, `CATEGORY_SEEDS`), or run `npm run db:setup` once the tables exist – it skips everything that exists and only seeds.

## 2. Coming from Phase 6? Migrate `profiles` → `users`
The `users` table must exist first (step 1). Then:
```powershell
$env:APPWRITE_API_KEY="<key with rows.read + rows.write>"; npm run db:migrate-profiles
```
Rows keep the **same ID** (= account ID), so nobody is duplicated; running it twice changes nothing. Field mapping:
`status → accountStatus`, `department → academicDepartment` (students only), `accountCreatedAt → createdAt`.
The old `profiles` table is not touched – delete it yourself once the checks in step 5 pass. If you skip the migration, open
**Users → Sync accounts** in the app instead: it rebuilds every row from the Appwrite accounts (roll numbers/programs are only recovered from old account prefs).

## 3. Update and redeploy the `profile-api` function
The function now writes the `users` table and reads `department_users` / `departments`.
- Redeploy `functions/profile-api` (Console → Functions → profile-api → create a new deployment from the folder, or `appwrite push`).
- **Variables**: keep `APPWRITE_API_KEY` and `DATABASE_ID`. `PROFILES_TABLE_ID` is **no longer used**. Optional (defaults shown):
  `USERS_TABLE_ID=users`, `DEPARTMENTS_TABLE_ID=departments`, `DEPARTMENT_USERS_TABLE_ID=department_users`.
- The existing API key scopes (`users.read`, `users.write`, rows read/write) are enough.
- Behaviour changes you will notice: promoting someone to **department staff no longer asks for a department** (staff are assigned to service
  departments separately, step 4); only **students** have an academic department; demoting staff removes their assignments automatically.

## 4. Assigning staff to departments (no screen for this yet)
Phase 7 delivers the data layer and service functions only. Until the admin screens exist:
1. Make the person staff: Users page → Manage → role *Department Staff* (or add the `department` label in the console, then **Sync accounts**).
2. Create the assignment: console → table `department_users` → **Create row** → `userId` (their account ID), `departmentId` (e.g. `itsc`),
   `position` (e.g. `Head`), `createdAt` (now). A second row for the same person + department is refused by the unique index.
   In code (as an admin): `departmentUsers.assign({ userId, departmentId, position })` from `src/services/db/index.js`, which also checks the
   person really is active department staff and the department is active.

## 5. Verify against your real project
1. Console shows 7 tables; each table's **Settings → Permissions / Row security** match `DATABASE_SCHEMA.md`; every column is *Available*; every index exists.
2. `departments` has 7 rows and `categories` has 7 rows (IDs like `itsc`, `lms-issues`); each category's `departmentId` matches the table above.
3. Permissions spot-check: Console → `departments` → Settings shows `read: users`, `create`/`update: label:admin` and **no** `delete` for anyone; `users` shows no table-level permission and Row security ON. Signed in as a student, `/admin/users` is refused.
4. Sign in as the `admin` user, open **Users → Sync accounts**: every account has exactly **one** row in `users` (row ID = user ID). Run it again → “0 created”.
5. Try to create a second `users` row with an existing email or roll number in the console → Appwrite refuses it (unique index).
6. As a staff user with an assignment: `/department/profile` shows “Assigned department: ITSC Department (Head)”. Remove their staff role in Users → the row in `department_users` disappears.
7. `complaints`, `ai_summaries`, `notifications` stay empty. A student cannot read or create rows there (Console → Settings shows no client permissions).

---

## Design notes

**One user record per account.** `users` row ID = Appwrite account ID, plus unique indexes on `userId`, `email` and `rollNumber`.
Only the `profile-api` function writes it (never the browser), and it creates a row only for an authenticated account, so
a second record for the same person cannot be produced by the app. Role and status are mirrored from the account (labels / blocked flag), which stay the source of truth.

**Reference fields, not relationship columns.** `departmentId`, `userId`, `categoryId` … are indexed string columns holding the
referenced row's ID. Appwrite relationship columns embed related rows inside each other and make read permissions depend on both
tables; here `users` rows are private to their owner, so a relationship would either hide the data or force looser permissions.
Reference fields keep every query simple and every permission explicit. The price: **Appwrite does not enforce them**. The service functions check
references on write (department exists and is active, user is staff, …), nothing is hard-deleted (departments and categories are *deactivated*), and the
function removes assignments when someone leaves the staff role.

**Permissions.** Labels (`admin`, `department`) can only be set by the console or a server key, so table-level `label:*` permissions cannot be self-granted.
- `departments`, `categories`: any signed-in user reads (students need them for the complaint form); only admins create/update; **no one deletes**.
- `department_users`: staff and admins read, only admins write. Row-level “read your own row” is not used because a browser cannot grant row permissions to other users;
  the trade-off is that any staff member can list all assignments (names/IDs and positions only).
- `users`: owner + admins read, nobody writes from a browser.
- `complaints`, `ai_summaries`: only admins can read at table level; **nobody can create from a browser yet**. The complaint phase adds a server function that
  writes rows with exact row permissions (complainant, admins, and the handling department), the same pattern as `profile-api`.
- `notifications`: server creates each row with `read` + `update` for the recipient only (so a user can mark their own notification read). Appwrite cannot
  restrict *which columns* an owner edits, so a user could alter the text of their own notification; that affects only them.

**Complaint snapshot.** `complaints.departmentId` is a copy of the category's department at submission time, so editing a category later does not re-route old complaints.

## Known limitations
- The tests use an in-memory stand-in for Appwrite (built from the same schema). They prove the schema, indexes, permission matrix and service logic are
  consistent, **not** that your live project is configured identically – use step 5.
- Duplicate department/category names are checked case-insensitively in the service; the database's unique index may be case-sensitive, so create names
  through the services (or the future admin screen), not by hand in the console.
- Listing runs in pages of 100 and some admin lists read a whole (small) table into memory, capped at 5,000 rows – ample for a faculty.
- Staff cannot yet be assigned from a screen, and categories/departments cannot be managed from a screen: that UI is not part of this phase.
