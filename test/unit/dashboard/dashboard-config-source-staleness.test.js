'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '../../..')

describe('Dashboard canonical config source documentation', () => {
    it('does not direct users to legacy Dashboard environment variables', () => {
        const dashboardReadme = fs.readFileSync(path.join(repoRoot, 'dashboard/README.md'), 'utf8')
        const rootReadme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
        const authSource = fs.readFileSync(path.join(repoRoot, 'src/dashboard/middleware/auth.js'), 'utf8')
        const combined = `${rootReadme}\n${dashboardReadme}\n${authSource}`

        assert.doesNotMatch(combined, /DASHBOARD_(?:PASSWORD|ALLOWED_ORIGINS)/)
        assert.match(dashboardReadme, /config\/config\.yaml/)
        assert.match(dashboardReadme, /dashboard\.password/)
        assert.match(dashboardReadme, /dashboard\.allowedOrigins/)
        assert.match(authSource, /config\/config\.yaml dashboard\.allowedOrigins/)
        assert.doesNotMatch(rootReadme, /dashboard\.password[^。\n]*(?:WebUI|管理面板)(?:修改|更改)/)
    })
})
