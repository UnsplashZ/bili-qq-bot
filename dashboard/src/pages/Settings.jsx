import { useState } from 'react'
import api from '../utils/auth'
import { useToast } from '../hooks/useToast'
import GeneralSettingsSection from './settings/components/GeneralSettingsSection'
import QqProviderSection from './settings/components/QqProviderSection'
import BiliGlobalSection from './settings/components/BiliGlobalSection'
import GlobalBlacklistSection from './settings/components/GlobalBlacklistSection'
import VideoDownloadSection from './settings/components/VideoDownloadSection'
import ConfigRuntimeStatusSection from './settings/components/ConfigRuntimeStatusSection'
import SystemControlSection from './settings/components/SystemControlSection'
import RestartConfirmModal from './settings/components/RestartConfirmModal'
import BiliQrModal from './settings/components/BiliQrModal'
import useSettingsData from './settings/hooks/useSettingsData'
import useBiliLogin from './settings/hooks/useBiliLogin'
import { Save } from 'lucide-react'
import { Button } from '../components/ui'

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
    return <div className="p-8 text-center text-[var(--muted)]">正在加载设置...</div>
  }

  const savingSettings = settingsData.savingGeneral || settingsData.savingVideoDownload
  const recoveryRequired = settingsData.configStatus?.recoveryRequired?.required === true

  return (
    <div className="admin-page space-y-6 md:space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-xs font-semibold uppercase text-[var(--accent)]">Configure</div>
          <h1 className="mt-1 text-3xl font-semibold text-[var(--fg)]">系统设置</h1>
          <p className="mt-1.5 text-xs text-[var(--muted)]">配置运行环境、连接方式和全局行为。</p>
        </div>
        <Button
          type="button"
          onClick={settingsData.saveAllSettings}
          disabled={savingSettings || recoveryRequired || settingsData.recoveringConfig}
          variant="primary"
          icon={Save}
        >
          {savingSettings ? '保存中...' : '保存设置'}
        </Button>
      </header>

      <GeneralSettingsSection
        generalConfig={settingsData.generalConfig}
        onGeneralChange={settingsData.handleGeneralChange}
        disabled={recoveryRequired}
      />

      <ConfigRuntimeStatusSection
        status={settingsData.configStatus}
        migration={settingsData.migrationStatus}
        lastApplyResult={settingsData.lastApplyResult}
        reloading={settingsData.reloadingConfig}
        onReload={settingsData.reloadConfig}
        recovering={settingsData.recoveringConfig}
        recoveryResult={settingsData.recoveryResult}
        onRecover={settingsData.recoverConfig}
      />

      <QqProviderSection
        config={settingsData.qqProviderConfig}
        status={settingsData.qqProviderStatus}
        onClearSecret={settingsData.clearOfficialSecret}
        disabled={recoveryRequired}
        onChange={(field, value) => settingsData.setQqProviderConfig(p => ({ ...p, [field]: value }))}
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
        disabled={recoveryRequired}
      />

      <VideoDownloadSection
        videoDownloadConfig={settingsData.videoDownloadConfig}
        onVideoDownloadChange={(field, value) => settingsData.setVideoDownloadConfig(p => ({ ...p, [field]: value }))}
        disabled={recoveryRequired}
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
