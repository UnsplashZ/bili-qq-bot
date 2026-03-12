# Image Crop And Badge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make multi-image thumbnails crop from the top and slightly enlarge long-image / animated-image badges.

**Architecture:** Keep renderer branches unchanged and implement the behavior as CSS-only updates in the shared theme layer. This limits risk to layout styling while preserving current dynamic image count handling and badge detection.

**Tech Stack:** Node.js, server-rendered HTML, shared CSS from `src/services/imageGenerator/core/theme.js`

---

### Task 1: Document the approved design

**Files:**
- Create: `docs/plans/2026-03-12-image-crop-badge-design.md`

**Step 1: Record the approved scope**

Write the confirmed scope and non-goals for dynamic grids, forwarded grids, and user profile preview images.

**Step 2: Record verification expectations**

Note that CSS-only changes still need the smallest relevant verification and that residual visual risk must be reported if screenshot-based verification is not run.

### Task 2: Update the shared image styles

**Files:**
- Modify: `src/services/imageGenerator/core/theme.js`

**Step 1: Add top-aligned cropping for multi-image thumbnails**

Update `.images-grid .image-item img` to keep `object-fit: cover` and add `object-position: top`.

**Step 2: Add top-aligned cropping for user profile preview images**

Update `.user-dynamic-image` to add `object-position: top`.

**Step 3: Slightly enlarge the image type badge**

Increase the size of `.image-type-badge` by tuning `min-width`, `height`, `padding`, and `font-size` conservatively.

### Task 3: Verify the affected scope

**Files:**
- Test: `test/unit/imageGenerator.test.js` if present, otherwise nearest related unit test scope

**Step 1: Find the smallest relevant test command**

Identify the nearest existing image generator or renderer test command.

**Step 2: Run the targeted verification**

Execute the smallest relevant automated test command and confirm it passes.

**Step 3: Report residual risk**

If there is no visual regression test for CSS cropping details, call that out explicitly in the final response.
