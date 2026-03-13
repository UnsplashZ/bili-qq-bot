# Remaining Logging Unification Design

**Goal:** Unify the remaining old-style bot and Python logs into the same human-readable terminal format already introduced for the Node-to-Python RPC chain.

## Background

The current logging work already unified the Python-service request chain:

- Node `ServiceManager` lifecycle and RPC logs
- Python lifecycle logs
- Python request middleware summaries
- Python service-step logs for the highest-value paths

However, a large portion of the project still uses legacy log strings such as:

- `[Bot] ...`
- `[LinkHandler] ...`
- `[AiHandler] ...`
- `Error in xxx handler: ...`

That leaves terminal output in a mixed state:

- Python RPC logs are easy to follow
- Bot entry, AI, subscription, send, dashboard, and Python edge modules still look fragmented

## Objective

Extend the same log design to all remaining high-signal areas without changing business behavior, response payloads, retry rules, cache semantics, or notification behavior.

## Non-Goals

- No functional refactor of message flow, AI flow, or subscription logic
- No external logging dependency changes
- No JSON-first logging redesign
- No dashboard/frontend UI work

## Unified Logging Standard

### Format

All newly unified logs should follow this shape:

```text
HH:mm:ss LVL CHANNEL  [scope] action key=value ...
```

Examples:

```text
00:09:16 INF BOT      [msg:1000:2:555] recv groupId=1000 userId=2 messageType=group
00:09:16 INF LINK     [msg:1000:2:555] card-ready type=video bvid=BV1...
00:09:17 WRN AUTH     [req:login_ab12cd] cookie-expiring ageDays=28.4
00:09:18 ERR SEND     [task:send_9f21c0] group-send-failed groupId=1000 error=ws_closed
```

### Levels

- `TRC`
- `DBG`
- `INF`
- `WRN`
- `ERR`
- `FTL`

### Channels

- `BOT`
- `LINK`
- `AI`
- `SUB`
- `SEND`
- `DASH`
- `AUTH`
- `RPC`
- `PY`
- `HTTP`
- `STORE`
- `MCP`
- `SERVICE`

### Scope Rules

- `msg:<trace>` for one QQ message chain
- `req:<id>` for one HTTP or RPC request
- `poll:<id>` for one subscription polling cycle
- `sub:<id>` for one subscription subject
- `task:<id>` for one send/download task
- `svc:<name>` for lifecycle or process-level events

### Field Rules

- Use camelCase consistently
- Keep `INF` and `WRN` concise
- Large payloads only appear in `DBG`
- Errors use `error=...`
- Full stacks only appear for `ERR` or `FTL`

## Rollout Strategy

Use staged rollout instead of whole-repo replacement.

### Batch 1: Entry Chain

Files:

- `src/bot.js`
- `src/handlers/messageHandler.js`
- `src/handlers/linkHandler.js`
- `src/commands/*.js`

Purpose:

- Unify bot startup, WebSocket lifecycle, incoming message routing, command entry, and link-card generation
- Ensure one QQ message can be followed with a single `msg:<trace>` scope

### Batch 2: High-Noise Business Flows

Files:

- `src/handlers/aiHandler.js`
- `src/services/subscriptionService.js`
- `src/services/subscription/**/*.js`
- `src/services/subscription/updateChecker/modules/*.js`
- `src/services/notificationService.js`
- `src/services/videoDownloadService.js`

Purpose:

- Unify AI diagnostics, subscription polling, state transitions, send tasks, and download tasks
- Introduce `poll:<id>`, `sub:<id>`, and `task:<id>` scopes

### Batch 3: Dashboard

Files:

- `src/dashboard/server.js`
- `src/dashboard/middleware/auth.js`
- `src/dashboard/routes/api/**/*.js`

Purpose:

- Unify dashboard lifecycle, auth failures, request summaries, and config changes
- Introduce dashboard `req:<id>` and `DASH`/`AUTH`/`HTTP` channel usage

### Batch 4: JS Infrastructure

Files:

- `src/config.js`
- `src/utils/cacheManager.js`
- `src/utils/storageUtils.js`
- `src/services/requestApprovalService.js`
- `src/services/userProfileService.js`
- `src/services/mcpManager.js`

Purpose:

- Unify configuration, storage, approval, profile, and MCP logs under `STORE` or `MCP`

### Batch 5: Remaining Python Modules

Files:

- `src/services/bili_server_core/web/handlers.py`
- `src/services/bili_server_core/auth/*.py`
- `src/services/bili_server_core/services/follow_service.py`
- `src/services/bili_server_core/download/service.py`
- `src/services/bili_server_core/config.py`

Purpose:

- Remove remaining legacy Python handler/auth/download/follow log styles
- Route them through the same `logging_utils.py` helper model
- Eliminate raw traceback printing where practical

## Architecture

### Node Side

Build on top of the new `logger.logEvent()` helper.

Add small context helpers:

- `msg` scope creation at message entry
- `poll` scope creation for subscription cycles
- `task` scope creation for send/download jobs
- optional propagation helpers so downstream modules receive the same trace object

### Dashboard Side

Use request middleware to assign request IDs, then log:

- `HTTP recv/done`
- `DASH` business summaries
- `AUTH` security or token failures

### Python Side

Build on top of `logging_utils.py` by:

- adding request-aware helper calls in `web/handlers.py`
- converting auth and download/follow modules to `service_log()`/`lifecycle_log()`-style usage
- suppressing or replacing raw traceback and startup banner noise where practical

## Context Propagation

### QQ Message Flow

- Generate one message trace in `bot.js` or `messageHandler.js`
- Pass it through message handler, command dispatch, link processing, AI, and sending

### Subscription Flow

- Generate one polling trace per cycle
- Derive subject scope for individual users/bangumi/live subjects

### Notification Flow

- Generate task scope for image save, download, send, and retry operations

### Dashboard Flow

- Generate request scope through middleware

### Python Flow

- Reuse the existing `reqId` propagation for Node-to-Python requests
- Extend helper usage to remaining Python modules

## Logging Decisions

### Keep

- Existing high-value semantics such as skip reasons, fallback reasons, and retry causes

### Change

- Old textual prefixes become structured `channel + scope + action`
- Noisy multi-line banners become lifecycle summaries
- Large raw payload dumps move to debug-only paths

### Remove

- Decorative separator lines
- redundant duplicate summaries
- raw `traceback.print_exc()` in normal operational paths

## Verification Strategy

- Add targeted Node-side tests for:
  - bot/message/link logging context
  - AI logging summaries
  - subscription cycle/task scope logs
  - dashboard request logging
- Add Python-side `unittest` coverage for remaining request-aware helpers
- Run real end-to-end checks for:
  - message -> link card
  - AI reply path
  - manual subscription check
  - dashboard API request
  - representative Python auth/follow/download paths where feasible

## Risks

- Scope propagation can spread through many function signatures if done naively
- High-volume modules can become noisy if too many existing logs are preserved
- Dashboard and subscription flows may create too many low-signal info logs

## Mitigations

- Use small trace objects and optional parameters
- Log summaries at `INF`, details at `DBG`
- Replace clusters of old logs with fewer higher-signal lines instead of adding new logs beside old ones

## Recommended Execution Order

1. Batch 1: entry chain
2. Batch 2: AI/subscription/send
3. Batch 5: remaining Python
4. Batch 3: dashboard
5. Batch 4: JS infrastructure

This order maximizes human-visible improvement early while keeping behavioral risk controlled.
