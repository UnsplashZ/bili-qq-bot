# Remaining Logging Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the remaining legacy bot, dashboard, and Python edge-module logs into the same human-readable channel/scope format without changing runtime behavior.

**Architecture:** Extend the existing Node `logger.logEvent()` and Python `logging_utils.py` patterns outward from the already-unified RPC chain. Introduce lightweight context propagation for message traces, polling traces, task traces, and dashboard request IDs, then migrate modules in batches so each area becomes internally consistent before moving on.

**Tech Stack:** Node.js, log4js, aiohttp, Python `logging`, existing bot handlers/services

---

### Task 1: Save the approved design

**Files:**
- Create: `docs/plans/2026-03-13-remaining-logging-unification-design.md`

**Step 1: Record the approved scope**

Save the unified format, channel rules, scope rules, rollout batches, and verification strategy.

**Step 2: Keep scope constrained**

Do not expand into unrelated functional refactors or frontend work.

### Task 2: Add failing tests for entry-chain logging

**Files:**
- Create: `test/unit/link-handler-logging.test.js`
- Create or Modify: `test/unit/message-handler-logging.test.js`
- Create or Modify: `test/unit/bot-lifecycle-logging.test.js`

**Step 1: Write a failing message-trace propagation test**

Verify one incoming message produces a shared `msg:<trace>` style scope across entry logs.

**Step 2: Write a failing link-flow summary test**

Verify link handling emits concise `LINK` summaries such as:

- extract
- fetch-start
- card-ready
- fallback-text

**Step 3: Write a failing bot lifecycle test**

Verify startup, reconnect, and shutdown logs emit `BOT` channel summaries instead of banner-style text.

**Step 4: Run the focused Node tests**

Run the narrowest command(s) for the new files and confirm they fail for the expected reasons.

### Task 3: Implement Batch 1 entry-chain logging

**Files:**
- Modify: `src/bot.js`
- Modify: `src/handlers/messageHandler.js`
- Modify: `src/handlers/linkHandler.js`
- Modify: selected files under `src/commands/`

**Step 1: Add message-scope helper usage**

Introduce or reuse a lightweight trace object so downstream handlers can share one message scope.

**Step 2: Replace old lifecycle and link logs**

Convert old `[Bot]` and `[LinkHandler]` summaries to `logger.logEvent()` with `BOT` or `LINK` channels.

**Step 3: Keep business logic unchanged**

Only replace or reduce logs; do not alter routing or fallback semantics.

**Step 4: Re-run the focused tests**

Run the Batch 1 tests and confirm they pass.

### Task 4: Add failing tests for AI/subscription/send logging

**Files:**
- Create or Modify: `test/unit/ai-flow-logging.test.js`
- Create or Modify: `test/unit/subscription-logging.test.js`
- Create or Modify: `test/unit/notification-logging.test.js`

**Step 1: Write a failing AI summary test**

Verify `AI` channel summaries for gate/context/tool/reply phases.

**Step 2: Write a failing subscription scope test**

Verify one polling cycle emits `poll:<id>` and one subject emits `sub:<id>`.

**Step 3: Write a failing send/download task test**

Verify `SEND` channel summaries use `task:<id>` and include result/duration/error fields.

**Step 4: Run the focused tests**

Run the new or updated test files and confirm they fail first.

### Task 5: Implement Batch 2 AI/subscription/send logging

**Files:**
- Modify: `src/handlers/aiHandler.js`
- Modify: `src/services/subscriptionService.js`
- Modify: `src/services/subscription/**/*.js`
- Modify: `src/services/subscription/updateChecker/modules/*.js`
- Modify: `src/services/notificationService.js`
- Modify: `src/services/videoDownloadService.js`

**Step 1: Add polling/task scope helpers**

Generate `poll:<id>`, `sub:<id>`, and `task:<id>` where the work begins.

**Step 2: Replace noisy old summaries**

Reduce multiple old logs into fewer high-signal `INF/WRN/ERR` lines.

**Step 3: Preserve diagnostic value**

Keep skip reasons, fallback reasons, and retry causes as fields.

**Step 4: Re-run the focused tests**

Confirm the new tests pass and no existing relevant tests regress.

### Task 6: Add failing tests for remaining Python logging

**Files:**
- Create: `test/unit/python_remaining_logging_test.py`

**Step 1: Use local `venv`**

Per repo rules, use the local `venv` for Python verification.

**Step 2: Write a failing test for handler/auth/download helper output**

Verify remaining Python modules can emit request-aware or service-aware log summaries via shared helpers.

**Step 3: Run the focused Python test**

Run: `PYTHONPATH=. venv/bin/python test/unit/python_remaining_logging_test.py`

Expected: FAIL before implementation.

### Task 7: Implement Batch 5 remaining Python logging

**Files:**
- Modify: `src/services/bili_server_core/web/handlers.py`
- Modify: `src/services/bili_server_core/auth/*.py`
- Modify: `src/services/bili_server_core/services/follow_service.py`
- Modify: `src/services/bili_server_core/download/service.py`
- Modify: `src/services/bili_server_core/config.py`
- Modify: `src/services/bili_server_core/logging_utils.py` if helper expansion is needed

**Step 1: Replace old handler error summaries**

Convert old `Error in xxx handler` patterns to shared helper usage.

**Step 2: Replace raw traceback printing where practical**

Keep stack traces in structured error paths only.

**Step 3: Normalize auth/follow/download/config logs**

Map them onto `AUTH`, `SERVICE`, or `PY` channels as appropriate.

**Step 4: Re-run the Python test**

Run the focused Python test and confirm it passes.

### Task 8: Add failing tests for dashboard logging

**Files:**
- Create or Modify: `test/unit/dashboard-logging.test.js`

**Step 1: Write a failing dashboard request-log test**

Verify dashboard middleware assigns request scope and emits `HTTP` summaries.

**Step 2: Write a failing dashboard business-log test**

Verify auth failures and config changes emit `AUTH` or `DASH` summaries.

**Step 3: Run the focused test**

Confirm it fails before implementation.

### Task 9: Implement Batch 3 dashboard logging

**Files:**
- Modify: `src/dashboard/server.js`
- Modify: `src/dashboard/middleware/auth.js`
- Modify: `src/dashboard/routes/api/**/*.js`

**Step 1: Add dashboard request ID middleware or helper**

Create a shared request scope path for dashboard APIs.

**Step 2: Replace old dashboard log strings**

Move route summaries, security failures, and config-change logs to the new style.

**Step 3: Re-run the dashboard tests**

Confirm they pass.

### Task 10: Add failing tests for JS infrastructure logging

**Files:**
- Create or Modify: `test/unit/store-logging.test.js`
- Create or Modify: `test/unit/mcp-logging.test.js`

**Step 1: Write failing tests for `STORE` summaries**

Cover config save/fail, cache cleanup, approval actions, and profile persistence summaries.

**Step 2: Write failing tests for `MCP` summaries**

Cover connect/reconnect/execute/fail events.

**Step 3: Run the focused tests**

Confirm they fail before implementation.

### Task 11: Implement Batch 4 JS infrastructure logging

**Files:**
- Modify: `src/config.js`
- Modify: `src/utils/cacheManager.js`
- Modify: `src/utils/storageUtils.js`
- Modify: `src/services/requestApprovalService.js`
- Modify: `src/services/userProfileService.js`
- Modify: `src/services/mcpManager.js`

**Step 1: Map modules to channels**

- `STORE` for config/cache/storage/approval/profile
- `MCP` for MCP lifecycle and tool calls

**Step 2: Replace high-noise logs with concise summaries**

Preserve errors and slow-operation signals, reduce decorative or repetitive info logs.

**Step 3: Re-run the focused tests**

Confirm the new tests pass.

### Task 12: Run end-to-end verification

**Files:**
- Reuse existing local verification paths

**Step 1: Verify representative bot message -> link flow**

Use a known Bilibili link and verify one message trace is readable end to end.

**Step 2: Verify representative AI flow**

Confirm gate/context/reply logging remains visible and coherent.

**Step 3: Verify representative subscription flow**

Run the smallest available manual or targeted path and confirm polling/task scopes appear.

**Step 4: Verify representative dashboard API flow**

Run the narrowest available API path and confirm request and business summaries appear.

**Step 5: Verify representative Python edge paths**

Check auth/follow/download/config paths where feasible.

### Task 13: Final verification and commit

**Files:**
- Add the modified code, tests, and docs

**Step 1: Run all targeted verification commands used above**

Use fresh output only.

**Step 2: Summarize residual risk**

Explicitly call out any flows that were not exercised with real runtime checks.

**Step 3: Commit with branch-aware subject and body**

On `main`, infer the next `vxx.yy.zz` version and include a real multiline commit body.
