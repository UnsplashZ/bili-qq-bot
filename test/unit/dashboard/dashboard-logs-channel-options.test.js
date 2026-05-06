#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.join(__dirname, '../../../dashboard/src/pages/Logs.jsx'), 'utf8')
const match = source.match(/const CHANNEL_OPTIONS = \[([^\]]+)\]/)

assert.ok(match, 'Logs.jsx should define CHANNEL_OPTIONS')
assert.ok(match[1].includes("'AGENT'"), 'Logs channel filters should include AGENT')

console.log('PASS dashboard-logs-channel-options')
