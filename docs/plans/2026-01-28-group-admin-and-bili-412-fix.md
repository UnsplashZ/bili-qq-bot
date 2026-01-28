# 群组管理员设置与 B站412错误修复设计方案

日期: 2026-01-28

## 概述

本文档描述两个功能的详细设计方案：
1. **群组管理员设置**：在 WebUI 中添加管理员管理界面
2. **B站412错误修复**：修复云服务器启动时的请求风控问题

---

## 问题1：群组管理员设置

### 1.1 现状分析

**后端支持情况（已完整）：**
- `config.js` 第379行：`ensureGroupConfig()` 初始化 `admins: []` 数组
- `config.js` 第285-328行：`addGroupAdmin()` / `removeGroupAdmin()` / `isGroupAdmin()` 方法
- `api.js` 第182-249行：`POST /api/groups/:id/config` 接口支持保存 admins 数组
- 数据存储：`config.json` 中 `groupConfigs[groupId].admins`

**前端缺失部分：**
- `Groups.jsx` 有5个标签页，没有管理员设置界面
- 需要添加独立的「管理员」标签页

### 1.2 功能设计

#### 1.2.1 UI 布局

在 `Groups.jsx` 的 `categories` 数组中添加管理员标签：

```javascript
const categories = [
  { name: '常规', icon: Settings },
  { name: '订阅', icon: Bell },
  { name: '黑名单', icon: Ban },
  { name: '管理员', icon: Shield },  // 新增
  { name: 'AI 设置', icon: Cpu },
  { name: '关注列表同步', icon: RefreshCw },
];
```

管理员标签页布局：
- **顶部说明**：显示当前管理员权限说明
- **添加区域**：输入框 + 添加按钮
- **管理员列表**：卡片式展示，显示 QQ 号和移除按钮

#### 1.2.2 交互逻辑

**添加管理员：**
1. 用户在输入框输入 QQ 号
2. 点击"添加"按钮或按 Enter 键
3. 前端验证：非空、非重复
4. 调用 `/api/groups/:id/config` 保存 `{ admins: [...] }`
5. 乐观更新列表，失败时回滚

**移除管理员：**
1. 点击管理员卡片的"移除"按钮
2. 弹出确认对话框（可选）
3. 调用 `/api/groups/:id/config` 保存更新后的列表
4. 从本地状态移除

**权限说明：**
- 显示提示：管理员可以使用所有机器人指令，不受其他限制
- 显示根管理员（`ADMIN_QQ`）提示（如果配置了）

### 1.3 实现细节

#### 1.3.1 前端状态扩展

在 `Groups.jsx` 中添加状态：

```javascript
// Admin State
const [adminInput, setAdminInput] = useState('');
```

#### 1.3.2 管理员标签页组件

```jsx
{/* Admin Tab */}
<Tab.Panel className="focus:outline-none">
  <div className="space-y-6">
    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
      <p className="text-sm text-white/70">
        群组管理员可以使用所有机器人指令，不受其他限制。
        {sysConfig.adminQQ && (
          <span className="block mt-2">
            根管理员: {sysConfig.adminQQ}
          </span>
        )}
      </p>
    </div>

    {/* 添加管理员 */}
    <div className="flex gap-2">
      <input
        type="text"
        placeholder="输入 QQ 号..."
        value={adminInput}
        onChange={(e) => setAdminInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleAddAdmin()}
        className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
      />
      <button
        onClick={handleAddAdmin}
        disabled={!adminInput}
        className="px-4 py-2 bg-yellow-600/20 text-yellow-300 border border-yellow-500/30 hover:bg-yellow-600/30 rounded-lg transition-colors disabled:opacity-50"
      >
        添加
      </button>
    </div>

    {/* 管理员列表 */}
    <div className="space-y-2">
      {formData.admins && formData.admins.length > 0 ? (
        formData.admins.map((qq) => (
          <div key={qq} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg p-3">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-yellow-400" />
              <span className="font-mono text-white">{qq}</span>
            </div>
            <button
              onClick={() => handleRemoveAdmin(qq)}
              className="text-gray-400 hover:text-red-400 transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))
      ) : (
        <div className="text-center text-gray-500 py-4">
          暂无管理员
        </div>
      )}
    </div>
  </div>
</Tab.Panel>
```

#### 1.3.3 处理函数

```javascript
const handleAddAdmin = () => {
  if (!adminInput) return;
  if (formData.admins?.includes(adminInput)) {
    show('该 QQ 已是管理员', 'error');
    return;
  }

  const newAdmins = [...(formData.admins || []), adminInput];
  handleUpdateAdmins(newAdmins);
  setAdminInput('');
  show('管理员已添加', 'success');
};

const handleRemoveAdmin = (qq) => {
  const newAdmins = (formData.admins || []).filter(a => a !== qq);
  handleUpdateAdmins(newAdmins);
  show('管理员已移除', 'success');
};

const handleUpdateAdmins = async (newAdmins) => {
  try {
    await api.post(`/api/groups/${selectedGroupId}/config`, { admins: newAdmins });
    setFormData(prev => ({ ...prev, admins: newAdmins }));
  } catch (err) {
    show('更新管理员失败', 'error');
  }
};
```

### 1.4 数据流

```
用户输入 QQ 号
    ↓
前端验证（非空、非重复）
    ↓
POST /api/groups/:id/config { admins: [...] }
    ↓
后端 sysConfig.groupConfigs[groupId].admins = [...]
    ↓
config.json 保存（debounce 500ms）
    ↓
前端列表更新
```

---

## 问题3：B站412错误修复

### 2.1 问题分析

**现象：**
- 云服务器启动时所有 Bilibili 请求返回 HTTP 412
- 登录后恢复正常

**412 错误原因：**
HTTP 412 "Precondition Failed" 通常是以下情况：
1. **BUVID3 缺失/无效**：B站设备指纹验证失败
2. **IP 变化检测**：B站检测到环境 IP 变化
3. **请求头不完整**：缺少必要的 Referer/Origin 等头部

**代码现状分析：**

| 项目 | 状态 | 说明 |
|------|------|------|
| User-Agent | ✅ 已配置 | Chrome 120 伪装 |
| Referer | ✅ 已配置 | bilibili.com |
| Origin | ✅ 已配置 | bilibili.com |
| bili_ticket | ✅ 已启用 | 防风控 |
| BUVID3 | ⚠️ 有问题 | Cookie 未正确保存/加载 |

**核心问题定位：**

`bili_server.py` 第60-67行 `load_credential()` 函数：

```python
def load_credential(group_id=None):
    file_path = get_credential_file(group_id)
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
            return Credential(
                sessdata=data.get('SESSDATA'),
                bili_jct=data.get('BILI_JCT'),
                buvid3=data.get('BUVID3')  # ← 问题在这里
            )
    except FileNotFoundError:
        return None
```

问题：Cookie 文件中可能没有保存 BUVID3，或者 BUVID3 已过期。

### 2.2 解决方案

#### 方案A：增强 BUVID3 获取（推荐）

**原理：** B站 API 会自动返回 BUVID3，需要正确保存和加载。

**实现步骤：**

1. **修改登录流程：** 确保登录时完整保存所有 Cookie 字段

```python
def save_credential(credential, group_id=None):
    # ... existing code ...

    # 确保 BUVID3 被保存
    with open(target_file, 'w') as f:
        json.dump({
            'SESSDATA': credential.sessdata,
            'BILI_JCT': credential.bili_jct,
            'BUVID3': credential.buvid3,  # 确保保存
            '_timestamp': int(time.time())  # 添加时间戳
        }, f)
```

2. **添加 BUVID3 自动刷新：** 如果 BUVID3 缺失或无效，自动获取

```python
async def refresh_buvid3(credential):
    """
    自动获取新的 BUVID3
    通过访问 B站首页触发 cookie 生成
    """
    try:
        url = "https://www.bilibili.com"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                # 从响应头或 cookies 中提取 BUVID3
                cookies = resp.cookies
                for cookie in cookies:
                    if cookie.key == 'buvid3':
                        credential.buvid3 = cookie.value
                        logger.info("成功刷新 BUVID3")
                        return True
        return False
    except Exception as e:
        logger.error(f"刷新 BUVID3 失败: {e}")
        return False
```

3. **修改 load_credential：** 添加 BUVID3 验证和自动刷新

```python
def load_credential(group_id=None):
    file_path = get_credential_file(group_id)
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
            sessdata = data.get('SESSDATA')
            bili_jct = data.get('BILI_JCT')
            buvid3 = data.get('BUVID3')

            # 检查 BUVID3 是否存在
            if not buvid3:
                logger.warning(f"BUVID3 缺失 (group_id: {group_id})，尝试刷新...")
                # 标记需要刷新（实际刷新在异步上下文中进行）
                return Credential(sessdata=sessdata, bili_jct=bili_jct, buvid3=None)

            # 检查是否过期（7天）
            timestamp = data.get('_timestamp', 0)
            if time.time() - timestamp > 7 * 24 * 3600:
                logger.warning(f"Cookie 可能已过期 (group_id: {group_id})")
                # 可以标记需要重新登录

            return Credential(
                sessdata=sessdata,
                bili_jct=bili_jct,
                buvid3=buvid3
            )
    except FileNotFoundError:
        return None
```

#### 方案B：添加请求重试机制（补充）

**原理：** 412 错误时自动重试，期间刷新 BUVID3。

```python
import asyncio

async def fetch_with_retry(api_func, max_retries=3):
    """
    带重试的 API 调用包装器
    """
    for attempt in range(max_retries):
        try:
            return await api_func()
        except Exception as e:
            error_msg = str(e)
            # 检查是否是 412 相关错误
            if '412' in error_msg or 'precondition' in error_msg.lower():
                logger.warning(f"遇到 412 错误，尝试重试 ({attempt + 1}/{max_retries})")

                if attempt < max_retries - 1:
                    # 等待后重试
                    await asyncio.sleep(2)
                    continue
            raise e
```

#### 方案C：改进请求头配置（现有增强）

**原理：** 添加更多浏览器特征，提高通过率。

```python
# 在 bili_server.py 顶部添加更完整的请求头
bilibili_api.HEADERS.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.bilibili.com',
    'Origin': 'https://www.bilibili.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
})
```

### 2.3 完整实现方案

**推荐组合：方案A + 方案C**

1. 确保 BUVID3 正确保存和加载
2. 添加更完整的请求头
3. 添加 412 错误检测和日志

**修改文件：** `src/services/bili_server.py`

**修改点：**

1. 第60-67行：修改 `load_credential()` 添加 BUVID3 验证
2. 第69-95行：修改 `save_credential()` 添加时间戳
3. 第19-25行：增强请求头配置

### 2.4 验证方法

1. **本地测试：** 删除 Cookie 文件，重新登录，检查 BUVID3 是否被保存
2. **云服务器测试：** 重启服务，检查是否还有 412 错误
3. **日志检查：** 查看日志中是否有 "BUVID3 缺失" 或类似警告

---

## 实现优先级

| 问题 | 优先级 | 预计工作量 |
|------|--------|-----------|
| 问题1：群组管理员设置 | 高 | 2-3 小时 |
| 问题3：B站412错误修复 | 高 | 1-2 小时 |

## 风险与注意事项

1. **管理员权限：** 确保管理员权限检查在所有敏感操作中生效
2. **Cookie 安全：** BUVID3 不含敏感信息，可以正常保存
3. **向后兼容：** 确保旧 Cookie 文件格式仍能正常加载
4. **错误处理：** 412 错误不应导致程序崩溃，应该优雅降级
