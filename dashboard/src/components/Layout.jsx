import React, { useEffect, useState } from 'react';
import { Menu, Moon, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import MobileMenu from './MobileMenu';
import { NAV_GROUPS } from './navigation';
import { Button } from './ui';

const THEME_STORAGE_KEY = 'bili-qq-bot.dashboard.theme';

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const SidebarItem = ({ icon, label, href, active, badge }) => {
  return (
    <Link
      to={href}
      className={`relative flex min-h-9 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-[var(--accent-soft)] text-[var(--fg)]'
          : 'text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]'
      }`}
    >
      {active && <span className="absolute bottom-2 left-0 top-2 w-px rounded bg-[var(--accent)]" />}
      <span className="flex min-w-0 items-center gap-3">
        {React.createElement(icon, { size: 18 })}
        <span className="truncate font-medium">{label}</span>
      </span>
      {badge && <span className="font-mono text-[11px] text-[var(--subtle)]">{badge}</span>}
    </Link>
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const path = location.pathname;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <header className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center border-b border-[var(--border)] bg-[var(--surface)] px-3 sm:h-16 sm:px-4 md:hidden">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="rounded-lg p-1.5 text-[var(--fg)] transition-colors hover:bg-[var(--surface-muted)] sm:p-2"
          aria-label="打开导航"
        >
          <Menu size={22} className="sm:h-6 sm:w-6" />
        </button>
        <h1 className="ml-2.5 text-lg font-semibold text-[var(--fg)] sm:ml-3 sm:text-xl">
          bili-qq-bot
        </h1>
      </header>

      <aside className="fixed left-0 top-0 z-50 hidden h-full w-64 border-r border-[var(--border)] bg-[var(--surface)] md:flex md:flex-col">
        <div className="p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-[color-mix(in_oklch,var(--accent)_34%,var(--border))] font-mono text-xs font-bold text-[var(--accent)]">
              BQ
            </div>
            <div>
              <h1 className="text-base font-semibold text-[var(--fg)]">bili-qq-bot</h1>
              <p className="mt-0.5 text-xs text-[var(--muted)]">Personal control center</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 text-[11px] font-bold uppercase text-[var(--subtle)]">
                {group.label}
              </div>
              <div className="mt-2 grid gap-1">
                {group.items.map((item) => (
                  <SidebarItem
                    key={item.href}
                    icon={item.icon}
                    label={item.label}
                    href={item.href}
                    badge={item.badge}
                    active={path === item.href}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] p-3">
          <Button
            variant="ghost"
            className="w-full justify-start"
            icon={theme === 'dark' ? Moon : Sun}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? '深色模式' : '浅色模式'}
          </Button>
        </div>
      </aside>

      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="p-3 pt-14 sm:p-4 sm:pt-16 md:ml-64 md:p-8 md:pt-8">
        <div className="mx-auto max-w-7xl">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
