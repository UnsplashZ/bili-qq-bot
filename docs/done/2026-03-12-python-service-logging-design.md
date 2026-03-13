# Python Service Logging Design

**Goal:** Make bot logs significantly more readable for humans by unifying Node-side Python RPC logs, Python service request logs, internal service step logs, and log level presentation.

## Context

Current logging has two main problems:

- Node-side `ServiceManager` mostly logs transport state such as process start, health checks, and endpoint errors.
- Python-side logs are forwarded almost verbatim, so the terminal view is dominated by raw process output instead of a coherent request lifecycle.

This makes it hard to answer basic debugging questions:

- Which bot action triggered a Python request?
- Which Python endpoint handled it?
- How long did it take?
- Which internal step failed?
- Which log lines belong to the same request?

## Scope

This work covers the Python-service-related logging chain end to end:

- Node main process logs around Python RPC calls
- Python service lifecycle logs
- Python HTTP request/access logs
- Python handler entry/exit/error logs
- Python service-layer step logs for the most used request paths
- Human-readable log level display

This work does not attempt to fully redesign all bot logs unrelated to Python RPC.

## Requirements

### Functional

- Every Node -> Python request should have a request ID.
- The same request ID should be visible in:
  - Node request start/end/failure logs
  - Python request receive/complete/failure logs
  - Python internal step logs
- Python service lifecycle events should be easy to distinguish from request logs.
- Python access logs should be summarized into a compact human-readable form.
- Log levels should be displayed consistently with short readable markers.

### Non-Functional

- Optimize for terminal readability first.
- Avoid introducing a heavy structured logging stack.
- Preserve enough context fields so a future machine-readable format remains possible.
- Keep the first version focused on the main Python request chain.

## Recommended Approach

Use a shared human-readable log style backed by lightweight structured context.

Core idea:

- Node generates `reqId` for each Python RPC call.
- Node passes `reqId` to Python.
- Python middleware attaches `reqId` and request metadata to request context.
- Node and Python both emit logs using a shared visual format:
  - short level marker
  - channel
  - request or service scope
  - concise summary
  - key fields such as endpoint, identifiers, duration

This keeps terminal logs readable while avoiding a pure string-only design that would block later improvements.

## Log Model

### Levels

- `TRC`
- `DBG`
- `INF`
- `WRN`
- `ERR`
- `FTL`

### Channels

- `BOT` for Node bot process events
- `RPC` for Node -> Python RPC start/success/failure
- `PY` for Python lifecycle and server events
- `HTTP` for summarized Python HTTP access logs
- `SERVICE` for Python internal service steps

### Example

```text
20:41:18 INF RPC      [req:dy_8f3a2c] start endpoint=dynamic_detail dynamicId=1178844982346252295
20:41:18 INF HTTP     [req:dy_8f3a2c] recv POST /dynamic_detail
20:41:18 INF SERVICE  [req:dy_8f3a2c] fetch dynamic detail from bilibili dynamicId=1178844982346252295
20:41:19 INF RPC      [req:dy_8f3a2c] done endpoint=dynamic_detail duration=842ms status=success
20:41:19 INF PY       [svc:lifecycle] ready port=10001
20:41:20 ERR RPC      [req:vid_19ac77] fail endpoint=video duration=5312ms error=timeout
```

## Architecture

### Node Side

Primary file:

- `src/services/ServiceManager.js`

Responsibilities:

- create `reqId`
- record RPC start/success/failure
- measure duration
- attach `reqId` to outbound requests
- normalize Python child-process output into the new display format
- emit lifecycle logs for start/ready/restart/exit

Supporting file:

- `src/utils/logger.js`

Responsibilities:

- add shared formatting helpers for short level display and context rendering
- support channel-aware logging in a way existing callers can adopt incrementally

### Python Side

Primary files:

- `src/services/bili_server_core/main.py`
- `src/services/bili_server_core/app.py`
- `src/services/bili_server_core/web/handlers.py`

Responsibilities:

- replace bare `basicConfig` usage with a centralized formatter
- add request middleware for `reqId`, method, path, duration
- replace raw aiohttp access noise with summarized request logs
- emit handler enter/exit/failure logs with request context

Secondary service files for first rollout:

- `src/services/bili_server_core/services/dynamic_service.py`
- `src/services/bili_server_core/services/video_service.py`
- `src/services/bili_server_core/services/article_service.py`
- `src/services/bili_server_core/services/user_service.py`
- `src/services/bili_server_core/services/feed_service.py`

Responsibilities:

- log high-value internal steps only
- include concise identifiers and timing where useful
- avoid spamming low-signal debug output

## Propagation Strategy

Recommended propagation path:

- Node sends `reqId` in request payload and/or header.
- Python middleware reads it and stores it in request context.
- Python helpers expose a small logging API that automatically includes:
  - `reqId`
  - endpoint
  - important resource identifiers

This avoids repeatedly hand-formatting context in every handler.

## Error Handling

- Normal failures should emit one concise summary line.
- Stack traces should be reserved for `ERR`/`FTL`.
- Access logs should not duplicate handler summary logs.
- Restart loops and health check failures should be grouped under lifecycle logging.

## Approach Options

### Option 1: Text-only formatting

- Lowest implementation effort
- Fastest improvement
- Weak future extensibility

### Option 2: Human-readable text backed by lightweight structured context

- Best balance
- Keeps terminal output clean
- Preserves future extensibility

### Option 3: Full JSON logs

- Strong for machine processing
- Poor fit for current "human-readable first" goal

**Recommendation:** Option 2.

## Verification Strategy

- Add Node-side tests for formatting and request-ID propagation.
- Add targeted tests for `ServiceManager` RPC logging behavior.
- Add Python-side tests for request middleware and log-summary behavior where feasible.
- Run at least one real Node -> Python request and verify the request lifecycle is visible with a single `reqId`.

## Risks

- Over-logging can make terminal output noisy again.
- Inconsistent adoption across Python services can produce mixed styles.
- Reformatting child-process logs without structure can lose fidelity if done too aggressively.

## Mitigations

- Limit first rollout to high-signal events.
- Keep existing message content where useful, but wrap it in a consistent format.
- Use targeted tests around request ID propagation and summary lines.
