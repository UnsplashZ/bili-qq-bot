import React, { useState } from 'react';
import { Brain, Home, Users, Settings, Terminal, Menu } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import MobileMenu from './MobileMenu';

const SidebarItem = ({ icon, label, href, active }) => {
  return (
    <Link
      to={href}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      {React.createElement(icon, { size: 20 })}
      <span className="font-medium">{label}</span>
    </Link>
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const path = location.pathname;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-black text-white">
      {/* Mobile Header */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-14 sm:h-16 bg-black/20 backdrop-blur-xl border-b border-white/10 z-30 flex items-center px-3 sm:px-4">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-white/10 transition-colors"
        >
          <Menu size={22} className="text-white sm:w-6 sm:h-6" />
        </button>
        <h1 className="ml-2.5 sm:ml-3 text-lg sm:text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
          控制面板
        </h1>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:block fixed left-0 top-0 h-full w-64 bg-black/20 backdrop-blur-xl border-r border-white/10 z-50">
        <div className="p-6">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
            控制面板
          </h1>
        </div>

        <nav className="px-4 space-y-2 mt-4">
          <SidebarItem
            icon={Home}
            label="运行状态"
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
          <SidebarItem
            icon={Brain}
            label="Agent 记忆"
            href="/agent-memory"
            active={path === '/agent-memory'}
          />
          <SidebarItem
            icon={Terminal}
            label="系统日志"
            href="/logs"
            active={path === '/logs'}
          />
        </nav>
      </aside>

      {/* Mobile Menu */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Content */}
      <main className="pt-14 sm:pt-16 md:pt-0 md:ml-64 p-3 sm:p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
