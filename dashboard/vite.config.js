import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export function getPackageName(id) {
  const marker = 'node_modules/'
  const index = id.lastIndexOf(marker)
  if (index < 0) return ''

  const rest = id.slice(index + marker.length)
  if (rest.startsWith('@')) {
    return rest.split('/').slice(0, 2).join('/')
  }
  return rest.split('/')[0]
}

export function resolveVendorChunk(id) {
  const pkg = getPackageName(id)
  if (!pkg) return undefined

  if (pkg === 'lucide-react') return 'vendor-icons'
  if (pkg === 'recharts' || pkg.startsWith('d3-')) return 'vendor-charts'
  if (pkg === 'framer-motion') return 'vendor-motion'
  if (pkg === 'axios') return 'vendor-http'
  if (pkg === 'react' || pkg === 'react-dom' || pkg === 'react-router' || pkg === 'react-router-dom') {
    return 'vendor-react'
  }
  return undefined
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_TARGET || 'http://localhost:3000'

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            return resolveVendorChunk(id)
          }
        }
      }
    },
    server: {
      proxy: {
        '/api': {
          target: target,
          changeOrigin: true,
        }
      }
    }
  }
})
