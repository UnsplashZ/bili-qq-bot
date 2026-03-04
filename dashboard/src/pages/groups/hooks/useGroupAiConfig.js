import { useCallback } from 'react';
import api from '../../../utils/auth';

const useGroupAiConfig = ({ selectedGroupId, setGroups, runLockedAction, show }) => {
  const handleAiToggle = useCallback(async (field, value) => {
    await runLockedAction('aiConfig', async () => {
      try {
        const response = await api.put(`/api/groups/${selectedGroupId}/ai-config`, {
          [field]: value
        });

        if (response.status === 200) {
          const res = await api.get('/api/groups');
          if (Array.isArray(res.data)) {
            setGroups(res.data);
          }
          show('AI配置已更新', 'success');
        }
        return true;
      } catch (error) {
        console.error('Failed to update AI config:', error);
        show('更新AI配置失败', 'error');
        return false;
      }
    });
  }, [runLockedAction, selectedGroupId, setGroups, show]);

  const handleAiReset = useCallback(async () => {
    await runLockedAction('aiConfig', async () => {
      try {
        const response = await api.delete(`/api/groups/${selectedGroupId}/ai-config`);

        if (response.status === 200) {
          const res = await api.get('/api/groups');
          if (Array.isArray(res.data)) {
            setGroups(res.data);
          }
          show('已重置为全局设置', 'success');
        }
        return true;
      } catch (error) {
        console.error('Failed to reset AI config:', error);
        show('重置AI配置失败', 'error');
        return false;
      }
    });
  }, [runLockedAction, selectedGroupId, setGroups, show]);

  return {
    handleAiToggle,
    handleAiReset
  };
};

export default useGroupAiConfig;
