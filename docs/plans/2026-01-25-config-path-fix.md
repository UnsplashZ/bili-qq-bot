# ServiceManager Configuration Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove hardcoded Python script path in `ServiceManager.js` and enforce usage of `config.biliScriptPath` to ensure configuration consistency and avoid dead code.

**Architecture:**
Modify `ServiceManager` to read the script path from the global `config` object. Use `path.resolve()` to ensure the path is correctly located regardless of where the process is started, assuming the config path is relative to the project root.

**Tech Stack:** Node.js

---

### Task 1: Update ServiceManager Path Logic

**Files:**
- Modify: `src/services/ServiceManager.js`

**Step 1: Write verification test**
Create a test script `test_config_path.js` that instantiates `ServiceManager` and checks if `scriptPath` matches the config value (resolved absolute path).

```javascript
const serviceManager = require('./src/services/ServiceManager');
const config = require('./src/config');
const path = require('path');

console.log('Config Path:', config.biliScriptPath);
console.log('Service Path:', serviceManager.scriptPath);

const expected = path.resolve(process.cwd(), config.biliScriptPath);
if (serviceManager.scriptPath !== expected) {
    console.error(`FAIL: Path mismatch.\nExpected: ${expected}\nActual: ${serviceManager.scriptPath}`);
    process.exit(1);
}
console.log('PASS: Paths match');
```

**Step 2: Modify ServiceManager.js**
Change the constructor to use `config.biliScriptPath`.

```javascript
// src/services/ServiceManager.js

// OLD: this.scriptPath = path.join(__dirname, 'bili_server.py');
// NEW:
this.scriptPath = path.resolve(process.cwd(), config.biliScriptPath || 'src/services/bili_server.py');
```

**Step 3: Verify**
Run `node test_config_path.js`.

**Step 4: Cleanup**
Delete `test_config_path.js`.

---

### Task 2: Safety Check

**Files:**
- Check: `src/config.js`

**Step 1: Verify Config Default**
Ensure `src/config.js` sets a valid default relative to project root. We already updated it to `./src/services/bili_server.py`, which is correct.

**Step 2: Integration Test**
Run the existing `test_integration.js` one last time to ensure the Python server still starts up correctly with the new path resolution.

