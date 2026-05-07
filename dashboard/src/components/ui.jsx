import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const Card = ({ as = 'section', children, className, padded = true }) => (
  React.createElement(
    as,
    {
      className: twMerge(
        clsx(
          'rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] shadow-[var(--shadow-card)]',
          padded && 'p-4 sm:p-5',
          className
        )
      )
    },
    children
  )
);

export const PanelHeader = ({
  title,
  description,
  eyebrow,
  meta,
  icon: Icon,
  actions,
  className
}) => (
  <div
    className={twMerge(
      clsx(
        'flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5',
        className
      )
    )}
  >
    <div className="min-w-0">
      {eyebrow && (
        <div className="mb-1 font-mono text-xs font-semibold uppercase text-[var(--accent)]">
          {eyebrow}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon size={18} className="shrink-0 text-[var(--accent)]" />}
        <h2 className="truncate text-sm font-semibold text-[var(--fg)] sm:text-base">{title}</h2>
      </div>
      {description && (
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{description}</p>
      )}
    </div>
    {(meta || actions) && (
      <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--muted)]">
        {meta}
        {actions}
      </div>
    )}
  </div>
);

const buttonVariants = {
  primary: 'border-[color-mix(in_oklch,var(--accent)_52%,var(--border))] bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[color-mix(in_oklch,var(--accent)_90%,var(--fg))]',
  secondary: 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--surface-muted)]',
  ghost: 'border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]',
  danger: 'border-[color-mix(in_oklch,var(--danger)_38%,var(--border))] bg-[var(--danger-soft)] text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))] hover:bg-[color-mix(in_oklch,var(--danger)_20%,var(--surface))]',
};

export const Button = React.forwardRef(function Button(
  { children, className, variant = 'secondary', size = 'md', icon: Icon, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={twMerge(
        clsx(
          'inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
          size === 'sm' ? 'min-h-8 px-3 py-1.5 text-xs' : 'min-h-10 px-4 py-2 text-sm',
          buttonVariants[variant],
          className
        )
      )}
      {...props}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
});

export const ToggleSwitch = ({ checked, onChange, label, disabled = false, className }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={twMerge(
      clsx(
        'inline-flex h-8 w-14 shrink-0 items-center rounded-md border px-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-[color-mix(in_oklch,var(--accent)_48%,var(--border))] bg-[var(--accent-soft)]'
          : 'border-[var(--border)] bg-[var(--surface-muted)]',
        className
      )
    )}
  >
    <span
      className={clsx(
        'h-5 w-5 rounded-[6px] bg-[var(--surface)] shadow-sm transition-transform',
        checked ? 'translate-x-6 border border-[var(--accent)]' : 'translate-x-0 border border-[var(--border-strong)]'
      )}
    />
  </button>
);

const statusTones = {
  neutral: 'border-[var(--border)] text-[var(--muted)]',
  accent: 'border-[color-mix(in_oklch,var(--accent)_34%,var(--border))] text-[var(--accent)]',
  success: 'border-[color-mix(in_oklch,var(--success)_34%,var(--border))] text-[color-mix(in_oklch,var(--success)_88%,var(--fg))]',
  warn: 'border-[color-mix(in_oklch,var(--warn)_38%,var(--border))] text-[color-mix(in_oklch,var(--warn)_88%,var(--fg))]',
  danger: 'border-[color-mix(in_oklch,var(--danger)_38%,var(--border))] text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]',
};

export const StatusPill = ({ children, tone = 'neutral', className }) => (
  <span
    className={twMerge(
      clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        'before:h-1.5 before:w-1.5 before:rounded-full before:bg-current',
        statusTones[tone],
        className
      )
    )}
  >
    {children}
  </span>
);

export const DataTable = ({ columns, rows, getRowKey, empty = '暂无数据', className }) => (
  <div className={twMerge(clsx('overflow-x-auto', className))}>
    <table className="min-w-full border-collapse text-left text-sm">
      <thead className="border-b border-[var(--border)] text-xs font-semibold uppercase text-[var(--muted)]">
        <tr>
          {columns.map((column) => (
            <th key={column.key} className={twMerge(clsx('px-4 py-3', column.headerClassName))}>
              {column.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="px-4 py-8 text-center text-[var(--muted)]" colSpan={columns.length}>
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row, rowIndex) => (
            <tr
              key={getRowKey ? getRowKey(row, rowIndex) : rowIndex}
              className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-muted)]"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={twMerge(clsx('px-4 py-3 align-middle text-[var(--fg)]', column.className))}
                >
                  {column.render ? column.render(row, rowIndex) : row[column.key]}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

export const FormField = ({ label, description, children, className }) => (
  <label className={twMerge(clsx('block space-y-1.5', className))}>
    <span className="text-sm font-medium text-[var(--fg)]">{label}</span>
    {description && <span className="block text-xs leading-relaxed text-[var(--muted)]">{description}</span>}
    {children}
  </label>
);
