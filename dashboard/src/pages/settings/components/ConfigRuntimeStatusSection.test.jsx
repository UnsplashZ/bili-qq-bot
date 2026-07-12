import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ConfigRuntimeStatusSection from './ConfigRuntimeStatusSection'

const recoveryStatus = {
  valid: true,
  documentGeneration: 7,
  effectiveGeneration: 6,
  recoveryRequired: {
    required: true,
    reason: 'runtime-reload-failed',
    code: 'CONFIG_RECOVERY_TOKEN_STALE',
    message: 'clientSecret=must-not-render'
  }
}

describe('ConfigRuntimeStatusSection recovery UI', () => {
  it('renders only structured recovery fields and disables reload while recovery is required', () => {
    const onReload = vi.fn()
    const onRecover = vi.fn()
    render(<ConfigRuntimeStatusSection
      status={recoveryStatus}
      reloading={false}
      recovering={false}
      onReload={onReload}
      onRecover={onRecover}
    />)

    expect(screen.getByText(/阶段：recovery-required/)).toHaveTextContent('错误码：CONFIG_RECOVERY_TOKEN_STALE')
    expect(screen.queryByText(/clientSecret|must-not-render/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /从磁盘重载/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /恢复运行时/ }))
    expect(onRecover).toHaveBeenCalledTimes(1)
  })

  it('shows a public failure code and phase and exposes retry without private messages', () => {
    const onRecover = vi.fn()
    render(<ConfigRuntimeStatusSection
      status={recoveryStatus}
      recoveryResult={{ ok: false, phase: 'cleanup', code: 'CONFIG_RECOVERY_FAILED', message: 'token=private' }}
      reloading={false}
      recovering={false}
      onReload={vi.fn()}
      onRecover={onRecover}
    />)

    expect(screen.getByText('cleanup / CONFIG_RECOVERY_FAILED')).toBeInTheDocument()
    expect(screen.queryByText(/token=private/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重试恢复/ }))
    expect(onRecover).toHaveBeenCalledTimes(1)
  })
})
