import React from 'react';
import { X, Home, Users, Settings, Terminal } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const MobileMenuItem = ({ icon, label, href, active, onClick }) => {
  return (
    <Link
      to={href}
      onClick={onClick}
      className={`flex items-center gap-4 px-6 py-4 rounded-lg transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      {React.createElement(icon, { size: 24 })}
      <span className="text-lg font-medium">{label}</span>
    </Link>
  );
};

const MobileMenu = ({ isOpen, onClose }) => {
  const location = useLocation();
  const path = location.pathname;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
        onClick={onClose}
      />

      {/* Menu Panel */}
      <div className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-gradient-to-br from-gray-900 via-slate-800 to-black border-r border-white/10 z-50 md:hidden overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
            控制面板
          </h1>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={24} className="text-gray-400" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-2">
          <MobileMenuItem
            icon={Home}
            label="运行状态"
            href="/"
            active={path === '/'}
            onClick={onClose}
          />
          <MobileMenuItem
            icon={Users}
            label="群组管理"
            href="/groups"
            active={path === '/groups'}
            onClick={onClose}
          />
          <MobileMenuItem
            icon={Settings}
            label="系统设置"
            href="/settings"
            active={path === '/settings'}
            onClick={onClose}
          />
          <MobileMenuItem
            icon={Terminal}
            label="系统日志"
            href="/logs"
            active={path === '/logs'}
            onClick={onClose}
          />
        </nav>
      </div>
    </>
  );
};

export default MobileMenu;
