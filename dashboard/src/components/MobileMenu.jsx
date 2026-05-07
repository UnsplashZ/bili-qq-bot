import React from 'react';
import { Moon, Sun, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { NAV_GROUPS } from './navigation';
import { Button } from './ui';

const MobileMenuItem = ({ icon, label, href, active, onClick, badge }) => {
  return (
    <Link
      to={href}
      onClick={onClick}
      className={`relative flex items-center justify-between gap-3 rounded-lg px-4 py-3 transition-colors sm:px-5 sm:py-4 ${
        active
          ? 'bg-[var(--accent-soft)] text-[var(--fg)]'
          : 'text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]'
      }`}
    >
      {active && <span className="absolute bottom-2 left-0 top-2 w-px rounded bg-[var(--accent)]" />}
      <span className="flex min-w-0 items-center gap-3">
        {React.createElement(icon, { size: 21 })}
        <span className="text-base font-medium sm:text-lg">{label}</span>
      </span>
      {badge && <span className="font-mono text-xs text-[var(--subtle)]">{badge}</span>}
    </Link>
  );
};

const MobileMenu = ({ isOpen, onClose, theme, onToggleTheme }) => {
  const location = useLocation();
  const path = location.pathname;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[86vw] flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] sm:w-80 md:hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4 sm:p-6">
          <div>
            <h1 className="text-xl font-semibold text-[var(--fg)] sm:text-2xl">bili-qq-bot</h1>
            <p className="mt-1 text-xs text-[var(--muted)]">Personal control center</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--fg)] sm:p-2"
            aria-label="关闭导航"
          >
            <X size={22} className="sm:h-6 sm:w-6" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 p-3 sm:p-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 text-[11px] font-bold uppercase text-[var(--subtle)]">
                {group.label}
              </div>
              <div className="mt-2 grid gap-1">
                {group.items.map((item) => (
                  <MobileMenuItem
                    key={item.href}
                    icon={item.icon}
                    label={item.label}
                    href={item.href}
                    badge={item.badge}
                    active={path === item.href}
                    onClick={onClose}
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
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? '深色模式' : '浅色模式'}
          </Button>
        </div>
      </div>
    </>
  );
};

export default MobileMenu;
