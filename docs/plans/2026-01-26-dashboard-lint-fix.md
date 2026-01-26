# Dashboard Lint Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix all linting errors in the dashboard project to ensure a clean codebase and reliable CI/CD pipeline.

**Architecture:**
- **Configuration:** Update ESLint/Vite config to recognize Node.js globals.
- **Components:** Fix unused variable warnings and React Refresh HMR issues by splitting components/hooks or adjusting exports.
- **Hooks:** Fix `useEffect` dependency warnings by ensuring comprehensive dependency arrays.

**Tech Stack:** React, Vite, ESLint.

---

### Task 1: Fix Vite Config & Layout Lint Errors

**Files:**
- Modify: `dashboard/vite.config.js`
- Modify: `dashboard/src/components/Layout.jsx`

**Step 1: Fix `process is not defined` in vite.config.js**
- Add `/* eslint-env node */` to the top of the file.
- This tells ESLint that this file runs in a Node.js environment, resolving the `process` undefined error.

**Step 2: Fix `Icon is defined but never used` in Layout.jsx**
- The error `5:30 error 'Icon' is defined but never used` suggests ESLint isn't correctly tracking the usage of `Icon` when destructured as `icon: Icon`.
- Verify usage: `<Icon size={20} />` is present.
- Fix: Add `// eslint-disable-next-line react/prop-types` or verify if it's a false positive. If strictly unused (which is unlikely given the code), remove it. But here it looks like a false positive or configuration nuance.
- *Better approach:* Ensure `react/prop-types` isn't flagging it. Or, simpler: explicitly verify the component usage. If it's a false positive on the destructured alias, we can suppress it for that line or check `eslint-plugin-react` config.
- *Action:* We will add `/* eslint-disable react/prop-types */` if it's prop-types related, or check if we can simplify the component definition.

---

### Task 2: Fix React Refresh & Unused Vars in Components

**Files:**
- Modify: `dashboard/src/components/ToastProvider.jsx`
- Modify: `dashboard/src/components/Toast.jsx`

**Step 1: Fix Fast Refresh warning in ToastProvider.jsx**
- Error: `Fast refresh only works when a file only exports components`.
- `ToastProvider.jsx` exports both `useToast` (hook) and `ToastProvider` (component).
- **Solution:** Move `useToast` context definition and hook to a separate file, e.g., `dashboard/src/context/ToastContext.js`, or verify if we can just accept the warning. The warning says "Use a new file".
- **Plan:** Split the file.
    - Create `dashboard/src/context/ToastContext.jsx` containing the Context creation and `useToast` hook.
    - Import them in `ToastProvider.jsx`.
    - *Wait*, simpler fix for now to avoid large refactors: Ensure `ToastProvider` is the default export and `useToast` is a named export, but Vite is strict.
    - **Decision:** Split into `ToastContext.jsx` (defines context + hook) and `ToastProvider.jsx` (defines provider component). But this might break imports in `App.jsx` etc.
    - **Alternative (Low risk):** Ignore the warning line if HMR isn't critical, but better to fix.
    - **Refactor:** Move `ToastContext` and `useToast` to `dashboard/src/contexts/ToastContext.jsx`. Update `ToastProvider.jsx` to import context. Update consumers (`Login.jsx`, `Groups.jsx`) to import `useToast` from new location.
    - *Actually*: We can keep them in one file if we accept HMR might fallback to full reload. But the plan should aim for "Clean".
    - **Refactor Plan:** Move `useToast` and `ToastContext` to `dashboard/src/contexts/ToastContext.jsx`.

**Step 2: Fix unused `motion` in Toast.jsx**
- Error: `'motion' is defined but never used`.
- Usage: `<motion.div ...>`.
- This is likely a false positive if `framer-motion` is used.
- **Fix:** Check if `motion` is imported but maybe the component uses `AnimatePresence` from a different import?
- Code check: `import { motion } from 'framer-motion';` and usage `<motion.div>`.
- Fix: Ensure `eslint-plugin-react` handles usages in JSX. If it's a stubborn false positive, add `// eslint-disable-line no-unused-vars`.

---

### Task 3: Fix Hooks Dependencies in Groups.jsx

**Files:**
- Modify: `dashboard/src/pages/Groups.jsx`

**Step 1: Fix exhaustive-deps warning**
- Error: `useEffect has missing dependencies: 'fetchSubscriptions' and 'selectedTabIndex'`.
- Code line 111: `useEffect(() => { ... }, [selectedTabIndex, selectedGroupId, fetchSubscriptions])`. Wait, line 111 HAS dependencies.
- The warning is likely on the **other** `useEffect` or `fetchSubscriptions` itself?
- Lint output says line 104.
- Code at 104:
  ```javascript
  useEffect(() => {
    if (selectedGroupId) { ... }
  }, [selectedGroupId, groups]);
  ```
- Inside this effect: `if (selectedTabIndex === 1) { fetchSubscriptions(selectedGroupId); }`.
- **Fix:** Add `selectedTabIndex` and `fetchSubscriptions` to the dependency array of this `useEffect`.
- *Caution:* Adding `fetchSubscriptions` (which is a `useCallback`) is safe. Adding `selectedTabIndex` might cause re-runs when tab changes, which is effectively what the *other* effect (line 107) does.
- Analysis: Line 104 effect is for "When Group Changes" -> update form data.
- Line 107 effect is for "When Tab Changes" -> fetch subs.
- The logic at 104 *also* checks "If we are on subs tab, fetch subs".
- If we add `selectedTabIndex` to dependency at 104, it merges the behavior of 107. We might be able to merge these effects or just satisfy the linter.
- **Solution:** Add `selectedTabIndex` and `fetchSubscriptions` to dependency array.

---
