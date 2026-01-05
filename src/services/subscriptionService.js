const fs = require('fs');
const path = require('path');
const biliApi = require('./biliApi');
const logger = require('../utils/logger');

const SUBS_FILE = path.join(__dirname, '../../subscriptions.json');

class SubscriptionService {
    constructor() {
        this.subscriptions = []; // { uid: string, type: 'live'|'dynamic', groupIds: string[], lastId: string }
        this.ws = null;
        this.checkInterval = 60000; // 1 minute
        this.loadSubscriptions();
    }

    setWs(ws) {
        this.ws = ws;
    }

    loadSubscriptions() {
        try {
            if (fs.existsSync(SUBS_FILE)) {
                this.subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
            }
        } catch (e) {
            logger.error('Failed to load subscriptions:', e);
        }
    }

    saveSubscriptions() {
        try {
            fs.writeFileSync(SUBS_FILE, JSON.stringify(this.subscriptions, null, 2));
        } catch (e) {
            logger.error('Failed to save subscriptions:', e);
        }
    }

    addSubscription(uid, groupId, type) {
        let sub = this.subscriptions.find(s => s.uid === uid && s.type === type);
        if (sub) {
            if (!sub.groupIds.includes(groupId)) {
                sub.groupIds.push(groupId);
            }
        } else {
            this.subscriptions.push({ uid, type, groupIds: [groupId], lastId: null });
        }
        this.saveSubscriptions();
        return true;
    }

    start() {
        setInterval(() => this.checkAll(), this.checkInterval);
        logger.info('Subscription service started.');
    }

    async checkAll() {
        if (!this.ws) return;

        for (const sub of this.subscriptions) {
            try {
                if (sub.type === 'dynamic') {
                    await this.checkDynamic(sub);
                } else if (sub.type === 'live') {
                    await this.checkLive(sub);
                }
            } catch (e) {
                logger.error(`Error checking subscription for ${sub.uid}:`, e);
            }
        }
        this.saveSubscriptions(); // Save state (lastId)
    }

    async checkDynamic(sub) {
        const res = await biliApi.getUserDynamic(sub.uid);
        if (res.status === 'success' && res.data) {
            const dynamicId = res.data.id;
            if (sub.lastId && sub.lastId !== dynamicId) {
                // New dynamic found
                this.notifyGroups(sub.groupIds, `New Dynamic from user ${sub.uid}: https://t.bilibili.com/${dynamicId}`);
            }
            sub.lastId = dynamicId;
        }
    }

    async checkLive(sub) {
        const res = await biliApi.getUserLive(sub.uid);
        if (res.status === 'success' && res.data) {
            const isLive = res.data.live_room?.liveStatus === 1;
            const liveTitle = res.data.live_room?.title;
            const liveUrl = res.data.live_room?.url;

            // Simple logic: if liveStatus is 1 and we haven't notified for this session...
            // But checking "session" is hard without storing start_time.
            // We can store 'lastStatus' instead of 'lastId' for live.
            // For now, let's treat lastId as 'isLive' boolean stored as string? Or just store state.
            
            const wasLive = sub.lastId === '1';
            
            if (isLive && !wasLive) {
                this.notifyGroups(sub.groupIds, `User ${sub.uid} is now LIVE!\nTitle: ${liveTitle}\nUrl: ${liveUrl}`);
            }
            
            sub.lastId = isLive ? '1' : '0';
        }
    }

    notifyGroups(groupIds, message) {
        if (!this.ws) return;
        
        groupIds.forEach(gid => {
             const payload = {
                action: 'send_group_msg',
                params: {
                    group_id: gid,
                    message: [{ type: 'text', data: { text: message } }]
                }
            };
            this.ws.send(JSON.stringify(payload));
        });
    }
}

module.exports = new SubscriptionService();
