import { useCallback, useEffect, useState } from 'react';
import api from '../../../utils/auth';

const createDefaultGlobalBiliStatus = () => ({
  isLoggedIn: false,
  uid: null,
  username: ''
});

const useGroupSyncConfig = () => {
  const [biliGroups, setBiliGroups] = useState([]);
  const [biliGroupsLoading, setBiliGroupsLoading] = useState(false);
  const [atAllTargets, setAtAllTargets] = useState({
    manualUsers: [],
    cookieUsers: [],
    syncGroupNames: []
  });
  const [atAllTargetsLoading, setAtAllTargetsLoading] = useState(false);
  const [globalBiliStatus, setGlobalBiliStatus] = useState(createDefaultGlobalBiliStatus());

  const fetchBiliGroups = useCallback(async (groupId) => {
    if (!groupId) return;

    setBiliGroupsLoading(true);
    try {
      const res = await api.get(`/api/groups/${groupId}/bili-groups`);
      const responseData = res.data;
      const listData = Array.isArray(responseData) ? responseData : (responseData?.data || []);
      const safeList = Array.isArray(listData) ? listData : [];
      setBiliGroups(safeList);
    } catch (error) {
      console.error('Failed to fetch Bili groups', error);
    } finally {
      setBiliGroupsLoading(false);
    }
  }, []);

  const fetchAtAllTargets = useCallback(async (groupId) => {
    if (!groupId) return;

    setAtAllTargetsLoading(true);
    try {
      const resp = await api.get(`/api/groups/${groupId}/atall-targets`);
      setAtAllTargets({
        manualUsers: Array.isArray(resp.data?.manualUsers) ? resp.data.manualUsers : [],
        cookieUsers: Array.isArray(resp.data?.cookieUsers) ? resp.data.cookieUsers : [],
        syncGroupNames: Array.isArray(resp.data?.syncGroupNames) ? resp.data.syncGroupNames : []
      });
    } catch (error) {
      console.error('Failed to fetch @all targets:', error);
      setAtAllTargets({ manualUsers: [], cookieUsers: [], syncGroupNames: [] });
    } finally {
      setAtAllTargetsLoading(false);
    }
  }, []);

  const checkGlobalBiliStatus = useCallback(async () => {
    try {
      const res = await api.get('/api/bili/global-status');
      setGlobalBiliStatus({
        isLoggedIn: res.data.isLoggedIn || false,
        uid: res.data.uid || null,
        username: res.data.username || ''
      });
    } catch (error) {
      console.error('Failed to check global bili status:', error);
      setGlobalBiliStatus(createDefaultGlobalBiliStatus());
    }
  }, []);

  useEffect(() => {
    checkGlobalBiliStatus();
  }, [checkGlobalBiliStatus]);

  return {
    biliGroups,
    biliGroupsLoading,
    atAllTargets,
    atAllTargetsLoading,
    globalBiliStatus,
    fetchBiliGroups,
    fetchAtAllTargets,
    checkGlobalBiliStatus
  };
};

export default useGroupSyncConfig;
