import React, { useState } from 'react';
import { Menu } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import MobileMenu from './MobileMenu';
import { NAV_ITEMS } from './navigation';

const SidebarItem = ({ icon, label, href, active }) => {
  return (
    <Link
      to={href}
      className={`relative flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
        active
          ? 'bg-cyan-300/10 text-white'
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-px rounded bg-cyan-300" />}
      {React.createElement(icon, { size: 19 })}
      <span className="font-medium">{label}</span>
    </Link>
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const path = location.pathname;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen text-white">
      <header className="fixed top-0 left-0 right-0 z-30 flex h-14 items-center border-b border-white/10 bg-[#080d15]/92 px-3 sm:h-16 sm:px-4 md:hidden">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="rounded-lg p-1.5 transition-colors hover:bg-white/10 sm:p-2"
        >
          <Menu size={22} className="text-white sm:w-6 sm:h-6" />
        </button>
        <h1 className="ml-2.5 text-lg font-semibold tracking-wide text-slate-100 sm:ml-3 sm:text-xl">
          控制面板
        </h1>
      </header>

      <aside className="fixed left-0 top-0 z-50 hidden h-full w-64 border-r border-white/10 bg-[#080d15]/88 md:block">
        <div className="p-6">
          <h1 className="text-xl font-semibold tracking-wide text-slate-100">
            控制面板
          </h1>
          <div className="mt-3 h-px w-16 bg-cyan-300/50" />
        </div>

        <nav className="mt-4 space-y-1.5 px-4">
          {NAV_ITEMS.map((item) => (
            <SidebarItem
              key={item.href}
              icon={item.icon}
              label={item.label}
              href={item.href}
              active={path === item.href}
            />
          ))}
        </nav>
      </aside>

      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      <main className="p-3 pt-14 sm:p-4 sm:pt-16 md:ml-64 md:p-8 md:pt-8">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
