import { createDefaultAtAllRules, normalizeAtAllRules } from './atAllRules';

const createDefaultLabelConfig = () => ({
  video: true,
  dynamic: true,
  live: true,
  article: true,
  bangumi: true,
  movie: true,
  tv: true,
  guocha: true,
  doc: true,
  variety: true
});

const createDefaultNightMode = () => ({
  mode: 'off',
  startTime: '21:00',
  endTime: '06:00'
});

export const createDefaultGroupFormData = () => ({
  linkCacheTimeout: 5,
  showId: true,
  labelConfig: createDefaultLabelConfig(),
  enableCookieSync: false,
  subscriptionAtAll: false,
  subscriptionAtAllRules: createDefaultAtAllRules(),
  cookieSyncGroupNames: [],
  blacklistedQQs: [],
  admins: [],
  aiProbability: null,
  aiContextLimit: null,
  aiTemperature: null,
  nightMode: createDefaultNightMode()
});

const resolveCookieSyncGroupNames = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

export const mapGroupConfigToFormData = (config, globalShowId) => {
  const safeConfig = config || {};
  const labels = safeConfig.labelConfig || {};

  return {
    linkCacheTimeout: safeConfig.linkCacheTimeout ?? 5,
    showId: safeConfig.showId ?? globalShowId ?? true,
    labelConfig: {
      video: labels.video ?? true,
      dynamic: labels.dynamic ?? true,
      live: labels.live ?? true,
      article: labels.article ?? true,
      bangumi: labels.bangumi ?? true,
      movie: labels.movie ?? true,
      tv: labels.tv ?? true,
      guocha: labels.guocha ?? true,
      doc: labels.doc ?? true,
      variety: labels.variety ?? true
    },
    enableCookieSync: safeConfig.enableCookieSync ?? false,
    subscriptionAtAll: safeConfig.subscriptionAtAll ?? false,
    subscriptionAtAllRules: normalizeAtAllRules(safeConfig.subscriptionAtAllRules),
    cookieSyncGroupNames: resolveCookieSyncGroupNames(safeConfig.cookieSyncGroupNames),
    blacklistedQQs: Array.isArray(safeConfig.blacklistedQQs) ? safeConfig.blacklistedQQs : [],
    admins: Array.isArray(safeConfig.admins) ? safeConfig.admins : [],
    aiProbability: safeConfig.aiProbability ?? null,
    aiContextLimit: safeConfig.aiContextLimit ?? null,
    aiTemperature: safeConfig.aiTemperature ?? null,
    aiEnabled: safeConfig.aiEnabled ?? null,
    aiRagEnabled: safeConfig.aiRagEnabled ?? null,
    aiProfileEnabled: safeConfig.aiProfileEnabled ?? null,
    nightMode: safeConfig.nightMode || createDefaultNightMode()
  };
};
