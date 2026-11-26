# Phase 6 tests

They prove the app's and the function's logic against **mocks**. They do not prove your real Appwrite
project is configured correctly – do the manual checks in docs/APPWRITE_SETUP.md (Phase 6, section D).

## Function tests (no browser, no Appwrite)
    npm run test:phase6        # needs `npm i` inside functions/profile-api once (for node-appwrite)

## Browser tests (real app + the REAL function handler behind a mock Appwrite)
Needs Playwright (`npm i -D playwright`; `npx playwright install chromium`, or set CHROME_PATH).

    node tests/phase6/mock-appwrite.mjs &      # restart before every run – state is in memory
    VITE_APPWRITE_ENDPOINT=http://localhost:4010/v1 VITE_APPWRITE_PROJECT_ID=testproject \
    VITE_APPWRITE_DATABASE_ID=testdb npx vite --port 5173 --strictPort &
    node tests/phase6/e2e.mjs

Covers student, department staff and administrator: profile pages, role redirects, route protection,
self-service edits, privilege-escalation and cross-student access attempts (through the function and
directly against the table), admin role/department/status management, sync, session expiry.

Note: tests/phase5 targets the old prefs-based registration and is superseded by this suite.
