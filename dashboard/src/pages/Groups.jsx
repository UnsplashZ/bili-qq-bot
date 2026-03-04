import React, { useEffect, useState } from 'react';
import { Tab } from '@headlessui/react';
import GlassCard from '../components/GlassCard';
import { useToast } from '../hooks/useToast';
import { Save, MessageSquare } from 'lucide-react';
import { clsx } from 'clsx';
import GroupListPanel from './groups/components/GroupListPanel';
import AddSubscriptionModal from './groups/components/AddSubscriptionModal';
import GeneralTab from './groups/components/tabs/GeneralTab';
import SubscriptionsTab from './groups/components/tabs/SubscriptionsTab';
import PermissionsTab from './groups/components/tabs/PermissionsTab';
import AiTab from './groups/components/tabs/AiTab';
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
import useGroupAiConfig from './groups/hooks/useGroupAiConfig';
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
    globalConfigLoading,
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

  const { handleAiToggle, handleAiReset } = useGroupAiConfig({
    selectedGroupId,
    setGroups,
    runLockedAction,
    show
  });

  const {
    videoDownloadConfig,
    setVideoDownloadConfig,
    fetchVideoDownloadConfig,
    saveVideoDownloadConfig,
    resetVideoDownloadConfig
  } = useGroupVideoDownloadConfig({
    selectedGroupId,
    runLockedAction,
    show
  });

  const categories = GROUP_TAB_CATEGORIES;
  const VIDEO_DOWNLOAD_TAB_INDEX = categories.findIndex((category) => category.name === '视频下载');

  useEffect(() => {
    if (!selectedGroupId) return;

    if (selectedTabIndex === 1) {
      fetchSubscriptions(selectedGroupId);
    }
    if (selectedTabIndex === 4) {
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
    <div className="px-4 md:px-6 pt-4 md:pt-6 space-y-4 md:space-y-6 pb-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">群组管理</h1>
        <p className="text-sm md:text-base text-gray-400">管理QQ群组配置、订阅和权限设置</p>
      </header>

      <div className="flex flex-col lg:flex-row gap-4 md:gap-6 lg:h-[calc(100vh-9rem)]">
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
              <Tab.Group as="div" className="flex flex-col h-full" selectedIndex={selectedTabIndex} onChange={setSelectedTabIndex}>
                <div className="flex-shrink-0 border-b border-white/10 bg-white/5 px-4 pt-4">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">
                      {groups.find((group) => group.id === selectedGroupId)?.name || '群组设置'}
                    </h2>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Save size={16} />
                      {saving ? '保存中...' : '保存更改'}
                    </button>
                  </div>
                  <Tab.List className="flex space-x-1 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20">
                    {categories.map((category) => (
                      <Tab
                        key={category.name}
                        className={({ selected }) => clsx(
                          'w-full py-2.5 text-sm font-medium leading-5 rounded-t-lg transition-all focus:outline-none',
                          selected
                            ? 'bg-white/10 text-blue-400 border-b-2 border-blue-400'
                            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border-b-2 border-transparent'
                        )}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <category.icon size={16} />
                          {category.name}
                        </div>
                      </Tab>
                    ))}
                  </Tab.List>
                </div>

                <Tab.Panels className="flex-1 min-h-0 p-6 overflow-y-auto">
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
                  <AiTab
                    formData={formData}
                    setFormData={setFormData}
                    globalConfig={globalConfig}
                    globalConfigLoading={globalConfigLoading}
                    actionLoading={actionLoading}
                    onAiToggle={handleAiToggle}
                    onAiReset={handleAiReset}
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
                    onSaveVideoDownloadConfig={saveVideoDownloadConfig}
                  />
                </Tab.Panels>
              </Tab.Group>
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
