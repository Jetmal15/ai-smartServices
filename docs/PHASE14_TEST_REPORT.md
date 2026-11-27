# Phase 14 – Security audit and integration test report

Project: AI SmartServices · Scope: Phase 14 only · Run the tests with `npm run test:phase14` (everything: `npm test`).

## 1. Result at a glance

| Suite | Tests | Passed | Failed |
|---|---:|---:|---:|
| Phases 6–13 (existing, updated for the merged `complaint-api`) | 205 | 205 | 0 |
| **Phase 14 – authentication and roles** (`tests/phase14/auth.test.mjs`) | 17 | 17 | 0 |
| **Phase 14 – complaints, AI, notifications** (`tests/phase14/flows.test.mjs`) | 15 | 15 | 0 |
| **Phase 14 – security audit** (`tests/phase14/security.test.mjs`) | 31 | 31 | 0 |
| **Total** | **268** | **268** | **0** |

Code quality: see section 6. **`npm run lint` and `npm run build` could not be run in the environment where this phase was prepared (no network, and the shipped `node_modules` only contained Windows binaries). Run both on your machine before approving.** Substitute checks that were run are listed there.

## 2. How the integration tests work

The Phase 14 tests do not test pieces in isolation. They run the **real browser services** (`authService`, `profileService`, `complaintService`, `notificationService`, `adminService`) through the **real Appwrite web SDK** into an in-process stand-in for the Appwrite HTTP API (`tests/support/fake-appwrite-http.mjs`), which calls the **real `profile-api` and `complaint-api` handlers** on a **schema-driven fake database** that enforces the table/row permissions from `database/schema.js`.

`service → Appwrite SDK → fetch → gateway → function handler → fake database`

The gateway models accounts, sessions (stored in the browser's localStorage like the real SDK), blocked accounts, single-use password-recovery tokens, Storage uploads with content-based MIME detection, and function executions (the gateway, not the browser, adds `x-appwrite-user-id` / `x-appwrite-user-jwt`, as Appwrite does). Each simulated person has their own browser (own session).

## 3. Coverage of the requested areas

**Authentication** (`auth.test.mjs`): student registration (normalisation, validation, duplicate e-mail, duplicate roll number, no role label ever set); login for all three roles; identical message for a wrong password and an unknown e-mail; disabled account refused; session persists across reloads and is not shared between browsers; revoked session = clean logout; logout (and logging out twice); logout of one person does not affect another; password recovery (link points at this app, single use, unknown e-mail looks identical and sends nothing, wrong token/user cannot reset anyone, reset signs out other devices); unauthorized access (a guest is refused by 14 different actions with 401).

**Role-based access** (`auth.test.mjs`, `security.test.mjs`): a student cannot reach any staff or admin action and cannot promote themselves (the server refuses requests that carry `role`, `labels`, `accountStatus` or `userId`); department staff cannot reach admin actions; role comes only from server-set labels; a demoted or disabled staff member loses access immediately; administrators cannot demote or disable themselves.

**Complaints** (`flows.test.mjs`): submit (with file), routing by category, duplicate-submit protection, field validation, history with search/filter/paging, tracking timeline, status updates along legal transitions only (illegal jump → 409, stale screen → 409, remark required to resolve), department assignment and reassignment (old department loses access, new one gains it), privacy (another student gets the same 404 for "not yours" and "does not exist").

**AI** (`flows.test.mjs`, `security.test.mjs`): summary, category suggestion, department suggestion and priority are produced and stored; the AI changes nothing by itself (category, department, status and priority stay until a person applies them); failure handling for HTTP 500, 429, invalid JSON, network error and out-of-range output → rule-based fallback, the complaint is still saved and staff still get a suggestion, confidence is clamped; phone numbers and e-mails are removed before the provider sees the text; only staff of that complaint and admins can run/review/apply it; the provider key never appears in responses, stored results or logs.

**Notifications** (`flows.test.mjs`): generated on submit (student + exactly that department's staff), on status change and on remarks; unread count; mark one (idempotent) and mark all; user-specific access (nobody can read, mark or enumerate another user's notifications; browsers cannot create/update/delete any); announcements are admin-only, recipients chosen by the server, repeats are not delivered twice, and are audited.

## 4. Security audit (`security.test.mjs`)

| Area | What was attacked | Result |
|---|---|---|
| Appwrite permissions | create/update/delete on **every table** as guest, student, other student, staff, admin | All refused – the browser can never write |
| | Table/bucket permission grants | Nothing public; no table-level writes; only `departments` and `categories` are readable by every signed-in user |
| | Reads per role | Users see only their own row; complaints, history, notes, AI results and audit log are admin-only for direct reads; notifications own-only, not even admins read others' |
| | Permissions on every row the functions create | Only `read(user:<id>)` / `read(label:…)` – no row is public or owner-writable |
| Backend authorization | **Every** complaint-api action × {guest, user id without JWT, forged identity, invalid JWT} | 401 for all (all 30 actions × 4 attacks) |
| | Students/staff vs staff-only and admin-only actions | 403, and the refusal leaks nothing |
| | profile-api admin actions | 401/403 for non-admins |
| Input validation | Wrong types (null, arrays, objects, `$gt`), 10 000-char strings, SQL/NoSQL/XSS/template/path strings in every field | Never a 500; stored values are strings; control characters stripped |
| | Search/filter/paging abuse (negative, huge, non-numeric, objects) | Never a 500; results capped |
| | Oversized / malformed bodies | 413 / 400 |
| | Rendering | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere in `src/` |
| File upload | Browser rules | Only JPG/PNG/PDF ≤ 5 MB; `.exe`, `.svg`, `.html`, `.php`, `a.png.exe`, empty files, oversize rejected |
| | Server re-check of the stored file | An `.exe` renamed `.png` and a PNG renamed `.pdf` are rejected **and deleted from storage** |
| | Misuse of file IDs | Another user's file, an already-attached file, invented/path-like IDs all rejected |
| | File names / downloads | Names sanitised; downloads only for owner, that department, and admins |
| Secrets | Whole repository scanned for Appwrite/OpenAI/Anthropic/Google/Groq keys, private keys, bearer tokens, hard-coded key assignments | None found |
| | `.env` handling | `.env` git-ignored; only 3 public `VITE_` settings; `.env.example` has no values |
| | Browser code and the shipped `dist/` bundle | No server key names, provider URLs or `node-appwrite` import |
| | Key leakage at runtime | The AI key is sent only to the provider; never in responses, stored data or logs |
| Protected routes | `AppRoutes` | Exactly 3 `ProtectedRoute` areas, one per role; no private path in the public section; nothing renders while the session loads; prefix look-alikes (`/studentx`) do not match |
| Cross-user | Students trying 9 actions + widening filters (`studentId`, `departmentId`, search) on someone else's complaint | 403/404, no leak, nothing changed |
| | Student views | Explicit whitelist – no priority, student ID, notes, AI data, staff names |
| Cross-department | Staff of department A vs department B's complaint through 8 actions, list filters, statistics | 404 / not visible; access ends the moment the assignment is removed |
| Abuse and errors | Submission flood | 429 after 5 in 10 minutes |
| | Unexpected server failure | Generic 500 – no stack trace, host, path or secret in the body |
| | Probing for existing IDs | "Not yours" and "does not exist" give byte-identical answers |

## 5. Defects found and fixed during this phase

| # | Severity | Problem | Fix |
|---|---|---|---|
| 1 | **High (functional)** | The Phase 12 notification actions (`notification.markRead`, `markAllRead`, `announce`) did not exist in the merged `complaint-api`, so the bell's "mark as read" and the announcement form failed. | Implemented in `handler.js`; own-notification only, admin-only announcements with server-chosen recipients, de-duplication and audit entry. |
| 2 | **High (functional)** | Notifications were written with a wrong field (`complaintId`, schema has `relatedComplaintId`), no `createdAt`, and the recipient was given *update* permission. Errors were swallowed, so most notifications were never created. | The handler now uses `notifications.js` (hash row IDs → no duplicates, read-only permission for the recipient, correct fields). |
| 3 | High (functional) | `main.js` lacked the dependencies `notifications.js` needs (`get/update/listUnread/countUnread`, `userRows.listIdsByRole`, `assignments.listUsersOfDepartment`). | Added. |
| 4 | Medium | Admin complaint list showed a blank reference number (`referenceNumber` vs `reference`). | List view returns both. |
| 5 | Low | `complaintService.adminListComplaints` called a non-existent action (dead code). | Removed. |
| 6 | Low | Admin search limit 120 vs 100 everywhere else. | Aligned to the schema value. |
| 7 | Medium | An array such as `["complaint.get"]` was accepted as an action name (coerced with `String()`). | Action must be a string (complaint-api and profile-api). |
| 8 | Medium | No request-body size limit. | 64 KB cap → `413 payload_too_large` in both functions. |
| 9 | Low | Attachment display names kept `<`, `>`, `:`, `..` and leading dots. | Names are sanitised. |
| 10 | Maintenance | The merge of `ai-analysis`/`admin-api` into `complaint-api` broke the tests of phases 8–13 (they imported the removed folders). | Tests and fake backends updated to the merged structure; `department.list` now documented and tested as role-routed (admins get the department catalogue, never the staff complaint list). |
| 11 | Maintenance | Debug `console.log`, commented-out code and stale references to `ai-analysis` / `admin-api` in code, comments, docs and README. | Removed/updated; `docs/DATABASE_SCHEMA.md` regenerated. |

Note: when an upload is rejected by the server the browser service deletes the file from storage; this already worked, and it is now asserted by a test (the test gateway gained a delete route).

## 6. Code quality

| Check | Status |
|---|---|
| `npm run lint` (oxlint) | **NOT RUN here.** Needs the Linux oxlint binary; the shipped `node_modules` contained only Windows bindings and there was no network. |
| `npm run build` (vite) | **NOT RUN here**, same reason. |
| Substitute 1 – `tsc` (unused and undefined symbols) over `src/`, `functions/`, `scripts/`, `database/`, `tests/` | 0 findings after fixes (3 unused variables in tests were found and removed). |
| Substitute 2 – `esbuild` bundle of `src/main.jsx` (full import graph, JSX compile) | Succeeds, no unresolved imports (≈ 638 KB minified, before Tailwind CSS). |
| `react/only-export-components` pattern scan | No `.jsx` file mixes component and non-component exports. |
| `react/rules-of-hooks` | Not independently checked – covered only by `npm run lint`. |

No working functionality was removed to hide an error. The only deletions are dead code (item 5) and comments.

## 7. Remaining limitations and things to verify on your side

1. **Run `npm install`, `npm run lint` and `npm run build`** and send me any output; I could not verify them here.
2. **The gateway is a model of Appwrite, not Appwrite.** Not tested: the real permission engine, platform rate limits, real e-mail delivery, real antivirus/MIME detection, real function runtime headers, JWT expiry, CORS/platform allow-list. Do the manual checklist below on the real project.
3. **No browser UI tests were run.** React components, form behaviour and the redirects in `ProtectedRoute` were verified by reading the code and by testing the logic they use, not by driving a browser (`tests/phase5` and `tests/phase6` Playwright scripts need a browser and were not run).
4. **AI quality is not tested** – the provider is faked. Failure handling and data hygiene are tested; answer quality needs a real key and real complaints.
5. **Deploy order matters.** Redeploy `profile-api` and `complaint-api`. If you never ran the Phase 12 migration, run `npm run db:setup -- --no-seed` so `notifications.relatedComplaintId`, `createdAt` and `readAt` exist; otherwise notification writes will still fail. `complaint-api` needs `COMPLAINT_API_FUNCTION_ID`, `INTERNAL_AI_SECRET`, the AI provider variables, and execute permission on itself (the AI analysis re-invokes it).
6. **The attachments bucket creation in `scripts/setup-database.mjs` is commented out.** Confirm in the console that bucket `complaint-attachments` exists with: file security on, create = users, max 5 MB, extensions jpg/jpeg/png/pdf, antivirus and encryption on.
7. **Low-severity design notes (not changed):** (a) every user with the `department` label can read all `department_users` rows (user ID and position, no names) – tightening needs a permission change in the console; (b) rate limiting exists only for complaint submission – other actions rely on Appwrite's platform limits; (c) password policy is length ≥ 8 only – enable Appwrite's password dictionary/history in the console; (d) e-mail verification is not implemented; (e) registration reveals that an e-mail is already registered (unavoidable for sign-up; login and password recovery do not reveal it).
8. **Stale artefacts:** `functions.zip` still contains an old `complaint-api` and an `admin-api` folder – do not deploy it. `complaint-api.tar.gz` has been rebuilt from the current source.
9. `npm audit` (dependency vulnerabilities) was not run (no network).
10. The student dashboard is still the mock `DashboardPreview` (not a security issue; it shows sample numbers).

## 8. Manual checklist on the real Appwrite project (≈ 20 minutes)

- Register a student; confirm no label is set on the account. Log out and in; reload and stay signed in.
- Use "Forgot password" with a real e-mail; open the link twice (second must fail).
- As a student, open another student's complaint URL (404) and `/admin/dashboard` (redirected).
- Try uploading `.exe`, a renamed `.exe`, and a 6 MB PDF.
- Submit a complaint; check the department staff member sees it and the student gets a bell notification; mark it read.
- As admin, send an announcement twice quickly (second must not duplicate).
- In the console, open the `notifications` table: a row should have only `read("user:<id>")`.
- Set the AI key to a wrong value: submit a complaint; staff must still see a (fallback) suggestion.
