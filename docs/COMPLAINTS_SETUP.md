# Phase 8 – Student complaint submission: setup and security notes

> **Phase 9 update:** students no longer read complaint rows directly; rows are administrator-read only and students use `complaint-api` (see `docs/HISTORY_SETUP.md`). Where this page says the complainant can read the row, Phase 9 replaces that.

Nothing here is done for you. Complaints work only after you (1) update the database, (2) create the attachments bucket and
(3) deploy the new `complaint-api` function. Exact table columns: [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md).

## What the student sees
1. **Submit Complaint** (`/student/submit-complaint`): title, category, description, optional location/details, optional attachment (JPG, PNG or PDF, up to 5 MB).
2. The page validates the input, uploads the optional file, and asks `complaint-api` to create the complaint.
3. A confirmation shows the **complaint ID** (e.g. `CMP-20261122-K7M2QX`), the department it was sent to, status **Submitted** and the submission time. A notification row is also created for the student.
4. **My Complaints** lists their complaints (newest first, status filter); each opens a detail page with an attachment download.
5. **Department staff** see complaints for the departments they are assigned to at `/department/complaints` (read-only in this phase).

Statuses: **Submitted** → Under Review → In Progress → Resolved → Closed. Every new complaint starts as *Submitted*. Changing the status is a later phase.

## 1. Update the database (and create the bucket)
Phase 7 prepared an empty `complaints` table with the old statuses. Phase 8 changes its columns and statuses, so recreate it **while it is empty**:
1. Appwrite console → Databases → your database → table `complaints` → **Delete** it. *(Only if it has no rows. Nothing wrote to it before Phase 8.)*
2. Run the setup script, which creates the missing table **and the attachments bucket** (safe to re-run; `--no-seed` skips the seed):
   ```powershell
   $env:APPWRITE_API_KEY="<key>"; npm run db:setup -- --no-seed
   ```
   The key needs the previous scopes plus **buckets.read/write** (storage). It prints `⚠` lines if an existing table differs from the schema.
3. By hand instead (Option B): create the table as in `DATABASE_SCHEMA.md`, and **Storage → Create bucket** with ID `complaint-attachments`,
   **File security ON**, bucket permission **Create → Users**, maximum file size **5 MB**, allowed extensions `jpg, jpeg, png, pdf`, encryption on, antivirus on (if offered).
   Do **not** give the bucket read/update/delete permissions.

## 2. Deploy the `complaint-api` function
Console → Functions → **Create function** (same way as `profile-api`):
- **Function ID: `complaint-api`** (the app calls it by this ID). Runtime: Node.js (same version as `profile-api`). Source: `functions/complaint-api`, entrypoint `src/main.js`, build command `npm install`.
- **Execute access: Users** (any signed-in user). The handler itself rejects non-students for submitting and non-staff for the department list.
- **Variables**: `APPWRITE_API_KEY` and `DATABASE_ID` (required). A key with scopes: `users.read`, rows read + write, **files read + write**.
  Optional (defaults match the schema): `COMPLAINTS_TABLE_ID`, `USERS_TABLE_ID`, `DEPARTMENTS_TABLE_ID`, `CATEGORIES_TABLE_ID`, `DEPARTMENT_USERS_TABLE_ID`, `NOTIFICATIONS_TABLE_ID`, `ATTACHMENTS_BUCKET_ID`.
- Keep the API key only in the function's variables, never in `.env` or any `VITE_` variable.
- `profile-api` needs no change.

Prerequisites from earlier phases: the 7 departments and 7 categories are seeded, and the `users` table has a row for the student (it is created when they sign in).

## 3. Verify against your real project
1. As a **student**, open Submit Complaint: the category list shows exactly the 7 categories; choosing one shows “This will be sent to: …”.
2. Submit with empty fields → messages on title, category, description; nothing is created. Submit properly → confirmation with a complaint ID; the row appears in `complaints` with `status = submitted`, your user ID in `studentId`, the right `departmentId`, a `submittedAt` time.
3. Open the row’s **Settings → Permissions**: Phase 8 granted `read` to you and `label:admin`; from Phase 9 only `label:admin` – no update/delete either way.
4. Submit with a PNG/JPG/PDF: the file appears in the bucket and, after submitting, its permissions are `read` for you + `label:admin` only (no delete). Try a `.exe` or a 6 MB file: refused in the form, and the bucket refuses it too.
5. Sign in as a **second student**: My Complaints is empty; opening the first student’s detail URL shows “not found”.
6. Assign a staff member to the department (see `DATABASE_SETUP.md` step 4), sign in as them: `/department/complaints` lists that complaint, other departments’ complaints are absent, the attachment downloads. Staff of another department see nothing.
7. As an **admin**, the console shows all complaints. Submit the same complaint twice quickly: only one is created (“We already have this complaint”). Submit 6 different complaints within 10 minutes: the 6th is refused.

## What is decided where
| Thing | Decided by | Browser may influence it? |
|---|---|---|
| Who the student is (`studentId`, name, roll no.) | `complaint-api`, from the verified login and the `users` row | No |
| Department | `complaint-api`: category → department, looked up in the database (both must be active) | No – only the category choice |
| Status, priority, submission time | `complaint-api` | No |
| Complaint ID | `complaint-api` (random suffix + unique row ID, retried on clash) | No |
| Who can read the complaint | Administrators directly; students and staff only through the function (students: own complaints; staff: their departments’), which returns whitelisted fields | No |
| Attachment name / size / type | Read from the stored file by the function | No |
| Title, description, location, category choice, file | The student | Yes – validated and cleaned on the server |

Everything the browser sends other than those five fields (e.g. `studentId`, `departmentId`, `status`) is ignored; tests prove it.

## Protecting complaint information
- Complaint rows are readable directly only by administrators (Phase 9); students read their own through the function. No browser can create, change or delete them (the table grants clients no write permission).
- Department staff cannot read the table directly: the function returns only complaints of departments they are assigned to, and answers “not found” for everything else.
- Attachments: the bucket enforces type and size; the function re-checks the stored file (size, extension, and the content type Appwrite detects, so a renamed `.exe` fails), accepts only a file uploaded by the same student and not attached before, then locks it to read-only. It is downloaded through the function, which applies the same visibility rules.
- Text is stored as plain text and shown escaped (React), so markup typed into a complaint cannot run.
- Error messages are friendly and generic; details go to the function log, not the browser.

## Known limitations (be aware)
- **Not run against a live Appwrite project.** The tests use an in-memory stand-in built from the schema; `functions/complaint-api/src/main.js` (the SDK wiring) and the Storage upload/download calls were not executed. Use the checklist above.
- Attachment download goes through the function as base64 (a 5 MB file ≈ 6.7 MB). If your Appwrite plan limits function response size below that, lower `maxBytes` in `database/schema.js` and `functions/complaint-api/src/handler.js` (a test keeps them equal) and the bucket limit together.
- A file uploaded but never attached (student closes the tab) stays in the bucket owned by that student; the form deletes it on a failed submit, but a closed tab cannot. Clean up occasionally in the console.
- Antivirus scanning depends on your Appwrite deployment offering it.
- Duplicate protection and the spam limit look at the student’s 25 most recent complaints; they are a safety net, not a security boundary.
- Not in this phase: changing statuses, assigning staff to complaints, replies, AI analysis, an administrator complaints screen (admins can read all rows through `services/db` → `complaints.list`).
