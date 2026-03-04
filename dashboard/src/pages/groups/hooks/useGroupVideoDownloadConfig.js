import { useCallback, useState } from 'react';
import api from '../../../utils/auth';

const createDefaultVideoDownloadConfig = () => ({
  videoDownloadEnabled: null,
  videoDownloadResolution: null,
  videoDownloadMaxDuration: null
});

const useGroupVideoDownloadConfig = ({ selectedGroupId, runLockedAction, show }) => {
  const [videoDownloadConfig, setVideoDownloadConfig] = useState(createDefaultVideoDownloadConfig());

  const fetchVideoDownloadConfig = useCallback(async (groupId) => {
    try {
      const resp = await api.get(`/api/groups/${groupId}/video-download-config`);
      setVideoDownloadConfig(resp.data);
    } catch (error) {
      console.error('Failed to fetch video download config:', error);
    }
  }, []);

  const saveVideoDownloadConfig = useCallback(async () => {
    await runLockedAction('videoConfig', async () => {
      try {
        await api.put(`/api/groups/${selectedGroupId}/video-download-config`, videoDownloadConfig);
        show('视频下载配置已更新', 'success');
        return true;
      } catch (error) {
        console.error('Failed to save video download config:', error);
        show('更新失败', 'error');
        return false;
      }
    });
  }, [runLockedAction, selectedGroupId, videoDownloadConfig, show]);

  const resetVideoDownloadConfig = useCallback(async () => {
    await runLockedAction('videoConfig', async () => {
      try {
        await api.delete(`/api/groups/${selectedGroupId}/video-download-config`);
        setVideoDownloadConfig(createDefaultVideoDownloadConfig());
        show('已重置为全局默认', 'success');
        return true;
      } catch (error) {
        console.error('Failed to reset video download config:', error);
        show('重置失败', 'error');
        return false;
      }
    });
  }, [runLockedAction, selectedGroupId, show]);

  return {
    videoDownloadConfig,
    setVideoDownloadConfig,
    fetchVideoDownloadConfig,
    saveVideoDownloadConfig,
    resetVideoDownloadConfig
  };
};

export default useGroupVideoDownloadConfig;
