export const DEFAULT_LOG_LIMIT = 1000;
export const MIN_LOG_LIMIT = 100;
export const MAX_LOG_LIMIT = 2000;

export const LOG_LIMIT_OPTIONS = [
  { value: 100, label: '100 条' },
  { value: 300, label: '300 条' },
  { value: 500, label: '500 条' },
  { value: 1000, label: '1000 条' },
  { value: 2000, label: '2000 条' },
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeLogLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LOG_LIMIT;
  }
  return clamp(parsed, MIN_LOG_LIMIT, MAX_LOG_LIMIT);
}

export function appendWithLimit(prev = [], nextItems = [], maxLogs = DEFAULT_LOG_LIMIT) {
  const limit = normalizeLogLimit(maxLogs);
  const merged = [
    ...(Array.isArray(prev) ? prev : []),
    ...(Array.isArray(nextItems) ? nextItems : [nextItems]),
  ];
  if (merged.length > limit) {
    return merged.slice(-limit);
  }
  return merged;
}

export function buildLogFilterKey(filters = {}) {
  const channels = Array.isArray(filters.channels)
    ? [...filters.channels].map((channel) => String(channel)).sort()
    : [];

  return JSON.stringify({
    level: String(filters.level || '').toLowerCase(),
    channels,
    keyword: String(filters.keyword || '').trim(),
    limit: normalizeLogLimit(filters.limit),
  });
}
