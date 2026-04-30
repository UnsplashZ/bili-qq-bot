import React from 'react';
import { X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { NAV_ITEMS } from './navigation';

const MobileMenuItem = ({ icon, label, href, active, onClick }) => {
  return (
    <Link
      to={href}
      onClick={onClick}
      className={`relative flex items-center gap-3 rounded-lg px-4 py-3 transition-colors sm:px-5 sm:py-4 ${
        active
          ? 'bg-cyan-300/10 text-white'
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-px rounded bg-cyan-300" />}
      {React.createElement(icon, { size: 21 })}
      <span className="text-base sm:text-lg font-medium">{label}</span>
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
        className="fixed inset-0 z-40 bg-black/55 md:hidden"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 left-0 z-50 w-72 max-w-[86vw] overflow-y-auto border-r border-white/10 bg-[#080d15] sm:w-80 md:hidden">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-white/10">
          <h1 className="text-xl font-semibold tracking-wide text-slate-100 sm:text-2xl">
            控制面板
          </h1>
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={22} className="text-gray-400 sm:w-6 sm:h-6" />
          </button>
        </div>

        <nav className="p-3 sm:p-4 space-y-2">
          {NAV_ITEMS.map((item) => (
            <MobileMenuItem
              key={item.href}
              icon={item.icon}
              label={item.label}
              href={item.href}
              active={path === item.href}
              onClick={onClose}
            />
          ))}
        </nav>
      </div>
    </>
  );
};

export default MobileMenu;
