export const validateNightMode = (nightMode) => {
  if (nightMode?.mode !== 'timed') return null;

  const timeRegex = /^\d{1,2}:\d{2}$/;
  if (!timeRegex.test(nightMode.startTime) || !timeRegex.test(nightMode.endTime)) {
    return '时间格式不正确，请使用 HH:mm 格式';
  }

  const [startH, startM] = nightMode.startTime.split(':').map(Number);
  const [endH, endM] = nightMode.endTime.split(':').map(Number);

  if (
    startH < 0 || startH > 23 || startM < 0 || startM > 59 ||
    endH < 0 || endH > 23 || endM < 0 || endM > 59
  ) {
    return '时间超出有效范围（00:00-23:59）';
  }

  return null;
};

export const validateAdminQQ = (qq) => {
  if (!/^\d+$/.test(qq)) {
    return '请输入有效的 QQ 号（纯数字）';
  }

  if (qq.length < 5 || qq.length > 11) {
    return 'QQ 号长度不正确（应为 5-11 位）';
  }

  return null;
};
