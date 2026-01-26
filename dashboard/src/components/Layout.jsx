import React from 'react';
import { Home, Users, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

// eslint-disable-next-line no-unused-vars
const SidebarItem = ({ icon: Icon, label, href, active }) => {
  return (
    <Link
      to={href}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
    </Link>
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const path = location.pathname;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-black text-white">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-black/20 backdrop-blur-xl border-r border-white/10 z-50">
        <div className="p-6">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
            控制面板
          </h1>
        </div>

        <nav className="px-4 space-y-2 mt-4">
          <SidebarItem
            icon={Home}
            label="控制面板"
            href="/"
            active={path === '/'}
          />
          <SidebarItem
            icon={Users}
            label="群组管理"
            href="/groups"
            active={path === '/groups'}
          />
          <SidebarItem
            icon={Settings}
            label="系统设置"
            href="/settings"
            active={path === '/settings'}
          />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="ml-64 p-8">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
