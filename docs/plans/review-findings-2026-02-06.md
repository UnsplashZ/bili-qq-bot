# Review Findings (main..HEAD + Working Tree)

**Scope**
- Base comparison: `main..HEAD` (branch `security-fixes-2026`).
- Additional review: uncommitted working tree changes vs `HEAD` (including deletions).

**Summary**
- 12 previously identified findings (P1: 2, P2: 10).

**Findings**
| ID | Severity | Location | Issue | Impact | Recommendation |
| --- | --- | --- | --- | --- | --- |
| F01 | P2 | `dashboard/src/pages/Groups.jsx:240` | Sync tab index mismatch after adding the “AI 配置” tab | Sync tab data fetch/login checks run on the wrong tab and fail to run on the actual Sync tab | Update the index check to match the new tab order |
| F02 | P1 | `src/handlers/aiHandler.js:291` | Catch block references `dynamicTimeout` and `tools` that are scoped inside `try` | Exception handling throws `ReferenceError`, masking the real error | Hoist the variables outside the `try`, or guard access in `catch` |
| F03 | P1 | `src/handlers/messageHandler.js:34` | Self-trigger guard compares string `userId` to possibly numeric `self_id` | Bot may process its own messages, causing loops | Normalize `self_id` to string before comparison |
| F04 | P2 | `src/handlers/messageHandler.js:18` | `ws.OPEN` is not a valid instance constant | Private replies (including non-admin rejection) likely never send | Use `WebSocket.OPEN` or `ws.readyState === WebSocket.OPEN` |
| F05 | P2 | `src/handlers/messageHandler.js:193` | `processSingleLink` swallows errors but caller assumes throws | Failed link processing still cached, blocking retries | Return a success boolean or rethrow; only cache on success |
| F06 | P2 | `src/services/subscription/updateChecker.js:329` | Feed pagination stops when filtered page becomes empty | Pages with only auto-post dynamics end the loop, skipping older valid items | Replace `break` with `continue` or only stop when `!hasMore` |
| F07 | P2 | `src/services/subscription/updateChecker.js:176` | Cookie-sync users are skipped in `checkUserVideo`/`checkUserArticle` while feed filters out video/article dynamics | Cookie-sync groups can lose video/article notifications entirely | Provide an alternate path for video/article updates or avoid filtering for feed-monitored users |
| F08 | P2 | `src/services/subscription/updateChecker.js:989` | `lastVideoId`/`lastArticleId` updated even when push fails | Notification may be permanently skipped after a failure | Only advance tracking when a push succeeds; apply to article logic too |
| F09 | P2 | `src/dashboard/middleware/auth.js:31` | `new URL(origin)` can throw on `Origin: null` or malformed headers | Request turns into 500 instead of 403, weakening CSRF control | Wrap parsing in try/catch and fail closed |
| F10 | P2 | `src/bot.js:309` | `gracefulShutdown` always exits with code 0 | Startup failures reported as success to supervisors | Allow caller to control exit code or avoid exiting in error paths |
| F11 | P2 | `dashboard/src/pages/Settings.jsx:268` | Global AI toggle calls `PUT /api/config` but backend exposes `POST /api/config` | Toggle requests fail with 404; config not persisted | Align method with backend endpoint |
| F12 | P2 | `dashboard/src/pages/Groups.jsx:207` | Group AI overrides not loaded into `formData` | AI Config tab always shows “inherit” and toggles are wrong | Load `aiEnabled`/`aiRagEnabled` from group config (allow null) |