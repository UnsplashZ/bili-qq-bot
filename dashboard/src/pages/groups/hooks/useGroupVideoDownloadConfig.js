import { useCallback, useState } from 'react';
import api from '../../../utils/auth';

const createDefaultVideoDownloadConfig = () => ({
  videoDownloadEnabled: null,
  videoDownloadResolution: null,
  videoDownloadMaxDuration: null
});

const useGroupVideoDownloadConfig = ({ selectedGroupId, runLockedAction, show }) => {
  const [videoDownloadConfig, setVideoDownloadConfig] = useState(createDefaultVideoDownloadConfig());
  const [videoDownloadDirty, setVideoDownloadDirty] = useState(false);
  const [videoDownloadResetPending, setVideoDownloadResetPending] = useState(false);

  const updateVideoDownloadConfig = useCallback((updater) => {
    setVideoDownloadConfig((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return next;
    });
    setVideoDownloadDirty(true);
    setVideoDownloadResetPending(false);
  }, []);

  const fetchVideoDownloadConfig = useCallback(async (groupId) => {
    try {
      const resp = await api.get(`/api/groups/${groupId}/video-download-config`);
      setVideoDownloadConfig(resp.data);
      setVideoDownloadDirty(false);
      setVideoDownloadResetPending(false);
    } catch (error) {
      console.error('Failed to fetch video download config:', error);
    }
  }, []);

  const saveVideoDownloadConfig = useCallback(async () => {
    if (!videoDownloadDirty && !videoDownloadResetPending) {
      return true;
    }
    if (!selectedGroupId) {
      return false;
    }
    return runLockedAction('videoConfig', async () => {
      try {
        if (videoDownloadResetPending) {
          await api.delete(`/api/groups/${selectedGroupId}/video-download-config`);
        } else {
          await api.put(`/api/groups/${selectedGroupId}/video-download-config`, videoDownloadConfig);
        }
        setVideoDownloadDirty(false);
        setVideoDownloadResetPending(false);
        show('视频下载配置已更新', 'success');
        return true;
      } catch (error) {
        console.error('Failed to save video download config:', error);
        show('更新失败', 'error');
        return false;
      }
    });
  }, [runLockedAction, selectedGroupId, videoDownloadConfig, videoDownloadDirty, videoDownloadResetPending, show]);

  const resetVideoDownloadConfig = useCallback(() => {
    setVideoDownloadConfig(createDefaultVideoDownloadConfig());
    setVideoDownloadDirty(false);
    setVideoDownloadResetPending(true);
    show('已设为跟随全局，保存后生效', 'success');
  }, [show]);

  return {
    videoDownloadConfig,
    setVideoDownloadConfig: updateVideoDownloadConfig,
    videoDownloadDirty,
    videoDownloadResetPending,
    fetchVideoDownloadConfig,
    saveVideoDownloadConfig,
    resetVideoDownloadConfig
  };
};

export default useGroupVideoDownloadConfig;
