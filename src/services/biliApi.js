const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const path = require('path');

class BiliApi {
    constructor() {
        this.pythonPath = config.pythonPath;
        this.scriptPath = config.biliScriptPath;
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

    async getVideoInfo(bvid) {
        return this.runCommand('video', [bvid]);
    }

    async getBangumiInfo(seasonId) {
        return this.runCommand('bangumi', [seasonId]);
    }

    async getLoginUrl() {
        return this.runCommand('login_url');
    }

    async checkLogin(key) {
        return this.runCommand('login_check', [key]);
    }

    async getUserDynamic(uid) {
        return this.runCommand('user_dynamic', [uid]);
    }

    async getUserLive(uid) {
        return this.runCommand('user_live', [uid]);
    }

    async getDynamicInfo(dynamicId) {
        return this.runCommand('dynamic_detail', [dynamicId]);
    }

    async getArticleInfo(cvid) {
        return this.runCommand('article', [cvid]);
    }

    async getLiveRoomInfo(roomId) {
        return this.runCommand('live_room', [roomId]);
    }

    async getOpusInfo(opusId) {
        return this.runCommand('opus', [opusId]);
    }

    async getUserInfo(uid) {
        return this.runCommand('user_info', [uid]);
    }

    async getUserCard(uid) {
        return this.runCommand('user_card', [uid]);
    }

    async getEpInfo(epId) {
        return this.runCommand('ep', [epId]);
    }

    async getMediaInfo(mediaId) {
        return this.runCommand('media', [mediaId]);
    }

    async getMyFollowings(groupName) {
        const args = groupName ? [groupName] : [];
        return this.runCommand('my_followings', args);
    }
}

module.exports = new BiliApi();