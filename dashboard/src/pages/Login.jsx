import React, { useState } from 'react';
import GlassCard from '../components/GlassCard';
import { Button } from '../components/ui';
import { login } from '../utils/auth';
import { useToast } from '../hooks/useToast';
import { Lock, Loader2 } from 'lucide-react';

const Login = () => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { show } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) {
      show('请输入密码', 'error');
      return;
    }

    setLoading(true);
    try {
      await login(password);
      show('登录成功', 'success');
      window.location.href = '/';
    } catch (error) {
      console.error('Login failed:', error);
      const msg = error.response?.data?.message || '登录失败，请检查密码';
      show(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <GlassCard className="p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-[color-mix(in_oklch,var(--info)_34%,var(--border))] bg-[var(--info-soft)] text-[var(--info)]">
              <Lock size={24} />
            </div>
            <h1 className="text-2xl font-semibold text-[var(--fg)]">管理员登录</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-[var(--fg)]">
                密码
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-control w-full px-4 py-3 placeholder-gray-500 transition-colors"
                placeholder="请输入管理员密码"
                disabled={loading}
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              variant="primary"
              className="w-full py-3"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  验证中...
                </>
              ) : (
                '登录'
              )}
            </Button>
          </form>
        </GlassCard>
      </div>
    </div>
  );
};

export default Login;
