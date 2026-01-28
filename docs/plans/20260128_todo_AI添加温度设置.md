# AI 温度参数（Temperature）功能添加计划

## 概述

当前项目中的 AI 对话功能没有显式设置 temperature（温度）参数，会使用 AI API 提供商的默认值（通常为 1.0）。本计划旨在添加完整的温度设置支持，包括 .env 环境变量配置、WebUI 全局设置和群组级别设置。

## 背景

在 `src/handlers/aiHandler.js:146-152` 中构建的请求 payload 只包含 model 和 messages：

```javascript
const requestPayload = {
    model: config.aiModel,
    messages: currentMessages
};
```

需要添加 temperature 参数以允许用户控制 AI 回复的随机性和创造性。

---

## 需要调整的文件清单

### 1. src/config.js

**位置1：META 对象中添加配置定义**

在 `aiContextLimit` 配置之后添加：

```javascript
aiContextLimit: { env: null, def: 10, type: 'int' },
aiTemperature: { env: 'AI_TEMPERATURE', def: 1.0, type: 'float' },
```

---

### 2. config/config.json.example

**位置1：添加 temperature 示例配置**

在 `aiContextLimit` 之后添加：

```json
"aiContextLimit": 10,
"aiTemperature": 1.0,
```

---

### 3. dashboard/src/pages/Settings.jsx

**位置1：AI State 中添加 temperature 字段**

```javascript
// 行约 39 行，aiContextLimit 之后添加
aiContextLimit: 0,
aiTemperature: 1.0,
```

**位置2：从后端加载配置时解构 temperature**

```javascript
// 行约 109 行，添加到解构列表
const {
  aiProbability,
  aiContextLimit,
  aiTemperature,  // ← 添加这行
  // ... 其他字段
} = configRes.data;
```

**位置3：setAiConfig 中初始化 temperature**

```javascript
// 行约 128 行，添加到初始化
setAiConfig({
  aiProbability: aiProbability ?? 0.1,
  aiContextLimit: aiContextLimit ?? 10,
  aiTemperature: aiTemperature ?? 1.0,  // ← 添加这行
  // ... 其他字段
});
```

**位置4：resetAiSettings 中重置 temperature**

```javascript
// 行约 293 行，添加到重置
setAiConfig(prev => ({
  ...prev,
  aiProbability: newConfig.aiProbability ?? 0.1,
  aiContextLimit: newConfig.aiContextLimit ?? 10,
  aiTemperature: newConfig.aiTemperature ?? 1.0,  // ← 添加这行
  // ... 其他字段
}));
```

**位置5：AI 配置 UI 中添加 temperature 输入框**

在上下文限制输入框之后添加：

```javascript
<div>
  <label className="block text-sm font-medium text-gray-300 mb-2">
    温度参数 ({aiConfig.aiTemperature})
  </label>
  <input
    type="range"
    min="0"
    max="2"
    step="0.1"
    value={aiConfig.aiTemperature}
    onChange={(e) => handleAiChange('aiTemperature', parseFloat(e.target.value))}
    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
  />
  <p className="text-xs text-gray-500 mt-1">控制 AI 回复的随机性（0=确定性，2=创造性）</p>
</div>
```

---

### 4. dashboard/src/pages/Groups.jsx

**位置1：formData 中添加 temperature 字段**

```javascript
// 行约 35 行，aiContextLimit 之后添加
aiContextLimit: null
aiTemperature: null  // ← 添加这行
});
```

**位置2：设置群组配置时初始化 temperature**

```javascript
// 行约 203 行，添加到初始化
aiProbability: config.aiProbability ?? null,
aiContextLimit: config.aiContextLimit ?? null,
aiTemperature: config.aiTemperature ?? null,  // ← 添加这行
```

**位置3：AI 配置 UI 中添加 temperature 输入框**

在上下文限制输入框之后添加：

```javascript
{/* 温度参数 */}
<div className="space-y-2">
  <label className="block text-sm font-medium text-white/90">
    温度参数 (留空使用全局默认)
  </label>
  <input
    type="number"
    step="0.1"
    min="0"
    max="2"
    value={formData.aiTemperature ?? ''}
    placeholder={globalConfigLoading ? '加载中...' : `全局默认: ${globalConfig.aiTemperature}`}
    disabled={globalConfigLoading}
    onChange={(e) => {
      const value = e.target.value;
      if (value === '') {
        setFormData({ ...formData, aiTemperature: null });
      } else {
        const parsed = parseFloat(value);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) {
          setFormData({ ...formData, aiTemperature: parsed });
        }
      }
    }}
    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
  />
  <p className="text-xs text-white/50">
    AI 回复的随机性 (0.0-2.0)，0 为完全确定性，2 为最大创造性
  </p>
</div>
```

---

### 5. src/dashboard/routes/api.js

**位置1：POST /api/ai 中添加 temperature 验证**

在 `aiContextLimit` 验证之后添加：

```javascript
if (updates.aiTemperature !== undefined) {
  const temp = parseFloat(updates.aiTemperature);
  if (isNaN(temp) || temp < 0 || temp > 2) {
    return res.status(400).json({
      error: 'aiTemperature must be between 0 and 2',
      field: 'aiTemperature',
      expected: '0.0 - 2.0'
    });
  }
  updates.aiTemperature = temp;
}
```

**位置2：POST /api/ai 中添加到 aiFields 列表**

```javascript
// 行约 833 行，添加到字段列表
const aiFields = [
  'aiApiUrl', 'aiApiKey', 'aiModel', 'aiSystemPrompt',
  'aiProbability', 'aiContextLimit', 'aiTemperature',  // ← 添加这行
  // ... 其他字段
];
```

**位置3：POST /api/ai/reset 中添加到 aiKeys 列表**

```javascript
// 行约 859 行，添加到重置列表
const aiKeys = [
  // General AI Config
  'aiApiUrl', 'aiApiKey', 'aiModel', 'aiSystemPrompt', 'aiProbability', 'aiTemperature',
  // ... 其他字段
];
```

---

### 6. src/handlers/aiHandler.js

**位置1：getReply 方法中获取 temperature**

在获取 contextLimit 之后添加：

```javascript
const contextLimit = config.getGroupConfig(groupId, 'aiContextLimit');
const context = fullContext.slice(-contextLimit);

// 添加以下代码
const temperature = config.getGroupConfig(groupId, 'aiTemperature');
```

**位置2：在 requestPayload 中添加 temperature**

修改 requestPayload：

```javascript
const requestPayload = {
  model: config.aiModel,
  messages: currentMessages,
  temperature: temperature  // ← 添加这行
};
```

---

## 修改统计

| 文件 | 修改点数 | 主要改动 |
|------|---------|---------|
| src/config.js | 1 | 添加 META 配置定义 |
| config/config.json.example | 1 | 添加示例配置 |
| dashboard/src/pages/Settings.jsx | 5 | state、加载、保存、重置、UI |
| dashboard/src/pages/Groups.jsx | 3 | formData、初始化、UI |
| src/dashboard/routes/api.js | 3 | 验证、字段列表、重置列表 |
| src/handlers/aiHandler.js | 2 | 获取配置、添加到请求 |

**总计：6 个文件，15 个修改点**

---

## 配置说明

### 温度参数取值范围

- **0.0 - 0.3**：低随机性，更确定性的输出，适合需要精确答案的场景
- **0.4 - 0.7**：中等随机性，平衡创造性和一致性（**推荐默认值**）
- **0.8 - 2.0**：高随机性，更具创造性的输出，适合创意写作等场景

### 使用优先级

1. 群组级别配置（Groups.jsx 中设置）
2. 全局默认配置（Settings.jsx 或 .env 中设置）
3. 代码默认值（1.0）

---

## 测试建议

1. 验证 .env 环境变量 `AI_TEMPERATURE` 是否正确读取
2. 验证 WebUI 全局设置是否正确保存和加载
3. 验证群组级别设置是否正确覆盖全局设置
4. 验证 temperature 参数是否正确传递到 AI API 请求中
5. 验证边界值（0 和 2）是否正常工作
