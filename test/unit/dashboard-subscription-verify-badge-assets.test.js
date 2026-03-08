const assert = require('assert')
const fs = require('fs')
const path = require('path')

describe('dashboard subscription verify badge assets', function () {
    it('SubscriptionsTab 应使用前端本地 SVG 认证图标而不是 BadgeCheck', function () {
        const componentPath = path.join(
            process.cwd(),
            'dashboard',
            'src',
            'pages',
            'groups',
            'components',
            'tabs',
            'SubscriptionsTab.jsx'
        )
        const componentSource = fs.readFileSync(componentPath, 'utf8')

        assert.ok(
            !componentSource.includes('BadgeCheck'),
            'SubscriptionsTab 仍在使用 BadgeCheck'
        )
        assert.ok(
            componentSource.includes('PERSONAL_OFFICIAL_VERIFY.svg'),
            'SubscriptionsTab 未引用个人认证 SVG'
        )
        assert.ok(
            componentSource.includes('ORGANIZATION_OFFICIAL_VERIFY.svg'),
            'SubscriptionsTab 未引用机构认证 SVG'
        )
    })
})
