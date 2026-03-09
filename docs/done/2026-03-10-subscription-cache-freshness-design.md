# Subscription Cache Freshness Design

**Date:** 2026-03-10

**Status:** Implemented

**Goal:** Eliminate subscription false negatives caused by stale cache reads, with freshness taking priority over API savings for state-sensitive checks.

## Problem Summary

The current subscription state pipeline can misclassify live and other mutable user states because it reads cached API responses during monitoring.

The confirmed live push failure for UID `108618052` exposed the issue:

- The subscription record existed and `lastLiveStatus` remained `0`
- The scheduled checker kept running on the server
- Direct `/user_info` and `/live_room` calls showed the streamer was online
- The scheduled live check never advanced to the online notification branch

The root cause is the interaction between the cache layer and state-sensitive checks:

- `checkUserLive()` calls cached `biliApi.getUserInfo()`
- cache expiry uses file `mtime`
- cache reads update that same `mtime`
- a stale cached offline result can therefore be kept alive indefinitely by repeated reads

This is not limited to live status. Any mutable state read through the same cache model is exposed to the same class of bug.

## Design Goals

- Prioritize freshness over API savings for monitoring and state-decision paths
- Preserve caching for display-oriented reads where stale data is acceptable
- Fix cache expiry semantics so repeated reads do not extend freshness
- Keep the change narrow enough to ship safely without reworking unrelated services
- Add regression coverage for stale-cache false negatives

## Options Considered

### Option A: Patch only the live checker

Change the live subscription path to bypass cache.

Pros:
- Lowest code churn
- Fastest hotfix

Cons:
- Does not solve the broader class of user/dynamic state misclassification
- Leaves the broken cache semantics intact

### Option B: Fix cache semantics and add freshness policy

Keep cache as a reusable service, but distinguish between:

- state-sensitive monitoring reads, which must fetch fresh data
- presentation reads, which may use cached data

Pros:
- Fixes the root cause instead of just the current symptom
- Preserves cache value for previews and non-critical reads
- Scales to future mutable-state checks

Cons:
- Slightly larger change set
- Requires careful regression coverage

### Option C: Disable caching for user/dynamic/live related data globally

Pros:
- Simple mental model
- Maximum freshness

Cons:
- Unnecessarily high request volume
- Throws away cache value for previews and non-critical paths
- Broadest behavioral change

## Chosen Approach

Option B.

We will repair the cache model itself and make state-sensitive paths opt into guaranteed fresh reads.

## Architecture

### 1. Replace “read refreshes TTL” with absolute freshness

`cacheManager` should treat freshness as “time since fetch”, not “time since last read”.

Design:

- Cache entries should carry explicit fetch metadata, for example `fetchedAt`
- Expiry should compare `Date.now()` to `fetchedAt`
- Reads must not update the freshness timestamp
- Legacy raw cache files should still be readable during rollout

This prevents stale entries from staying alive simply because the checker touches them repeatedly.

### 2. Introduce cache policy at API call sites

`biliApi` should expose intent clearly:

- `cached`: allow cache reads
- `fresh`: bypass cache reads and fetch from upstream

Fresh reads may still write back the latest successful result so display flows benefit from newer data later.

### 3. Route monitoring paths to fresh reads

All subscription and state-decision paths should use fresh reads for mutable state.

Initial scope:

- manual live checks that currently read `user_info`
- any subscription decision path that uses cached mutable user state
- existing real-time endpoints that are already uncached remain unchanged

Display and preview paths can continue to use cached reads unless a concrete correctness issue is found there too.

### 4. Preserve operational safety

To avoid legacy cache artifacts affecting the first post-fix runs, rollout should include one of:

- one-time targeted cache cleanup for mutable prefixes
- one-time in-code invalidation for legacy entries in those prefixes

The safer initial rollout is targeted cleanup during deployment.

## Scope Boundaries

Included:

- `src/utils/cacheManager.js`
- `src/services/biliApi.js`
- subscription/update checker paths that make freshness-sensitive decisions
- targeted regression tests

Not included:

- dashboard UI changes
- unrelated cache consumers unless audit shows they are part of mutable-state decision logic
- major storage redesign

## Risks

### Increased upstream request volume

Expected and acceptable for monitoring paths because freshness is the priority.

Mitigation:

- keep cached behavior for non-monitoring paths
- limit fresh reads to decision points instead of disabling cache everywhere

### Legacy cache compatibility

Changing cache file structure can break older cache entries if migration is too strict.

Mitigation:

- support both legacy raw payload and wrapped payload during read
- rewrite to the new shape on successful fresh fetch

### Hidden mutable-state call sites

There may be additional state-sensitive reads outside the confirmed live path.

Mitigation:

- audit all subscription/update checker uses of cached `biliApi` methods
- add regression tests around the known live failure and at least one generalized stale-state scenario

## Verification Strategy

- Unit test cache expiry based on fetch time, not read time
- Unit test legacy cache entries remain readable
- Unit test fresh policy bypasses cache reads but still updates cache on success
- Regression test live subscription: stale cached offline `user_info` plus fresh online upstream result must produce an online transition
- Run targeted existing subscription tests to ensure state-advance logic is preserved

## Rollout Plan

1. Ship the cache semantic fix and fresh-read policy together
2. Clear mutable state cache files on the server during deployment
3. Run a targeted “check now” or wait for the next scheduled cycle
4. Confirm affected subscriptions advance from `lastLiveStatus: 0` to `1` and notifications are emitted

## Recommendation

Implement the minimum general solution:

- fix cache freshness semantics once
- force fresh reads for mutable-state monitoring
- keep cache for presentation reads

This addresses the confirmed live notification failure and closes the broader class of stale-cache false negatives without paying the cost of disabling cache globally.

## Implementation Outcome

Implemented in this work:

- `cacheManager` now expires cache entries based on explicit fetch time instead of read-refreshed file `mtime`
- `biliApi` now supports explicit cache policy selection (`fresh` / `cached`) while keeping legacy boolean callers compatible
- subscription state-sensitive paths now use fresh reads for mutable user state

Verified locally:

- targeted cache freshness regression tests passed
- targeted subscription regression tests passed
- local manual live checks for UID `51628309` and UID `108618052` both advanced `lastLiveStatus` from `0` to `1` and entered the live notification branch when upstream data reported `liveStatus=1`
