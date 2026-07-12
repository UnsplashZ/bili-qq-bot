import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Card } from './ui';

export const Surface = ({ children, className }) => {
  return (
    <Card padded={false} className={`admin-surface ${className || ''}`}>
      {children}
    </Card>
  );
};

export const SurfaceHeader = ({ children, className }) => (
  <div
    className={twMerge(
      clsx('border-b border-[var(--border)] px-0 py-4', className)
    )}
  >
    {children}
  </div>
);

export const SurfaceBody = ({ children, className }) => (
  <div className={twMerge(clsx('py-5', className))}>{children}</div>
);

export default Surface;
