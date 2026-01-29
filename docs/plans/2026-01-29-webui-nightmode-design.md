# WebUI 群组管理：深色模式功能开关设计

## 设计日期
2026-01-29

## 概述
在 WebUI 群组管理页面的"常规"Tab 中添加深色模式配置功能，支持三种模式（开/关/定时），并提供定时模式的时间段设置。

## 数据结构

### nightMode 配置对象
```javascript
nightMode: {
  mode: "on" | "off" | "timed",
  startTime: "HH:mm",  // 默认 "21:00"
  endTime: "HH:mm"     // 默认 "06:00"
}
```

## UI 设计

### 位置
- 页面：群组管理页 → 常规 Tab
- 顺序：链接缓存超时 → **深色模式** → 预览卡片标签开关

### 组件结构
```jsx
<div className="space-y-4">
  {/* 深色模式标题 */}
  <div>
    <span className="text-gray-300 text-sm font-medium mb-2 block">
      深色模式
    </span>

    {/* 模式选择按钮组 */}
    <div className="flex gap-3 mb-3">
      <button /* mode: 'off' */>关闭</button>
      <button /* mode: 'on' */>开启</button>
      <button /* mode: 'timed' */>定时</button>
    </div>

    {/* 时间输入框（仅在定时模式显示） */}
    {formData.nightMode.mode === 'timed' && (
      <div className="space-y-2 p-3 bg-white/5 rounded-lg">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="text-xs text-gray-400">开始时间</span>
            <input type="time" value={startTime} />
          </label>
          <label>
            <span className="text-xs text-gray-400">结束时间</span>
            <input type="time" value={endTime} />
          </label>
        </div>
        <p className="text-xs text-gray-500">
          支持跨天时段（例如 21:00–06:00）
        </p>
      </div>
    )}
  </div>
</div>
```

### 样式规范
- 模式按钮：选中时蓝色边框 + 背景高亮
- 时间输入：`input[type="time"]`，与现有输入框样式一致
- 整体风格：glassmorphism（毛玻璃效果）

## 前端实现

### 1. 状态管理（Groups.jsx）

**添加到 formData state**
```javascript
const [formData, setFormData] = useState({
  // ... 现有字段
  nightMode: {
    mode: "off",
    startTime: "21:00",
    endTime: "06:00"
  }
});
```

**状态初始化（useEffect 第174-224行）**
```javascript
// 从 group.config.nightMode 读取配置
const nightMode = config.nightMode || {
  mode: "off",
  startTime: "21:00",
  endTime: "06:00"
};

setFormData({
  // ... 其他字段
  nightMode: nightMode
});
```

### 2. 前端校验（handleSave 函数）

**校验逻辑**
```javascript
// 深色模式校验
if (formData.nightMode.mode === 'timed') {
  const timeRegex = /^\d{1,2}:\d{2}$/;

  if (!timeRegex.test(formData.nightMode.startTime) ||
      !timeRegex.test(formData.nightMode.endTime)) {
    show('时间格式不正确，请使用 HH:mm 格式', 'error');
    return;
  }

  // 校验时间范围
  const [startH, startM] = formData.nightMode.startTime.split(':').map(Number);
  const [endH, endM] = formData.nightMode.endTime.split(':').map(Number);

  if (startH < 0 || startH > 23 || startM < 0 || startM > 59 ||
      endH < 0 || endH > 23 || endM < 0 || endM > 59) {
    show('时间超出有效范围（00:00-23:59）', 'error');
    return;
  }
}
```

**错误处理**
- 使用 toast (`show()`) 显示错误信息
- 校验失败时阻止 API 调用

## 后端实现

### 1. API 校验（src/dashboard/routes/api.js 第229-309行）

**在 POST /api/groups/:id/config 中添加校验**
```javascript
// 验证 nightMode 配置
if (updates.hasOwnProperty('nightMode')) {
  const nightMode = updates.nightMode;

  if (!nightMode || typeof nightMode !== 'object') {
    return res.status(400).json({ error: 'nightMode must be an object' });
  }

  // 校验 mode
  if (!['on', 'off', 'timed'].includes(nightMode.mode)) {
    return res.status(400).json({
      error: 'nightMode.mode must be "on", "off", or "timed"'
    });
  }

  // 当 mode 为 timed 时，校验时间格式
  if (nightMode.mode === 'timed') {
    const timeRegex = /^\d{1,2}:\d{2}$/;

    if (!timeRegex.test(nightMode.startTime) ||
        !timeRegex.test(nightMode.endTime)) {
      return res.status(400).json({ error: 'Time format must be HH:mm' });
    }

    // 解析并校验时间范围
    const [startH, startM] = nightMode.startTime.split(':').map(Number);
    const [endH, endM] = nightMode.endTime.split(':').map(Number);

    if (startH < 0 || startH > 23 || startM < 0 || startM > 59 ||
        endH < 0 || endH > 23 || endM < 0 || endM > 59) {
      return res.status(400).json({
        error: 'Time values out of range (00:00-23:59)'
      });
    }
  }
}
```

### 2. 配置默认值（src/config.js 第400-447行）

**在 ensureGroupConfig 函数中添加**
```javascript
this.groupConfigs[key] = {
  linkCacheTimeout: 5,
  labelConfig: {
    video: true,
    dynamic: true,
    live: true,
    article: true,
    bangumi: true
  },
  enableCookieSync: false,
  cookieSyncGroupNames: [],
  blacklistedQQs: [],
  admins: [],
  nightMode: {           // 新增
    mode: "off",
    startTime: "21:00",
    endTime: "06:00"
  }
};
```

## 实施步骤

1. ✅ 在 `config.js` 的 `ensureGroupConfig` 中补充 `nightMode` 默认值
2. ✅ 在 `api.js` 的 `/api/groups/:id/config` 路由中增加 `nightMode` 校验逻辑
3. ✅ 在 `Groups.jsx` 的"常规"Tab 里添加深色模式配置 UI
4. ✅ 在 `Groups.jsx` 的 `handleSave` 中添加前端输入校验
5. 本地验证前端交互与后端写入
6. 提交 PR 进行代码审查

## 验收标准

### 前端
- [ ] 不同模式切换时 UI 正常显示/隐藏时间输入框
- [ ] 输入非法时间（如 25:00、aa:bb）时保存被阻止并提示
- [ ] 保存后刷新页面仍能正确回显配置
- [ ] 时间输入框显示当前设置或默认值 21:00-06:00

### 后端
- [ ] 提交合法定时配置（如 21:00-06:00）成功保存
- [ ] 提交非法时间返回 400 错误，错误消息明确
- [ ] 配置正确写入 `config.json` 的 `groupConfigs[groupId].nightMode`

### 集成
- [ ] 深色主题判定与定时跨天逻辑与 `theme.js:isNightMode` 一致（现有功能，无需修改）
- [ ] 群组中生成预览卡片时，深色模式配置生效

## 参考代码位置

- 夜间模式判定：`src/services/imageGenerator/core/theme.js:isNightMode` (1-40行)
- 群组管理页面：`dashboard/src/pages/Groups.jsx`
- 群组配置 API：`src/dashboard/routes/api.js` (228-309行)
- 配置默认值：`src/config.js:ensureGroupConfig` (399-447行)

## 风险与回滚

### 风险
- 时间解析边界值（00:00、23:59）的测试覆盖
- 跨天区间（21:00-06:00）的用户理解偏差

### 回滚方案
- 若前端问题：临时隐藏"定时"选项，仅提供开/关
- 若后端校验误判：临时放宽校验，仅做模式枚举限制
