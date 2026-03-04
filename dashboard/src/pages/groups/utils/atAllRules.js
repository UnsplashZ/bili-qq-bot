import { AT_ALL_SOURCE_KEYS } from '../constants/atAll';

export const createDefaultAtAllRules = () => ({
  sources: {
    manual: true,
    cookieSync: true
  },
  categories: {
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
  },
  manualDisabledIds: [],
  cookieSyncDisabledIds: []
});

export const normalizeIdList = (list) => {
  if (!Array.isArray(list)) return [];

  const normalized = [];
  for (const item of list) {
    const uid = String(item ?? '').trim();
    if (!/^\d+$/.test(uid)) continue;
    if (!normalized.includes(uid)) {
      normalized.push(uid);
    }
  }

  return normalized;
};

export const normalizeAtAllRules = (rules) => {
  const defaults = createDefaultAtAllRules();
  const sourceInput = rules && typeof rules === 'object' && rules.sources && typeof rules.sources === 'object'
    ? rules.sources
    : {};
  const categoryInput = rules && typeof rules === 'object' && rules.categories && typeof rules.categories === 'object'
    ? rules.categories
    : {};

  const normalizedSources = {};
  AT_ALL_SOURCE_KEYS.forEach((key) => {
    normalizedSources[key] = typeof sourceInput[key] === 'boolean' ? sourceInput[key] : defaults.sources[key];
  });

  const normalizedCategories = {};
  Object.keys(defaults.categories).forEach((key) => {
    normalizedCategories[key] = typeof categoryInput[key] === 'boolean'
      ? categoryInput[key]
      : defaults.categories[key];
  });

  return {
    sources: normalizedSources,
    categories: normalizedCategories,
    manualDisabledIds: normalizeIdList(rules?.manualDisabledIds),
    cookieSyncDisabledIds: normalizeIdList(rules?.cookieSyncDisabledIds)
  };
};
