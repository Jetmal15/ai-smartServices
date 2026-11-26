# Database schema (generated)

> Generated from `database/schema.js` by `npm run db:docs`. **Do not edit by hand** – edit the schema and regenerate.
> Setup steps: `docs/DATABASE_SETUP.md`.

Reference columns (`userId`, `departmentId`, …) store the `$id` of the referenced row. They are plain indexed string columns, not Appwrite relationship columns (see the design notes in the setup guide).

## Users — table ID `users`

One row per Appwrite account (row ID = the account ID). Mirrors name/email/role/status from Appwrite Auth; written only by the profile-api function. Replaces the Phase 6 `profiles` table.

- **Row security:** ON
- **Table permissions:** _none_ (no table-level permission)
- **Row permissions:** Set by profile-api when the row is created: read for the owner and for label:admin. Nobody gets update/delete.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `userId` | String (36) | yes | – | Appwrite account ID (same as the row ID). |
| `name` | String (128) | yes | – |  |
| `email` | String (320) | yes | – | Mirrors the account email. |
| `rollNumber` | String (20) | no | – | Students only. Empty (null) when unset. |
| `role` | Enum: `student`, `department`, `admin` | yes | – | Mirrors the account label (no label = student). |
| `academicDepartment` | String (100) | no | – | Students only: their academic program (an FET department). |
| `accountStatus` | Enum: `active`, `disabled` | yes | – |  |
| `createdAt` | Datetime | yes | – | When the account was created. |

| Index key | Type | Columns |
|---|---|---|
| `user_id_unique` | Unique | `userId` |
| `email_unique` | Unique | `email` |
| `roll_number_unique` | Unique | `rollNumber` |
| `role_idx` | Key | `role` |
| `account_status_idx` | Key | `accountStatus` |

## Departments — table ID `departments`

Service departments that receive complaints (ITSC, Cleaning, ...). Never deleted: set status to inactive instead. Every signed-in user may read; changes are made only by the admin-api function (Phase 13), which validates them and keeps an audit trail.

- **Row security:** OFF
- **Table permissions:** `read("users")`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | String (128) | yes | – |  |
| `description` | String (1000) | no | – |  |
| `email` | Email | no | – | Contact address for the department. Left empty in the seed data. |
| `status` | Enum: `active`, `inactive` | yes | – |  |
| `createdAt` | Datetime | yes | – |  |

| Index key | Type | Columns |
|---|---|---|
| `name_unique` | Unique | `name` |
| `status_idx` | Key | `status` |

## Department Users — table ID `department_users`

Assigns department staff (users with role `department`) to service departments. One row per (user, department) pair. Staff and administrators may read; changes are made only by the admin-api function (Phase 13).

- **Row security:** OFF
- **Table permissions:** `read("label:admin")`, `read("label:department")`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `userId` | String (36) | yes | – | References users.userId. |
| `departmentId` | String (36) | yes | – | References departments row ID. |
| `position` | String (100) | no | `Staff` | e.g. Head, Technician, Clerk. |
| `createdAt` | Datetime | yes | – |  |

| Index key | Type | Columns |
|---|---|---|
| `user_department_unique` | Unique | `userId`, `departmentId` |
| `department_idx` | Key | `departmentId` |
| `user_idx` | Key | `userId` |

## Categories — table ID `categories`

Complaint categories. Each category belongs to exactly one department, which is where its complaints are routed. Every signed-in user may read; changes are made only by the admin-api function (Phase 13).

- **Row security:** OFF
- **Table permissions:** `read("users")`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | String (128) | yes | – |  |
| `description` | String (1000) | no | – |  |
| `departmentId` | String (36) | yes | – | References departments row ID. |
| `status` | Enum: `active`, `inactive` | yes | – |  |

| Index key | Type | Columns |
|---|---|---|
| `name_unique` | Unique | `name` |
| `department_idx` | Key | `departmentId` |
| `status_idx` | Key | `status` |

## Complaints — table ID `complaints`

One row per student complaint. Rows are created and changed ONLY by the complaint-api function (API key), which takes the student, department, status and dates from the server, never from the browser. Row ID = reference number. Students and department staff never read this table directly: they use complaint-api, which returns only the fields they are allowed to see (so internal fields can never leak). Only administrators can read it directly.

- **Row security:** ON
- **Table permissions:** `read("label:admin")`
- **Row permissions:** Set by complaint-api: read for label:admin only (Phase 9; Phase 8 also granted the complainant read). Nobody gets update/delete from a browser.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `referenceNumber` | String (24) | yes | – | Unique complaint ID, e.g. CMP-20261122-K7M2QX. Same value as the row ID. |
| `studentId` | String (36) | yes | – | The authenticated complainant (users.userId), set by the server. |
| `studentName` | String (128) | yes | – | Snapshot at submission time. |
| `studentRollNumber` | String (20) | no | – | Snapshot at submission time. |
| `title` | String (200) | yes | – |  |
| `description` | String (5000) | yes | – |  |
| `location` | String (300) | no | – | Location or other relevant details. |
| `categoryId` | String (36) | yes | – | References categories row ID. |
| `categoryName` | String (128) | yes | – | Snapshot at submission time. |
| `departmentId` | String (36) | yes | – | The category’s department at submission time, looked up by the server. |
| `departmentName` | String (128) | yes | – | Snapshot at submission time. |
| `status` | Enum: `submitted`, `under_review`, `in_progress`, `resolved`, `closed` | yes | – | Always `submitted` on creation. |
| `priority` | Enum: `low`, `medium`, `high`, `urgent` | no | `medium` |  |
| `submittedAt` | Datetime | yes | – | Server time of submission. |
| `assignedTo` | String (36) | no | – | References users.userId (department staff handling it). Later phase. |
| `lastUpdatedBy` | String (36) | no | – | Staff user ID of the last status change or remark. Private: never sent to students. |
| `lastUpdatedByName` | String (128) | no | – | Name of that staff member at the time. |
| `lastUpdatedAt` | Datetime | no | – |  |
| `attachmentId` | String (36) | no | – | Appwrite Storage file ID in the complaint-attachments bucket. |
| `attachmentName` | String (255) | no | – | Taken from the stored file, not from the browser. |
| `attachmentMime` | String (100) | no | – |  |
| `attachmentSize` | Integer | no | – |  |
| `resolutionNote` | String (2000) | no | – |  |
| `resolvedAt` | Datetime | no | – |  |

| Index key | Type | Columns |
|---|---|---|
| `reference_number_unique` | Unique | `referenceNumber` |
| `student_idx` | Key | `studentId` |
| `department_status_idx` | Key | `departmentId`, `status` |
| `category_idx` | Key | `categoryId` |
| `status_idx` | Key | `status` |
| `assigned_to_idx` | Key | `assignedTo` |

## Complaint History — table ID `complaint_history`

Status timeline of each complaint: one row per status (the first is `submitted`, written when the complaint is created). Contains ONLY information a student may see (status, date, public remark) – internal notes live in complaint_notes. Written by complaint-api; read through complaint-api only.

- **Row security:** OFF
- **Table permissions:** `read("label:admin")`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `complaintId` | String (36) | yes | – | References complaints row ID. |
| `status` | Enum: `submitted`, `under_review`, `in_progress`, `resolved`, `closed` | yes | – | The status the complaint moved TO. |
| `previousStatus` | Enum: `submitted`, `under_review`, `in_progress`, `resolved`, `closed` | no | – |  |
| `kind` | Enum: `status`, `remark` | no | `status` | `status` = a status change; `remark` = a public remark without a status change. |
| `remark` | String (1000) | no | – | Public remark from the department, shown to the student. |
| `actorRole` | Enum: `system`, `department`, `admin` | yes | – | Who made the change. Shown to students only as “Department” / “System”. |
| `actorId` | String (36) | no | – | Staff user ID. Private: never sent to students. |
| `actorName` | String (128) | no | – | Staff name at the time. Private: shown to staff and administrators only. |
| `changedAt` | Datetime | yes | – |  |

| Index key | Type | Columns |
|---|---|---|
| `complaint_changed_idx` | Key | `complaintId`, `changedAt` |
| `actor_idx` | Key | `actorId` |

## Complaint Notes — table ID `complaint_notes`

INTERNAL department notes about a complaint (Phase 10). Never readable by students: no student-facing code reads this table and its permissions grant them nothing. Staff read and write them only through complaint-api, for complaints of their own department.

- **Row security:** OFF
- **Table permissions:** `read("label:admin")`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `complaintId` | String (36) | yes | – | References complaints row ID. |
| `authorId` | String (36) | yes | – | Staff user ID. |
| `authorName` | String (128) | no | – |  |
| `note` | String (2000) | yes | – |  |
| `createdAt` | Datetime | yes | – |  |

| Index key | Type | Columns |
|---|---|---|
| `complaint_idx` | Key | `complaintId` |
| `author_idx` | Key | `authorId` |

## AI Summaries — table ID `ai_summaries`

AI analysis of a complaint (Phase 11): short summary, SUGGESTED category, department and priority. One row per complaint (row ID = complaint ID; re-running updates it). Written only by the ai-analysis function; staff and administrators read it through complaint-api. Everything here is a suggestion: it never changes the complaint by itself. `source` says whether the AI provider or the rule-based fallback produced it.

- **Row security:** ON
- **Table permissions:** `read("label:admin")`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `complaintId` | String (36) | yes | – | References complaints row ID (also the row ID). |
| `status` | Enum: `pending`, `completed`, `failed` | yes | – | `pending` while running, `completed` when a result (AI or fallback) is stored, `failed` only for unexpected errors. |
| `source` | Enum: `ai`, `fallback` | no | – | `ai` = the configured AI provider; `fallback` = built-in keyword rules (used when the AI is unavailable, rate limited or returned something invalid). |
| `summary` | String (2000) | no | – | Short, clear summary (validated, max 400 characters). |
| `suggestedCategoryId` | String (36) | no | – | Suggested category (one of the active categories). References categories row ID. |
| `suggestedDepartmentId` | String (36) | no | – | The suggested category’s department. References departments row ID. |
| `priority` | Enum: `low`, `medium`, `high`, `urgent` | no | – | Suggested priority. |
| `sentiment` | Enum: `positive`, `neutral`, `negative` | no | – |  |
| `keywords` | String (50), **array** | no | – |  |
| `confidence` | Float (min 0, max 1) | no | – |  |
| `reason` | String (500) | no | – | Why this category/priority was suggested (validated, short). |
| `model` | String (100) | no | – | Provider/model that produced it, or `rule-based-fallback`. |
| `errorMessage` | String (500) | no | – | Why the AI was not used (fallback) or the analysis failed. Never contains secrets. |
| `attempts` | Integer | no | `0` | How many times analysis was run (limits re-runs). |
| `generatedAt` | Datetime | no | – |  |
| `reviewStatus` | Enum: `pending`, `accepted`, `dismissed` | no | `pending` | Whether a person has reviewed the suggestion. |
| `reviewedBy` | String (36) | no | – | Staff/admin user ID who reviewed. Private. |
| `reviewedByName` | String (128) | no | – |  |
| `reviewedAt` | Datetime | no | – |  |

| Index key | Type | Columns |
|---|---|---|
| `complaint_unique` | Unique | `complaintId` |
| `status_idx` | Key | `status` |

## Admin Audit — table ID `admin_audit`

Audit trail of sensitive administrator operations (Phase 13): creating accounts, role and status changes, department, category and staff-assignment changes. Written only by the server (admin-api, profile-api); only administrators can read it. Never contains passwords or other secrets.

- **Row security:** OFF
- **Table permissions:** `read("label:admin")`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `actorId` | String (36) | yes | – | The administrator who did it (taken from the verified login). |
| `actorName` | String (128) | no | – |  |
| `action` | String (64) | yes | – | e.g. department.create, user.setRole. |
| `targetType` | String (32) | yes | – | user, department, category or staff. |
| `targetId` | String (64) | no | – |  |
| `summary` | String (500) | yes | – | A short sentence describing the change. |
| `createdAt` | Datetime | yes | – |  |

| Index key | Type | Columns |
|---|---|---|
| `created_idx` | Key | `createdAt` |
| `actor_idx` | Key | `actorId` |

## Notifications — table ID `notifications`

In-app notifications (Phase 12). The row ID is the notificationId: a hash of the event, so the same event can never notify the same person twice. Created ONLY by complaint-api (API key). Each row is readable only by its recipient; nobody can update or delete it from a browser (marking as read goes through complaint-api, which changes nothing but isRead/readAt).

- **Row security:** ON
- **Table permissions:** _none_ (no table-level permission)
- **Row permissions:** Set by complaint-api when the row is created: read for the recipient only. No update, no delete.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `userId` | String (36) | yes | – | The recipient. References users.userId. |
| `type` | Enum: `complaint_submitted`, `complaint_assigned`, `status_changed`, `complaint_in_progress`, `complaint_resolved`, `complaint_closed`, `admin_update`, `system` | yes | – |  |
| `title` | String (200) | yes | – |  |
| `message` | String (1000) | yes | – |  |
| `relatedComplaintId` | String (36) | no | – | The complaint this is about, if any. References complaints row ID. |
| `isRead` | Boolean | no | `false` |  |
| `readAt` | Datetime | no | – |  |
| `createdAt` | Datetime | no | – | Server time the notification was created (always set; optional only so older rows can be upgraded). |

| Index key | Type | Columns |
|---|---|---|
| `user_read_idx` | Key | `userId`, `isRead` |
| `user_created_idx` | Key | `userId`, `createdAt` |
| `related_complaint_idx` | Key | `relatedComplaintId` |

## Storage bucket: Complaint attachments — bucket ID `complaint-attachments`

Optional evidence file (photo or PDF) for a complaint. Students upload; the complaint-api function verifies the file and then locks its permissions to read-only for the owner and administrators. Department staff download through the function only.

- **File security:** ON
- **Bucket permissions:** `create("users")`
- **Maximum file size:** 5242880 bytes (5 MB)
- **Allowed file extensions:** `jpg`, `jpeg`, `png`, `pdf`
- **Encryption:** ON · **Antivirus:** ON (if your Appwrite plan offers it) · **Compression:** none

