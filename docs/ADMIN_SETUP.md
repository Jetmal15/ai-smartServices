# Phase 13 – Administrator Dashboard: Setup, Behaviour and Security Notes

Nothing here is automatically done for you. Follow Steps 1–4, then complete the verification checklist.

**Important architecture decision:** Do not create a separate `admin-api` Appwrite Function. All administrator dashboard operations will be integrated into the existing `complaint-api`. Account provisioning and account-level role management will remain in `profile-api`.

Exact database columns: `DATABASE_SCHEMA.md`.

## What administrators get

### 1. Dashboard (`/admin/dashboard`)

Display:
- Total complaints.
- Pending complaints (Submitted + Under Review).
- In Progress, Resolved and Closed complaints.
- Total students.
- Department staff.
- Total departments and active departments.
- Most recent administrator activity.

### 2. Users (`/admin/users`)

Administrators can:
- View, search and filter users by role.
- Activate and deactivate accounts.
- Change existing user roles.
- Add department staff or administrators.
- Generate a random temporary password for newly created accounts.
- Display the temporary password only once.
- Optionally assign newly created staff to a department.

**Account operations remain in `profile-api`.** The administrator interface must not create or modify Appwrite accounts directly.

### 3. Departments

Administrators can:
- View departments with staff and category counts.
- Add departments.
- Edit department details.
- Activate and deactivate departments.
- Assign staff to departments.
- Set or change staff positions.
- Remove staff assignments.

### 4. Categories

Administrators can:
- View categories.
- Add categories.
- Edit categories.
- Connect categories to departments.
- Move categories between departments.
- Activate and deactivate categories.

### 5. Complaints

Administrators can:
- View all complaints.
- Search by complaint ID, title, student, roll number, category and details.
- Filter by status, department and category.
- Sort and paginate results.
- Open complaint details.
- View complaint history and AI analysis.
- Reassign complaints to another category or department with confirmation.

Complaint operations remain inside `complaint-api`.

### 6. Reports

Display:
- Complaints by category.
- Complaints by department.
- Status distribution.
- Average resolution time.
- Median resolution time.
- Complaints resolved within 24 hours and 72 hours.
- Resolution rate.
- Department performance table.

## How the adjusted architecture works

The browser communicates with the existing functions:

```text
React Administrator Dashboard
          |
          |----------------------|
          |                      |
          v                      v
    complaint-api           profile-api
          |                      |
          |                      |-- Create staff accounts
          |                      |-- Create admin accounts
          |                      |-- Change roles
          |                      |-- Activate/deactivate accounts
          |                      |-- Generate temporary passwords
          |                      |-- Administrator allowlist
          |
          |-- Verify administrator
          |-- Dashboard statistics
          |-- Department management
          |-- Category management
          |-- Staff assignments
          |-- Complaint management
          |-- Reports
          |-- AI analysis
          |-- Notifications
          |-- Administrator audit entries
          |
          v
    Existing Appwrite Database
          |
          |-- departments
          |-- categories
          |-- department_users
          |-- complaints
          |-- ai_summaries
          |-- admin_audit
          |-- users
          |
          v
    Authorized administrator
```

**No third Appwrite Function is required.**

## How it is secured

### Administrator verification

Every administrator action in `complaint-api` must:
- Verify the signed-in user's authentication.
- Re-read the user's Appwrite account on the server.
- Check that the account has the `admin` label.
- Check that the account is active.
- Reject students, department staff and guests.
- Reject disabled administrators.
- Repeat the check for every request rather than trusting frontend role information.

A demoted administrator must immediately lose administrator access.

### Database security

Departments, categories and department staff assignments must not be writable from the browser.

On the following tables:
- `departments`
- `categories`
- `department_users`

Remove browser `create`, `update` and `delete` permissions for the `admin` label. Keep the necessary read permissions.

The existing `complaint-api` server API key performs authorized writes.

The server must validate:
- Department and category names.
- Duplicate names, including different letter cases.
- Active department requirements.
- Staff role and account status.
- Duplicate staff assignments.
- Valid staff positions.

Every successful administrative change must generate an audit entry.

### Account security

Accounts stay in `profile-api`.

It must support:
- Creating department staff and administrators, never students through the provisioning action.
- Generating a random temporary password.
- Returning that password once to the authorized administrator.
- Never storing, logging or auditing the temporary password.
- Enforcing an optional `ADMIN_ALLOWLIST`.
- Preventing an administrator from demoting or disabling themselves.
- Protecting the system from losing its last active administrator.
- Recording account creation, role changes and activation/deactivation in `admin_audit`.

When `ADMIN_ALLOWLIST` is configured, only authorized email addresses or permitted domains can become administrators through creation or promotion.

### Complaint security

Complaint listing, details and reassignment stay in `complaint-api`.

The administrator complaint list must be accessible only to verified administrators.

Only administrators can reassign complaints to another category or department.

Reassignment must:
- Validate the destination category and department.
- Require confirmation in the frontend.
- Update the complaint on the server.
- Record the action in the audit trail.
- Notify the student and affected departments.
- Ensure the previous department loses access when it no longer has an authorized assignment.

### Important frontend rule

The administrator pages only call the existing Appwrite Functions.

React must never directly write to:
- `departments`
- `categories`
- `department_users`
- `admin_audit`

Frontend route protection is only for navigation. Real authorization must happen on the backend.

---

## Step 1. Update the database

Open PowerShell in your project directory:

```powershell
cd "C:\SCD\zip12\ai-smartservices"
```

Run:

```powershell
$env:APPWRITE_API_KEY="<your_appwrite_api_key>"
npm run db:setup -- --no-seed
```

This adds the new `admin_audit` table if it is not already present.

**Do not recreate existing tables.**

### Verify the database

Open:

Appwrite Console → Databases → Your Database → Tables

Check that these tables exist:

- `users`
- `departments`
- `categories`
- `department_users`
- `complaints`
- `ai_summaries`
- `notifications`
- `admin_audit`

Use `DATABASE_SCHEMA.md` for the exact columns and data types.

### Configure table permissions

For `departments`, `categories` and `department_users`:

1. Open the table in Appwrite Console.
2. Open Settings → Permissions.
3. Remove browser write permissions for the `admin` label:
   - Create
   - Update
   - Delete
4. Keep the required read permissions.

For `admin_audit`:
- Enable Row Security.
- Allow only authorized administrator access to audit records.
- Do not give students or department staff access.
- Server-side functions must perform audit writes.

The existing server API key must have the required row permissions.

---

## Step 2. Integrate administrator operations into the existing `complaint-api`

**Do not create `admin-api`.**

Open:

```text
functions/complaint-api/
```

Add the administrator backend module to the existing function.

Suggested organization:

```text
functions/
└── complaint-api/
    ├── package.json
    └── src/
        ├── main.js
        ├── handler.js
        ├── ai/
        │   ├── handler.js
        │   ├── provider.js
        │   ├── fallback.js
        │   ├── redact.js
        │   └── validate.js
        │
        └── admin/
            ├── handler.js
            ├── auth.js
            ├── dashboard.js
            ├── departments.js
            ├── categories.js
            ├── staff.js
            ├── complaints.js
            ├── reports.js
            └── audit.js
```

This is a suggested modular organization. Reuse existing files and modules where the functionality already exists. Do not create duplicate handlers.

### Administrator actions to integrate

The existing `complaint-api` request dispatcher should support the required administrator operations.

Suggested action groups:

**Dashboard**
- Get dashboard statistics.
- Get recent administrator activity.

**Departments**
- List departments.
- Create department.
- Update department.
- Activate/deactivate department.

**Categories**
- List categories.
- Create category.
- Update category.
- Change department.
- Activate/deactivate category.

**Staff**
- List department staff.
- Assign staff.
- Change staff position.
- Remove staff assignment.

**Complaints**
- Administrator complaint listing.
- Administrator complaint details.
- Complaint reassignment.

**Reports**
- Category statistics.
- Department statistics.
- Status statistics.
- Resolution statistics.
- Department performance.

**Audit**
- Record administrator actions.
- Retrieve recent audit entries.

Use the existing complaint-api action naming and request format where possible. Every new action must pass through server-side administrator verification.

### Existing AI functionality must remain intact

Do not remove or break:
- Groq provider integration.
- `openai/gpt-oss-120b`.
- Internal asynchronous AI execution.
- `INTERNAL_AI_SECRET`.
- Personal data redaction.
- AI response validation.
- Rule-based fallback.
- `ai_summaries` storage.

The administrator module must coexist with the existing AI and complaint modules.

### Environment variables for `complaint-api`

Open:

Appwrite Console → Functions → `complaint-api` → Settings → Variables.

Keep existing variables and add the following if they are not already configured:

| Variable | Value |
|---|---|
| `APPWRITE_API_KEY` | Existing secret server API key |
| `DATABASE_ID` | Existing database ID |
| `USERS_TABLE_ID` | `users` |
| `DEPARTMENTS_TABLE_ID` | `departments` |
| `CATEGORIES_TABLE_ID` | `categories` |
| `DEPARTMENT_USERS_TABLE_ID` | `department_users` |
| `COMPLAINTS_TABLE_ID` | `complaints` |
| `ADMIN_AUDIT_TABLE_ID` | `admin_audit` |

The existing API key must have:
- `users.read`
- `rows.read`
- `rows.write`

Retain all additional scopes required by existing complaint, notification and AI operations.

**Do not replace your existing API key or remove existing AI variables.**

### Function settings

Keep:
- Function ID: `complaint-api`
- Runtime: Node.js 22
- Entrypoint: `src/main.js`
- Execute access: Users

The handler must authenticate and authorize every administrator operation.

---

## Step 3. Update the existing `profile-api`

Account provisioning and role management remain in `profile-api`.

Do not move account creation into `complaint-api`.

Open:

Appwrite Console → Functions → `profile-api` → Settings → Variables.

Keep the existing variables and add:

| Variable | Value |
|---|---|
| `ADMIN_AUDIT_TABLE_ID` | `admin_audit` |
| `ADMIN_ALLOWLIST` | Optional authorized administrator emails/domains |

Example:

```text
ADMIN_ALLOWLIST=@your-university.edu,dean@elsewhere.org
```

Leave it empty if any existing administrator may appoint other administrators.

### Required API key permissions

Ensure the existing `profile-api` API key has:
- `users.read`
- `users.write`
- `rows.read`
- `rows.write`

Keep all existing permissions.

### Account provisioning requirements

The existing `profile-api` must:
1. Create department staff accounts.
2. Create administrator accounts.
3. Generate random temporary passwords.
4. Return the password once.
5. Never store or log the password.
6. Enforce the administrator allowlist.
7. Prevent self-demotion and self-deactivation.
8. Protect the last active administrator.
9. Write account-related audit entries into `admin_audit`.

The frontend must call `profile-api` for these account operations.

---

## Step 4. Redeploy the two existing functions

After updating their source code and environment variables:

1. Redeploy `profile-api` using its existing Function ID.
2. Redeploy `complaint-api` using its existing Function ID.
3. Do not create another Function.
4. Confirm both deployments complete successfully.
5. Check execution logs for errors.
6. Verify existing student complaint submission still works.
7. Verify AI analysis still works.
8. Verify notifications still work.

Keep the existing function IDs:

```text
profile-api
complaint-api
```

---

## Verify against your real Appwrite project

Complete these tests after deployment.

### 1. Administrator dashboard

- Sign in as an administrator.
- Open `/admin/dashboard`.
- Verify all eight dashboard statistics.
- Compare the values with the Appwrite database.
- Check recent administrator activity.
- Sign in as a student and department staff member.
- Attempt to access the dashboard directly.
- Both must be refused by the backend.

### 2. Departments

- Add a department.
- Edit its details.
- Deactivate it.
- Reactivate it.
- Attempt to create a duplicate name with different capitalization.
- Verify duplicate validation.
- Assign a staff member.
- Attempt to assign the same person twice.
- Verify the duplicate assignment is refused.
- Change the staff position.
- Remove the staff assignment.

### 3. Categories

- Add a category.
- Edit its name.
- Connect it to a department.
- Move it to another department.
- Deactivate it.
- Verify inactive categories no longer appear in the student complaint form.
- Attempt to activate a category belonging to an inactive department.
- Verify the server refuses the operation.

### 4. Add staff or administrator

- Open Users.
- Create a department staff account.
- Assign a department.
- Verify the temporary password is displayed once.
- Copy the password.
- Close the dialog.
- Verify the password is no longer displayed.
- Test login with the new account.
- Attempt to create the same email again.
- Verify that duplicate account creation is refused.

Repeat for administrator creation.

### 5. Administrator allowlist

When `ADMIN_ALLOWLIST` is configured:

- Try creating an administrator outside the list.
- Try promoting an existing user outside the list.
- Both operations must be refused.
- Verify authorized addresses can be promoted or created.

### 6. Administrator protection

- Attempt to demote yourself.
- Attempt to deactivate yourself.
- Both must be refused.
- With two administrators, demote the other administrator.
- Verify at least one active administrator remains.

### 7. Complaints

- Open the administrator complaint list.
- Test search.
- Test status filters.
- Test department filters.
- Test category filters.
- Test sorting and pagination.
- Open a complaint.
- Check complaint history and AI analysis.
- Reassign a complaint to another category or department.
- Confirm the operation.
- Verify student and affected departments receive notifications.
- Verify the old department loses access when appropriate.

### 8. Reports

- Open Reports.
- Verify complaints by category.
- Verify complaints by department.
- Verify status distribution.
- Verify average and median resolution time.
- Verify 24-hour and 72-hour resolution statistics.
- Verify resolution rate.
- Verify department performance.
- Compare results with actual complaint records.

### 9. Audit trail

Open:

Appwrite Console → Databases → Your Database → `admin_audit`.

Verify entries exist for:
- Department creation and updates.
- Category creation and updates.
- Staff assignment changes.
- Account creation.
- Role changes.
- Account activation/deactivation.
- Complaint reassignment.

Each entry must identify who performed the action and when.

**No temporary passwords or API secrets must appear in audit records.**

### 10. Browser security

Open browser Developer Tools → Network.

Verify:
- No direct browser writes to protected tables.
- No Appwrite server API key appears in browser requests.
- No Groq API key appears in browser requests.
- Students cannot call administrator operations successfully.
- Department staff cannot call administrator operations successfully.
- Disabled administrators are refused.
- Only authorized administrators can execute administrator operations.

---

## Known limitations

- The administrator module must be tested against the real Appwrite project after integration.
- Temporary passwords are not automatically forced to change. Users should change them after their first login or use password reset.
- The last-administrator protection is best-effort; simultaneous changes can still race. The allowlist provides stronger control over who can become an administrator.
- Reports use the 2,000 newest resolved complaints for resolution-time calculations. The interface must identify when results are sampled.
- Closed complaints count towards the resolution rate but not resolution-time calculations.
- Departments and categories are deactivated rather than deleted because complaints reference them.
- Administrator audit records cover administrative operations in this phase. Existing complaint status changes remain in complaint history.
- Existing AI, complaint and notification functionality must be regression-tested after updating `complaint-api`.

## Phase 13 completion criteria

Phase 13 is complete only when:

- Administrator dashboard statistics work.
- Department management works.
- Category management works.
- Staff assignment management works.
- Account creation through `profile-api` works.
- Administrator allowlist works when configured.
- Complaint search, filtering and reassignment work.
- Reports display correct statistics.
- Audit entries are recorded correctly.
- Unauthorized users are refused by the backend.
- Existing complaint submission, AI analysis and notifications continue working.

**Final architecture: Two Appwrite Functions only — `profile-api` and `complaint-api`. No separate `admin-api` Function is created.**