import React, { useEffect } from 'react';
import { motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { clsx } from 'clsx';

const icons = {
  success: <CheckCircle className="w-5 h-5 text-green-400" />,
  error: <AlertCircle className="w-5 h-5 text-red-400" />,
  info: <Info className="w-5 h-5 text-blue-400" />,
};

const styles = {
  success: 'bg-green-500/10 border-green-500/20 text-green-100',
  error: 'bg-red-500/10 border-red-500/20 text-red-100',
  info: 'bg-blue-500/10 border-blue-500/20 text-blue-100',
};

const Toast = ({ id, message, type = 'info', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, 4000); // Auto dismiss after 4 seconds

    return () => clearTimeout(timer);
  }, [id, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      layout
      className={clsx(
        'pointer-events-auto flex w-full max-w-sm rounded-lg shadow-lg ring-1 backdrop-blur-md p-4 mb-3 border',
        styles[type] || styles.info
      )}
    >
      <div className="flex-shrink-0 pt-0.5">
        {icons[type] || icons.info}
      </div>
      <div className="ml-3 flex-1">
        <p className="text-sm font-medium">{message}</p>
      </div>
      <div className="ml-4 flex flex-shrink-0">
        <button
          type="button"
          className="inline-flex rounded-md p-1.5 hover:bg-white/10 focus:outline-none transition-colors"
          onClick={() => onClose(id)}
        >
          <span className="sr-only">Close</span>
          <X className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
};

export default Toast;
