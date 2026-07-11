import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login'
import { login } from '../utils/auth'

vi.mock('../utils/auth', () => ({ login: vi.fn() }))
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ show: vi.fn() }) }))

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/settings" element={<div>recovery settings</div>} />
        <Route path="/" element={<div>dashboard home</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Login recovery navigation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('navigates an authenticated recovery session directly to Settings', async () => {
    login.mockResolvedValue({ token: 'redacted', recoveryRequired: true, redirectPath: '/settings' })
    renderLogin()
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'admin-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(screen.getByText('recovery settings')).toBeInTheDocument())
  })

  it('keeps the normal successful login destination unchanged', async () => {
    login.mockResolvedValue({ token: 'redacted', recoveryRequired: false, redirectPath: '/' })
    renderLogin()
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'admin-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(screen.getByText('dashboard home')).toBeInTheDocument())
  })
})
