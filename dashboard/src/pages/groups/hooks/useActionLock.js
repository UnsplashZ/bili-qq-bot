import { useCallback, useRef, useState } from 'react';

const INITIAL_ACTION_LOADING = {
  blacklist: false,
  admins: false,
  aiConfig: false,
  videoConfig: false
};

const INITIAL_ACTION_LOCKS = {
  blacklist: false,
  admins: false,
  aiConfig: false,
  videoConfig: false
};

const useActionLock = () => {
  const [actionLoading, setActionLoading] = useState(() => ({ ...INITIAL_ACTION_LOADING }));
  const actionLocksRef = useRef({ ...INITIAL_ACTION_LOCKS });

  const runLockedAction = useCallback(async (key, action, timeoutMs = 20000) => {
    if (actionLocksRef.current[key]) return false;

    actionLocksRef.current[key] = true;
    setActionLoading((prev) => ({ ...prev, [key]: true }));

    const timeoutId = setTimeout(() => {
      actionLocksRef.current[key] = false;
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }, timeoutMs);

    try {
      const result = await action();
      return result ?? true;
    } finally {
      clearTimeout(timeoutId);
      actionLocksRef.current[key] = false;
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  return {
    actionLoading,
    runLockedAction
  };
};

export default useActionLock;
