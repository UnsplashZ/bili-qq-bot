import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import viteConfig, { getPackageName, resolveVendorChunk } from '../../../dashboard/vite.config.js'

describe('dashboard vite manual chunks', function () {
    it('按 node_modules 包名解析 scoped 与普通包名', function () {
        assert.equal(getPackageName('/repo/dashboard/node_modules/lucide-react/dist/esm/icons/x.js'), 'lucide-react')
        assert.equal(getPackageName('/repo/dashboard/node_modules/@vitejs/plugin-react/dist/index.js'), '@vitejs/plugin-react')
        assert.equal(getPackageName('/repo/dashboard/src/App.jsx'), '')
    })

    it('关键依赖应被拆到稳定 vendor chunk', function () {
        const cases = [
            ['/repo/dashboard/node_modules/lucide-react/dist/esm/icons/circle.js', 'vendor-icons'],
            ['/repo/dashboard/node_modules/react/index.js', 'vendor-react'],
            ['/repo/dashboard/node_modules/react-dom/client.js', 'vendor-react'],
            ['/repo/dashboard/node_modules/react-router-dom/dist/index.js', 'vendor-react'],
            ['/repo/dashboard/node_modules/recharts/es6/chart/LineChart.js', 'vendor-charts'],
            ['/repo/dashboard/node_modules/d3-scale/src/index.js', 'vendor-charts'],
            ['/repo/dashboard/node_modules/d3-array/src/index.js', 'vendor-charts'],
            ['/repo/dashboard/node_modules/framer-motion/dist/es/index.mjs', 'vendor-motion'],
            ['/repo/dashboard/node_modules/axios/lib/axios.js', 'vendor-http']
        ]

        for (const [id, chunkName] of cases) {
            assert.equal(resolveVendorChunk(id), chunkName, `${id} should map to ${chunkName}`)
        }
    })

    it('build.manualChunks 使用同一解析器，避免大依赖回落到默认 chunk', function () {
        const resolved = viteConfig({ mode: 'test', command: 'build' })
        const manualChunks = resolved?.build?.rollupOptions?.output?.manualChunks

        assert.equal(typeof manualChunks, 'function')
        assert.equal(
            manualChunks('/repo/dashboard/node_modules/recharts/es6/index.js'),
            'vendor-charts'
        )
        assert.equal(
            manualChunks('/repo/dashboard/node_modules/framer-motion/dist/es/index.mjs'),
            'vendor-motion'
        )
        assert.equal(
            manualChunks('/repo/dashboard/node_modules/axios/lib/axios.js'),
            'vendor-http'
        )
    })
})
