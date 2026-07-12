import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import api from '../../../utils/auth'
import useSettingsData from './useSettingsData'

vi.mock('../../../utils/auth', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() }
}))

const initialConfig = { generation: 4, subscriptionCheckInterval: 300 }
const recoveryStatus = {
  documentGeneration: 4,
  effectiveGeneration: 3,
  recoveryRequired: { required: true, code: 'CONFIG_RECOVERY_FAILED', reason: 'runtime-reload-failed' }
}

function installInitialReads() {
  api.get.mockImplementation(async (url) => {
    if (url === '/api/config') return { data: initialConfig }
    if (url === '/api/config/status') return { data: recoveryStatus }
    if (url === '/api/blacklist/global') return { data: [] }
    if (url === '/api/bili/global-status') return { data: { isLoggedIn: false } }
    if (url === '/api/qq-provider/status') return { data: { provider: null } }
    if (url === '/api/config/migrations') return { data: { migration: null } }
    throw new Error(`unexpected GET ${url}`)
  })
}

describe('useSettingsData recovery interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installInitialReads()
  })

  it('coalesces repeated recovery clicks and refreshes one consistent post-recovery snapshot', async () => {
    let releaseRecovery
    api.post.mockImplementation((url) => {
      expect(url).toBe('/api/config/recover')
      return new Promise(resolve => { releaseRecovery = () => resolve({ data: { recovered: true, handlers: ['qq-provider-runtime'] } }) })
    })
    const show = vi.fn()
    const { result } = renderHook(() => useSettingsData(show))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first
    let duplicate
    act(() => {
      first = result.current.recoverConfig()
      duplicate = result.current.recoverConfig()
    })
    expect(api.post).toHaveBeenCalledTimes(1)

    api.get.mockImplementation(async (url) => {
      if (url === '/api/config') return { data: { generation: 5, subscriptionCheckInterval: 901 } }
      if (url === '/api/config/status') return { data: { documentGeneration: 5, effectiveGeneration: 5, recoveryRequired: null } }
      throw new Error(`unexpected post-recovery GET ${url}`)
    })
    releaseRecovery()
    await act(async () => { await Promise.all([first, duplicate]) })

    expect(result.current.configStatus.recoveryRequired).toBeNull()
    expect(result.current.configStatus.documentGeneration).toBe(5)
    expect(result.current.generalConfig.subscriptionCheckInterval).toBe(901)
    expect(result.current.recoveryResult).toMatchObject({ ok: true, documentGeneration: 5, effectiveGeneration: 5 })
  })

  it('projects a failed recovery safely and permits a successful retry', async () => {
    api.post
      .mockRejectedValueOnce({ response: { data: { code: 'CONFIG_RECOVERY_TOKEN_STALE', phase: 'cleanup', error: 'secret=hidden' } } })
      .mockResolvedValueOnce({ data: { recovered: true } })
    const show = vi.fn()
    const { result } = renderHook(() => useSettingsData(show))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.recoverConfig() })
    expect(result.current.recoveryResult).toEqual({ ok: false, code: 'CONFIG_RECOVERY_TOKEN_STALE', phase: 'cleanup' })
    expect(JSON.stringify(result.current.recoveryResult)).not.toContain('secret=hidden')

    api.get.mockImplementation(async (url) => {
      if (url === '/api/config') return { data: { generation: 6 } }
      if (url === '/api/config/status') return { data: { documentGeneration: 6, effectiveGeneration: 6, recoveryRequired: null } }
      throw new Error(`unexpected retry GET ${url}`)
    })
    await act(async () => { await result.current.recoverConfig() })
    expect(api.post).toHaveBeenCalledTimes(2)
    expect(result.current.recoveryResult).toMatchObject({ ok: true, documentGeneration: 6, effectiveGeneration: 6 })
  })

  it('renders recovery state when every non-bootstrap API remains admission-paused', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/api/config') return { data: initialConfig }
      if (url === '/api/config/status') return { data: recoveryStatus }
      const error = new Error('APPLICATION_INGRESS_PAUSED')
      error.response = { status: 503, data: { error: 'APPLICATION_INGRESS_PAUSED' } }
      throw error
    })

    const show = vi.fn()
    const { result } = renderHook(() => useSettingsData(show))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.configStatus.recoveryRequired).toMatchObject({
      required: true,
      code: 'CONFIG_RECOVERY_FAILED'
    })
    expect(result.current.blacklist).toEqual([])
    expect(result.current.qqProviderStatus).toBeNull()
    expect(result.current.migrationStatus).toBeNull()
    expect(show).not.toHaveBeenCalledWith('加载设置失败', 'error')
  })

  it('does not lock the UI for CONFIG_RELOAD_ERROR after a complete rollback', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/api/config') return { data: initialConfig }
      if (url === '/api/config/status') return { data: { documentGeneration: 4, effectiveGeneration: 4, recoveryRequired: null, pendingRuntimeRecovery: null } }
      if (url === '/api/blacklist/global') return { data: [] }
      if (url === '/api/bili/global-status') return { data: { isLoggedIn: false } }
      if (url === '/api/qq-provider/status') return { data: { provider: null } }
      if (url === '/api/config/migrations') return { data: { migration: null } }
      throw new Error(`unexpected GET ${url}`)
    })
    api.post.mockRejectedValue({
      response: { data: { code: 'CONFIG_RELOAD_ERROR', recoveryRequired: null, pendingRuntimeRecovery: null } }
    })
    const show = vi.fn()
    const { result } = renderHook(() => useSettingsData(show))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.reloadConfig() })
    expect(result.current.configStatus.recoveryRequired).toBeNull()
  })

  it('locks the UI only when the backend returns required true', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/api/config') return { data: initialConfig }
      if (url === '/api/config/status') return { data: { documentGeneration: 4, effectiveGeneration: 4, recoveryRequired: null } }
      if (url === '/api/blacklist/global') return { data: [] }
      if (url === '/api/bili/global-status') return { data: { isLoggedIn: false } }
      if (url === '/api/qq-provider/status') return { data: { provider: null } }
      if (url === '/api/config/migrations') return { data: { migration: null } }
      throw new Error(`unexpected GET ${url}`)
    })
    api.post.mockRejectedValue({ response: { data: {
      code: 'CONFIG_RELOAD_ERROR',
      generation: 4,
      recoveryRequired: { required: true, code: 'CONFIG_RECOVERY_REQUIRED', reason: 'runtime-reload-failed' },
      pendingRuntimeRecovery: { required: true, handlers: ['qq-provider-runtime'], rollbackErrors: [] }
    } } })
    const show = vi.fn()
    const { result } = renderHook(() => useSettingsData(show))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.reloadConfig() })
    expect(result.current.configStatus.recoveryRequired).toMatchObject({ required: true, code: 'CONFIG_RECOVERY_REQUIRED' })
    expect(result.current.configStatus.pendingRuntimeRecovery.handlers).toEqual(['qq-provider-runtime'])
  })
})
