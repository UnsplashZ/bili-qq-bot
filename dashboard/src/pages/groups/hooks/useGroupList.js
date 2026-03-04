import { useCallback, useEffect, useState } from 'react';
import api from '../../../utils/auth';

const useGroupList = ({ show }) => {
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/groups');
      if (Array.isArray(res.data)) {
        setGroups(res.data);
      }
    } catch (error) {
      console.error('Failed to fetch groups', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleToggleGroup = useCallback(async (e, group) => {
    e.stopPropagation();
    const newStatus = !group.isEnabled;

    setGroups((prev) => prev.map((item) => (item.id === group.id ? { ...item, isEnabled: newStatus } : item)));

    try {
      await api.post(`/api/groups/${group.id}/toggle`);
    } catch (err) {
      console.error('Failed to toggle group', err);
      setGroups((prev) => prev.map((item) => (item.id === group.id ? { ...item, isEnabled: !newStatus } : item)));
    }
  }, []);

  const handleDeleteConfig = useCallback(async (e, group) => {
    e.stopPropagation();

    if (!window.confirm(`确认删除群组 ${group.name} (${group.id}) 的所有配置和订阅数据？\n\n此操作不可恢复。`)) {
      return;
    }

    try {
      await api.delete(`/api/groups/${group.id}`);
      show('配置已删除', 'success');

      setGroups((prev) => prev.filter((item) => item.id !== group.id));
      setSelectedGroupId((prev) => (prev === group.id ? null : prev));
    } catch (err) {
      console.error('Failed to delete group config', err);
      show(err.response?.data?.error || '删除失败', 'error');
    }
  }, [show]);

  return {
    groups,
    setGroups,
    selectedGroupId,
    setSelectedGroupId,
    loading,
    fetchGroups,
    handleToggleGroup,
    handleDeleteConfig
  };
};

export default useGroupList;
