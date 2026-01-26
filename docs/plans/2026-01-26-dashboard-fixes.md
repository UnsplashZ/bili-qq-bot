# Dashboard Fixes & Enhancements Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix layout issues on MacBook screens, consistency issues in subscription categories (backend support for 'dynamic'), and subscription list display (missing UIDs).

**Architecture:**
- **Backend:** Update API to support 'dynamic' subscription type and normalize data structure (map `uid` -> `value`) so frontend matches.
- **Frontend:** Improve responsive grid for Dashboard summary cards and update Groups subscription list to show both Name and UID.

**Tech Stack:** Node.js, Express, React, Tailwind CSS.

---

### Task 1: Backend - Fix Subscription Types & Response Structure

**Files:**
- Modify: `src/dashboard/routes/api.js`

**Step 1: Update GET /groups/:id/subscriptions**
- In `router.get('/groups/:id/subscriptions', ...)`:
- Modify the `mergedSubs` mapping.
- For users: `...u, type: 'user', value: u.uid` (Ensure `value` exists).
- For bangumi: `...b, type: 'bangumi', value: b.seasonId` (Ensure `value` exists).

**Step 2: Update POST & DELETE /groups/:id/subscriptions**
- Locate the logic checking subscription types (around lines 236 and 264).
- Change `if (type === 'video' || type === 'live' || type === 'user')` to include `|| type === 'dynamic'`.
- This ensures 'dynamic' subscriptions (which use user UIDs) are processed correctly by `subscriptionService`.

**Step 3: Verification**
- Restart backend.
- `curl` POST with `type: dynamic`.
- `curl` GET and verify `value` field exists in JSON.

---

### Task 2: Frontend - Fix Groups Subscription List

**Files:**
- Modify: `dashboard/src/pages/Groups.jsx`

**Step 1: Update Table Display**
- In the subscription list table (around line 404).
- Change the display logic for the "值 / ID" column.
- Current: `{sub.name || sub.value}`
- New:
  ```jsx
  <div className="flex flex-col">
    <span className="text-white font-medium">{sub.name || '未知用户'}</span>
    <span className="text-gray-500 text-xs font-mono">{sub.value}</span>
  </div>
  ```
  *(Or single line: `{sub.name ? `${sub.name} (${sub.value})` : sub.value}`)*. Let's use the 2-line approach for cleaner UI, or single line if space permits. Given the column width, single line `{sub.name} <span className="text-gray-500">({sub.value})</span>` might be better.

**Step 2: Update Delete Logic (Confirmation)**
- Verify `handleDeleteSubscription` uses `sub` object which now correctly has `value` (thanks to Task 1).
- No code change needed if `sub` now has `value`, as `api.delete` sends `data: sub`.

---

### Task 3: Frontend - Fix Dashboard Layout (MacBook View)

**Files:**
- Modify: `dashboard/src/pages/Dashboard.jsx`

**Step 1: Adjust Grid Breakpoints**
- Locate the Summary Grid container (line 56).
- Current: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
- Change to: `grid-cols-1 md:grid-cols-2 xl:grid-cols-4`
- Rationale: `lg` (1024px) is often too narrow for 4 columns with this content. Pushing 4 columns to `xl` (1280px) ensures MacBook Air/Pro (often scaled effectively to ~1440 or ~1280 width) might still hit `xl` or fall back to 2 columns if zoomed, preventing overlap.
- Actually, specifically for MacBook (13/14 inch), they often resolve to widths where 4 cols is tight. `xl` is safer.

**Step 2: Prevent Text Overflow**
- Inside `GlassCard` (lines 57-104), ensure text containers have `min-w-0` if using `truncate`.
- Or, simpler: Allow wrapping.
- In the "Network" card (lines 82-94), the text is:
  ```jsx
  <span className="text-lg font-bold">↑ {formatNetSpeed(...)}</span>
  <br />
  <span className="text-lg font-bold">↓ {formatNetSpeed(...)}</span>
  ```
  This usually fits, but if 4 cols are squeezed, it might overlap icon.
- Add `gap-4` is already there.
- The `xl:grid-cols-4` change should be sufficient.

---
