import React, { useEffect, useState } from 'react';
import GlassCard from '../components/GlassCard';
import ModernTabs from '../components/ModernTabs';
import { useToast } from '../hooks/useToast';
import { Save, MessageSquare } from 'lucide-react';
import GroupListPanel from './groups/components/GroupListPanel';
import AddSubscriptionModal from './groups/components/AddSubscriptionModal';
import GeneralTab from './groups/components/tabs/GeneralTab';
import SubscriptionsTab from './groups/components/tabs/SubscriptionsTab';
import PermissionsTab from './groups/components/tabs/PermissionsTab';
import SyncTab from './groups/components/tabs/SyncTab';
import VideoDownloadTab from './groups/components/tabs/VideoDownloadTab';
import { AT_ALL_CATEGORY_ITEMS } from './groups/constants/atAll';
import { GROUP_TAB_CATEGORIES } from './groups/constants/tabs';
import useActionLock from './groups/hooks/useActionLock';
import useGroupList from './groups/hooks/useGroupList';
import useGroupSyncConfig from './groups/hooks/useGroupSyncConfig';
import useSubscriptions from './groups/hooks/useSubscriptions';
import useGroupForm from './groups/hooks/useGroupForm';
import useGroupPermissions from './groups/hooks/useGroupPermissions';
import useGroupVideoDownloadConfig from './groups/hooks/useGroupVideoDownloadConfig';

const SUB_TYPES = [
  { value: 'user', label: 'UP主' },
  { value: 'bangumi', label: '番剧' }
];

function Groups() {
  const { show } = useToast();
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  const { actionLoading, runLockedAction } = useActionLock();

  const {
    groups,
    setGroups,
    selectedGroupId,
    setSelectedGroupId,
    loading,
    handleToggleGroup,
    handleDeleteConfig
  } = useGroupList({ show });

  const {
    biliGroups,
    biliGroupsLoading,
    atAllTargets,
    atAllTargetsLoading,
    globalBiliStatus,
    fetchBiliGroups,
    fetchAtAllTargets,
    checkGlobalBiliStatus
  } = useGroupSyncConfig();

  const {
    formData,
    setFormData,
    saving,
    handleSave,
    globalConfig,
    toggleSyncGroup,
    toggleAtAllSource,
    toggleAtAllCategory,
    setAllAtAllIdsEnabled,
    toggleAtAllUser,
    isAtAllUserEnabled,
    isCookieUserInSelectedSyncGroups,
    atAllRules
  } = useGroupForm({
    selectedGroupId,
    groups,
    setGroups,
    show,
    atAllTargets
  });

  const {
    subscriptions,
    subsLoading,
    isSubModalOpen,
    setIsSubModalOpen,
    subForm,
    setSubForm,
    fetchSubscriptions,
    handleAddSubscription,
    handleDeleteSubscription
  } = useSubscriptions({
    selectedGroupId,
    show,
    refreshAtAllTargets: fetchAtAllTargets
  });

  const {
    blacklistInput,
    setBlacklistInput,
    adminInput,
    setAdminInput,
    handleAddBlacklist,
    handleRemoveBlacklist,
    handleAddAdmin,
    handleRemoveAdmin
  } = useGroupPermissions({
    selectedGroupId,
    groups,
    setGroups,
    formData,
    setFormData,
    runLockedAction,
    show
  });

  const {
    videoDownloadConfig,
    setVideoDownloadConfig,
    fetchVideoDownloadConfig,
    saveVideoDownloadConfig,
    videoDownloadDirty,
    videoDownloadResetPending,
    resetVideoDownloadConfig
  } = useGroupVideoDownloadConfig({
    selectedGroupId,
    runLockedAction,
    show
  });

  const VIDEO_DOWNLOAD_TAB_INDEX = GROUP_TAB_CATEGORIES.findIndex((category) => category.name === '视频下载');

  const handleSaveAll = async () => {
    const configSaved = await handleSave();
    if (!configSaved) return;
    if (videoDownloadDirty || videoDownloadResetPending) {
      await saveVideoDownloadConfig();
    }
  };

  useEffect(() => {
    if (!selectedGroupId) return;

    if (selectedTabIndex === 1) {
      fetchSubscriptions(selectedGroupId);
    }
    if (GROUP_TAB_CATEGORIES[selectedTabIndex]?.name === '关注同步') {
      fetchBiliGroups(selectedGroupId);
      fetchAtAllTargets(selectedGroupId);
      checkGlobalBiliStatus();
    }
    if (selectedTabIndex === VIDEO_DOWNLOAD_TAB_INDEX) {
      fetchVideoDownloadConfig(selectedGroupId);
    }
  }, [
    selectedTabIndex,
    selectedGroupId,
    groups,
    fetchSubscriptions,
    fetchBiliGroups,
    fetchAtAllTargets,
    checkGlobalBiliStatus,
    fetchVideoDownloadConfig,
    VIDEO_DOWNLOAD_TAB_INDEX
  ]);

  return (
    <div className="space-y-4 pb-5 md:space-y-6 md:pb-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">群组管理</h1>
      </header>

      <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 md:gap-6 lg:h-[calc(100vh-9rem)]">
        <GroupListPanel
          groups={groups}
          loading={loading}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          onToggleGroup={handleToggleGroup}
          onDeleteConfig={handleDeleteConfig}
        />

        <div className="w-full lg:w-2/3 flex flex-col">
          {selectedGroupId ? (
            <GlassCard className="flex-1 flex flex-col p-0 overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-white sm:text-xl">
                    {groups.find((group) => group.id === selectedGroupId)?.name || '群组设置'}
                  </h2>
                  <div className="mt-1 text-xs text-slate-500">ID: {selectedGroupId}</div>
                </div>
                <button
                  onClick={handleSaveAll}
                  disabled={saving || actionLoading.videoConfig}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500/20 px-3 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-4"
                >
                  <Save size={16} />
                  {saving || actionLoading.videoConfig ? '保存中...' : '保存更改'}
                </button>
              </div>
              <ModernTabs
                tabs={GROUP_TAB_CATEGORIES}
                selectedIndex={selectedTabIndex}
                onChange={setSelectedTabIndex}
              >
                <GeneralTab formData={formData} setFormData={setFormData} />
                <SubscriptionsTab
                  subsLoading={subsLoading}
                  subscriptions={subscriptions}
                  subTypes={SUB_TYPES}
                  onOpenAddModal={() => setIsSubModalOpen(true)}
                  onDeleteSubscription={handleDeleteSubscription}
                />
                <PermissionsTab
                  globalConfig={globalConfig}
                  adminInput={adminInput}
                  setAdminInput={setAdminInput}
                  onAddAdmin={handleAddAdmin}
                  onRemoveAdmin={handleRemoveAdmin}
                  blacklistInput={blacklistInput}
                  setBlacklistInput={setBlacklistInput}
                  onAddBlacklist={handleAddBlacklist}
                  onRemoveBlacklist={handleRemoveBlacklist}
                  formData={formData}
                  actionLoading={actionLoading}
                />
                <SyncTab
                  formData={formData}
                  setFormData={setFormData}
                  atAllRules={atAllRules}
                  atAllCategoryItems={AT_ALL_CATEGORY_ITEMS}
                  toggleAtAllSource={toggleAtAllSource}
                  toggleAtAllCategory={toggleAtAllCategory}
                  setAllAtAllIdsEnabled={setAllAtAllIdsEnabled}
                  atAllTargetsLoading={atAllTargetsLoading}
                  atAllTargets={atAllTargets}
                  isAtAllUserEnabled={isAtAllUserEnabled}
                  toggleAtAllUser={toggleAtAllUser}
                  isCookieUserInSelectedSyncGroups={isCookieUserInSelectedSyncGroups}
                  globalBiliStatus={globalBiliStatus}
                  biliGroupsLoading={biliGroupsLoading}
                  biliGroups={biliGroups}
                  toggleSyncGroup={toggleSyncGroup}
                />
                <VideoDownloadTab
                  videoDownloadConfig={videoDownloadConfig}
                  setVideoDownloadConfig={setVideoDownloadConfig}
                  actionLoading={actionLoading}
                  onResetVideoDownloadConfig={resetVideoDownloadConfig}
                />
              </ModernTabs>
            </GlassCard>
          ) : (
            <GlassCard className="flex-1 flex flex-col items-center justify-center text-center text-gray-400">
              <MessageSquare size={48} className="mb-4 opacity-50" />
              <h3 className="text-xl font-medium text-white mb-2">选择一个群组</h3>
              <p>从列表中选择一个群组以查看和编辑其配置。</p>
            </GlassCard>
          )}
        </div>
      </div>

      <AddSubscriptionModal
        isOpen={isSubModalOpen}
        onClose={() => setIsSubModalOpen(false)}
        subForm={subForm}
        setSubForm={setSubForm}
        subTypes={SUB_TYPES}
        onAddSubscription={handleAddSubscription}
      />
    </div>
  );
}

export default Groups;
