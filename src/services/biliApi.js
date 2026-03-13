const serviceManager = require('./ServiceManager');
const cacheManager = require('../utils/cacheManager');
const axios = require('axios');
const logger = require('../utils/logger');
const BILI_API_SCOPE = logger.createScope('svc', 'bili-api')

class BiliApi {
    _resolveCacheBehavior(cacheOptions) {
        if (cacheOptions === true) {
            return { readCache: false, writeCache: true };
        }

        if (!cacheOptions || cacheOptions === false || cacheOptions === 'cached') {
            return { readCache: true, writeCache: true };
        }

        if (cacheOptions === 'fresh') {
            return { readCache: false, writeCache: true };
        }

        if (typeof cacheOptions === 'object') {
            const policy = cacheOptions.policy || cacheOptions.mode || 'cached';
            const readCache = policy !== 'fresh';
            const writeCache = cacheOptions.writeCache !== false;
            return { readCache, writeCache };
        }

        return { readCache: true, writeCache: true };
    }

    /**
     * Helper to wrap requests with caching
     * @param {string} keyPrefix - Cache key prefix
     * @param {string} id - Resource ID
     * @param {string} groupId - Group ID for context
     * @param {Function} fetchFn - Function to execute on cache miss
     * @param {boolean|string|object} [cacheOptions=false] - Cache policy
     */
    async _withCache(keyPrefix, id, groupId, fetchFn, cacheOptions = false) {
        const cacheKey = `${keyPrefix}:${id}:${groupId || 'public'}`;
        const cacheBehavior = this._resolveCacheBehavior(cacheOptions);

        // Try cache first
        if (cacheBehavior.readCache) {
            const cached = await cacheManager.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        try {
            // Fetch fresh data
            const result = await fetchFn();

            // Only cache successful results
            if (cacheBehavior.writeCache && result && result.status === 'success') {
                await cacheManager.set(cacheKey, result);
            }

            return result;
        } catch (error) {
            // Fallback for network/service errors
            return {
                status: 'error',
                message: `Service communication error: ${error.message}`
            };
        }
    }

    async getVideoInfo(bvid, groupId) {
        return this._withCache('video', bvid, groupId, () =>
            serviceManager.sendCommand('video', { bvid, group_id: groupId })
        );
    }

    async downloadVideo(bvid, pageIndex, resolution, groupId, videoMeta = null) {
        // 下载操作不缓存，超时设为 5 分钟
        // output_dir 由 Python 侧固定为脚本相对路径，不再由 Node 侧传入
        try {
            if (!serviceManager.process) {
                await serviceManager.start()
            }
            serviceManager.lastRequestTime = Date.now()
            const url = `${serviceManager.baseUrl}/video_download`
            const payload = {
                bvid,
                page_index: pageIndex,
                resolution,
                group_id: groupId,
            }
            if (videoMeta) payload.video_meta = videoMeta
            const response = await axios.post(url, payload, { timeout: 5 * 60 * 1000 })
            return response.data
        } catch (error) {
            logger.logEvent('error', 'RPC', BILI_API_SCOPE, 'video-download-failed', {
                bvid,
                pageIndex,
                resolution,
                groupId,
                error: logger.getErrorMessage(error)
            })
            return { status: 'error', message: error.message }
        }
    }

    async getLoginUrl() {
        // No cache for login QR (one-time use)
        return serviceManager.sendCommand('login_url', {});
    }

    async checkLogin(key, groupId) {
        // No cache for login check (polling)
        return serviceManager.sendCommand('login_check', { key, group_id: groupId });
    }

    async getUserDynamic(uid, groupId, cacheOptions = false) {
        // Caching user dynamics (reduces load on subscription checks)
        return this._withCache('user_dynamic', uid, groupId, () =>
            serviceManager.sendCommand('user_dynamic', { uid, group_id: groupId }),
            cacheOptions
        );
    }

    async getUserLive(uid, groupId) {
        // No cache for live status (needs real-time)
        return serviceManager.sendCommand('user_live', { uid, group_id: groupId });
    }

    async getDynamicInfo(dynamicId, groupId) {
        return this._withCache('dynamic', dynamicId, groupId, () =>
            serviceManager.sendCommand('dynamic_detail', { dynamic_id: dynamicId, group_id: groupId })
        );
    }

    async getArticleInfo(cvid, groupId) {
        return this._withCache('article', cvid, groupId, () =>
            serviceManager.sendCommand('article', { cvid, group_id: groupId })
        );
    }

    async getBangumiInfo(seasonId, groupId) {
        return this._withCache('bangumi', seasonId, groupId, () =>
            serviceManager.sendCommand('bangumi', { season_id: seasonId, group_id: groupId })
        );
    }

    async getLiveRoomInfo(roomId, groupId) {
        // No cache for room info (online count/status changes)
        return serviceManager.sendCommand('live_room', { room_id: roomId, group_id: groupId });
    }

    async getOpusInfo(opusId, groupId) {
        return this._withCache('opus', opusId, groupId, () =>
            serviceManager.sendCommand('opus', { opus_id: opusId, group_id: groupId })
        );
    }

    async getUserInfo(uid, groupId, cacheOptions = false, requestOptions = {}) {
        return this._withCache('user', uid, groupId, () =>
            serviceManager.sendCommand('user_info', { uid, group_id: groupId }, requestOptions),
            cacheOptions
        );
    }

    async getUserCard(uid, groupId) {
        return this._withCache('user_card', uid, groupId, () =>
            serviceManager.sendCommand('user_card', { uid, group_id: groupId })
        );
    }

    async getEpInfo(epId, groupId) {
        return this._withCache('ep', epId, groupId, () =>
            serviceManager.sendCommand('ep', { ep_id: epId, group_id: groupId })
        );
    }

    async getMediaInfo(mediaId, groupId) {
        return this._withCache('media', mediaId, groupId, () =>
            serviceManager.sendCommand('media', { media_id: mediaId, group_id: groupId })
        );
    }

    async getMyInfo(groupId) {
        // Personal info usually doesn't change often, but let's keep it fresh for now
        // or execute without cache
        return serviceManager.sendCommand('my_info', { group_id: groupId });
    }

    async getMyFollowings(groupName, groupId) {
        return serviceManager.sendCommand('my_followings', { group_name: groupName, group_id: groupId });
    }

    async getDynamicFeed(offset, groupId) {
        // No cache for dynamic feed (real-time data)
        return serviceManager.sendCommand('dynamic_feed', { offset, group_id: groupId });
    }

    async getLiveFeed(groupId) {
        // No cache for live feed (real-time data)
        return serviceManager.sendCommand('live_feed', { group_id: groupId });
    }

    async getFollowGroups(groupId) {
        // Cache this as tags don't change often
        return this._withCache('follow_groups', 'list', groupId, () =>
            serviceManager.sendCommand('get_follow_groups', { group_id: groupId })
        );
    }

    /**
     * 获取用户视频列表
     * @param {string|number} uid - 用户UID
     * @param {string} groupId - 群组ID（用于Cookie）
     * @returns {Promise<Object>} 视频列表
     */
    async getUserVideos(uid, groupId = null) {
        // No cache for video list (need fresh data for subscription)
        return serviceManager.sendCommand('user_videos', { uid: String(uid), group_id: groupId });
    }

    /**
     * 获取用户专栏列表
     * @param {string|number} uid - 用户UID
     * @param {string} groupId - 群组ID（用于Cookie）
     * @returns {Promise<Object>} 专栏列表
     */
    async getUserArticles(uid, groupId = null) {
        // No cache for article list (need fresh data for subscription)
        return serviceManager.sendCommand('user_articles', { uid: String(uid), group_id: groupId });
    }

    /**
     * 获取全局Cookie的用户信息
     * @returns {Promise<{status: string, data?: {uid, username, is_logged_in, timestamp}, message?: string}>}
     */
    async getGlobalCredentialInfo(bypassCache = false) {
        // 短期缓存（60秒），避免频繁查询
        return this._withCache('global_credential_info', 'global', null, async () => {
            try {
                const result = await serviceManager.sendCommand('credential_info', {});
                return result;
            } catch (error) {
                return {
                    status: 'error',
                    message: error.message || 'Failed to fetch credential info'
                };
            }
        }, bypassCache);
    }

    /**
     * 检查并自动刷新全局 Cookie
     * @returns {Promise<{status: string, refreshed?: boolean, reason?: string, message: string}>}
     */
    async refreshCredential() {
        try {
            return await serviceManager.sendCommand('refresh_credential', {});
        } catch (error) {
            return { status: 'error', reason: 'service_unavailable', message: error.message };
        }
    }
}

module.exports = new BiliApi();
