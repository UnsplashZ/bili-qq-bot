import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const SettingRow = ({
  title,
  description,
  control,
  status,
  children,
  className
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'grid gap-3 border-b border-[var(--border)] px-0 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(220px,auto)_auto] md:items-center',
          className
        )
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--fg)]">{title}</div>
        {description && (
          <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{description}</div>
        )}
      </div>
      <div className="min-w-0 md:justify-self-end">{control || children}</div>
      {status && (
        <div className="text-xs font-medium text-[var(--muted)] md:justify-self-end">{status}</div>
      )}
    </div>
  );
};

export default SettingRow;
