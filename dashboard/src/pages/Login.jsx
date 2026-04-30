import React, { useState } from 'react';
import GlassCard from '../components/GlassCard';
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
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
              <Lock size={24} />
            </div>
            <h1 className="text-2xl font-semibold text-white">管理员登录</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
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

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center rounded-lg bg-cyan-500/20 px-4 py-3 font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  验证中...
                </>
              ) : (
                '登录'
              )}
            </button>
          </form>
        </GlassCard>
      </div>
    </div>
  );
};

export default Login;
