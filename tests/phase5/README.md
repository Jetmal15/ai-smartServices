# Phase 5 auth tests (mock Appwrite)

These run the real app in a real browser against a **local mock** of the Appwrite Account
endpoints. They prove the app's logic; they do NOT prove your Appwrite project is configured
correctly – do the manual checks in docs/APPWRITE_SETUP.md for that.

Needs Playwright (`npm i -D playwright`, then `npx playwright install chromium`, or set CHROME_PATH).

```bash
node tests/phase5/mock-appwrite.mjs &            # mock on :4010 (restart it before every run – state is in memory)
VITE_APPWRITE_ENDPOINT=http://localhost:4010/v1 VITE_APPWRITE_PROJECT_ID=testproject \
VITE_APPWRITE_DATABASE_ID=testdb npx vite --port 5173 --strictPort &
node tests/phase5/e2e.mjs
```
