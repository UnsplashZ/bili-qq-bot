const DEFAULT_BOTTOM_THRESHOLD = 48;

export function isNearBottom({ scrollTop = 0, clientHeight = 0, scrollHeight = 0 }, threshold = DEFAULT_BOTTOM_THRESHOLD) {
  if (scrollHeight <= clientHeight) {
    return true;
  }
  return scrollTop + clientHeight >= scrollHeight - threshold;
}

export { DEFAULT_BOTTOM_THRESHOLD };
