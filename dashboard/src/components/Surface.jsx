import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Card } from './ui';

export const Surface = ({ children, className }) => {
  return (
    <Card padded={false} className={className}>
      {children}
    </Card>
  );
};

export const SurfaceHeader = ({ children, className }) => (
  <div
    className={twMerge(
      clsx('border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5 sm:py-4', className)
    )}
  >
    {children}
  </div>
);

export const SurfaceBody = ({ children, className }) => (
  <div className={twMerge(clsx('p-4 sm:p-5', className))}>{children}</div>
);

export default Surface;
