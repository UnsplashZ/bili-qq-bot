import { useCallback, useState } from 'react';
import api from '../../../utils/auth';
import { validateAdminQQ } from '../utils/validators';

const useGroupPermissions = ({
  selectedGroupId,
  groups,
  setGroups,
  formData,
  setFormData,
  runLockedAction,
  show
}) => {
  const [blacklistInput, setBlacklistInput] = useState('');
  const [adminInput, setAdminInput] = useState('');

  const handleUpdateBlacklist = useCallback(async (newBlacklist) => {
    return runLockedAction('blacklist', async () => {
      try {
        setFormData((prev) => ({ ...prev, blacklistedQQs: newBlacklist }));
        await api.post(`/api/groups/${selectedGroupId}/config`, { blacklistedQQs: newBlacklist });

        setGroups((prev) => prev.map((group) => (
          group.id === selectedGroupId
            ? { ...group, config: { ...group.config, blacklistedQQs: newBlacklist } }
            : group
        )));

        show('黑名单已更新', 'success');
        return true;
      } catch (err) {
        console.error(err);
        show('更新黑名单失败', 'error');
        return false;
      }
    });
  }, [runLockedAction, selectedGroupId, setFormData, setGroups, show]);

  const handleAddBlacklist = useCallback(async () => {
    if (!blacklistInput) return;
    if (formData.blacklistedQQs.includes(blacklistInput)) {
      show('该 QQ 已在黑名单中', 'error');
      return;
    }

    const newList = [...formData.blacklistedQQs, blacklistInput];
    const success = await handleUpdateBlacklist(newList);
    if (success) {
      setBlacklistInput('');
    }
  }, [blacklistInput, formData.blacklistedQQs, show, handleUpdateBlacklist]);

  const handleRemoveBlacklist = useCallback(async (qq) => {
    const newList = formData.blacklistedQQs.filter((item) => item !== qq);
    await handleUpdateBlacklist(newList);
  }, [formData.blacklistedQQs, handleUpdateBlacklist]);

  const handleUpdateAdmins = useCallback(async (newAdmins) => {
    return runLockedAction('admins', async () => {
      try {
        setFormData((prev) => ({ ...prev, admins: newAdmins }));
        await api.post(`/api/groups/${selectedGroupId}/config`, { admins: newAdmins });

        setGroups((prev) => prev.map((group) => (
          group.id === selectedGroupId
            ? { ...group, config: { ...group.config, admins: newAdmins } }
            : group
        )));

        return true;
      } catch (err) {
        console.error(err);
        show('更新管理员失败', 'error');

        const currentGroup = groups.find((group) => group.id === selectedGroupId);
        if (currentGroup && currentGroup.config) {
          setFormData((prev) => ({ ...prev, admins: currentGroup.config.admins || [] }));
        }
        return false;
      }
    });
  }, [runLockedAction, selectedGroupId, setFormData, setGroups, show, groups]);

  const handleAddAdmin = useCallback(async () => {
    if (!adminInput) return;

    const adminQQError = validateAdminQQ(adminInput);
    if (adminQQError) {
      show(adminQQError, 'error');
      return;
    }

    if (formData.admins?.includes(adminInput)) {
      show('该 QQ 已是管理员', 'error');
      return;
    }

    const newAdmins = [...(formData.admins || []), adminInput];
    const success = await handleUpdateAdmins(newAdmins);
    if (success) {
      setAdminInput('');
      show('管理员已添加', 'success');
    }
  }, [adminInput, formData.admins, show, handleUpdateAdmins]);

  const handleRemoveAdmin = useCallback(async (qq) => {
    const newAdmins = (formData.admins || []).filter((admin) => admin !== qq);
    const success = await handleUpdateAdmins(newAdmins);
    if (success) {
      show('管理员已移除', 'success');
    }
  }, [formData.admins, show, handleUpdateAdmins]);

  return {
    blacklistInput,
    setBlacklistInput,
    adminInput,
    setAdminInput,
    handleAddBlacklist,
    handleRemoveBlacklist,
    handleAddAdmin,
    handleRemoveAdmin
  };
};

export default useGroupPermissions;
