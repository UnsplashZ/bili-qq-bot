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
            
            let dataString = '';
            let errorString = '';

            pythonProcess.stdout.on('data', (data) => {
                dataString += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                errorString += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    logger.error(`Python script exited with code ${code}: ${errorString}`);
                    reject(new Error(`Python script exited with code ${code}`));
                    return;
                }
                try {
                    const json = JSON.parse(dataString);
                    resolve(json);
                } catch (e) {
                    logger.error('Failed to parse Python output:', dataString);
                    reject(e);
                }
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
}

module.exports = new BiliApi();