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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <GlassCard className="p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center mb-4 text-blue-400">
              <Lock size={24} />
            </div>
            <h1 className="text-2xl font-bold text-white">管理员登录</h1>
            <p className="text-gray-400 mt-2">请输入密码以继续</p>
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
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 text-white placeholder-gray-500 transition-colors"
                placeholder="请输入管理员密码"
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02]"
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
