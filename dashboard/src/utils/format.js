/**
 * Format bytes to human readable string
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted string (e.g., "1.5 GB")
 */
export const formatBytes = (bytes, decimals = 2) => {
  if (!+bytes) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

/**
 * Format uptime in seconds to human readable string
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted string (e.g., "2d 4h 30m")
 */
export const formatUptime = (seconds) => {
  if (!seconds || seconds < 0) return '0m';

  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(' ') : '0m';
};

/**
 * Format network speed (bytes per second)
 * @param {number} bytesPerSecond - Bytes per second
 * @returns {string} Formatted string (e.g., "1.5 MB/s")
 */
export const formatNetSpeed = (bytesPerSecond) => {
  return `${formatBytes(bytesPerSecond)}/s`;
};
