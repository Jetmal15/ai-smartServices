# Appwrite manual setup (Phase 4)

Nothing below has been done for you – these are dashboard steps you perform yourself.

## 1. Create the project
1. Sign in at https://cloud.appwrite.io (or open your self-hosted console).
2. **Create project** → name it (e.g. `AI SmartServices`) → choose the region closest to you.

## 2. Add your development platform
1. Open the project → **Overview** → **Add platform** → **Web**.
2. Hostname: `localhost` (hostname only – no `http://`, no port).
3. Later, add your deployed domain the same way.
Without a registered Web platform, browser requests are rejected (CORS / "Invalid Origin").

## 3. Get Project ID and endpoint
- **Settings** (project) shows the **Project ID** and the **API Endpoint**
  (Cloud format: `https://<REGION>.cloud.appwrite.io/v1`). Copy both exactly.

## 4. Create a database
1. **Databases** → **Create database** → name it (e.g. `smartservices`).
2. Copy the **Database ID** from the database's Settings tab (you may set a custom ID at creation).
3. Tables are created in a later phase.

## 5. Configure environment variables
```bash
cp .env.example .env
```
Fill in `VITE_APPWRITE_ENDPOINT`, `VITE_APPWRITE_PROJECT_ID`, `VITE_APPWRITE_DATABASE_ID`, then restart `npm run dev`.

## 6. Test the connection
```bash
npm run appwrite:check
```
Success = endpoint reachable and project ID accepted. Ping cannot validate the Database ID; that
is confirmed by the first real table read in a later phase. The script runs in Node, so it does
not test the Web-platform/CORS registration – confirm that from the browser later.

## Security
- Only `VITE_*` values reach the browser and they are public. Never put an API key in `.env`'s VITE_ vars.
- Server API keys are for backends / Appwrite Functions only.
- `.env` is git-ignored; commit only `.env.example`.

---

# Phase 5 – Authentication setup (manual)

None of this has been done for you.

## A. Email/Password auth
Console → **Auth → Settings** → make sure **Email/Password** is enabled.
Review **Session length** and **Limit sessions per user** here if you want to change them.

## B. Register every origin that will use the app
Console → **Overview → Platforms → Web**. Add `localhost` for development and your production domain later.
The password-recovery link is built from `window.location.origin`, and Appwrite only accepts redirect
URLs on registered platforms – otherwise "Forgot password" fails.

## C. Password-recovery email
Appwrite Cloud sends recovery emails with its default sender. For reliable delivery (and a custom
sender/template) configure SMTP under **Settings → SMTP**. Template: **Auth → Templates → Password recovery**.

## D. Create department staff and administrators (never via public sign-up)
1. Console → **Auth → Users → Create user** (email, password, name).
2. Open the user → **Labels** → add exactly `department` or `admin` → save.
No label means student. Labels cannot be changed by the user from the browser, which is why the app
reads the role from labels and not from prefs.
(Optional) add `department` to the staff user's **Preferences** as a display value, e.g. `{"department":"Software Engineering"}`.

## E. Manual test checklist against your real project
1. Register a student → lands on /student/dashboard; Auth → Users shows the new user with no labels.
2. Log out, log back in; reload the page while logged in (session persists).
3. Log in as your `admin`-labelled user → /admin/dashboard; `department` user → /department/dashboard.
4. Forgot password → email arrives → link opens /reset-password → new password works.
5. Console → Users → open a user → **Sessions** → delete the session, then refocus the app tab:
   you are sent to /login with "Your session has expired".

## Known limitations (by design for this phase)
- **Roll number and department live in account prefs.** Prefs are editable by the user themself, so
  they are display data only – never use them for authorization – and Appwrite cannot enforce a
  *unique* roll number there. A `students` TablesDB table with a unique index (written by a server
  function) is the proper fix and belongs with the database phase.
- **No roll-number login.** Email + password only, as specified. Roll-number login would need a
  server-side Appwrite Function (API key stays on the server, rate-limited, returning no data about
  whether a roll number exists); nothing like that is exposed to the frontend.
- **No email verification** is required to log in yet.
- Role checks in the UI are for navigation only. Real enforcement must be Appwrite table/row
  permissions in later phases.

---

# Phase 6 – Profiles and role-based access (manual)

> **Updated in Phase 7:** the `profiles` table described below is replaced by the `users` table (same rows, new column names) and
> staff are assigned to service departments in `department_users`. Follow **`docs/DATABASE_SETUP.md`** for tables, the function's
> environment variables (`PROFILES_TABLE_ID` is no longer used) and the migration. Sections A and the `PROFILES_TABLE_ID` line below are
> kept only as history. Everything about labels, the function's trust model and the Phase 6 checks still applies.

None of this has been done for you. Do the steps in order.

## How enforcement works
- **Role** = Appwrite label on the account (`admin` / `department`; none = student). Only the console or a server API key can set labels.
- **`profiles` table**: browsers get **no** create/update/delete permission. Each row is readable only by its owner and by `label:admin`.
- **`profile-api` function** (runs with an API key): the only code that writes profiles or changes labels. It re-reads the caller's labels on every request, so a demoted user loses admin rights immediately, regardless of what the frontend shows.
- Frontend role checks only decide navigation and what to display.

## A. Create the `profiles` table
Console → Databases → your database → **Create table**.
- Table ID: `profiles` (exactly)
- **Table permissions: leave empty** (add none)
- **Row security: ON**

Columns (create all, then wait until each shows *Available*):

| Key | Type | Size / values | Required |
|---|---|---|---|
| `userId` | String | 36 | yes |
| `name` | String | 128 | yes |
| `email` | String | 320 | yes |
| `role` | Enum | `student`, `department`, `admin` | yes |
| `status` | Enum | `active`, `disabled` | yes |
| `rollNumber` | String | 20 | no (no default) |
| `department` | String | 100 | no |
| `accountCreatedAt` | Datetime | – | no |

Index (after the columns are available): **Unique** index named `roll_number_unique` on `rollNumber`. Roll numbers are left empty (null) when unset, so many rows may have none.

## B. Create the function
Console → Functions → **Create function** → Node.js (20 or newer).
- Function ID: `profile-api` (exactly)
- Source: this repo's `functions/profile-api` folder (root directory `functions/profile-api`, entrypoint `src/main.js`, build command `npm install`). With the CLI: deploy that folder.
- **Settings → Execute access: `Users`** (any signed-in user). Do NOT choose Any/Guests.
- **Settings → Variables**:
  - `APPWRITE_API_KEY` – create under Overview → API keys with scopes: `users.read`, `users.write`, and read/write for database rows (shown as `rows.read`/`rows.write`, or "documents" in some versions). This key lives only in the function, never in `.env`.
  - `DATABASE_ID` – same value as `VITE_APPWRITE_DATABASE_ID`.
  - `PROFILES_TABLE_ID` – optional; defaults to `profiles`.
- Deploy, wait for *Ready*.

## C. First run
1. Make sure you have an admin: Console → Auth → Users → open your account → Labels → add `admin`.
2. Sign in to the app, open **Users** (`/admin/users`) → **Sync accounts**. This creates profile rows for accounts that already exist (Phase 5 students keep their roll number/department; they are copied from old prefs once, validated). Run it again any time you edit labels in the console.
3. To create department staff: Console → Auth → Users → create the user → label `department`. Then an admin opens Users → Manage → choose the assigned department. (Once the staff user exists, admins can also promote any student from the Users page.)

## D. Manual checks against your real project
1. Register a student → lands on `/student/dashboard`; Console → table `profiles` shows a row whose ID = the user's ID, with the row's permissions listing only that user and `label:admin`.
2. Student: `/student/profile` shows name, roll number, email, program, created date. Edit name/program → saved; roll number is locked.
3. Student tries `/admin/dashboard`, `/admin/users`, `/department/dashboard` → sent back with an access notice.
4. Student B and Student A: A cannot see B's data anywhere. In the browser console the table is not reachable without the function (the table has no client permissions beyond reading one's own row).
5. Department user: `/department/profile` shows assigned department, role and status; can edit only the name. `/admin/*` is refused.
6. Admin: `/admin/users` lists everyone; promote a student to staff (choose a department) → the user's label in Console → Auth shows `department`; the open browser of that user is moved to the staff area within ~15 s of focusing the tab.
7. Admin's own row has a disabled **Manage** button; calling the function to change your own role returns "You cannot change your own role".
8. Disable a student → they cannot log in; re-enable → they can.
9. Function logs (Console → Functions → profile-api → Executions) show no stack traces for the steps above.

## Known limitations (by design for this phase)
- **Roll numbers are not verified** against a registrar list. The first student to claim a roll number gets it (unique index prevents duplicates); a wrong one can be corrected by an admin through the function's `admin.updateAccount` action; the Users page dialog does not expose roll-number editing yet.
- **Email** can still be changed by a user through the Appwrite Account API (their sign-in identity); the profile mirrors it on the next sync. Name changes made that way are mirrored too.
- Role changes are effective for Appwrite permissions immediately; an *open* browser tab updates on its next focus/5-minute check.
- Two admins demoting each other at the same instant could leave zero admins (not atomic). Recover by adding the `admin` label in the console.
- Listing runs in memory (capped at 5,000 profiles) – ample for a faculty, revisit if it grows.
- Only students/staff/admin roles exist; staff cannot yet view student profiles (a later phase will define what complaint-related data they may see).
