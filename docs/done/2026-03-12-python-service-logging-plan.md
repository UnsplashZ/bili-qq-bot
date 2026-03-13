# Python Service Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify Node and Python service logs into a human-readable request-oriented format with request IDs, clearer level markers, and useful lifecycle/step summaries.

**Architecture:** Node `ServiceManager` becomes the request-lifecycle anchor for all Python RPCs, while Python aiohttp middleware and helper logging functions attach the same `reqId` to request, handler, and service-step logs. Shared formatting stays lightweight and text-first so terminal readability improves immediately without introducing a large new logging stack.

**Tech Stack:** Node.js, log4js, aiohttp, Python `logging`

---

### Task 1: Record the approved design

**Files:**
- Create: `docs/plans/2026-03-12-python-service-logging-design.md`

**Step 1: Save the validated design**

Record the approved scope, level model, channels, propagation strategy, and rollout boundaries.

**Step 2: Keep the design focused**

Avoid expanding the scope to unrelated bot logs outside the Python service chain.

### Task 2: Add failing Node-side tests for the new logging contract

**Files:**
- Modify: `test/unit/` nearest `ServiceManager` or logger-related test file if one exists
- Create: `test/unit/serviceManager-python-logging.test.js`

**Step 1: Write a failing test for request ID generation and propagation**

Test that a Node -> Python call produces a stable `reqId` and includes it in the outbound request context.

**Step 2: Write a failing test for human-readable RPC summary logs**

Test expected summary lines for:

- start
- success with duration
- failure with duration and error summary

**Step 3: Run the focused test file**

Run: `node test/unit/serviceManager-python-logging.test.js`

Expected: FAIL because the current implementation does not emit the new format.

### Task 3: Implement Node-side logging helpers and RPC lifecycle logging

**Files:**
- Modify: `src/utils/logger.js`
- Modify: `src/services/ServiceManager.js`

**Step 1: Add formatting helpers to the shared logger**

Introduce small helper(s) for:

- short level labels
- channel labels
- context rendering

Keep existing logger callers working.

**Step 2: Add request ID creation and propagation in `ServiceManager`**

Generate `reqId` per Python RPC call and include it in outbound request context.

**Step 3: Add RPC lifecycle logs**

Emit:

- `RPC start`
- `RPC done`
- `RPC fail`

with endpoint, duration, and key identifiers.

**Step 4: Normalize Python child-process lifecycle output**

Replace raw `[PyServer] ...` forwarding with clearer lifecycle and forwarded log summaries where possible.

### Task 4: Add failing Python-side tests for request-context logging

**Files:**
- Create: `test/unit/python_service_logging_test.py`
- Inspect: `venv`

**Step 1: Check for local virtual environment**

Use existing `venv` if present; otherwise create it before running Python tests.

**Step 2: Write a failing test for request ID extraction and middleware context**

Verify request metadata can be attached and later read by handler/service logging helpers.

**Step 3: Write a failing test for summarized request completion logs**

Verify completion logging includes method, path, status, duration, and `reqId`.

**Step 4: Run the focused Python test**

Run: `venv/bin/python -m pytest test/unit/python_service_logging_test.py -v`

Expected: FAIL before implementation.

### Task 5: Implement Python logging bootstrap and request middleware

**Files:**
- Modify: `src/services/bili_server_core/main.py`
- Modify: `src/services/bili_server_core/app.py`
- Modify: `src/services/bili_server_core/web/handlers.py`
- Create or Modify: small helper under `src/services/bili_server_core/` if needed for logging utilities

**Step 1: Centralize Python logging setup**

Create one formatter/config path for:

- short level labels
- channel labels
- request/service scopes

**Step 2: Add aiohttp middleware for request context**

Attach:

- `reqId`
- method
- path
- start time

and emit compact request summary logs.

**Step 3: Update handlers to use structured summaries**

Add consistent handler start/failure/complete logs and preserve tracebacks for true errors.

### Task 6: Add service-step logging to the highest-value Python services

**Files:**
- Modify: `src/services/bili_server_core/services/dynamic_service.py`
- Modify: `src/services/bili_server_core/services/video_service.py`
- Modify: `src/services/bili_server_core/services/article_service.py`
- Modify: `src/services/bili_server_core/services/user_service.py`
- Modify: `src/services/bili_server_core/services/feed_service.py`

**Step 1: Add only high-signal step logs**

Examples:

- fetch started
- credential refresh triggered
- fallback path used
- parse completed
- upstream request failed

**Step 2: Keep logs concise**

Do not log every intermediate variable or raw payload.

### Task 7: Re-run focused verification

**Files:**
- Test: `test/unit/serviceManager-python-logging.test.js`
- Test: `test/unit/python_service_logging_test.py`

**Step 1: Run the Node test**

Run: `node test/unit/serviceManager-python-logging.test.js`

Expected: PASS

**Step 2: Run the Python test with local venv**

Run: `venv/bin/python -m pytest test/unit/python_service_logging_test.py -v`

Expected: PASS

### Task 8: Run a real end-to-end request verification

**Files:**
- Reuse existing local verification path for preview generation or direct RPC

**Step 1: Trigger a real Python-backed request**

Use an existing narrow command that exercises a real Node -> Python request.

**Step 2: Verify terminal logs manually**

Confirm that one request shows:

- a single `reqId`
- Node `RPC start`
- Python request summary
- at least one Python service-step log
- Node `RPC done` or `RPC fail`

### Task 9: Commit

**Files:**
- Add the modified Node, Python, test, and doc files

**Step 1: Create a commit with branch-aware subject**

On `main`, infer the next version from the latest `vxx.yy.zz` subject and include a commit body.
