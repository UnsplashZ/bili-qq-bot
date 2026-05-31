const serviceManager = require('./ServiceManager');
const cacheManager = require('../utils/cacheManager');
const logger = require('../utils/logger');
const { normalizeServiceError } = require('./biliApiServiceError');
const BILI_API_SCOPE = logger.createScope('svc', 'bili-api')

class BiliApi {
    _normalizeServiceResult(result, endpoint) {
        if (result && String(result.status || '').toLowerCase() === 'error') {
            return normalizeServiceError({
                data: result,
                httpStatus: result.httpStatus ?? result.http_status ?? 200,
                endpoint
            }, endpoint)
        }

        return result
    }

    async _sendCommand(endpoint, payload = {}, requestOptions = {}) {
        try {
            const result = await serviceManager.sendCommand(endpoint, payload, requestOptions);
            return this._normalizeServiceResult(result, endpoint);
        } catch (error) {
            return normalizeServiceError(error, endpoint);
        }
    }

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
    async _withCache(keyPrefix, id, groupId, fetchFn, cacheOptions = false, endpoint = keyPrefix) {
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
            const normalizedResult = this._normalizeServiceResult(result, endpoint);

            // Only cache successful results
            if (cacheBehavior.writeCache && normalizedResult && normalizedResult.status === 'success') {
                await cacheManager.set(cacheKey, normalizedResult);
            }

            return normalizedResult;
        } catch (error) {
            return normalizeServiceError(error, endpoint);
        }
    }

    async getVideoInfo(bvid, groupId) {
        return this._withCache('video', bvid, groupId, () =>
            serviceManager.sendCommand('video', { bvid, group_id: groupId }),
            false,
            'video'
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
            const payload = {
                bvid,
                page_index: pageIndex,
                resolution,
                group_id: groupId,
            }
            if (videoMeta) payload.video_meta = videoMeta
            const result = await serviceManager.sendCommand('video_download', payload, { timeoutMs: 5 * 60 * 1000 })
            return this._normalizeServiceResult(result, 'video_download')
        } catch (error) {
            logger.logEvent('error', 'RPC', BILI_API_SCOPE, 'video-download-failed', {
                bvid,
                pageIndex,
                resolution,
                groupId,
                error: logger.getErrorMessage(error)
            })
            return normalizeServiceError(error, 'video_download')
        }
    }

    async getLoginUrl() {
        // No cache for login QR (one-time use)
        return this._sendCommand('login_url', {});
    }

    async checkLogin(key, groupId) {
        // No cache for login check (polling)
        return this._sendCommand('login_check', { key, group_id: groupId });
    }

    async getUserDynamic(uid, groupId, cacheOptions = false) {
        // Caching user dynamics (reduces load on subscription checks)
        return this._withCache('user_dynamic', uid, groupId, () =>
            serviceManager.sendCommand('user_dynamic', { uid, group_id: groupId }),
            cacheOptions,
            'user_dynamic'
        );
    }

    async getUserLive(uid, groupId) {
        // No cache for live status (needs real-time)
        return this._sendCommand('user_live', { uid, group_id: groupId });
    }

    async getDynamicInfo(dynamicId, groupId) {
        return this._withCache('dynamic', dynamicId, groupId, () =>
            serviceManager.sendCommand('dynamic_detail', { dynamic_id: dynamicId, group_id: groupId }),
            false,
            'dynamic_detail'
        );
    }

    async getArticleInfo(cvid, groupId) {
        return this._withCache('article', cvid, groupId, () =>
            serviceManager.sendCommand('article', { cvid, group_id: groupId }),
            false,
            'article'
        );
    }

    async getBangumiInfo(seasonId, groupId) {
        return this._withCache('bangumi', seasonId, groupId, () =>
            serviceManager.sendCommand('bangumi', { season_id: seasonId, group_id: groupId }),
            false,
            'bangumi'
        );
    }

    async getLiveRoomInfo(roomId, groupId) {
        // No cache for room info (online count/status changes)
        return this._sendCommand('live_room', { room_id: roomId, group_id: groupId });
    }

    async getOpusInfo(opusId, groupId) {
        return this._withCache('opus', opusId, groupId, () =>
            serviceManager.sendCommand('opus', { opus_id: opusId, group_id: groupId }),
            false,
            'opus'
        );
    }

    async getUserInfo(uid, groupId, cacheOptions = false, requestOptions = {}) {
        return this._withCache('user', uid, groupId, () =>
            serviceManager.sendCommand('user_info', { uid, group_id: groupId }, requestOptions),
            cacheOptions,
            'user_info'
        );
    }

    async getUserCard(uid, groupId) {
        return this._withCache('user_card', uid, groupId, () =>
            serviceManager.sendCommand('user_card', { uid, group_id: groupId }),
            false,
            'user_card'
        );
    }

    async searchUsers(keyword, groupId, options = {}) {
        const page = Number.isFinite(Number(options.page)) ? Number(options.page) : 1
        const pageSize = Number.isFinite(Number(options.pageSize)) ? Number(options.pageSize) : 5
        return this._sendCommand('user_search', {
            keyword,
            page,
            page_size: pageSize,
            group_id: groupId
        })
    }

    async getEpInfo(epId, groupId) {
        return this._withCache('ep', epId, groupId, () =>
            serviceManager.sendCommand('ep', { ep_id: epId, group_id: groupId }),
            false,
            'ep'
        );
    }

    async getMediaInfo(mediaId, groupId) {
        return this._withCache('media', mediaId, groupId, () =>
            serviceManager.sendCommand('media', { media_id: mediaId, group_id: groupId }),
            false,
            'media'
        );
    }

    async getFavoriteListInfo(mediaId, groupId, favoriteType = 'video') {
        const resourceId = mediaId || favoriteType || 'default';
        return this._withCache('favorite_list', `${favoriteType}:${resourceId}`, groupId, () =>
            serviceManager.sendCommand('favorite_list', {
                media_id: mediaId,
                favorite_type: favoriteType,
                group_id: groupId
            }),
            false,
            'favorite_list'
        );
    }

    async getAudioInfo(auid, groupId) {
        return this._withCache('audio', auid, groupId, () =>
            serviceManager.sendCommand('audio', { auid, group_id: groupId }),
            false,
            'audio'
        );
    }

    async getAudioListInfo(amid, groupId) {
        return this._withCache('audio_list', amid, groupId, () =>
            serviceManager.sendCommand('audio_list', { amid, group_id: groupId }),
            false,
            'audio_list'
        );
    }

    async getTopicInfo(topicId, groupId) {
        return this._withCache('topic', topicId, groupId, () =>
            serviceManager.sendCommand('topic', { topic_id: topicId, group_id: groupId }),
            false,
            'topic'
        );
    }

    async getChannelSeriesInfo(uid, seriesId, seriesType, groupId) {
        return this._withCache('channel_series', `${seriesType}:${uid}:${seriesId}`, groupId, () =>
            serviceManager.sendCommand('channel_series', {
                uid,
                series_id: seriesId,
                series_type: seriesType,
                group_id: groupId
            }),
            false,
            'channel_series'
        );
    }

    async getArticleListInfo(rlid, groupId) {
        return this._withCache('article_list', rlid, groupId, () =>
            serviceManager.sendCommand('article_list', { rlid, group_id: groupId }),
            false,
            'article_list'
        );
    }

    async getNoteInfo(cvid, groupId) {
        return this._withCache('note', cvid, groupId, () =>
            serviceManager.sendCommand('note', { cvid, group_id: groupId }),
            false,
            'note'
        );
    }

    async getCheeseVideoInfo(epId, seasonId, groupId) {
        const key = epId ? `ep:${epId}` : `season:${seasonId}`;
        return this._withCache('cheese_video', key, groupId, () =>
            serviceManager.sendCommand('cheese_video', {
                ep_id: epId,
                season_id: seasonId,
                group_id: groupId
            }),
            false,
            'cheese_video'
        );
    }

    async getInteractiveVideoInfo(bvid, groupId) {
        return this._withCache('interactive_video', bvid, groupId, () =>
            serviceManager.sendCommand('interactive_video', { bvid, group_id: groupId }),
            false,
            'interactive_video'
        );
    }

    async getMyInfo(groupId) {
        // Personal info usually doesn't change often, but let's keep it fresh for now
        // or execute without cache
        return this._sendCommand('my_info', { group_id: groupId });
    }

    async getMyFollowings(groupName, groupId) {
        return this._sendCommand('my_followings', { group_name: groupName, group_id: groupId });
    }

    async getDynamicFeed(offset, groupId) {
        // No cache for dynamic feed (real-time data)
        return this._sendCommand('dynamic_feed', { offset, group_id: groupId });
    }

    async getLiveFeed(groupId) {
        // No cache for live feed (real-time data)
        return this._sendCommand('live_feed', { group_id: groupId });
    }

    async getFollowGroups(groupId) {
        // Cache this as tags don't change often
        return this._withCache('follow_groups', 'list', groupId, () =>
            serviceManager.sendCommand('get_follow_groups', { group_id: groupId }),
            false,
            'get_follow_groups'
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
        return this._sendCommand('user_videos', { uid: String(uid), group_id: groupId });
    }

    /**
     * 获取用户专栏列表
     * @param {string|number} uid - 用户UID
     * @param {string} groupId - 群组ID（用于Cookie）
     * @returns {Promise<Object>} 专栏列表
     */
    async getUserArticles(uid, groupId = null) {
        // No cache for article list (need fresh data for subscription)
        return this._sendCommand('user_articles', { uid: String(uid), group_id: groupId });
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
        }, bypassCache, 'credential_info');
    }

    /**
     * 检查并自动刷新全局 Cookie
     * @returns {Promise<{status: string, refreshed?: boolean, reason?: string, message: string}>}
     */
    async refreshCredential() {
        return this._sendCommand('refresh_credential', {});
    }
}

module.exports = new BiliApi();
