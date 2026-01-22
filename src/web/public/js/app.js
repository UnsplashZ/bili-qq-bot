class App {
  constructor() {
    this.state = {
      groups: [],
      selectedGroupId: null
    };

    // Bilibili login state
    this.currentLoginGroupId = null;
    this.currentQrcodeKey = null;
    this.loginCheckInterval = null;

    // Following sync state
    this.currentSyncGroupId = null;

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
            <option value="timed" ${nightMode.mode === 'timed' ? 'selected' : ''}>定时</option>
          </select>
        </div>

        <div class="config-item ${nightMode.mode === 'timed' ? '' : 'hidden'}" id="nightModeTimeContainer">
          <label>定时时间</label>
          <input type="text" id="nightModeTime" class="config-input"
                 value="${nightMode.startTime || '22:00'}-${nightMode.endTime || '07:00'}"
                 placeholder="22:00-07:00">
          <p class="config-hint">格式：开始时间-结束时间，例如 22:00-07:00</p>
        </div>

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

      <div class="management-section bili-account-section">
        <h3>🅱️ Bilibili 账号</h3>
        <div class="bili-account-info">
          <div class="account-status">
            <span class="status-label">登录状态：</span>
            <span class="status-value" id="biliLoginStatus">未登录</span>
            <span class="account-uid hidden" id="biliAccountUid"></span>
          </div>
          <div class="account-actions">
            <button class="btn btn-primary btn-sm" id="groupBiliLoginBtn">
              登录/重新登录
            </button>
            <span class="last-login-time" id="lastLoginTime"></span>
          </div>
        </div>
      </div>

      <div class="subscriptions-section">
        <div class="section-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h3>订阅管理</h3>
          <button class="btn btn-secondary" id="syncFromFollowingBtn">
            从关注同步
          </button>
        </div>
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

    // 绑定深色模式变化 - 只切换时间输入框显示，不重新渲染整个面板
    document.getElementById('nightModeSelect').addEventListener('change', (e) => {
      const timeContainer = document.getElementById('nightModeTimeContainer');
      if (e.target.value === 'timed') {
        timeContainer.classList.remove('hidden');
      } else {
        timeContainer.classList.add('hidden');
      }
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

    // 绑定 Bilibili 登录按钮
    document.getElementById('groupBiliLoginBtn').addEventListener('click', () => {
      this.showBilibiliLoginModal(groupId);
    });

    // 绑定从关注同步按钮
    document.getElementById('syncFromFollowingBtn').addEventListener('click', () => {
      this.showFollowingSyncModal(groupId);
    });

    // 默认加载 UP 主订阅
    this.loadSubscriptions(groupId, 'users');
    this.updateBilibiliStatus(groupId);
  }

  async saveGroupConfig(groupId) {
    try {
      const nightModeSelect = document.getElementById('nightModeSelect').value;
      const nightModeConfig = { mode: nightModeSelect };

      if (nightModeSelect === 'timed') {
        const timeInput = document.getElementById('nightModeTime').value;
        const [start, end] = timeInput.split('-');
        nightModeConfig.startTime = start;
        nightModeConfig.endTime = end;
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
    container.innerHTML = ''; // Clear existing content

    if (users.length === 0) {
      // Create empty state elements
      const emptyHint = document.createElement('p');
      emptyHint.className = 'empty-hint';
      emptyHint.textContent = '暂无 UP 主订阅';
      
      const addButton = document.createElement('button');
      addButton.className = 'btn btn-primary';
      addButton.textContent = '+ 添加 UP 主订阅';
      addButton.onclick = () => app.showAddUserSubDialog(groupId);
      
      container.appendChild(emptyHint);
      container.appendChild(addButton);
      return;
    }

    // Create subscription list container
    const subscriptionList = document.createElement('div');
    subscriptionList.className = 'subscription-list';

    // Create list items for each user
    users.forEach(user => {
      const listItem = document.createElement('div');
      listItem.className = 'list-item';

      // Create subscription details container
      const details = document.createElement('div');
      details.className = 'subscription-details';

      // Create name element
      const nameDiv = document.createElement('div');
      nameDiv.className = 'subscription-name';
      nameDiv.textContent = user.name;

      // Create UID element
      const uidDiv = document.createElement('div');
      uidDiv.className = 'subscription-uid';
      uidDiv.textContent = `UID: ${user.uid}`;

      // Create remove button
      const removeButton = document.createElement('button');
      removeButton.className = 'btn-icon btn-danger';
      removeButton.textContent = '×';
      removeButton.title = '取消订阅';
      removeButton.onclick = () => app.removeUserSub(groupId, user.uid);

      // Assemble the list item
      details.appendChild(nameDiv);
      details.appendChild(uidDiv);
      listItem.appendChild(details);
      listItem.appendChild(removeButton);
      subscriptionList.appendChild(listItem);
    });

    // Create add button
    const addButton = document.createElement('button');
    addButton.className = 'btn btn-primary';
    addButton.textContent = '+ 添加 UP 主订阅';
    addButton.onclick = () => app.showAddUserSubDialog(groupId);

    // Append to container
    container.appendChild(subscriptionList);
    container.appendChild(addButton);
  }


  renderBangumiSubscriptions(groupId, bangumi) {
    const container = document.querySelector('.tab-content');
    container.innerHTML = ''; // Clear existing content

    if (bangumi.length === 0) {
      const emptyHint = document.createElement('p');
      emptyHint.className = 'empty-hint';
      emptyHint.textContent = '暂无番剧订阅';
      
      const addButton = document.createElement('button');
      addButton.className = 'btn btn-primary';
      addButton.textContent = '+ 添加番剧订阅';
      addButton.onclick = () => this.showAddBangumiSubDialog(groupId);
      
      container.appendChild(emptyHint);
      container.appendChild(addButton);
      return;
    }

    const subscriptionList = document.createElement('div');
    subscriptionList.className = 'subscription-list';

    bangumi.forEach(item => {
      const listItem = document.createElement('div');
      listItem.className = 'list-item';

      const details = document.createElement('div');
      details.className = 'subscription-details';

      const name = document.createElement('div');
      name.className = 'subscription-name';
      name.textContent = item.title;

      const uid = document.createElement('div');
      uid.className = 'subscription-uid';
      uid.textContent = `Season ID: ${item.season_id}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-icon btn-danger';
      removeBtn.textContent = '×';
      removeBtn.title = '取消订阅';
      removeBtn.onclick = () => this.removeBangumiSub(groupId, item.season_id);

      details.appendChild(name);
      details.appendChild(uid);
      listItem.appendChild(details);
      listItem.appendChild(removeBtn);
      subscriptionList.appendChild(listItem);
    });

    const addButton = document.createElement('button');
    addButton.className = 'btn btn-primary';
    addButton.textContent = '+ 添加番剧订阅';
    addButton.onclick = () => this.showAddBangumiSubDialog(groupId);

    container.appendChild(subscriptionList);
    container.appendChild(addButton);
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
    const seasonId = prompt('请输入番剧链接或 ID (支持 ss/md/ep 格式，如: ss12345 或完整链接):');
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
      await api.updateGroupConfig(groupId, { blacklistedQQs: newBlacklist });
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
      await api.updateGroupConfig(groupId, { blacklistedQQs: newBlacklist });
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

      // Update tab header counts
      this.updateSubscriptionCounts(groupId);

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

      // Update tab header counts
      this.updateSubscriptionCounts(groupId);

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

      // Update tab header counts
      this.updateSubscriptionCounts(groupId);

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

      // Update tab header counts
      this.updateSubscriptionCounts(groupId);

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
      this.showGlobalConfigModal();
    });

    // 模态框关闭按钮
    document.getElementById('closeModalBtn').addEventListener('click', () => {
      this.hideGlobalConfigModal();
    });

    document.getElementById('cancelModalBtn').addEventListener('click', () => {
      this.hideGlobalConfigModal();
    });

    // 保存全局配置按钮
    document.getElementById('saveGlobalConfigBtn').addEventListener('click', () => {
      this.saveGlobalConfig();
    });

    // 全局深色模式选择变化
    document.getElementById('globalNightMode').addEventListener('change', (e) => {
      const timeContainer = document.getElementById('globalNightModeTimeContainer');
      if (e.target.value === 'timed') {
        timeContainer.classList.remove('hidden');
      } else {
        timeContainer.classList.add('hidden');
      }
    });

    // 退出登录
    document.getElementById('logoutBtn').addEventListener('click', () => {
      if (confirm('确定要退出登录吗？')) {
        window.location.reload();
      }
    });

    // ========== Following Sync Modal Events ==========

    // Sync modal close button
    document.getElementById('closeFollowingSyncModalBtn').addEventListener('click', () => {
      this.hideFollowingSyncModal();
    });

    // Refresh followings button
    document.getElementById('refreshFollowingsListBtn').addEventListener('click', () => {
      this.refreshFollowings();
    });

    // Select all/unselect all
    document.getElementById('selectAllUsersBtn').addEventListener('click', () => {
      this.selectAllFollowings(true);
    });

    document.getElementById('unselectAllUsersBtn').addEventListener('click', () => {
      this.selectAllFollowings(false);
    });

    // Cancel button
    document.getElementById('cancelSyncModalBtn').addEventListener('click', () => {
      this.hideFollowingSyncModal();
    });

    // Sync modal tab switching (using event delegation)
    const syncTabsContainer = document.querySelector('.sync-tabs');
    if (syncTabsContainer) {
      syncTabsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
          const tabName = e.target.getAttribute('data-sync-tab');
          if (tabName) {
            this.switchSyncTab(tabName);
          }
        }
      });
    }

    // Sync modal footer buttons
    document.getElementById('saveSyncGroupsBtn').addEventListener('click', () => {
      this.saveSyncGroups();
    });

    document.getElementById('batchSubscribeUsersBtn').addEventListener('click', () => {
      this.batchSubscribe();
    });
  }

  showGlobalConfigModal() {
    const modal = document.getElementById('globalConfigModal');
    modal.classList.remove('hidden');
    this.loadGlobalConfig();
  }

  hideGlobalConfigModal() {
    const modal = document.getElementById('globalConfigModal');
    modal.classList.add('hidden');
  }

  async loadGlobalConfig() {
    try {
      const response = await fetch('/api/config/global');
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || '加载全局配置失败');
      }

      const config = data.data;

      // 订阅轮询间隔
      if (config.subscriptionCheckInterval) {
        document.getElementById('globalSubscriptionInterval').value = config.subscriptionCheckInterval;
      }

      // 默认深色模式
      if (config.nightMode) {
        document.getElementById('globalNightMode').value = config.nightMode.mode || 'off';

        // 显示/隐藏定时时间输入框
        const timeContainer = document.getElementById('globalNightModeTimeContainer');
        if (config.nightMode.mode === 'timed') {
          timeContainer.classList.remove('hidden');
          if (config.nightMode.startTime && config.nightMode.endTime) {
            document.getElementById('globalNightModeTime').value = `${config.nightMode.startTime}-${config.nightMode.endTime}`;
          }
        } else {
          timeContainer.classList.add('hidden');
        }
      }

      // 默认标签配置
      if (config.labelConfig) {
        document.getElementById('globalLabelVideo').checked = config.labelConfig.video !== false;
        document.getElementById('globalLabelLive').checked = config.labelConfig.live !== false;
        document.getElementById('globalLabelDynamic').checked = config.labelConfig.dynamic !== false;
        document.getElementById('globalLabelArticle').checked = config.labelConfig.article !== false;
        document.getElementById('globalLabelBangumi').checked = config.labelConfig.bangumi !== false;
        document.getElementById('globalLabelUser').checked = config.labelConfig.user !== false;
      }

      // 默认 AI 配置
      if (config.aiContextLimit) {
        document.getElementById('globalAiContext').value = config.aiContextLimit;
      }
      if (config.aiProbability !== undefined) {
        document.getElementById('globalAiProbability').value = config.aiProbability;
      }
    } catch (error) {
      showToast('加载全局配置失败: ' + error.message, 'error');
    }
  }

  async saveGlobalConfig() {
    try {
      const config = {};

      // 订阅轮询间隔
      const interval = document.getElementById('globalSubscriptionInterval').value;
      if (interval) {
        const intervalNum = parseInt(interval);
        if (isNaN(intervalNum) || intervalNum < 10 || intervalNum > 3600) {
          showToast('订阅轮询间隔必须在 10-3600 秒之间', 'error');
          return;
        }
        config.subscriptionCheckInterval = intervalNum;
      }

      // 默认深色模式
      const nightMode = document.getElementById('globalNightMode').value;
      config.nightMode = { mode: nightMode };

      if (nightMode === 'timed') {
        const timeInput = document.getElementById('globalNightModeTime').value;
        if (timeInput) {
          const [start, end] = timeInput.split('-');
          if (start && end) {
            config.nightMode.startTime = start.trim();
            config.nightMode.endTime = end.trim();
          } else {
            showToast('定时时间格式错误，请使用格式：22:00-07:00', 'error');
            return;
          }
        } else {
          showToast('请输入定时时间', 'error');
          return;
        }
      }

      // 默认标签配置
      config.labelConfig = {
        video: document.getElementById('globalLabelVideo').checked,
        live: document.getElementById('globalLabelLive').checked,
        dynamic: document.getElementById('globalLabelDynamic').checked,
        article: document.getElementById('globalLabelArticle').checked,
        bangumi: document.getElementById('globalLabelBangumi').checked,
        user: document.getElementById('globalLabelUser').checked
      };

      // 默认 AI 配置
      const aiContext = document.getElementById('globalAiContext').value;
      if (aiContext) {
        const aiContextNum = parseInt(aiContext);
        if (isNaN(aiContextNum) || aiContextNum < 1 || aiContextNum > 50) {
          showToast('AI 上下文消息数必须在 1-50 之间', 'error');
          return;
        }
        config.aiContextLimit = aiContextNum;
      }

      const aiProb = document.getElementById('globalAiProbability').value;
      if (aiProb) {
        const aiProbNum = parseFloat(aiProb);
        if (isNaN(aiProbNum) || aiProbNum < 0 || aiProbNum > 1) {
          showToast('AI 随机回复概率必须在 0-1 之间', 'error');
          return;
        }
        config.aiProbability = aiProbNum;
      }

      const response = await fetch('/api/config/global', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || '保存全局配置失败');
      }

      showToast('全局配置已保存', 'success');
      this.hideGlobalConfigModal();
    } catch (error) {
      showToast('保存失败: ' + error.message, 'error');
    }
  }

  updateSubscriptionCounts(groupId) {
    const group = this.state.groups.find(g => g.groupId === groupId);
    if (!group) return;

    const usersTab = document.querySelector('[data-tab="users"]');
    const bangumiTab = document.querySelector('[data-tab="bangumi"]');

    if (usersTab) {
      usersTab.textContent = `UP主订阅 (${group.subscriptions.users})`;
    }
    if (bangumiTab) {
      bangumiTab.textContent = `番剧订阅 (${group.subscriptions.bangumi})`;
    }
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

  // ========== Bilibili Login Methods ==========

  async updateBilibiliStatus(groupId) {
    try {
      const response = await api.getBilibiliStatus(groupId);
      if (!response.success) return;

      const data = response.data;
      const statusEl = document.getElementById('biliLoginStatus');
      const uidEl = document.getElementById('biliAccountUid');
      const btnEl = document.getElementById('groupBiliLoginBtn');

      if (!statusEl || !uidEl || !btnEl) return;

      if (data.logged_in) {
        statusEl.textContent = '已登录';
        statusEl.style.color = '#4caf50';
        statusEl.style.fontWeight = 'bold';

        uidEl.textContent = `UID: ${data.uid} | ${data.name}`;
        uidEl.classList.remove('hidden');

        btnEl.textContent = '切换账号';
      } else {
        statusEl.textContent = '未登录';
        statusEl.style.color = '';
        statusEl.style.fontWeight = '';

        uidEl.classList.add('hidden');
        btnEl.textContent = '登录/重新登录';
      }
    } catch (error) {
      console.error('Failed to update Bilibili status:', error);
    }
  }

  showBilibiliLoginModal(groupId) {
    this.currentLoginGroupId = groupId;

    const modal = document.getElementById('bilibiliLoginModal');
    modal.classList.remove('hidden');

    // Reset UI
    document.getElementById('loginStatus').classList.remove('hidden');
    document.getElementById('qrcodeContainer').classList.add('hidden');

    // Clear previous QR code and interval
    if (this.loginCheckInterval) {
      clearInterval(this.loginCheckInterval);
      this.loginCheckInterval = null;
    }
    this.currentQrcodeKey = null;

    // Bind modal close buttons
    document.getElementById('closeBilibiliLoginBtn').onclick = () => {
      this.hideBilibiliLoginModal();
            this.updateBilibiliStatus(this.currentLoginGroupId);
    };
    document.getElementById('cancelBilibiliLoginBtn').onclick = () => {
      this.hideBilibiliLoginModal();
    };

    // Bind get QR code button
    document.getElementById('getQrcodeBtn').onclick = () => {
      this.getLoginQrcode();
    };
  }

  hideBilibiliLoginModal() {
    const modal = document.getElementById('bilibiliLoginModal');
    modal.classList.add('hidden');

    // Clean up interval
    if (this.loginCheckInterval) {
      clearInterval(this.loginCheckInterval);
      this.loginCheckInterval = null;
    }

    this.currentQrcodeKey = null;
    this.currentLoginGroupId = null;
  }

  async getLoginQrcode() {
    try {
      showToast('正在获取二维码...', 'info');
      const response = await api.getLoginQrcode();

      if (!response.success) {
        throw new Error(response.message || '获取二维码失败');
      }

      // Hide status and show QR code container
      document.getElementById('loginStatus').classList.add('hidden');
      const qrcodeContainer = document.getElementById('qrcodeContainer');
      qrcodeContainer.classList.remove('hidden');

      // Clear previous QR code and generate new one
      const qrcodeWrapper = qrcodeContainer.querySelector('.qrcode-wrapper');
      qrcodeWrapper.innerHTML = '';

      // Allow browser layout cycle before generating QR code
      setTimeout(() => {
        new QRCode(qrcodeWrapper, {
          text: response.data.qrcodeUrl,
          width: 256,
          height: 256
        });

        // Check if QR code was generated successfully
        if (qrcodeWrapper.children.length === 0) {
          console.warn('QR Code generation failed: Container might still be hidden or have 0 dimensions');
        }
      }, 50);

      // Update progress text
      const loginProgress = document.getElementById('loginProgress');
      loginProgress.querySelector('p').textContent = '等待扫码...';

      // Save key and start polling
      this.currentQrcodeKey = response.data.qrcodeKey;
      this.startLoginPolling();

    } catch (error) {
      showToast('获取二维码失败: ' + error.message, 'error');
    }
  }

  startLoginPolling() {
    if (this.loginCheckInterval) {
      clearInterval(this.loginCheckInterval);
    }

    // Check login status every 2 seconds
    this.loginCheckInterval = setInterval(async () => {
      try {
        const response = await api.checkLogin(this.currentQrcodeKey, this.currentLoginGroupId);

        if (response.success && response.data) {
          const status = response.data;

          // Update progress text based on status
          const loginProgress = document.getElementById('loginProgress');

          if (status.code === 0) {
            // Login successful
            clearInterval(this.loginCheckInterval);
            this.loginCheckInterval = null;

            showToast('登录成功！', 'success');
            this.hideBilibiliLoginModal();

            // Refresh group data and update panel
            await this.loadGroups();
            if (this.state.selectedGroupId === this.currentLoginGroupId) {
              this.selectGroup(this.currentLoginGroupId);
            }

          } else if (status.code === 86101) {
            // QR code not scanned yet
            loginProgress.querySelector('p').textContent = '等待扫码...';

          } else if (status.code === 86090) {
            // QR code scanned, waiting for confirmation
            loginProgress.querySelector('p').textContent = '已扫码，请在手机上确认...';

          } else if (status.code === 86038) {
            // QR code expired
            clearInterval(this.loginCheckInterval);
            this.loginCheckInterval = null;

            showToast('二维码已过期，请重新获取', 'error');

            // Show get QR code button again
            document.getElementById('qrcodeContainer').classList.add('hidden');
            document.getElementById('loginStatus').classList.remove('hidden');

          } else {
            // Other error
            clearInterval(this.loginCheckInterval);
            this.loginCheckInterval = null;

            const errorMsg = status.message || `登录失败 (code: ${status.code})`;
            showToast(errorMsg, 'error');

            // Show get QR code button again
            document.getElementById('qrcodeContainer').classList.add('hidden');
            document.getElementById('loginStatus').classList.remove('hidden');
          }
        }
      } catch (error) {
        console.error('Login check error:', error);
      }
    }, 2000);
  }

  // ========== Following Sync Methods ==========

  async showFollowingSyncModal(groupId) {
    // Save current group ID
    this.currentSyncGroupId = groupId;

    // Show modal
    const modal = document.getElementById('followingSyncModal');
    modal.classList.remove('hidden');

    // Set modal title with group name
    const group = this.state.groups.find(g => g.groupId === groupId);
    const groupNameSpan = document.getElementById('syncModalGroupName');
    if (group && groupNameSpan) {
      groupNameSpan.textContent = `群组 ${groupId}`;
    }

    // Default to Tab 1 (groups)
    this.switchSyncTab('groups');

    // Load following groups for Tab 1
    await this.loadFollowingGroups();

    // 填充群组选择器（for Tab 2）
    const select = document.getElementById('targetGroupSelect');
    if (select) {
      select.innerHTML = '<option value="">请选择群组</option>';
      this.state.groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.groupId;
        option.textContent = `群组 ${group.groupId}`;
        select.appendChild(option);
      });
    }

    // 加载关注列表（for Tab 2）
    await this.loadFollowings();
  }

  hideFollowingSyncModal() {
    const modal = document.getElementById('followingSyncModal');
    modal.classList.add('hidden');
  }

  switchSyncTab(tabName) {
    // Remove active class from all tab buttons
    document.querySelectorAll('.sync-tabs .tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    // Add active class to the clicked button
    const activeBtn = document.querySelector(`[data-sync-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Hide all tab contents
    document.querySelectorAll('.sync-tab-content').forEach(content => {
      content.classList.add('hidden');
    });

    // Show the corresponding tab content
    const activeContent = document.getElementById(
      tabName === 'groups' ? 'syncGroupsTab' : 'syncUsersTab'
    );
    if (activeContent) activeContent.classList.remove('hidden');

    // Switch footer buttons
    const saveBtn = document.getElementById('saveSyncGroupsBtn');
    const batchBtn = document.getElementById('batchSubscribeUsersBtn');
    if (tabName === 'groups') {
      saveBtn.classList.remove('hidden');
      batchBtn.classList.add('hidden');
    } else {
      saveBtn.classList.add('hidden');
      batchBtn.classList.remove('hidden');
    }
  }

  async loadFollowingGroups() {
    const container = document.getElementById('followingGroupsList');
    container.innerHTML = '<p class="empty-hint">加载中...</p>';

    try {
      const response = await api.getFollowingGroups(this.currentSyncGroupId);

      if (!response.success || !response.data || response.data.length === 0) {
        container.innerHTML = '<p class="empty-hint">暂无分组数据。请先登录 Bilibili 账号并刷新关注列表。</p>';
        return;
      }

      // Get current configured group names from group config
      const group = this.state.groups.find(g => g.groupId === this.currentSyncGroupId);
      const currentConfig = (group && group.config && group.config.cookieSyncGroupNames) || [];

      // Render group list
      const groups = response.data;
      const html = groups.map(group => `
        <label class="group-item">
          <input type="checkbox" value="${group.name}"
                 ${currentConfig.includes(group.name) ? 'checked' : ''}>
          <span class="group-name">${group.name}</span>
          <span class="group-count">(${group.count}人)</span>
        </label>
      `).join('');

      container.innerHTML = html;

      // Update current sync groups text
      const currentText = document.getElementById('currentSyncGroupsText');
      if (currentText) {
        currentText.textContent = currentConfig.length > 0 ? currentConfig.join(', ') : '无';
      }

    } catch (error) {
      container.innerHTML = `<p class="empty-hint">加载失败: ${error.message}</p>`;
      showToast('加载关注分组失败: ' + error.message, 'error');
    }
  }

  async loadFollowings() {
    const container = document.getElementById('followingsUserGrid');
    const cacheInfo = document.getElementById('cacheLastRefreshTime');

    container.innerHTML = '<p class="empty-hint">加载中...</p>';

    try {
      const response = await api.getFollowings(null, this.currentSyncGroupId);

      // Update cache info
      if (response.cache && cacheInfo) {
        const lastUpdate = response.cache.lastUpdate
          ? new Date(response.cache.lastUpdate).toLocaleString('zh-CN')
          : '从未';
        const canRefresh = response.cache.canRefresh;
        const cooldownRemaining = response.cache.cooldownRemaining || 0;

        let statusText = lastUpdate;
        if (!canRefresh && cooldownRemaining > 0) {
          statusText += ` (冷却中: ${Math.ceil(cooldownRemaining / 1000)}秒)`;
        }

        cacheInfo.textContent = statusText;

        // Enable/disable refresh button based on cooldown
        const refreshBtn = document.getElementById('refreshFollowingsListBtn');
        if (refreshBtn) {
          refreshBtn.disabled = !canRefresh;
        }
      }

      if (!response.success || !response.data || response.data.length === 0) {
        container.innerHTML = '<p class="empty-hint">暂无关注数据。请先登录 Bilibili 账号并刷新关注列表。</p>';
        return;
      }

      this.followings = response.data;
      this.renderFollowings();

    } catch (error) {
      container.innerHTML = `<p class="empty-hint">加载失败: ${error.message}</p>`;
      showToast('加载关注列表失败: ' + error.message, 'error');
    }
  }

  renderFollowings() {
    const container = document.getElementById('followingsUserGrid');

    if (!this.followings || this.followings.length === 0) {
      container.innerHTML = '<p class="empty-hint">暂无关注数据</p>';
      this.updateSelectedCount();
      return;
    }

    container.innerHTML = this.followings.map(following => `
      <div class="following-card" data-uid="${following.uid}">
        <input type="checkbox" class="following-checkbox" data-uid="${following.uid}">
        <img src="${following.face || 'https://via.placeholder.com/48'}"
             alt="${following.name}"
             class="following-avatar"
             onerror="this.src='https://via.placeholder.com/48'">
        <div class="following-info">
          <div class="following-name">${following.name}</div>
          <div class="following-uid">UID: ${following.uid}</div>
          ${following.sign ? `<div class="following-sign">${following.sign}</div>` : ''}
        </div>
      </div>
    `).join('');

    // 绑定卡片点击事件
    container.querySelectorAll('.following-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // 如果点击的不是 checkbox，则切换 checkbox 状态
        if (e.target.tagName !== 'INPUT') {
          const checkbox = card.querySelector('.following-checkbox');
          checkbox.checked = !checkbox.checked;
        }
        // 更新卡片选中状态
        this.updateCardSelection(card);
        this.updateSelectedCount();
      });

      // Checkbox 变化时更新卡片状态
      const checkbox = card.querySelector('.following-checkbox');
      checkbox.addEventListener('change', () => {
        this.updateCardSelection(card);
        this.updateSelectedCount();
      });
    });

    // Initialize selected count
    this.updateSelectedCount();
  }

  updateCardSelection(card) {
    const checkbox = card.querySelector('.following-checkbox');
    if (checkbox.checked) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  }

  async refreshFollowings() {
    try {
      showToast('正在刷新关注列表...', 'info');

      // Disable refresh button during refresh
      const refreshBtn = document.getElementById('refreshFollowingsListBtn');
      if (refreshBtn) {
        refreshBtn.disabled = true;
      }

      const response = await api.refreshFollowings(this.currentSyncGroupId);

      if (response.success) {
        showToast('关注列表刷新成功', 'success');
        // Reload followings to get fresh data and update cache info
        await this.loadFollowings();
      } else {
        throw new Error(response.message || '刷新失败');
      }
    } catch (error) {
      // Check if it's a cooldown error (HTTP 429)
      if (error.message.includes('冷却') || error.message.includes('cooldown')) {
        showToast('刷新过于频繁，请稍后再试: ' + error.message, 'warning');
      } else {
        showToast('刷新关注列表失败: ' + error.message, 'error');
      }

      // Re-enable button after cooldown check
      const refreshBtn = document.getElementById('refreshFollowingsListBtn');
      if (refreshBtn) {
        refreshBtn.disabled = false;
      }
    }
  }

  selectAllFollowings(select) {
    const checkboxes = document.querySelectorAll('.following-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.checked = select;
      const card = checkbox.closest('.following-card');
      this.updateCardSelection(card);
    });

    // Update selected count
    this.updateSelectedCount();
  }

  updateSelectedCount() {
    const checkedCount = document.querySelectorAll('.following-checkbox:checked').length;
    const totalCount = document.querySelectorAll('.following-checkbox').length;
    const countText = document.getElementById('selectedUserCount');
    if (countText) {
      countText.textContent = checkedCount;
    }
  }

  async saveSyncGroups() {
    try {
      // Collect selected group names
      const checkboxes = document.querySelectorAll('#followingGroupsList input[type="checkbox"]:checked');
      const selectedGroups = Array.from(checkboxes).map(cb => cb.value);

      // Save to group config
      await api.updateGroupConfig(this.currentSyncGroupId, {
        cookieSyncGroupNames: selectedGroups
      });

      showToast('分组同步配置已保存', 'success');

      // Update current sync groups text
      const currentText = document.getElementById('currentSyncGroupsText');
      if (currentText) {
        currentText.textContent = selectedGroups.length > 0 ? selectedGroups.join(', ') : '无';
      }

      // Reload groups to update state
      await this.loadGroups();

    } catch (error) {
      showToast('保存配置失败: ' + error.message, 'error');
    }
  }

  async batchSubscribe() {
    // Collect selected UIDs
    const checkboxes = document.querySelectorAll('.following-checkbox:checked');
    const uids = Array.from(checkboxes).map(cb => cb.dataset.uid);

    if (uids.length === 0) {
      showToast('请至少选择一个UP主', 'error');
      return;
    }

    if (!confirm(`确定要为群组 ${this.currentSyncGroupId} 添加 ${uids.length} 个订阅吗？`)) {
      return;
    }

    try {
      showToast(`正在添加 ${uids.length} 个订阅...`, 'info');

      const response = await api.batchSubscribeFollowings(this.currentSyncGroupId, uids);

      if (response.success) {
        const result = response.data || {};
        const successCount = (result.success && result.success.length) || 0;
        const failCount = (result.failed && result.failed.length) || 0;
        const skipCount = (result.skipped && result.skipped.length) || 0;

        let message = `批量订阅完成！成功: ${successCount}`;
        if (skipCount > 0) {
          message += `，跳过已订阅: ${skipCount}`;
        }
        if (failCount > 0) {
          message += `，失败: ${failCount}`;
        }

        showToast(message, failCount > 0 ? 'warning' : 'success');

        // Close modal
        this.hideFollowingSyncModal();

        // Refresh group data
        await this.loadGroups();

        // If current selected group is this group, refresh the subscriptions view
        if (this.state.selectedGroupId === this.currentSyncGroupId) {
          this.selectGroup(this.currentSyncGroupId);
        }
      } else {
        throw new Error(response.message || '批量订阅失败');
      }
    } catch (error) {
      showToast('批量订阅失败: ' + error.message, 'error');
    }
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
