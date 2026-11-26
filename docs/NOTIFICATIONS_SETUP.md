# Phase 12 – Notification system: setup, behaviour and security notes

Nothing here is done for you. Do steps 1–3, then the checklist. Exact columns: [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md).

## What users get
- A **bell** in the top bar of every dashboard with the **unread count**, a **dropdown** with the latest notifications, **Mark all as read**, and a link to the full page. The count refreshes by itself every 30 seconds while the tab is visible (and when you return to the tab).
- A **Notifications page** per role (`/student/notifications`, `/department/notifications`, `/admin/notifications`): list (newest first), **All / Unread** tabs, paging, **Mark as read** per item, **Mark all as read**, loading and empty states.
- A **notification details page**: full message, the time ("5 minutes ago" with the exact date/time on hover and in the details), the type, read status, and a **View complaint** button. Opening an unread notification marks it as read.
- Administrators also get **Send an important update** on their Notifications page.

## Who is notified, and when
| Event | Recipient | Type |
|---|---|---|
| 1. A student submits a complaint | the student | `complaint_submitted` |
| 2. A complaint is assigned to a department (on submission, or when an administrator moves it) | the staff assigned to that department | `complaint_assigned` |
| 3. Staff update the status, or add a public remark | the student | `status_changed` |
| 4. A complaint moves to In Progress | the student | `complaint_in_progress` |
| 5. A complaint is resolved | the student | `complaint_resolved` |
| 6. A complaint is closed | the student | `complaint_closed` |
| 7. An administrator makes an important update: moves a complaint (the old department's staff are told it left), or sends an announcement to all students / all staff / one department's staff / one complaint's student | as described | `admin_update` (and `complaint_assigned` for the student and the new department) |

Internal notes never notify anyone. Notification text contains no student name or roll number.

## 1. Update the database (existing tables)
```powershell
$env:APPWRITE_API_KEY="<key>"; npm run db:setup -- --no-seed
```
Adds the new `notifications` columns `relatedComplaintId` and `createdAt` and two new indexes. It prints `⚠` lines for things you change by hand in the console:
- **`notifications.type`** (enum) must allow the new values `complaint_in_progress`, `complaint_closed`, `admin_update` (Databases → table → column → edit the elements).
- The old **`complaintId`** column and its index are no longer used. They are harmless; delete them once step 2 is done.

## 2. Upgrade existing notifications (only if you already have some)
```powershell
$env:APPWRITE_API_KEY="<key>"; npm run db:migrate-notifications
```
Copies `complaintId` → `relatedComplaintId`, fills `createdAt` from each row's creation time, and makes every row **read-only for its recipient** (before, the owner could edit their own rows). Safe to repeat.

## 3. Redeploy `complaint-api`
Redeploy `functions/complaint-api` (same function ID; no new variables or scopes). All notification creation, "mark as read" and announcements run inside it.

## Verify against your real project
1. Submit a complaint as a student: the student's bell shows **1**; staff assigned to that department see **1** too ("New complaint for your department"); staff of other departments and other students see none.
2. Open the dropdown: the item shows the title, a two-line message, a tag and "x minutes ago". Click it: the details page opens and the unread count drops. Hover over the time: the exact date and time appear.
3. As staff, move the complaint to Under Review → In Progress → Resolved → Closed (and add a remark): the student gets one notification per step, with the type tag changing (Update, In progress, Resolved, Closed). The unread number grows by one each time.
4. **Mark all as read** (dropdown and page) sets everything to read; an empty list shows "You have no notifications yet".
5. As an administrator open **Notifications → Send an important update**, send to *All students*: every active student gets an "Important" notification. Send the identical text again within five minutes: "had already received it", no second notification. As a student or staff user the form is not shown (and the server refuses the request).
6. In the Appwrite console open a notification row: **Permissions** show only `read` for that one user. A user cannot open another user's notification by URL ("Notification not found").
7. As an administrator, move a complaint to another department (Admin → Complaints → open it → AI panel or the move action): the student, the new department's staff and the old department's staff each get their notification.

## How it is secured
- **Notifications are created only by the server** (`complaint-api` with the API key). The `notifications` table grants browsers nothing; each row is readable by its recipient only, so a user can list and open only their own, and not even administrators can read other people's.
- **Nobody can edit or delete a notification from a browser**, including the owner. "Mark as read" goes through the server, which checks the notification belongs to the caller (otherwise "not found") and changes nothing but `isRead` and `readAt`; title, message and recipient cannot be altered. "Mark all as read" touches only the caller's own unread notifications (200 per call; the app repeats until none are left).
- **Duplicates are impossible by construction.** The row ID (`notificationId`) is a hash of the event (what happened, to which complaint, for whom, and when). Appwrite refuses a second row with the same ID, so a retried or double-clicked action cannot notify the same person twice. A genuinely new event (for example a complaint re-opened and resolved again) has a different key and notifies again. Announcements sent twice within five minutes are the same announcement.
- **A failed notification never blocks the real work**: the complaint, the status change or the announcement already succeeded; the failure is logged on the server.
- **Announcements are administrator-only**, validated (title 3–120, message 3–1000 characters, real words), and the recipients (all active students, all active staff, a department's staff, or one complaint's student) are worked out on the server, never sent by the browser (at most 5,000 people per announcement).

## Known limitations
- **Not run against a live Appwrite project.** Tests use an in-memory stand-in built from the schema; the SDK wiring in `functions/complaint-api/src/main.js` and the React screens were not executed here. Use the checklist above.
- The bell refreshes every 30 seconds rather than instantly (no real-time push). Opening the dropdown refreshes it immediately.
- No e-mail, SMS or push notifications and no per-user settings; in-app only.
- Staff are told when a complaint is assigned to their department, not about colleagues' later updates.
- An announcement cannot be recalled once sent. Notifications are never deleted automatically; old ones simply scroll down the list.
