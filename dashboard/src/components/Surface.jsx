import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const Surface = ({ children, className }) => {
  return (
    <section
      className={twMerge(
        clsx(
          'rounded-lg border border-white/10 bg-[#101620]/90 text-white shadow-[0_18px_46px_rgba(0,0,0,0.24)]',
          className
        )
      )}
    >
      {children}
    </section>
  );
};

export const SurfaceHeader = ({ children, className }) => (
  <div
    className={twMerge(
      clsx('border-b border-white/10 px-4 py-3 sm:px-5 sm:py-4', className)
    )}
  >
    {children}
  </div>
);

export const SurfaceBody = ({ children, className }) => (
  <div className={twMerge(clsx('p-4 sm:p-5', className))}>{children}</div>
);

export default Surface;
