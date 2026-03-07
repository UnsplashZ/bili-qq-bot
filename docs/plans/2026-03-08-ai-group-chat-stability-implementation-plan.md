# AI Group Chat Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a layered AI decision pipeline that keeps the bot moderately responsive in groups while strongly constraining misfires, context drift, and accidental action-like responses.

**Architecture:** Insert a pre-LLM decision pipeline between `messageHandler` and `aiHandler`: reply gating decides whether to enter AI, context selection chooses only relevant thread context plus a conservative summary, response mode constrains the bot to chat/answer/confirm states, and prompt assembly turns all of that into a stable structured model input. Existing command dispatch, link handling, context persistence, vector memory, and idempotency remain in place.

**Tech Stack:** Node.js, CommonJS modules, existing `src/handlers/*`, `src/services/ai/*`, `src/services/aiContextService.js`, unit tests under `test/unit`

---

### Task 1: Add AI config fields for gating, response mode, and bot facts

**Files:**
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/config.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/validation.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/ai-config-validation.test.js`

**Step 1: Write the failing test**

Add config normalization and validation coverage for:
- `aiReplyGateEnabled`
- `aiContextSelectorEnabled`
- `aiResponseModeEnabled`
- `aiPromptAssemblerEnabled`
- `aiReplyScoreThreshold`
- `aiBusyReplyScoreThreshold`
- `aiBusyWindowSeconds`
- `aiBusyMessageCount`
- `aiReplyCooldownMs`
- `aiMaxRepliesPerWindow`
- `aiBotName`
- `aiBotAliases`

Test expectations:
- Boolean toggles accept booleans only
- Thresholds accept bounded integers
- `aiBotAliases` normalizes to string array

**Step 2: Run test to verify it fails**

Run: `node test/unit/ai-config-validation.test.js`

Expected: FAIL because new config keys are unknown or unvalidated.

**Step 3: Write minimal implementation**

Update `/Users/zheng/dev/Github/bili-qq-bot/src/config.js`:
- Add new META entries with sensible defaults
- Keep defaults conservative

Update `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/validation.js`:
- Allow new fields
- Validate integer ranges
- Normalize aliases array

Recommended defaults:
- `aiReplyGateEnabled=true`
- `aiContextSelectorEnabled=true`
- `aiResponseModeEnabled=true`
- `aiPromptAssemblerEnabled=true`
- `aiReplyScoreThreshold=45`
- `aiBusyReplyScoreThreshold=80`
- `aiBusyWindowSeconds=10`
- `aiBusyMessageCount=12`
- `aiReplyCooldownMs=15000`
- `aiMaxRepliesPerWindow=3`
- `aiBotName=''`
- `aiBotAliases=[]`

**Step 4: Run test to verify it passes**

Run: `node test/unit/ai-config-validation.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 2: Enrich stored AI message metadata without breaking existing contexts

**Files:**
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/services/aiContextService.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/ai-context-metadata.test.js`

**Step 1: Write the failing test**

Add tests covering:
- `addMessageToContext` stores optional metadata when present
- old messages without new metadata still load cleanly
- `messageHandler.extractMessageMeta()` includes:
  - `replyToMessageId`
  - `currentMentionsBot`
  - `isReplyToBot`
  - `botNameHit`

**Step 2: Run test to verify it fails**

Run: `node test/unit/ai-context-metadata.test.js`

Expected: FAIL because metadata fields are missing.

**Step 3: Write minimal implementation**

In `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`:
- Detect `reply` segment if present
- Extract `replyToMessageId`
- Track if current message explicitly mentions bot by `self_id`
- Track whether bot alias/name appears in raw text

In `/Users/zheng/dev/Github/bili-qq-bot/src/services/aiContextService.js`:
- Store optional fields only when provided
- Keep backward compatibility with old context entries

Suggested stored fields:
- `messageId`
- `replyToMessageId`
- `replyToSpeakerId`
- `isReplyToBot`
- `normalizedText`
- `topicHints`
- `currentMentionsBot`
- `botNameHit`

**Step 4: Run test to verify it passes**

Run: `node test/unit/ai-context-metadata.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 3: Add bot fact resolution service

**Files:**
- Create: `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/botFactsService.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/bot.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/ai-bot-facts.test.js`

**Step 1: Write the failing test**

Add tests for a helper returning:
- `botId`
- `botName`
- `botAliases`
- `ownerId`
- `currentMentionsBot`
- `currentReplyToBot`

Test fallback order:
- Prefer runtime login info nickname
- Fall back to configured `aiBotName`
- Always include configured aliases

**Step 2: Run test to verify it fails**

Run: `node test/unit/ai-bot-facts.test.js`

Expected: FAIL because service does not exist.

**Step 3: Write minimal implementation**

Create `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/botFactsService.js`:
- Export a pure builder function
- Read `global.bot.selfId`
- Read runtime nickname if available
- Read config aliases
- Normalize all ids/strings

Update `/Users/zheng/dev/Github/bili-qq-bot/src/bot.js`:
- When handling `get_login_info`, persist nickname and any safe runtime fields into `global.bot`

**Step 4: Run test to verify it passes**

Run: `node test/unit/ai-bot-facts.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 4: Implement reply gate scoring and busy mode

**Files:**
- Create: `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/replyGateService.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/ai-reply-gate.test.js`

**Step 1: Write the failing test**

Add tests for:
- `@bot` always passes
- private chat always passes
- short noise message in busy mode fails
- same user follow-up after recent bot interaction can pass
- non-targeted group chatter fails when score is low
- per-group busy mode threshold works

**Step 2: Run test to verify it fails**

Run: `node test/unit/ai-reply-gate.test.js`

Expected: FAIL because service does not exist or behavior is missing.

**Step 3: Write minimal implementation**

Create `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/replyGateService.js`:
- Keep small in-memory window per group
- Track recent message timestamps and recent bot reply timestamps
- Compute `replyScore`
- Return:
  - `shouldReply`
  - `score`
  - `busyMode`
  - `triggerLevel`
  - `reasons`

Update `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`:
- Replace direct `aiHandler.shouldReply()` use
- Build gate input from current message and recent context

Suggested trigger levels:
- `direct`
- `followup`
- `ambient`

**Step 4: Run test to verify it passes**

Run: `node test/unit/ai-reply-gate.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 5: Implement context selector for thread-focused context

**Files:**
- Create: `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/contextSelectorService.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/ai-context-selector.test.js`

**Step 1: Write the failing test**

Add tests covering:
- same-speaker recent messages are selected first
- recent bot reply in same topic is retained
- unrelated chatter is dropped
- reply-linked message is retained
- summary is generated conservatively when message volume is high

**Step 2: Run test to verify it fails**

Run: `node test/unit/ai-context-selector.test.js`

Expected: FAIL because service does not exist.

**Step 3: Write minimal implementation**

Create `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/contextSelectorService.js`:
- Accept full context plus current turn
- Score candidate messages by relevance
- Return:
  - `currentTurn`
  - `threadMessages`
  - `backgroundSummary`
  - `stats`

Use conservative summary rules:
- summarize topic and relation only
- never summarize as a decision

Update `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`:
- Pass group context and current turn into selector

**Step 4: Run test to verify it passes**

Run: `node test/unit/ai-context-selector.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 6: Implement response mode classification

**Files:**
- Create: `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/responseModeService.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/ai-response-mode.test.js`

**Step 1: Write the failing test**

Add tests for:
- plain question becomes `answer_only`
- casual banter becomes `chat`
- ambiguous action phrasing becomes `confirm_needed`
- non-strongly-triggered group action phrase does not become `action_ready`
- explicit direct request can classify as `confirm_needed` instead of overcommitting

**Step 2: Run test to verify it fails**

Run: `node test/unit/ai-response-mode.test.js`

Expected: FAIL because classifier does not exist.

**Step 3: Write minimal implementation**

Create `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/responseModeService.js`:
- Use deterministic rules first
- Classify into:
  - `chat`
  - `answer_only`
  - `confirm_needed`
  - `action_ready`

Current rollout policy:
- `action_ready` may be produced internally
- handler still treats it as non-executing and only uses it for prompt constraints

Update `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`:
- Attach response mode to AI input payload

**Step 4: Run test to verify it passes**

Run: `node test/unit/ai-response-mode.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 7: Implement prompt assembler with structured blocks

**Files:**
- Create: `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/promptAssemblerService.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/aiHandler.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/ai-prompt-assembler.test.js`

**Step 1: Write the failing test**

Add tests verifying the prompt includes:
- identity rules
- conversation policy
- bot facts block
- turn facts block
- response mode block
- current user message block
- thread context block
- conservative background summary block

Add tests verifying:
- current user message is the primary task source
- response mode constraints are present for `confirm_needed`
- unrelated chatter is not appended as raw history

**Step 2: Run test to verify it fails**

Run: `node test/unit/ai-prompt-assembler.test.js`

Expected: FAIL because assembler does not exist.

**Step 3: Write minimal implementation**

Create `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/promptAssemblerService.js`:
- Build one system prompt from structured blocks
- Return a minimal `messages` array:
  - one system message
  - a bounded number of selected thread messages
  - current user message last

Update `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/aiHandler.js`:
- Support receiving structured AI input
- Use prompt assembler when enabled
- Keep legacy fallback path behind feature toggle until rollout is complete

**Step 4: Run test to verify it passes**

Run: `node test/unit/ai-prompt-assembler.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 8: Integrate selector, mode, and assembler into aiHandler request flow

**Files:**
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/aiHandler.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/messageHandler-ai-pipeline.test.js`

**Step 1: Write the failing test**

Add end-to-end unit coverage for:
- message enters gate and is dropped
- message enters gate and produces structured AI input
- `confirm_needed` causes constrained prompt mode
- busy mode still allows `@bot`
- legacy fallback still works when feature toggles are disabled

**Step 2: Run test to verify it fails**

Run: `node test/unit/messageHandler-ai-pipeline.test.js`

Expected: FAIL because pipeline wiring is incomplete.

**Step 3: Write minimal implementation**

In `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`:
- Build `aiPipelineInput`
- Call gate, selector, mode services
- Pass structured object to `aiHandler.getReply()`

In `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/aiHandler.js`:
- Accept either legacy positional params or structured pipeline input
- Use feature toggles to roll forward safely

**Step 4: Run test to verify it passes**

Run: `node test/unit/messageHandler-ai-pipeline.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 9: Preserve and adapt long-term memory injection under the new structure

**Files:**
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/aiHandler.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/promptAssemblerService.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/ai-memory-assembly.test.js`

**Step 1: Write the failing test**

Add tests verifying:
- relevant memories are still included when RAG is enabled
- memories appear in a separate block, not mixed into current thread
- bot identity questions in strict mode still suppress inappropriate memory use

**Step 2: Run test to verify it fails**

Run: `node test/unit/ai-memory-assembly.test.js`

Expected: FAIL because memory assembly is still tied to legacy prompt layout.

**Step 3: Write minimal implementation**

Update `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/aiHandler.js`:
- Fetch RAG memories using current turn text and response mode context
- Pass memories to prompt assembler as a separate block

Update `/Users/zheng/dev/Github/bili-qq-bot/src/services/ai/promptAssemblerService.js`:
- Render memories as supporting context only

**Step 4: Run test to verify it passes**

Run: `node test/unit/ai-memory-assembly.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 10: Add rollout-safe logging and diagnostics

**Files:**
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/messageHandler.js`
- Modify: `/Users/zheng/dev/Github/bili-qq-bot/src/handlers/aiHandler.js`
- Test: `/Users/zheng/dev/Github/bili-qq-bot/test/unit/ai-pipeline-logging.test.js`

**Step 1: Write the failing test**

Add tests covering log payloads for:
- gate rejection
- busy mode activation
- selected thread count
- response mode chosen
- fallback to legacy mode

**Step 2: Run test to verify it fails**

Run: `node test/unit/ai-pipeline-logging.test.js`

Expected: FAIL because structured diagnostics are missing.

**Step 3: Write minimal implementation**

Add structured debug/info logging with trace id for:
- gate decision
- selector result size
- response mode
- prompt assembly mode

Do not log full raw prompt or user history bodies in production info logs.

**Step 4: Run test to verify it passes**

Run: `node test/unit/ai-pipeline-logging.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 11: Run focused verification for the full pipeline

**Files:**
- Test only

**Step 1: Run targeted new tests**

Run:
- `node test/unit/ai-config-validation.test.js`
- `node test/unit/ai-context-metadata.test.js`
- `node test/unit/ai-bot-facts.test.js`
- `node test/unit/ai-reply-gate.test.js`
- `node test/unit/ai-context-selector.test.js`
- `node test/unit/ai-response-mode.test.js`
- `node test/unit/ai-prompt-assembler.test.js`
- `node test/unit/messageHandler-ai-pipeline.test.js`
- `node test/unit/ai-memory-assembly.test.js`
- `node test/unit/ai-pipeline-logging.test.js`

Expected: PASS

**Step 2: Run regression checks for existing AI-adjacent behavior**

Run:
- `node test/unit/messageHandler-ai-idempotency.test.js`
- `node test/unit/messageHandler-blacklistType.test.js`

Expected: PASS

**Step 3: If Python or dashboard code was not touched, skip broader verification**

Expected: No extra unrelated verification needed.

**Step 4: Commit**

Do not commit without explicit user approval.

### Task 12: Optional follow-up tuning after rollout

**Files:**
- Modify as needed after observing runtime behavior

**Step 1: Observe runtime behavior in a noisy group**

Collect:
- gate hit rate
- busy mode frequency
- false negative examples
- confirm-needed examples

**Step 2: Tune thresholds only if needed**

Prefer:
- threshold tuning
- alias tuning
- keyword tuning

Avoid:
- broadening action-like language
- weakening confirm-needed rules

**Step 3: Add any regression tests for discovered edge cases**

Run only the affected test files plus the relevant pipeline test.

**Step 4: Commit**

Do not commit without explicit user approval.
