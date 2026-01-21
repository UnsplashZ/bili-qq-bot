class API {
  constructor(baseURL = '/api') {
    this.baseURL = baseURL;
  }

  async request(method, endpoint, data = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, options);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || response.statusText);
      }

      return response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // 群组相关
  async getGroups() {
    return this.request('GET', '/groups');
  }

  async getGroup(groupId) {
    return this.request('GET', `/groups/${groupId}`);
  }

  async enableGroup(groupId) {
    return this.request('POST', `/groups/${groupId}/enable`);
  }

  async disableGroup(groupId) {
    return this.request('POST', `/groups/${groupId}/disable`);
  }

  async addGroupAdmin(groupId, userId) {
    return this.request('POST', `/groups/${groupId}/admins`, { userId });
  }

  async removeGroupAdmin(groupId, userId) {
    return this.request('DELETE', `/groups/${groupId}/admins/${userId}`);
  }

  async updateGroupConfig(groupId, config) {
    return this.request('PUT', `/groups/${groupId}/config`, config);
  }

  // 订阅相关
  async getSubscriptions(groupId) {
    return this.request('GET', `/subscriptions/${groupId}`);
  }

  async subscribeUser(groupId, uid) {
    return this.request('POST', `/subscriptions/${groupId}/user`, { uid });
  }

  async unsubscribeUser(groupId, uid) {
    return this.request('DELETE', `/subscriptions/${groupId}/user/${uid}`);
  }

  async subscribeBangumi(groupId, seasonId) {
    return this.request('POST', `/subscriptions/${groupId}/bangumi`, { seasonId });
  }

  async unsubscribeBangumi(groupId, seasonId) {
    return this.request('DELETE', `/subscriptions/${groupId}/bangumi/${seasonId}`);
  }

  // 全局配置
  async getGlobalConfig() {
    return this.request('GET', '/config');
  }

  async updateGlobalConfig(config) {
    return this.request('PUT', '/config', config);
  }

  async addGlobalBlacklist(userId) {
    return this.request('POST', '/config/blacklist', { userId });
  }

  async removeGlobalBlacklist(userId) {
    return this.request('DELETE', `/config/blacklist/${userId}`);
  }

  // Bilibili 登录和关注
  async getLoginQrcode() {
    return this.request('GET', '/bilibili/login/qrcode');
  }

  async checkLogin(qrcodeKey, groupId) {
    return this.request('POST', '/bilibili/login/check', { qrcodeKey, groupId });
  }

  async getFollowingGroups(groupId) {
    const params = new URLSearchParams();
    if (groupId) params.append('groupId', groupId);
    const query = params.toString();
    return this.request('GET', `/bilibili/following-groups${query ? '?' + query : ''}`);
  }

  async getFollowings(groupName, groupId) {
    const params = new URLSearchParams();
    if (groupName) params.append('groupName', groupName);
    if (groupId) params.append('groupId', groupId);
    const query = params.toString();
    return this.request('GET', `/bilibili/followings${query ? '?' + query : ''}`);
  }

  async refreshFollowings(groupId) {
    return this.request('POST', '/bilibili/followings/refresh', { groupId });
  }

  async batchSubscribeFollowings(groupId, uids) {
    return this.request('POST', '/bilibili/followings/subscribe', { groupId, uids });
  }
}

const api = new API();
