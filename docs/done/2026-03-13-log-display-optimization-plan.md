# Log Display Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve log readability for `docker logs` first, then add WebUI log history and interactive filtering without regressing the existing unified logging pipeline.

**Architecture:** Keep the current `logger.logEvent(...)` API as the single entry point, but upgrade the logger to produce a structured event object with a configurable pretty renderer for stdout. Add environment-variable-driven filtering and formatting in the logger layer for terminal use, then add a lightweight in-memory log buffer behind the Dashboard so the Logs page can load recent history before subscribing to the live WebSocket stream.

**Tech Stack:** Node.js, log4js, Express, WebSocket, React, local `.env`/config loading, existing `logger.onLog()` event stream.

---

### Task 1: Define structured logger config and pretty rendering rules

**Files:**
- Modify: `src/utils/logger.js`
- Reference: `src/config.js`
- Test: `test/unit/logger-stdout-format.test.js`

**Step 1: Write the failing test expectations**

Add expectations covering:
- full timestamp format `yyyy/mm/dd hh:mm:ss`
- optional colorized output gate
- respect for `LOG_TIMESTAMP=true`
- default pretty output still including `INF/WRN/ERR` labels and aligned channel field

**Step 2: Run test to verify it fails**

Run:

```bash
node test/unit/logger-stdout-format.test.js
```

Expected: FAIL because current stdout formatting does not yet include configurable full timestamp rules.

**Step 3: Write minimal implementation**

Implement in `src/utils/logger.js`:
- environment readers for:
  - `LOG_LEVEL`
  - `LOG_CHANNELS`
  - `LOG_EXCLUDE_CHANNELS`
  - `LOG_COLOR`
  - `LOG_TIMESTAMP`
  - `LOG_PRETTY`
  - `LOG_STACKS`
  - `LOG_BUFFER_SIZE`
- a structured event object shape:

```js
{
  timestamp,
  timestampText,
  level,
  severity,
  channel,
  scope,
  action,
  fields,
  rendered
}
```

- full timestamp formatter using `yyyy/mm/dd hh:mm:ss`
- pretty renderer with fixed slot order:
  - timestamp
  - level
  - channel
  - scope
  - action
  - fields
- optional ANSI color application only when enabled

**Step 4: Run test to verify it passes**

Run:

```bash
node test/unit/logger-stdout-format.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/logger.js test/unit/logger-stdout-format.test.js
git commit -m "test: add configurable logger pretty output"
```

### Task 2: Add terminal-side level and channel filtering

**Files:**
- Modify: `src/utils/logger.js`
- Test: `test/unit/logger-stdout-format.test.js`
- Create: `test/unit/logger-filtering.test.js`

**Step 1: Write the failing test**

Add tests showing:
- `LOG_LEVEL=warn` suppresses `INF`
- `LOG_CHANNELS=RPC,PY` only emits those channels
- `LOG_EXCLUDE_CHANNELS=HTTP` suppresses HTTP lines even if level matches
- `logger.onLog()` still receives structured events even when stdout filtering suppresses terminal output

**Step 2: Run test to verify it fails**

Run:

```bash
node test/unit/logger-filtering.test.js
```

Expected: FAIL because filtering is not implemented yet.

**Step 3: Write minimal implementation**

Implement filtering in `src/utils/logger.js`:
- compute numeric severity for each event
- filter stdout appender emission based on env rules
- keep `listeners`/`logger.onLog()` fed by the structured event object
- avoid filtering the internal event bus so Dashboard can still choose its own visibility rules

**Step 4: Run test to verify it passes**

Run:

```bash
node test/unit/logger-filtering.test.js
node test/unit/logger-stdout-format.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/logger.js test/unit/logger-filtering.test.js test/unit/logger-stdout-format.test.js
git commit -m "feat: add logger level and channel filters"
```

### Task 3: Separate error summaries from stack output

**Files:**
- Modify: `src/utils/logger.js`
- Reference: `src/bot.js`, `src/services/ServiceManager.js`
- Create: `test/unit/logger-stack-format.test.js`

**Step 1: Write the failing test**

Add coverage for:
- summary line remains single-line and readable
- stack is only appended when `LOG_STACKS=error` or `all`
- stack lines are indented or clearly separated from summary line

**Step 2: Run test to verify it fails**

Run:

```bash
node test/unit/logger-stack-format.test.js
```

Expected: FAIL

**Step 3: Write minimal implementation**

Update renderer behavior:
- detect `fields.stack` / `fields.traceback`
- omit stack from main line
- append multiline stack block only when configured
- keep `fields.error` visible in the summary

**Step 4: Run test to verify it passes**

Run:

```bash
node test/unit/logger-stack-format.test.js
node test/unit/bot-lifecycle-logging.test.js
node test/unit/serviceManager-python-logging.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/logger.js test/unit/logger-stack-format.test.js
git commit -m "refactor: separate stack traces from log summaries"
```

### Task 4: Add Dashboard-side log ring buffer

**Files:**
- Create: `src/dashboard/logBuffer.js`
- Modify: `src/dashboard/server.js`
- Test: `test/unit/dashboard-logging.test.js`
- Create: `test/unit/dashboard-log-buffer.test.js`

**Step 1: Write the failing test**

Add tests for:
- logger events are stored in insertion order
- buffer keeps only the latest `LOG_BUFFER_SIZE` records
- records preserve structured fields such as `channel`, `scope`, `action`, `level`, `rendered`

**Step 2: Run test to verify it fails**

Run:

```bash
node test/unit/dashboard-log-buffer.test.js
```

Expected: FAIL because no buffer exists yet.

**Step 3: Write minimal implementation**

Implement `src/dashboard/logBuffer.js`:
- in-memory ring buffer
- `push(event)`
- `list({ level, channels, keyword, limit })`
- no persistence to disk in this phase

Wire it in `src/dashboard/server.js`:
- subscribe from `logger.onLog()`
- push every structured event into the buffer
- keep current WebSocket broadcast behavior

**Step 4: Run test to verify it passes**

Run:

```bash
node test/unit/dashboard-log-buffer.test.js
node test/unit/dashboard-logging.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/dashboard/logBuffer.js src/dashboard/server.js test/unit/dashboard-log-buffer.test.js
git commit -m "feat: add dashboard log ring buffer"
```

### Task 5: Add Dashboard history API and WebSocket filter support

**Files:**
- Modify: `src/dashboard/server.js`
- Modify: `src/dashboard/routes/api/index.js`
- Create: `src/dashboard/routes/api/modules/logs.js`
- Test: `test/unit/dashboard-secondary-logging.test.js`
- Create: `test/unit/dashboard-logs-api.test.js`

**Step 1: Write the failing test**

Add tests covering:
- `GET /api/logs/recent`
- filters: `level`, `channels`, `keyword`, `limit`
- WebSocket log stream honoring optional query params for level/channels

**Step 2: Run test to verify it fails**

Run:

```bash
node test/unit/dashboard-logs-api.test.js
```

Expected: FAIL because no history API or WS-side filter exists yet.

**Step 3: Write minimal implementation**

Implement:
- `GET /api/logs/recent`
- query parsing helpers for `channels=RPC,PY`
- optional WS subscriber-side filtering without changing the shared event bus

**Step 4: Run test to verify it passes**

Run:

```bash
node test/unit/dashboard-logs-api.test.js
node test/unit/dashboard-secondary-logging.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/dashboard/server.js src/dashboard/routes/api/index.js src/dashboard/routes/api/modules/logs.js test/unit/dashboard-logs-api.test.js
git commit -m "feat: add dashboard log history and filters"
```

### Task 6: Upgrade the WebUI Logs page to use history + live stream

**Files:**
- Modify: `dashboard/src/pages/Logs.jsx`
- Create: `dashboard/src/pages/logs/useLogsStream.js`
- Test: `dashboard` frontend smoke/manual verification

**Step 1: Write the failing test or verification checklist**

If the frontend test stack is too thin, define a manual verification checklist first:
- refresh page still shows recent logs
- level selector works
- channel multi-select works
- keyword filter works
- pause keeps history on screen without losing buffered logs

If lightweight component tests already exist, add targeted tests for state restoration and filtering.

**Step 2: Run the current check to verify the gap**

Run:

```bash
cd dashboard && npm run build
```

Expected: Current UI still only shows live stream and loses logs on refresh.

**Step 3: Write minimal implementation**

Update `Logs.jsx`:
- fetch `/api/logs/recent` on load
- connect to `/ws/logs` with current filter params
- add controls:
  - level dropdown
  - channel multi-select or checkbox group
  - keyword search
  - pause/resume
  - clear current view
- render structured columns:
  - time
  - level
  - channel
  - scope
  - action/message

**Step 4: Run verification**

Run:

```bash
cd dashboard && npm run build
```

Then manually verify in browser:
- refresh preserves recent logs
- filters affect loaded history and live updates
- timestamp displays `yyyy/mm/dd hh:mm:ss`

**Step 5: Commit**

```bash
git add dashboard/src/pages/Logs.jsx dashboard/src/pages/logs/useLogsStream.js
git commit -m "feat: add dashboard log history and filtering UI"
```

### Task 7: Document operator-facing logger controls

**Files:**
- Modify: `README.md`
- Modify: `config/.env.example`
- Test: manual doc sanity check

**Step 1: Add documentation updates**

Document:
- `LOG_LEVEL`
- `LOG_CHANNELS`
- `LOG_EXCLUDE_CHANNELS`
- `LOG_COLOR`
- `LOG_TIMESTAMP`
- `LOG_PRETTY`
- `LOG_STACKS`
- `LOG_BUFFER_SIZE`

Include practical examples for `docker logs` debugging:

```env
LOG_LEVEL=warn
LOG_EXCLUDE_CHANNELS=HTTP
```

and

```env
LOG_LEVEL=debug
LOG_CHANNELS=RPC,PY,AUTH
```

**Step 2: Verify documentation**

Check:
- README links render correctly
- `.env.example` values are coherent with implementation defaults

**Step 3: Commit**

```bash
git add README.md config/.env.example
git commit -m "docs: document logger display controls"
```

### Final Verification

**Run full relevant verification**

```bash
git diff --check
node test/unit/logger-stdout-format.test.js
node test/unit/logger-filtering.test.js
node test/unit/logger-stack-format.test.js
node test/unit/dashboard-log-buffer.test.js
node test/unit/dashboard-logs-api.test.js
node test/unit/dashboard-logging.test.js
node test/unit/dashboard-secondary-logging.test.js
node test/unit/message-handler-logging.test.js
node test/unit/serviceManager-python-logging.test.js
PYTHONPATH=. venv/bin/python test/unit/python_service_logging_test.py
PYTHONPATH=. venv/bin/python test/unit/python_remaining_logging_test.py
cd dashboard && npm run build
```

**Expected:** all commands succeed with no failing tests.

### Notes

- Keep filtering in `src/utils/logger.js` for terminal / `docker logs` behavior. Do not implement terminal visibility rules inside Dashboard code.
- Keep `logger.onLog()` structured and richer than stdout so Dashboard can choose different filtering from terminal output.
- Do not add persistence to disk for the WebUI cache in this phase; an in-memory ring buffer is enough.
- Keep timestamp format fixed to `yyyy/mm/dd hh:mm:ss` when `LOG_TIMESTAMP=true`.

Plan complete and saved to `docs/plans/2026-03-13-log-display-optimization-plan.md`. Two execution options:

1. Subagent-Driven (this session) - 我在当前会话里按计划逐步实现并在关键点复核
2. Parallel Session (separate) - 你开一个新会话，按 `executing-plans` 批量执行

Which approach?
