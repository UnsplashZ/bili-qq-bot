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

    panel.innerHTML = `
      <h2>群组详情 - ${group.groupId}</h2>
      <div class="group-info">
        <p><strong>状态:</strong> ${group.enabled ? '已启用' : '已禁用'}</p>
        <p><strong>管理员:</strong> ${group.admins.length} 人</p>
        <p><strong>黑名单:</strong> ${group.blacklist.length} 人</p>
        <button class="btn btn-primary" id="toggleGroupBtn">
          ${group.enabled ? '禁用群组' : '启用群组'}
        </button>
      </div>
      <div class="subscriptions-section">
        <h3>订阅管理</h3>
        <p><strong>UP主订阅:</strong> ${group.subscriptions.users} 个</p>
        <p><strong>番剧订阅:</strong> ${group.subscriptions.bangumi} 个</p>
      </div>
    `;

    // 绑定切换按钮
    document.getElementById('toggleGroupBtn').addEventListener('click', () => {
      this.toggleGroup(groupId, group.enabled);
    });
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
  const app = new App();
});
