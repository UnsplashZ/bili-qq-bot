# Subscription System Refactoring Plan: Check Now Logic & Deduplication

## 1. Problem Definition

### Current Behavior
The "Check Now" (`checkSubscriptionNow`) feature allows a user to manually trigger a check for a specific subscription in a specific group.
1. It calls `checkUserDynamic` with `force=true`.
2. It constructs a temporary subscription object containing only the current `groupId`.
3. It sends a notification to the current group if a new dynamic is found.
4. **Critical Issue**: Because `force=true` is used, the global `lastDynamicId` for that user is **NOT updated**.
5. When the scheduled `UpdateChecker` runs later, it compares the latest dynamic ID with the stale `lastDynamicId`.
6. It detects a "new" update and broadcasts it to **ALL** subscribed groups, including the one that already received the "Check Now" notification.
7. Result: The user in the triggering group receives the same notification twice.

### Constraints
- `UserSubscription` data structure groups multiple `groupIds` under a single `uid`.
- `lastDynamicId` is stored at the `UserSubscription` level (global for that user), not per group.
- We cannot simply update `lastDynamicId` during "Check Now" because doing so would silence notifications for **other** groups that haven't received them yet.

## 2. Proposed Solution: Notification Deduplication Cache

Instead of changing the data structure (which requires migration) or changing the command semantics, we introduce a **deduplication layer** in memory.

### Core Concept
Maintain a transient record of `(GroupId, DynamicId)` pairs that have successfully received a notification. Before sending any notification, check this record.

### Detailed Design

#### 2.1. New Component: `NotificationHistory`
A lightweight, in-memory cache class (or integrated into `UpdateChecker`) to track recent notifications.

```javascript
class NotificationHistory {
    constructor() {
        // Map<"groupId:dynamicId", timestamp>
        this.history = new Map();
        this.ttl = 10 * 60 * 1000; // 10 minutes TTL (sufficient for update intervals)
    }

    add(groupId, dynamicId) {
        const key = `${groupId}:${dynamicId}`;
        this.history.set(key, Date.now());
        this.cleanup();
    }

    has(groupId, dynamicId) {
        const key = `${groupId}:${dynamicId}`;
        return this.history.has(key);
    }

    cleanup() {
        const now = Date.now();
        for (const [key, timestamp] of this.history.entries()) {
            if (now - timestamp > this.ttl) {
                this.history.delete(key);
            }
        }
    }
}
```

#### 2.2. Modified `checkSubscriptionNow` Flow
1. Fetch latest dynamic.
2. If new, send notification to the requesting `groupId`.
3. **NEW**: Call `NotificationHistory.add(groupId, latestDynamicId)`.
4. Do NOT update `lastDynamicId` (preserve existing logic to protect other groups).

#### 2.3. Modified `UpdateChecker.checkUserDynamic` Flow
1. Fetch latest dynamic.
2. If `latestId !== sub.lastDynamicId`:
   - Iterate through `sub.groupIds`.
   - **NEW**: For each group, check `NotificationHistory.has(groupId, latestId)`.
   - If present: Skip notification (log: "Skipping duplicate notification").
   - If absent: Send notification AND add to history (to prevent double sends in edge cases).
3. After processing all groups, update `lastDynamicId` as usual.

### Pros & Cons
- **Pros**: 
  - Zero database/file schema changes.
  - Fixes the duplicate notification issue completely.
  - Low memory footprint.
- **Cons**: 
  - State is lost on restart (acceptable, as "Check Now" is an interactive runtime operation).

## 3. Alternative Solution: Global Refresh (Rejected)

An alternative was to make "Check Now" trigger a full update for all groups.
- **Behavior**: When user checks in Group A, Bot checks updates and notifies Group A, Group B, and Group C immediately, then updates `lastDynamicId`.
- **Reason for Rejection**: This changes the semantics of the command. A user in Group A might not have the authority or intention to spam Group B and C. The current "local check" semantic is safer.

## 4. Implementation Steps

1. **Create `src/utils/notificationHistory.js`**: Implement the TTL cache.
2. **Integrate into `UpdateChecker`**:
   - Instantiate `NotificationHistory`.
   - In `notifyGroups` / `notifyGroupsWithImage`, add the check-before-send logic.
   - Alternatively, handle this logic inside `checkUserDynamic` loop before calling notify methods.
3. **Update `SubscriptionService`**:
   - Ensure `checkSubscriptionNow` calls the history recording method after a successful manual check.

## 5. Future Work (Long Term)

If the subscription system becomes more complex, consider splitting `UserSubscription` so that read state (`lastDynamicId`) is tracked per-group (Schema: `UserGroupSubscription`). This would allow independent state management but requires significant data migration.
