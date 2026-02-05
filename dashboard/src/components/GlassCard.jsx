import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const GlassCard = ({ children, className }) => {
  return (
    <div
      className={twMerge(
        clsx(
          'bg-white/10 backdrop-blur-md border border-white/20 rounded-xl shadow-lg p-4 md:p-6 text-white',
          className
        )
      )}
    >
      {children}
    </div>
  );
};

export default GlassCard;
