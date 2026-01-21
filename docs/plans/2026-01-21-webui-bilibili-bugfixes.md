# Bug Fix: Bilibili Login Status & QR Code Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix the "Not Logged In" display issue by implementing a status check endpoint, and fix the QR code rendering issue by optimizing DOM timing.

**Architecture:**
- **Backend:** Add a new `check_cookie` command to the Python service to verify login status (cookie existence + validity) and return UID. Expose this via a new API endpoint.
- **Frontend:** Fetch this status when rendering the group panel. For QR codes, ensure the container is visible and layout is complete before generating the code.

**Tech Stack:** Node.js, Express, Python (bilibili-api), Vanilla JS, qrcodejs2.

---

### Task 1: Backend - Implement Login Status Check

**Files:**
- Modify: `src/services/bili_service.py` (Add `check_cookie` command)
- Modify: `src/services/biliApi.js` (Add `getCredentialStatus` method)
- Modify: `src/web/routes/bilibili.js` (Add `GET /status` endpoint)

**Step 1: Update Python Service**
Add `check_cookie` command to `src/services/bili_service.py`. It should:
1.  Load credential for the group.
2.  If no credential -> return `{logged_in: False}`.
3.  If credential exists -> Call `user.get_self_info()` to verify and get UID.
4.  Return `{logged_in: True, uid: ..., name: ...}`.
5.  Handle errors (invalid cookie) -> return `{logged_in: False, message: ...}`.

**Step 2: Update BiliApi Service**
Add `getCredentialStatus(groupId)` to `src/services/biliApi.js` that calls the python command.

**Step 3: Add API Route**
Add `GET /status` to `src/web/routes/bilibili.js`.
- Query param: `groupId`
- Call `biliApi.getCredentialStatus`
- Return standardized JSON response.

**Step 4: Verify**
Run manually: `curl "http://localhost:3000/api/bilibili/status?groupId=123"`

---

### Task 2: Frontend - Integrate Login Status

**Files:**
- Modify: `src/web/public/js/api.js` (Add `getBilibiliStatus` method)
- Modify: `src/web/public/js/app.js` (Call status check in `renderGroupPanel`)

**Step 1: Update API Client**
Add `getBilibiliStatus(groupId)` to `API` class in `src/web/public/js/api.js`.

**Step 2: Update App Logic**
In `src/web/public/js/app.js`:
1.  Add `async updateBilibiliStatus(groupId)` method.
    -   Call `api.getBilibiliStatus`.
    -   Update `#biliLoginStatus`, `#biliAccountUid`, `#lastLoginTime` elements.
    -   Update `#groupBiliLoginBtn` text (e.g., "Switch Account" if logged in).
2.  Call `this.updateBilibiliStatus(groupId)` at the end of `renderGroupPanel`.

**Step 3: Verify**
Open the WebUI, click a group, and ensure "Not Logged In" updates to "Logged In (UID: ...)" if a cookie exists.

---

### Task 3: Frontend - Fix QR Code Rendering

**Files:**
- Modify: `src/web/public/js/app.js` (Fix `getLoginQrcode` timing)
- Modify: `src/web/public/css/app.css` (Ensure wrapper dimensions)

**Step 1: Update CSS**
Ensure `.qrcode-wrapper` has clear dimensions or display properties in `src/web/public/css/app.css`.
```css
.qrcode-wrapper {
  min-height: 256px;
  min-width: 256px;
  display: flex;
  justify-content: center;
  align-items: center;
  /* ... existing styles ... */
}
```

**Step 2: Update JS Timing**
In `src/web/public/js/app.js`, modify `getLoginQrcode`:
1.  Unhide the container.
2.  Use `setTimeout(() => { ... }, 50)` to delay `new QRCode(...)` call.
3.  Ensure `innerHTML = ''` is called before generation.
4.  Add a fallback: check if `img` tag is created successfully.

**Step 3: Verify**
Click "Login", click "Get QR Code", and verify the QR code renders immediately and correctly.
