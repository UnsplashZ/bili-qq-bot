import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../utils/auth';

const useGroupList = ({ show }) => {
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const generationRef = useRef(null);

  const syncConfigGeneration = useCallback((source) => {
    const generation = Number(source?.documentGeneration ?? source?.generation ?? source);
    if (Number.isSafeInteger(generation)) generationRef.current = generation;
    return generationRef.current;
  }, []);

  const requireExpectedGeneration = useCallback(() => {
    if (!Number.isSafeInteger(generationRef.current)) {
      throw new Error('配置 generation 尚未就绪，请刷新群组列表后重试');
    }
    return generationRef.current;
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/groups');
      syncConfigGeneration(res.headers?.['x-config-generation']);
      if (Array.isArray(res.data)) {
        setGroups(res.data);
      }
    } catch (error) {
      console.error('Failed to fetch groups', error);
    } finally {
      setLoading(false);
    }
  }, [syncConfigGeneration]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleToggleGroup = useCallback(async (e, group) => {
    e.stopPropagation();
    const newStatus = !group.isEnabled;

    setGroups((prev) => prev.map((item) => (item.id === group.id ? { ...item, isEnabled: newStatus } : item)));

    try {
      const response = await api.post(`/api/groups/${group.id}/toggle`, {
        expectedGeneration: requireExpectedGeneration()
      });
      syncConfigGeneration(response.data);
    } catch (err) {
      console.error('Failed to toggle group', err);
      setGroups((prev) => prev.map((item) => (item.id === group.id ? { ...item, isEnabled: !newStatus } : item)));
    }
  }, [requireExpectedGeneration, syncConfigGeneration]);

  const handleDeleteConfig = useCallback(async (e, group) => {
    e.stopPropagation();

    if (!window.confirm(`确认删除群组 ${group.name} (${group.id}) 的所有配置和订阅数据？\n\n此操作不可恢复。`)) {
      return;
    }

    try {
      const response = await api.delete(`/api/groups/${group.id}`, {
        data: { expectedGeneration: requireExpectedGeneration() }
      });
      syncConfigGeneration(response.data);
      show('配置已删除', 'success');

      setGroups((prev) => prev.filter((item) => item.id !== group.id));
      setSelectedGroupId((prev) => (prev === group.id ? null : prev));
    } catch (err) {
      console.error('Failed to delete group config', err);
      show(err.response?.data?.error || '删除失败', 'error');
    }
  }, [requireExpectedGeneration, show, syncConfigGeneration]);

  return {
    groups,
    setGroups,
    selectedGroupId,
    setSelectedGroupId,
    loading,
    fetchGroups,
    handleToggleGroup,
    handleDeleteConfig,
    requireExpectedGeneration,
    syncConfigGeneration
  };
};

export default useGroupList;
