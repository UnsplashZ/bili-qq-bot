const { subscriptionManager, biliApi, logger } = require('../adapters/deps')
const { resolveArticleTitle } = require('../helpers/article')

module.exports = {
    /**
     * 统一的视频检查方法（支持手动订阅和Cookie同步）
     * @param {Object} userItem - 从buildUserCheckList返回的用户对象
     * @param {boolean} force - 是否强制检查
     */
    async checkUserVideoUnified(userItem, force = false, options = {}) {
        const persistState = options.persistState !== false
        const {
            uid,
            name,
            targetGroups: rawTargetGroups,
            source,
            manualSub,
            cookieFollower,
            accountUid,
            targetGroupSourceMap
        } = userItem

        const fallbackSource = source === 'cookie' ? 'cookieSync' : 'manual'
        const normalizedTargetGroupSourceMap = this.normalizeGroupSourceMap(targetGroupSourceMap || rawTargetGroups, fallbackSource)
        const targetGroups = this.getGroupIdsFromSourceMap(normalizedTargetGroupSourceMap)

        try {
            if (targetGroups.length === 0) return
            const groupId = targetGroups[0]
            const res = await biliApi.getUserVideos(uid, groupId)

            if (res.status !== 'success' || !res.data.videos || res.data.videos.length === 0) {
                return
            }

            const videos = res.data.videos
            videos.sort((a, b) => b.created - a.created)
            const latestVideo = videos[0]
            const latestBvid = latestVideo.bvid
            const latestVideoCreatedRaw = Number(latestVideo.created)
            const latestVideoCreated = Number.isFinite(latestVideoCreatedRaw) ? latestVideoCreatedRaw : null

            // 获取lastVideoId（优先从手动订阅，其次从Cookie follower）
            let lastVideoId = null
            let lastVideoCreated = null
            if (manualSub) {
                lastVideoId = manualSub.lastVideoId
                lastVideoCreated = manualSub.lastVideoCreated
            } else if (cookieFollower) {
                lastVideoId = cookieFollower.lastVideoId
                lastVideoCreated = cookieFollower.lastVideoCreated
            }
            const normalizeTimestamp = value => {
                if (value === null || value === undefined || value === '') return null
                const num = Number(value)
                return Number.isFinite(num) ? num : null
            }
            lastVideoCreated = normalizeTimestamp(lastVideoCreated)

            // 首次检查：记录最新视频但不推送
            if (!lastVideoId && !force) {
                if (persistState) {
                    await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated })
                }
                logger.info(`[UpdateChecker] Initialized lastVideoId for ${name} (${source}): ${latestBvid}`)
                return
            }

            // 检查是否有新视频
            if (latestBvid !== lastVideoId || force) {
                // 兼容旧状态：仅有 lastVideoId 无时间戳，且 lastVideoId 已不在列表中
                // 避免升级后的首轮回放旧视频
                if (!force && lastVideoId && lastVideoCreated === null && !videos.some(v => v.bvid === lastVideoId)) {
                    if (persistState) {
                        await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated })
                    }
                    logger.debug(`[UpdateChecker] Legacy video anchor missing for ${name}, refreshed to ${latestBvid}`)
                    return
                }

                const newVideos = []
                for (const video of videos) {
                    if (video.bvid === lastVideoId) break

                    if (!force && lastVideoCreated !== null) {
                        const createdRaw = Number(video.created)
                        const created = Number.isFinite(createdRaw) ? createdRaw : null
                        if (created !== null && created <= lastVideoCreated) break
                    }

                    newVideos.push(video)
                }

                let videoToPush
                if (newVideos.length === 0) {
                    if (!force) {
                        if (persistState) {
                            await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated })
                        }
                        logger.debug(`[UpdateChecker] No new videos for ${name}, updated tracking to ${latestBvid}`)
                        return
                    } else {
                        logger.debug(`[UpdateChecker] Force check: pushing latest video for ${name}: ${latestBvid}`)
                        videoToPush = [latestVideo]
                    }
                } else {
                    videoToPush = [newVideos[0]]
                    logger.debug(`[UpdateChecker] Found ${newVideos.length} new video(s) for ${name}, pushing latest: ${newVideos[0].bvid}`)
                }

                for (const video of videoToPush) {
                    try {
                        const bvid = video.bvid
                        const info = await biliApi.getVideoInfo(bvid, groupId)

                        if (info.status !== 'success') {
                            logger.warn(`[UpdateChecker] Failed to get video detail for ${bvid}`)
                            continue
                        }

                        if (video.is_charging_arc || video.is_upower_exclusive) {
                            info.data.is_charging_arc = true
                            info.data.is_upower_exclusive = true
                        }

                        const notificationText = `${name} 投稿了新视频：\n${info.data.title}`
                        const url = `https://www.bilibili.com/video/${bvid}`
                        await this.notifyGroupsWithImageAndCache(
                            normalizedTargetGroupSourceMap,
                            info,
                            'video',
                            url,
                            notificationText,
                            { actorUid: uid, fallbackSources: [fallbackSource] }
                        )

                        // 订阅推送后下载视频一次，发送到所有目标群
                        const videoDownloadService = require('../../../videoDownloadService')
                        videoDownloadService.downloadAndSendToGroups(this.ws, targetGroups, bvid, info).catch(e => {
                            logger.error(`[UpdateChecker] downloadAndSendToGroups failed for ${bvid}:`, e)
                        })

                        logger.info(`[UpdateChecker] Pushed new video for ${name} (${source}): ${bvid}`)
                    } catch (e) {
                        logger.error(`[UpdateChecker] Failed to push video ${video.bvid}:`, e)
                    }
                }

                if (persistState) {
                    await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated })
                }
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking videos for ${name} (${source}):`, e)
        }
    },

    /**
     * 统一的专栏检查方法（支持手动订阅和Cookie同步）
     * @param {Object} userItem - 从buildUserCheckList返回的用户对象
     * @param {boolean} force - 是否强制检查
     */
    async checkUserArticleUnified(userItem, force = false, options = {}) {
        const persistState = options.persistState !== false
        const {
            uid,
            name,
            targetGroups: rawTargetGroups,
            source,
            manualSub,
            cookieFollower,
            accountUid,
            targetGroupSourceMap
        } = userItem

        const fallbackSource = source === 'cookie' ? 'cookieSync' : 'manual'
        const normalizedTargetGroupSourceMap = this.normalizeGroupSourceMap(targetGroupSourceMap || rawTargetGroups, fallbackSource)
        const targetGroups = this.getGroupIdsFromSourceMap(normalizedTargetGroupSourceMap)

        try {
            if (targetGroups.length === 0) return
            const groupId = targetGroups[0]
            const res = await biliApi.getUserArticles(uid, groupId)

            if (res.status !== 'success' || !res.data.articles || res.data.articles.length === 0) {
                return
            }

            const articles = res.data.articles
            articles.sort((a, b) => b.publish_time - a.publish_time)
            const latestArticle = articles[0]
            const latestCvid = `cv${latestArticle.id}`
            const latestArticlePublishRaw = Number(latestArticle.publish_time)
            const latestArticlePublishTime = Number.isFinite(latestArticlePublishRaw) ? latestArticlePublishRaw : null

            // 获取lastArticleId（优先从手动订阅，其次从Cookie follower）
            let lastArticleId = null
            let lastArticlePublishTime = null
            if (manualSub) {
                lastArticleId = manualSub.lastArticleId
                lastArticlePublishTime = manualSub.lastArticlePublishTime
            } else if (cookieFollower) {
                lastArticleId = cookieFollower.lastArticleId
                lastArticlePublishTime = cookieFollower.lastArticlePublishTime
            }
            const normalizeTimestamp = value => {
                if (value === null || value === undefined || value === '') return null
                const num = Number(value)
                return Number.isFinite(num) ? num : null
            }
            lastArticlePublishTime = normalizeTimestamp(lastArticlePublishTime)

            // 首次检查：记录最新专栏但不推送
            if (!lastArticleId && !force) {
                if (persistState) {
                    await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime })
                }
                logger.info(`[UpdateChecker] Initialized lastArticleId for ${name} (${source}): ${latestCvid}`)
                return
            }

            // 检查是否有新专栏
            if (latestCvid !== lastArticleId || force) {
                // 兼容旧状态：仅有 lastArticleId 无时间戳，且 lastArticleId 已不在列表中
                // 避免升级后的首轮回放旧专栏
                if (!force && lastArticleId && lastArticlePublishTime === null && !articles.some(a => `cv${a.id}` === lastArticleId)) {
                    if (persistState) {
                        await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime })
                    }
                    logger.debug(`[UpdateChecker] Legacy article anchor missing for ${name}, refreshed to ${latestCvid}`)
                    return
                }

                const newArticles = []
                for (const article of articles) {
                    const cvid = `cv${article.id}`
                    if (cvid === lastArticleId) break

                    if (!force && lastArticlePublishTime !== null) {
                        const publishRaw = Number(article.publish_time)
                        const publishTime = Number.isFinite(publishRaw) ? publishRaw : null
                        if (publishTime !== null && publishTime <= lastArticlePublishTime) break
                    }

                    newArticles.push(article)
                }

                let articleToPush
                if (newArticles.length === 0) {
                    if (!force) {
                        if (persistState) {
                            await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime })
                        }
                        logger.debug(`[UpdateChecker] No new articles for ${name}, updated tracking to ${latestCvid}`)
                        return
                    } else {
                        logger.debug(`[UpdateChecker] Force check: pushing latest article for ${name}: ${latestCvid}`)
                        articleToPush = [latestArticle]
                    }
                } else {
                    articleToPush = [newArticles[0]]
                    logger.debug(`[UpdateChecker] Found ${newArticles.length} new article(s) for ${name}, pushing latest: cv${newArticles[0].id}`)
                }

                for (const article of articleToPush) {
                    try {
                        const cvid = `cv${article.id}`
                        const info = await biliApi.getArticleInfo(cvid, groupId)

                        if (info.status !== 'success') {
                            logger.warn(`[UpdateChecker] Failed to get article detail for ${cvid}`)
                            continue
                        }

                        const { actualType, title: articleTitle } = resolveArticleTitle(info)
                        const notificationText = `${name} 发布了新专栏：\n${articleTitle}`
                        const url = `https://www.bilibili.com/read/${cvid}`
                        await this.notifyGroupsWithImageAndCache(
                            normalizedTargetGroupSourceMap,
                            info,
                            actualType,
                            url,
                            notificationText,
                            { actorUid: uid, fallbackSources: [fallbackSource] }
                        )

                        logger.info(`[UpdateChecker] Pushed new article for ${name} (${source}): ${cvid}`)
                    } catch (e) {
                        logger.error(`[UpdateChecker] Failed to push article cv${article.id}:`, e)
                    }
                }

                if (persistState) {
                    await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime })
                }
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking articles for ${name} (${source}):`, e)
        }
    },

    /**
     * 更新用户的视频状态
     * @param {Object} userItem - 用户对象
     * @param {Object|string} videoState - 最新视频状态或视频ID
     */
    async updateVideoState(userItem, videoState) {
        const { source, manualSub, cookieFollower, accountUid, uid } = userItem
        const state = typeof videoState === 'string'
            ? { videoId: videoState, videoCreated: null }
            : (videoState || {})
        const normalizeTimestamp = value => {
            if (value === null || value === undefined || value === '') return null
            const num = Number(value)
            return Number.isFinite(num) ? num : null
        }
        const updates = {
            lastVideoId: state.videoId || null,
            lastVideoCreated: normalizeTimestamp(state.videoCreated)
        }

        try {
            // 更新手动订阅的状态
            if (manualSub) {
                await subscriptionManager.updateUserSub(uid, updates)
            }

            // 更新Cookie follower的状态
            // 使用 updateCookieFollowerState 直接操作当前数组中的对象，
            // 避免 refreshCookieFollowings 并发替换数组引用导致的竞态条件
            if (cookieFollower) {
                await subscriptionManager.updateCookieFollowerState(accountUid, uid, updates)
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Failed to update video state for ${uid} (${source}):`, e)
        }
    },

    /**
     * 更新用户的专栏状态
     * @param {Object} userItem - 用户对象
     * @param {Object|string} articleState - 最新专栏状态或专栏ID
     */
    async updateArticleState(userItem, articleState) {
        const { source, manualSub, cookieFollower, accountUid, uid } = userItem
        const state = typeof articleState === 'string'
            ? { articleId: articleState, articlePublishTime: null }
            : (articleState || {})
        const normalizeTimestamp = value => {
            if (value === null || value === undefined || value === '') return null
            const num = Number(value)
            return Number.isFinite(num) ? num : null
        }
        const updates = {
            lastArticleId: state.articleId || null,
            lastArticlePublishTime: normalizeTimestamp(state.articlePublishTime)
        }

        try {
            // 更新手动订阅的状态
            if (manualSub) {
                await subscriptionManager.updateUserSub(uid, updates)
            }

            // 更新Cookie follower的状态
            // 使用 updateCookieFollowerState 直接操作当前数组中的对象，
            // 避免 refreshCookieFollowings 并发替换数组引用导致的竞态条件
            if (cookieFollower) {
                await subscriptionManager.updateCookieFollowerState(accountUid, uid, updates)
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Failed to update article state for ${uid} (${source}):`, e)
        }
    }
}
