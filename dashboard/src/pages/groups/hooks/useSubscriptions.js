import { useCallback, useRef, useState } from 'react';
import api from '../../../utils/auth';

const useSubscriptions = ({ selectedGroupId, show, refreshAtAllTargets }) => {
  const [subscriptions, setSubscriptions] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [subForm, setSubForm] = useState({ type: 'user', value: '' });
  const lastLoadedGroupIdRef = useRef(null);
  const fetchSeqRef = useRef(0);

  const fetchSubscriptions = useCallback(async (groupId) => {
    if (!groupId) return;

    const requestSeq = fetchSeqRef.current + 1;
    fetchSeqRef.current = requestSeq;
    const isGroupChanged = lastLoadedGroupIdRef.current !== groupId;

    if (isGroupChanged) {
      setSubscriptions([]);
    }

    setSubsLoading(true);
    try {
      const res = await api.get(`/api/groups/${groupId}/subscriptions`);
      if (requestSeq !== fetchSeqRef.current) return;

      setSubscriptions(res.data || []);
      lastLoadedGroupIdRef.current = groupId;
    } catch (error) {
      if (requestSeq !== fetchSeqRef.current) return;

      console.error('Failed to fetch subscriptions', error);
      show('获取订阅列表失败', 'error');
    } finally {
      if (requestSeq === fetchSeqRef.current) {
        setSubsLoading(false);
      }
    }
  }, [show]);

  const handleAddSubscription = useCallback(async () => {
    const normalizedValue = String(subForm.value || '').trim();
    if (!normalizedValue) {
      show('请输入订阅值', 'error');
      return;
    }

    if (!/^\d+$/.test(normalizedValue)) {
      show('订阅值必须为纯数字', 'error');
      return;
    }

    try {
      await api.post(`/api/groups/${selectedGroupId}/subscriptions`, {
        ...subForm,
        value: normalizedValue
      });
      show('添加订阅成功', 'success');
      setIsSubModalOpen(false);
      setSubForm({ type: 'user', value: '' });
      await fetchSubscriptions(selectedGroupId);
      if (refreshAtAllTargets) {
        refreshAtAllTargets(selectedGroupId);
      }
    } catch (err) {
      console.error(err);
      show('添加订阅失败', 'error');
    }
  }, [subForm, show, selectedGroupId, fetchSubscriptions, refreshAtAllTargets]);

  const handleDeleteSubscription = useCallback(async (sub) => {
    try {
      await api.delete(`/api/groups/${selectedGroupId}/subscriptions`, { data: sub });
      show('删除订阅成功', 'success');
      setSubscriptions((prev) => prev.filter((item) => !(item.type === sub.type && item.value === sub.value)));
      if (refreshAtAllTargets) {
        refreshAtAllTargets(selectedGroupId);
      }
    } catch (err) {
      console.error(err);
      show('删除订阅失败', 'error');
    }
  }, [show, selectedGroupId, refreshAtAllTargets]);

  return {
    subscriptions,
    subsLoading,
    isSubModalOpen,
    setIsSubModalOpen,
    subForm,
    setSubForm,
    fetchSubscriptions,
    handleAddSubscription,
    handleDeleteSubscription
  };
};

export default useSubscriptions;
