import { useState } from 'react'
import api from '../utils/auth'
import { useToast } from '../hooks/useToast'
import GeneralSettingsSection from './settings/components/GeneralSettingsSection'
import BiliGlobalSection from './settings/components/BiliGlobalSection'
import GlobalBlacklistSection from './settings/components/GlobalBlacklistSection'
import VideoDownloadSection from './settings/components/VideoDownloadSection'
import SystemControlSection from './settings/components/SystemControlSection'
import RestartConfirmModal from './settings/components/RestartConfirmModal'
import BiliQrModal from './settings/components/BiliQrModal'
import useSettingsData from './settings/hooks/useSettingsData'
import useBiliLogin from './settings/hooks/useBiliLogin'

const Settings = () => {
  const { show } = useToast()
  const [isRestartModalOpen, setIsRestartModalOpen] = useState(false)

  const settingsData = useSettingsData(show)
  const biliActions = useBiliLogin({
    show,
    setBiliGlobalStatus: settingsData.setBiliGlobalStatus
  })

  const handleRestart = () => {
    setIsRestartModalOpen(true)
  }

  const confirmRestart = async () => {
    setIsRestartModalOpen(false)
    try {
      await api.post('/api/restart')
      show('系统重启已启动。', 'success')
    } catch (error) {
      console.error('Failed to restart:', error)
      show('重启系统失败', 'error')
    }
  }

  if (settingsData.loading) {
    return <div className="text-white p-8 text-center">正在加载设置...</div>
  }

  return (
    <div className="px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 md:pt-6 space-y-5 md:space-y-8 pb-8 md:pb-12">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-1.5 md:mb-2">系统设置</h1>
        <p className="text-sm md:text-base text-gray-400">管理常规选项、全局黑名单、B站登录和系统控制。</p>
      </header>

      <GeneralSettingsSection
        generalConfig={settingsData.generalConfig}
        savingGeneral={settingsData.savingGeneral}
        onGeneralChange={settingsData.handleGeneralChange}
        onSaveGeneral={settingsData.saveGeneralSettings}
        previewGradientConfig={settingsData.previewGradientConfig}
        savingPreviewGradient={settingsData.savingPreviewGradient}
        onPreviewGradientChange={settingsData.handlePreviewGradientChange}
        onSavePreviewGradient={settingsData.savePreviewGradientSettings}
        onResetPreviewGradient={settingsData.resetPreviewGradientSettings}
      />

      <BiliGlobalSection
        biliGlobalStatus={settingsData.biliGlobalStatus}
        biliLoading={biliActions.biliLoading}
        onLogin={biliActions.handleBiliGlobalLogin}
        onLogout={biliActions.handleBiliGlobalLogout}
      />

      <GlobalBlacklistSection
        blacklist={settingsData.blacklist}
        newBlacklistQQ={settingsData.newBlacklistQQ}
        addingBlacklist={settingsData.addingBlacklist}
        onNewBlacklistQQChange={settingsData.setNewBlacklistQQ}
        onAddBlacklist={settingsData.handleAddBlacklist}
        onRemoveBlacklist={settingsData.handleRemoveBlacklist}
      />

      <VideoDownloadSection
        videoDownloadConfig={settingsData.videoDownloadConfig}
        savingVideoDownload={settingsData.savingVideoDownload}
        onVideoDownloadChange={(field, value) => settingsData.setVideoDownloadConfig(p => ({ ...p, [field]: value }))}
        onSaveVideoDownload={settingsData.saveVideoDownloadSettings}
      />

      <SystemControlSection onRestart={handleRestart} />

      <RestartConfirmModal
        isOpen={isRestartModalOpen}
        onClose={() => setIsRestartModalOpen(false)}
        onConfirm={confirmRestart}
      />

      <BiliQrModal
        isOpen={biliActions.isQrModalOpen}
        onClose={biliActions.closeQrModal}
        qrCodeUrl={biliActions.qrCodeUrl}
      />
    </div>
  )
}

export default Settings
