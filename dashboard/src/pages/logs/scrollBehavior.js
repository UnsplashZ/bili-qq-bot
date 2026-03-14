const DEFAULT_VISIBLE_ROWS = 3;
const DEFAULT_BOTTOM_THRESHOLD = 96;
const MIN_BOTTOM_THRESHOLD = 72;
const MAX_BOTTOM_THRESHOLD = 240;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function getBottomThreshold(rowHeight, visibleRows = DEFAULT_VISIBLE_ROWS) {
  const normalizedHeight = Number(rowHeight);
  const normalizedRows = Number(visibleRows);
  if (!Number.isFinite(normalizedHeight) || normalizedHeight <= 0 || !Number.isFinite(normalizedRows) || normalizedRows <= 0) {
    return DEFAULT_BOTTOM_THRESHOLD;
  }

  return clamp(
    Math.round(normalizedHeight * normalizedRows),
    MIN_BOTTOM_THRESHOLD,
    MAX_BOTTOM_THRESHOLD
  );
}

export function isNearBottom({ scrollTop = 0, clientHeight = 0, scrollHeight = 0 }, threshold = DEFAULT_BOTTOM_THRESHOLD) {
  if (scrollHeight <= clientHeight) {
    return true;
  }
  return scrollTop + clientHeight >= scrollHeight - threshold;
}

export function getScrollTargetMode({ containerHasOverflow = false, pageHasOverflow = false } = {}) {
  if (containerHasOverflow) {
    return 'container';
  }
  if (pageHasOverflow) {
    return 'page';
  }
  return null;
}

export function getFloatingButtonMode({ hasLogs = false, hasOverflow = false, isNearBottomPosition = false } = {}) {
  if (!hasLogs) {
    return null;
  }
  if (!hasOverflow) {
    return 'bottom';
  }
  return isNearBottomPosition ? 'top' : 'bottom';
}

export { DEFAULT_BOTTOM_THRESHOLD, MIN_BOTTOM_THRESHOLD, MAX_BOTTOM_THRESHOLD };
