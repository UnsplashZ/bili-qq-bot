import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const GlassCard = ({ children, className }) => {
  return (
    <div
      className={twMerge(
        clsx(
          'rounded-lg border border-white/10 bg-[#101620]/90 p-3 text-white shadow-[0_18px_46px_rgba(0,0,0,0.24)] sm:p-4 md:p-5',
          className
        )
      )}
    >
      {children}
    </div>
  );
};

export default GlassCard;
