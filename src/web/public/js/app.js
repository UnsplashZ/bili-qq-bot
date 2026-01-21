class App {
  constructor() {
    this.state = {
      groups: [],
      selectedGroupId: null
    };

    this.init();
  }

  async init() {
    await this.loadGroups();
    this.bindEvents();
  }

  async loadGroups() {
    try {
      const response = await api.getGroups();
      this.state.groups = response.data;
      this.renderGroupList();
    } catch (error) {
      showToast('加载群组列表失败: ' + error.message, 'error');
    }
  }

  renderGroupList() {
    const container = document.getElementById('groupList');
    container.innerHTML = '';

    if (this.state.groups.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #999; padding: 2rem;">暂无群组数据</p>';
      return;
    }

    this.state.groups.forEach(group => {
      const card = this.createGroupCard(group);
      container.appendChild(card);
    });
  }

  createGroupCard(group) {
    const card = document.createElement('div');
    card.className = `group-card ${group.enabled ? 'enabled' : 'disabled'}`;
    card.dataset.groupId = group.groupId;

    const totalSubs = group.subscriptions.users + group.subscriptions.bangumi;

    card.innerHTML = `
      <div class="group-card-header">
        <h3>群组 ${group.groupId}</h3>
        <span class="status-badge ${group.enabled ? 'enabled' : 'disabled'}">
          ${group.enabled ? '已启用' : '已禁用'}
        </span>
      </div>
      <div class="group-card-body">
        <p>订阅: ${totalSubs}</p>
        <p>管理员: ${group.admins.length}</p>
      </div>
    `;

    card.addEventListener('click', () => {
      this.selectGroup(group.groupId);
    });

    return card;
  }

  selectGroup(groupId) {
    // 更新选中状态
    document.querySelectorAll('.group-card').forEach(card => {
      card.classList.remove('selected');
    });

    const selectedCard = document.querySelector(`[data-group-id="${groupId}"]`);
    if (selectedCard) {
      selectedCard.classList.add('selected');
    }

    this.state.selectedGroupId = groupId;
    this.renderGroupPanel(groupId);
  }

  renderGroupPanel(groupId) {
    const group = this.state.groups.find(g => g.groupId === groupId);
    if (!group) return;

    const emptyState = document.getElementById('emptyState');
    const panel = document.getElementById('groupPanel');

    emptyState.classList.add('hidden');
    panel.classList.remove('hidden');

    const config = group.config || {};
    const nightMode = config.nightMode || { mode: 'off' };
    const labelConfig = config.labelConfig || {};

    panel.innerHTML = `
      <h2>群组详情 - ${group.groupId}</h2>

      <div class="group-info">
        <p><strong>状态:</strong> ${group.enabled ? '已启用' : '已禁用'}</p>
        <button class="btn btn-primary" id="toggleGroupBtn">
          ${group.enabled ? '禁用群组' : '启用群组'}
        </button>
      </div>

      <div class="management-section">
        <h3>群组配置</h3>

        <div class="config-item">
          <label>深色模式</label>
          <select id="nightModeSelect" class="config-select">
            <option value="off" ${nightMode.mode === 'off' ? 'selected' : ''}>关闭</option>
            <option value="on" ${nightMode.mode === 'on' ? 'selected' : ''}>开启</option>
            <option value="schedule" ${nightMode.mode === 'schedule' ? 'selected' : ''}>定时</option>
          </select>
        </div>

        ${nightMode.mode === 'schedule' ? `
        <div class="config-item">
          <label>定时时间</label>
          <input type="text" id="nightModeTime" class="config-input"
                 value="${nightMode.start || '22:00'}-${nightMode.end || '07:00'}"
                 placeholder="22:00-07:00">
        </div>
        ` : ''}

        <div class="config-item">
          <label>显示 UID</label>
          <input type="checkbox" id="showIdCheck" ${config.showId !== false ? 'checked' : ''}>
        </div>

        <div class="config-item">
          <label>链接缓存时间 (秒)</label>
          <input type="number" id="linkCacheInput" class="config-input"
                 value="${config.linkCacheTimeout || 600}" min="0">
        </div>

        <div class="config-section">
          <h4>标签显示配置</h4>
          <div class="config-grid">
            <label><input type="checkbox" id="labelVideo" ${labelConfig.video !== false ? 'checked' : ''}> 视频</label>
            <label><input type="checkbox" id="labelLive" ${labelConfig.live !== false ? 'checked' : ''}> 直播</label>
            <label><input type="checkbox" id="labelDynamic" ${labelConfig.dynamic !== false ? 'checked' : ''}> 动态</label>
            <label><input type="checkbox" id="labelArticle" ${labelConfig.article !== false ? 'checked' : ''}> 专栏</label>
            <label><input type="checkbox" id="labelBangumi" ${labelConfig.bangumi !== false ? 'checked' : ''}> 番剧</label>
            <label><input type="checkbox" id="labelUser" ${labelConfig.user !== false ? 'checked' : ''}> 用户</label>
          </div>
        </div>

        <button class="btn btn-primary" id="saveConfigBtn">保存配置</button>
      </div>

      <div class="management-section">
        <h3>AI 功能配置</h3>

        <div class="config-item">
          <label>AI 上下文消息数</label>
          <input type="number" id="aiContextLimit" class="config-input"
                 value="${config.aiContextLimit || 10}" min="1" max="50"
                 placeholder="默认: 10">
          <p class="config-hint">控制 AI 记忆的消息条数，越多消耗越大（1-50）</p>
        </div>

        <div class="config-item">
          <label>AI 随机回复概率</label>
          <input type="number" id="aiProbability" class="config-input"
                 value="${config.aiProbability !== undefined ? config.aiProbability : 0.1}"
                 min="0" max="1" step="0.1"
                 placeholder="默认: 0.1">
          <p class="config-hint">AI 主动插话的概率，0 = 不主动，1 = 总是回复（0-1）</p>
        </div>

        <button class="btn btn-primary" id="saveAiConfigBtn">保存 AI 配置</button>
      </div>

      <div class="management-section">
        <h3>管理员列表 (${group.admins.length})</h3>
        <div class="list-container">
          ${group.admins.length > 0
            ? group.admins.map(admin => `
                <div class="list-item">
                  <span class="user-id">${admin}</span>
                  <button class="btn-icon btn-danger" onclick="app.removeAdmin('${groupId}', '${admin}')" title="移除管理员">×</button>
                </div>
              `).join('')
            : '<p class="empty-hint">暂无管理员</p>'
          }
        </div>
        <button class="btn btn-secondary" id="addAdminBtn">+ 添加管理员</button>
      </div>

      <div class="management-section">
        <h3>黑名单 (${group.blacklist.length})</h3>
        <div class="list-container">
          ${group.blacklist.length > 0
            ? group.blacklist.map(user => `
                <div class="list-item">
                  <span class="user-id">${user}</span>
                  <button class="btn-icon btn-danger" onclick="app.removeBlacklist('${groupId}', '${user}')" title="移除黑名单">×</button>
                </div>
              `).join('')
            : '<p class="empty-hint">暂无黑名单用户</p>'
          }
        </div>
        <button class="btn btn-secondary" id="addBlacklistBtn">+ 添加黑名单</button>
      </div>

      <div class="subscriptions-section">
        <h3>订阅管理</h3>
        <div class="subscription-tabs">
          <button class="tab-btn active" data-tab="users">UP主订阅 (${group.subscriptions.users})</button>
          <button class="tab-btn" data-tab="bangumi">番剧订阅 (${group.subscriptions.bangumi})</button>
        </div>
        <div class="tab-content">
          <div id="subscriptions-loading">加载中...</div>
        </div>
      </div>
    `;

    // 绑定切换按钮
    document.getElementById('toggleGroupBtn').addEventListener('click', () => {
      this.toggleGroup(groupId, group.enabled);
    });

    // 绑定保存配置按钮
    document.getElementById('saveConfigBtn').addEventListener('click', () => {
      this.saveGroupConfig(groupId);
    });

    // 绑定保存 AI 配置按钮
    document.getElementById('saveAiConfigBtn').addEventListener('click', () => {
      this.saveAiConfig(groupId);
    });

    // 绑定深色模式变化
    document.getElementById('nightModeSelect').addEventListener('change', () => {
      this.renderGroupPanel(groupId);
    });

    // 绑定添加管理员按钮
    document.getElementById('addAdminBtn').addEventListener('click', () => {
      this.showAddAdminDialog(groupId);
    });

    // 绑定添加黑名单按钮
    document.getElementById('addBlacklistBtn').addEventListener('click', () => {
      this.showAddBlacklistDialog(groupId);
    });

    // 绑定订阅标签切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.loadSubscriptions(groupId, e.target.dataset.tab);
      });
    });

    // 默认加载 UP 主订阅
    this.loadSubscriptions(groupId, 'users');
  }

  async saveGroupConfig(groupId) {
    try {
      const nightModeSelect = document.getElementById('nightModeSelect').value;
      const nightModeConfig = { mode: nightModeSelect };

      if (nightModeSelect === 'schedule') {
        const timeInput = document.getElementById('nightModeTime').value;
        const [start, end] = timeInput.split('-');
        nightModeConfig.start = start;
        nightModeConfig.end = end;
      }

      const labelConfig = {
        video: document.getElementById('labelVideo').checked,
        live: document.getElementById('labelLive').checked,
        dynamic: document.getElementById('labelDynamic').checked,
        article: document.getElementById('labelArticle').checked,
        bangumi: document.getElementById('labelBangumi').checked,
        user: document.getElementById('labelUser').checked
      };

      const config = {
        nightMode: nightModeConfig,
        labelConfig: labelConfig,
        showId: document.getElementById('showIdCheck').checked,
        linkCacheTimeout: parseInt(document.getElementById('linkCacheInput').value)
      };

      await api.updateGroupConfig(groupId, config);
      showToast('配置已保存', 'success');
      await this.loadGroups();
      this.selectGroup(groupId);
    } catch (error) {
      showToast('保存失败: ' + error.message, 'error');
    }
  }

  async saveAiConfig(groupId) {
    try {
      const aiContextLimit = parseInt(document.getElementById('aiContextLimit').value);
      const aiProbability = parseFloat(document.getElementById('aiProbability').value);

      // 验证输入
      if (isNaN(aiContextLimit) || aiContextLimit < 1 || aiContextLimit > 50) {
        showToast('AI 上下文消息数必须在 1-50 之间', 'error');
        return;
      }

      if (isNaN(aiProbability) || aiProbability < 0 || aiProbability > 1) {
        showToast('AI 随机回复概率必须在 0-1 之间', 'error');
        return;
      }

      const config = {
        aiContextLimit: aiContextLimit,
        aiProbability: aiProbability
      };

      await api.updateGroupConfig(groupId, config);
      showToast('AI 配置已保存', 'success');
      await this.loadGroups();
      this.selectGroup(groupId);
    } catch (error) {
      showToast('保存失败: ' + error.message, 'error');
    }
  }

  async loadSubscriptions(groupId, type) {
    const container = document.querySelector('.tab-content');
    container.innerHTML = '<div class="loading">加载中...</div>';

    try {
      const response = await api.getSubscriptions(groupId);
      const subscriptions = response.data;

      if (type === 'users') {
        this.renderUserSubscriptions(groupId, subscriptions.users);
      } else {
        this.renderBangumiSubscriptions(groupId, subscriptions.bangumi);
      }
    } catch (error) {
      container.innerHTML = `<p class="empty-hint">加载失败: ${error.message}</p>`;
    }
  }

  renderUserSubscriptions(groupId, users) {
    const container = document.querySelector('.tab-content');

    if (users.length === 0) {
      container.innerHTML = `
        <p class="empty-hint">暂无 UP 主订阅</p>
        <button class="btn btn-primary" onclick="app.showAddUserSubDialog('${groupId}')">+ 添加 UP 主订阅</button>
      `;
      return;
    }

    container.innerHTML = `
      <div class="subscription-list">
        ${users.map(user => `
          <div class="subscription-item">
            <div class="subscription-info">
              <img src="${user.face}" alt="${user.name}" class="user-avatar">
              <div class="subscription-details">
                <div class="subscription-name">${user.name}</div>
                <div class="subscription-uid">UID: ${user.uid}</div>
              </div>
            </div>
            <button class="btn-icon btn-danger" onclick="app.removeUserSub('${groupId}', '${user.uid}')" title="取消订阅">×</button>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-primary" onclick="app.showAddUserSubDialog('${groupId}')">+ 添加 UP 主订阅</button>
    `;
  }

  renderBangumiSubscriptions(groupId, bangumi) {
    const container = document.querySelector('.tab-content');

    if (bangumi.length === 0) {
      container.innerHTML = `
        <p class="empty-hint">暂无番剧订阅</p>
        <button class="btn btn-primary" onclick="app.showAddBangumiSubDialog('${groupId}')">+ 添加番剧订阅</button>
      `;
      return;
    }

    container.innerHTML = `
      <div class="subscription-list">
        ${bangumi.map(item => `
          <div class="subscription-item">
            <div class="subscription-info">
              <img src="${item.cover}" alt="${item.title}" class="bangumi-cover">
              <div class="subscription-details">
                <div class="subscription-name">${item.title}</div>
                <div class="subscription-uid">Season ID: ${item.season_id}</div>
              </div>
            </div>
            <button class="btn-icon btn-danger" onclick="app.removeBangumiSub('${groupId}', '${item.season_id}')" title="取消订阅">×</button>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-primary" onclick="app.showAddBangumiSubDialog('${groupId}')">+ 添加番剧订阅</button>
    `;
  }

  showAddAdminDialog(groupId) {
    const userId = prompt('请输入要添加的管理员 QQ 号:');
    if (userId && userId.trim()) {
      this.addAdmin(groupId, userId.trim());
    }
  }

  showAddBlacklistDialog(groupId) {
    const userId = prompt('请输入要添加到黑名单的 QQ 号:');
    if (userId && userId.trim()) {
      this.addBlacklist(groupId, userId.trim());
    }
  }

  showAddUserSubDialog(groupId) {
    const uid = prompt('请输入要订阅的 UP 主 UID:');
    if (uid && uid.trim()) {
      this.addUserSub(groupId, uid.trim());
    }
  }

  showAddBangumiSubDialog(groupId) {
    const seasonId = prompt('请输入要订阅的番剧 Season ID:');
    if (seasonId && seasonId.trim()) {
      this.addBangumiSub(groupId, seasonId.trim());
    }
  }

  async addAdmin(groupId, userId) {
    try {
      await api.addGroupAdmin(groupId, userId);
      showToast('管理员添加成功', 'success');
      await this.loadGroups();
      this.selectGroup(groupId);
    } catch (error) {
      showToast('添加失败: ' + error.message, 'error');
    }
  }

  async removeAdmin(groupId, userId) {
    if (!confirm(`确定要移除管理员 ${userId} 吗？`)) return;

    try {
      await api.removeGroupAdmin(groupId, userId);
      showToast('管理员已移除', 'success');
      await this.loadGroups();
      this.selectGroup(groupId);
    } catch (error) {
      showToast('移除失败: ' + error.message, 'error');
    }
  }

  async addBlacklist(groupId, userId) {
    try {
      const group = this.state.groups.find(g => g.groupId === groupId);
      const newBlacklist = [...group.blacklist, userId];
      await api.updateGroupConfig(groupId, { blacklist: newBlacklist });
      showToast('黑名单添加成功', 'success');
      await this.loadGroups();
      this.selectGroup(groupId);
    } catch (error) {
      showToast('添加失败: ' + error.message, 'error');
    }
  }

  async removeBlacklist(groupId, userId) {
    if (!confirm(`确定要移除黑名单用户 ${userId} 吗？`)) return;

    try {
      const group = this.state.groups.find(g => g.groupId === groupId);
      const newBlacklist = group.blacklist.filter(id => id !== userId);
      await api.updateGroupConfig(groupId, { blacklist: newBlacklist });
      showToast('黑名单已移除', 'success');
      await this.loadGroups();
      this.selectGroup(groupId);
    } catch (error) {
      showToast('移除失败: ' + error.message, 'error');
    }
  }

  async addUserSub(groupId, uid) {
    try {
      await api.subscribeUser(groupId, uid);
      showToast('订阅成功', 'success');
      await this.loadGroups();
      this.loadSubscriptions(groupId, 'users');
    } catch (error) {
      showToast('订阅失败: ' + error.message, 'error');
    }
  }

  async removeUserSub(groupId, uid) {
    if (!confirm(`确定要取消订阅该 UP 主吗？`)) return;

    try {
      await api.unsubscribeUser(groupId, uid);
      showToast('取消订阅成功', 'success');
      await this.loadGroups();
      this.loadSubscriptions(groupId, 'users');
    } catch (error) {
      showToast('取消订阅失败: ' + error.message, 'error');
    }
  }

  async addBangumiSub(groupId, seasonId) {
    try {
      await api.subscribeBangumi(groupId, seasonId);
      showToast('订阅成功', 'success');
      await this.loadGroups();
      this.loadSubscriptions(groupId, 'bangumi');
    } catch (error) {
      showToast('订阅失败: ' + error.message, 'error');
    }
  }

  async removeBangumiSub(groupId, seasonId) {
    if (!confirm(`确定要取消订阅该番剧吗？`)) return;

    try {
      await api.unsubscribeBangumi(groupId, seasonId);
      showToast('取消订阅成功', 'success');
      await this.loadGroups();
      this.loadSubscriptions(groupId, 'bangumi');
    } catch (error) {
      showToast('取消订阅失败: ' + error.message, 'error');
    }
  }

  async toggleGroup(groupId, currentlyEnabled) {
    try {
      if (currentlyEnabled) {
        await api.disableGroup(groupId);
        showToast('群组已禁用', 'success');
      } else {
        await api.enableGroup(groupId);
        showToast('群组已启用', 'success');
      }

      // 重新加载
      await this.loadGroups();
      this.selectGroup(groupId);
    } catch (error) {
      showToast('操作失败: ' + error.message, 'error');
    }
  }

  bindEvents() {
    // 搜索功能
    const searchInput = document.getElementById('groupSearch');
    searchInput.addEventListener('input', debounce((e) => {
      this.filterGroups(e.target.value);
    }, 300));

    // 全局配置按钮
    document.getElementById('globalConfigBtn').addEventListener('click', () => {
      showToast('全局配置功能待实现', 'info');
    });

    // 退出登录
    document.getElementById('logoutBtn').addEventListener('click', () => {
      if (confirm('确定要退出登录吗？')) {
        window.location.reload();
      }
    });
  }

  filterGroups(query) {
    const cards = document.querySelectorAll('.group-card');
    cards.forEach(card => {
      const groupId = card.dataset.groupId;
      if (groupId.includes(query)) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
