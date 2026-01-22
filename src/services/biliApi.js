const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

class BiliApi {
    constructor() {
        this.pythonPath = config.pythonPath;
        this.scriptPath = config.biliScriptPath;
        this.retryDelay = 10000; // 10秒重试延迟
        this.maxRetries = 1; // 最多重试1次

        // FastAPI configuration
        this.useFastAPI = process.env.USE_FASTAPI !== 'false';
        this.fastAPIUrl = process.env.FASTAPI_URL || 'http://127.0.0.1:8765';
        this.pythonProcess = null;
        this.fastAPIReady = false;

        if (this.useFastAPI) {
            this.startFastAPIService();
        }
    }

    async startFastAPIService() {
        if (this.pythonProcess) return;

        try {
            const scriptDir = path.dirname(this.scriptPath);
            const fastApiScript = path.join(scriptDir, 'bili_fastapi.py');
            
            logger.info(`Starting FastAPI service from ${fastApiScript}...`);
            
            // Ensure logs directory exists
            const logDir = path.join(process.cwd(), 'logs');
            fs.mkdirSync(logDir, { recursive: true });

            const logFile = path.join(logDir, 'fastapi.log');
            const logStream = fs.openSync(logFile, 'a');

            // Spawn the FastAPI process
            this.pythonProcess = spawn(this.pythonPath, [fastApiScript], {
                stdio: ['ignore', logStream, logStream]
            });

            this.pythonProcess.on('close', (code) => {
                logger.warn(`FastAPI service exited with code ${code}`);
                this.pythonProcess = null;
                this.fastAPIReady = false;
            });

            // Start polling for readiness
            this.waitForFastAPIReady();
        } catch (error) {
            logger.error(`Failed to start FastAPI service: ${error.message}`);
        }
    }

    async waitForFastAPIReady() {
        let attempts = 0;
        const maxAttempts = 30; // Wait up to 30 seconds
        
        logger.info('Waiting for FastAPI service to be ready...');

        while (attempts < maxAttempts) {
            try {
                const response = await fetch(`${this.fastAPIUrl}/health`);
                if (response.ok) {
                    this.fastAPIReady = true;
                    logger.info('FastAPI service is ready');
                    return;
                }
            } catch (e) {
                // Service not ready yet
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }
        
        logger.error('FastAPI service failed to start within timeout');
    }

    async callFastAPI(endpoint, data) {
        if (!this.fastAPIReady) {
            throw new Error('FastAPI service not ready');
        }

        const response = await fetch(`${this.fastAPIUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
        }

        return await response.json();
    }

    async runCommand(command, args = []) {
        return new Promise((resolve, reject) => {
            const processArgs = [this.scriptPath, command, ...args];
            const pythonProcess = spawn(this.pythonPath, processArgs);

            const chunks = [];
            let errorString = '';

            // Set timeout for Python process (60 seconds)
            const timeout = setTimeout(() => {
                pythonProcess.kill();
                reject(new Error(`Python script timed out for command: ${command}`));
            }, 60000);

            pythonProcess.stdout.on('data', (data) => {
                chunks.push(data);
            });

            pythonProcess.stderr.on('data', (data) => {
                errorString += data.toString();
            });

            pythonProcess.on('close', (code) => {
                clearTimeout(timeout);
                if (code !== 0) {
                    // Check if it was killed by timeout (signal usually SIGTERM or SIGKILL)
                    if (code === null) {
                         // Process killed, likely by timeout
                         return; // Already rejected in timeout
                    }
                    logger.error(`Python script exited with code ${code}: ${errorString}`);
                    reject(new Error(`Python script exited with code ${code}`));
                    return;
                }
                const dataString = Buffer.concat(chunks).toString();
                try {
                    const json = JSON.parse(dataString);
                    resolve(json);
                } catch (e) {
                    logger.error('Failed to parse Python output:', dataString.substring(0, 500) + '...'); // Log partial output
                    reject(e);
                }
            });

            pythonProcess.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    /**
     * 带重试机制的命令执行
     * @param {string} command - 命令名称
     * @param {Array} args - 命令参数
     * @param {number} retryCount - 当前重试次数（内部使用）
     * @returns {Promise} 执行结果
     */
    async runCommandWithRetry(command, args = [], retryCount = 0) {
        try {
            logger.debug(`Executing command: ${command} (attempt ${retryCount + 1}/${this.maxRetries + 1})`);
            const result = await this.runCommand(command, args);

            // 成功执行，返回结果
            if (retryCount > 0) {
                logger.info(`Command ${command} succeeded after ${retryCount} retry(ies)`);
            }
            return result;
        } catch (error) {
            // 如果还有重试机会
            if (retryCount < this.maxRetries) {
                logger.warn(`Command ${command} failed (attempt ${retryCount + 1}/${this.maxRetries + 1}): ${error.message}`);
                logger.info(`Retrying in ${this.retryDelay / 1000} seconds...`);

                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.runCommandWithRetry(command, args, retryCount + 1);
            } else {
                // 已达到最大重试次数，记录错误并抛出
                logger.error(`Command ${command} failed after ${this.maxRetries + 1} attempts: ${error.message}`);
                throw error;
            }
        }
    }

    async getVideoInfo(bvid, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/video', { bvid, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getVideoInfo: ${error.message}`);
            }
        }
        const args = [bvid];
        if (groupId) args.push(groupId);
        return this.runCommand('video', args);
    }

    async getLoginUrl() {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/login_url', {});
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getLoginUrl: ${error.message}`);
            }
        }
        return this.runCommand('login_url');
    }

    async checkLogin(key, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/login_check', { qrcode_key: key, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for checkLogin: ${error.message}`);
            }
        }
        const args = [key];
        if (groupId) args.push(groupId);
        return this.runCommand('login_check', args);
    }

    async getUserDynamic(uid, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/user_dynamic', { uid, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getUserDynamic: ${error.message}`);
            }
        }
        const args = [uid];
        if (groupId) args.push(groupId);
        return this.runCommandWithRetry('user_dynamic', args);
    }

    async getUserLive(uid, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/user_live', { uid, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getUserLive: ${error.message}`);
            }
        }
        const args = [uid];
        if (groupId) args.push(groupId);
        return this.runCommandWithRetry('user_live', args);
    }

    async getDynamicInfo(dynamicId, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/dynamic_detail', { dynamic_id: dynamicId, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getDynamicInfo: ${error.message}`);
            }
        }
        const args = [dynamicId];
        if (groupId) args.push(groupId);
        return this.runCommandWithRetry('dynamic_detail', args);
    }

    async getArticleInfo(cvid, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/article', { cvid, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getArticleInfo: ${error.message}`);
            }
        }
        const args = [cvid];
        if (groupId) args.push(groupId);
        return this.runCommand('article', args);
    }

    async getBangumiInfo(seasonId, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/bangumi', { season_id: seasonId, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getBangumiInfo: ${error.message}`);
            }
        }
        const args = [seasonId];
        if (groupId) args.push(groupId);
        return this.runCommandWithRetry('bangumi', args);
    }

    async getLiveRoomInfo(roomId, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/live_room', { room_id: roomId, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getLiveRoomInfo: ${error.message}`);
            }
        }
        const args = [roomId];
        if (groupId) args.push(groupId);
        return this.runCommandWithRetry('live_room', args);
    }

    async getOpusInfo(opusId, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/opus', { opus_id: opusId, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getOpusInfo: ${error.message}`);
            }
        }
        const args = [opusId];
        if (groupId) args.push(groupId);
        return this.runCommand('opus', args);
    }

    async getUserInfo(uid, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/user_info', { uid, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getUserInfo: ${error.message}`);
            }
        }
        const args = [uid];
        if (groupId) args.push(groupId);
        return this.runCommandWithRetry('user_info', args);
    }

    async getUserCard(uid, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/user_card', { uid, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getUserCard: ${error.message}`);
            }
        }
        const args = [uid];
        if (groupId) args.push(groupId);
        return this.runCommand('user_card', args);
    }

    async getEpInfo(epId, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/ep', { ep_id: epId, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getEpInfo: ${error.message}`);
            }
        }
        const args = [epId];
        if (groupId) args.push(groupId);
        return this.runCommand('ep', args);
    }

    async getMediaInfo(mediaId, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/media', { media_id: mediaId, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getMediaInfo: ${error.message}`);
            }
        }
        const args = [mediaId];
        if (groupId) args.push(groupId);
        return this.runCommand('media', args);
    }

    async getMyFollowings(groupName, groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/my_followings', { group_name: groupName, group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getMyFollowings: ${error.message}`);
            }
        }
        const args = [];
        if (groupName) {
            args.push(groupName);
        } else {
            if (groupId) {
                args.push("None");
            }
        }
        if (groupId) args.push(groupId);
        return this.runCommandWithRetry('my_followings', args);
    }

    async getFollowingGroups(groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/following_groups', { group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getFollowingGroups: ${error.message}`);
            }
        }
        const args = [];
        if (groupId) args.push(groupId);
        return this.runCommand('following_groups', args);
    }

    async getCredentialStatus(groupId) {
        if (this.useFastAPI && this.fastAPIReady) {
            try {
                return await this.callFastAPI('/api/check_cookie', { group_id: groupId });
            } catch (error) {
                logger.warn(`[BiliApi] FastAPI call failed for getCredentialStatus: ${error.message}. Falling back to spawn.`);
            }
        }

        const args = [];
        if (groupId) args.push(groupId);
        return this.runCommand('check_cookie', args);
    }
}

module.exports = new BiliApi();
