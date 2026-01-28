# 全局Cookie功能实现计划

**日期**: 2026-01-28
**功能**: WebUI系统设置-全局Cookie管理
**优先级**: 群组Cookie > 全局Cookie > 无Cookie

---

## 功能概述

### 目标
在Dashboard的系统设置页面添加B站全局Cookie管理功能，为所有未单独登录的群组提供统一的B站凭证。

### 用户价值
- **简化管理**: 不需要为每个群组单独登录B站
- **统一凭证**: 新加入的群组自动使用全局Cookie
- **灵活性**: 支持群组级别覆盖（群组Cookie优先）

### Cookie调用优先级
```
请求B站API
  ↓
1. 检查群组Cookie (data/cookies_{group_id}.json)
   ↓ 存在 → 使用群组Cookie
   ↓ 不存在
2. 检查全局Cookie (data/cookies.json)
   ↓ 存在 → 使用全局Cookie
   ↓ 不存在
3. 无Cookie → 匿名访问（部分API可能失败）
```

---

## 架构设计

### 1. 数据流
```
┌─────────────────┐
│ Settings.jsx    │ (前端UI)
│ - 显示登录状态  │
│ - 扫码登录      │
│ - 退出登录      │
└────────┬────────┘
         │ HTTP API
         ↓
┌─────────────────┐
│ api.js          │ (Express路由)
│ GET /bili/      │
│   global-status │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ biliApi.js      │ (Node.js封装)
│ getGlobalCred   │
│ entialInfo()    │
└────────┬────────┘
         │ HTTP
         ↓
┌─────────────────┐
│ bili_server.py  │ (Python服务)
│ POST /credential│
│      -info      │
│ load_credential │
│   (group_id)    │
└─────────────────┘
         │
         ↓
┌─────────────────┐
│ bilibili_api    │ (官方SDK)
│ User.get_user_  │
│      info()     │
└─────────────────┘
```

### 2. 文件结构
```
data/
├── cookies.json              # 全局Cookie (新增使用)
├── cookies_{group_id}.json   # 群组Cookie (现有)
└── cookies_map.json          # 群组映射 (现有)
```

---

## 实施步骤

### Phase 1: Python服务层修改 (bili_server.py)

#### 1.1 修改 `load_credential()` 函数
**位置**: Line 69-96
**改动**: 添加fallback逻辑

```python
def load_credential(group_id=None):
    """
    加载B站凭证，优先级：群组Cookie > 全局Cookie

    Args:
        group_id: 群组ID，None表示加载全局Cookie

    Returns:
        Credential对象或None
    """
    credential = None

    # 优先尝试加载群组Cookie
    if group_id:
        file_path = get_credential_file(group_id)
        if os.path.exists(file_path):
            try:
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    sessdata = data.get('SESSDATA')
                    bili_jct = data.get('BILI_JCT')
                    buvid3 = data.get('BUVID3')

                    if not buvid3:
                        logger.warning(f"BUVID3 缺失 (group_id: {group_id}, file: {file_path})")

                    timestamp = data.get('_timestamp', 0)
                    if timestamp:
                        age_days = (time.time() - timestamp) / (24 * 3600)
                        if age_days > 7:
                            logger.warning(f"Cookie 可能已过期 (group_id: {group_id}, age: {age_days:.1f} 天)")

                    credential = Credential(
                        sessdata=sessdata,
                        bili_jct=bili_jct,
                        buvid3=buvid3
                    )
                    logger.debug(f"使用群组Cookie: {group_id}")
                    return credential
            except Exception as e:
                logger.error(f"加载群组Cookie失败 (group_id: {group_id}): {e}")

        # 群组Cookie不存在，尝试fallback
        logger.info(f"群组 {group_id} Cookie不存在，尝试使用全局Cookie")

    # 加载全局Cookie
    if os.path.exists(CREDENTIAL_FILE):
        try:
            with open(CREDENTIAL_FILE, 'r') as f:
                data = json.load(f)
                sessdata = data.get('SESSDATA')
                bili_jct = data.get('BILI_JCT')
                buvid3 = data.get('BUVID3')

                if not buvid3:
                    logger.warning(f"全局Cookie BUVID3 缺失")

                timestamp = data.get('_timestamp', 0)
                if timestamp:
                    age_days = (time.time() - timestamp) / (24 * 3600)
                    if age_days > 7:
                        logger.warning(f"全局Cookie 可能已过期 (age: {age_days:.1f} 天)")

                credential = Credential(
                    sessdata=sessdata,
                    bili_jct=bili_jct,
                    buvid3=buvid3
                )
                logger.debug("使用全局Cookie")
                return credential
        except Exception as e:
            logger.error(f"加载全局Cookie失败: {e}")

    logger.debug("未找到可用的Cookie")
    return None
```

#### 1.2 新增 `/credential-info` 端点
**位置**: 在路由注册区域添加 (Line ~1330)

```python
async def handle_credential_info(request):
    """
    获取Cookie对应的用户信息

    Request Body:
        {
            "group_id": "123456" (可选，用于测试特定群组Cookie)
        }

    Response:
        {
            "status": "success",
            "data": {
                "uid": 123456,
                "username": "用户名",
                "is_logged_in": true,
                "timestamp": 1706428800
            }
        }
    """
    try:
        data = await request.json()
        group_id = data.get('group_id')

        # 加载凭证
        credential = load_credential(group_id)
        if not credential:
            return web.json_response({
                'status': 'error',
                'message': 'No credential found'
            })

        # 获取用户信息
        u = user.User(credential=credential)
        info = await u.get_user_info()

        return web.json_response({
            'status': 'success',
            'data': {
                'uid': info['mid'],
                'username': info['name'],
                'is_logged_in': True,
                'timestamp': int(time.time())
            }
        })
    except Exception as e:
        logger.error(f"获取凭证信息失败: {e}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            'status': 'error',
            'message': str(e)
        })

# 在路由注册处添加
app.add_routes([
    # ... 现有路由
    web.post('/credential-info', handle_credential_info),
])
```

#### 1.3 BugFix: 修复动态详情中的子查询
**位置 1**: Line 774
```python
# 修改前
u = user.User(uid=int(author_uid), credential=load_credential())

# 修改后
u = user.User(uid=int(author_uid), credential=load_credential(group_id))
```

**位置 2**: Line 826
```python
# 修改前
vv = vote_api.Vote(vote_id=int(vote_id), credential=load_credential())

# 修改后
vv = vote_api.Vote(vote_id=int(vote_id), credential=load_credential(group_id))
```

**注意**: 需要确保 `group_id` 参数在这些代码段中可访问（应该已经通过函数参数传递）

---

### Phase 2: Node.js API层修改

#### 2.1 biliApi.js 新增方法
**文件**: `src/services/biliApi.js`
**位置**: 在类的末尾添加

```javascript
/**
 * 获取全局Cookie的用户信息
 * @returns {Promise<{status: string, data?: {uid, username, is_logged_in, timestamp}, message?: string}>}
 */
async getGlobalCredentialInfo() {
    return this._withCache('global_credential_info', 'global', null, async () => {
        try {
            const result = await serviceManager.sendCommand('credential_info', {});
            // 短期缓存（60秒），避免频繁查询
            return result;
        } catch (error) {
            return {
                status: 'error',
                message: error.message || 'Failed to fetch credential info'
            };
        }
    });
}
```

**导出**: 在 `module.exports` 中添加此方法

#### 2.2 Dashboard API 新增端点
**文件**: `src/dashboard/routes/api.js`
**位置**: 在 `/api/bili/` 路由组中添加

```javascript
// GET /api/bili/global-status - 获取全局Cookie登录状态
router.get('/bili/global-status', authenticateToken, async (req, res) => {
    try {
        const result = await biliApi.getGlobalCredentialInfo();

        if (result.status === 'success') {
            res.json({
                isLoggedIn: true,
                uid: result.data.uid,
                username: result.data.username,
                timestamp: result.data.timestamp
            });
        } else {
            // Cookie不存在或失效
            res.json({
                isLoggedIn: false,
                message: result.message || 'Not logged in'
            });
        }
    } catch (error) {
        logger.error('Error fetching global Bilibili status:', error);
        res.status(500).json({
            isLoggedIn: false,
            error: 'Failed to check login status'
        });
    }
});
```

**验证**: 确认 `POST /api/bili/logout` 已支持不传 `groupId` 参数（当前实现已支持，Line 306-344）

---

### Phase 3: 前端UI实现

#### 3.1 Settings.jsx 状态管理
**文件**: `dashboard/src/pages/Settings.jsx`
**位置**: 在组件顶部state声明区域

```javascript
// B站全局Cookie状态
const [biliGlobalStatus, setBiliGlobalStatus] = useState({
    isLoggedIn: false,
    uid: null,
    username: '',
    timestamp: null
});
const [biliLoading, setBiliLoading] = useState(false);
const [qrCodeUrl, setQrCodeUrl] = useState('');
const [isQrModalOpen, setIsQrModalOpen] = useState(false);
const [qrKey, setQrKey] = useState('');
const [qrPollInterval, setQrPollInterval] = useState(null);
```

#### 3.2 数据加载
**位置**: 修改现有的 `useEffect` (Line 66-140)

```javascript
useEffect(() => {
    const fetchData = async () => {
        try {
            setLoading(true);
            const [configRes, mcpRes, blacklistRes, biliStatusRes] = await Promise.all([
                api.get('/api/config'),
                api.get('/api/mcp'),
                api.get('/api/blacklist/global'),
                api.get('/api/bili/global-status')  // 新增
            ]);

            // ... 现有代码 ...

            // 设置B站全局状态
            if (biliStatusRes.data.isLoggedIn) {
                setBiliGlobalStatus({
                    isLoggedIn: true,
                    uid: biliStatusRes.data.uid,
                    username: biliStatusRes.data.username,
                    timestamp: biliStatusRes.data.timestamp
                });
            } else {
                setBiliGlobalStatus({
                    isLoggedIn: false,
                    uid: null,
                    username: '',
                    timestamp: null
                });
            }
        } catch (error) {
            console.error("Failed to load settings:", error);
            show("加载设置失败", "error");
        } finally {
            setLoading(false);
        }
    };
    fetchData();
}, [show]);
```

#### 3.3 事件处理函数
**位置**: 在组件内部添加（建议放在其他handler后面）

```javascript
// 处理全局Cookie登录
const handleBiliGlobalLogin = async () => {
    setBiliLoading(true);
    try {
        // 获取二维码 (不传groupId)
        const res = await api.get('/api/bili/login-url');
        setQrCodeUrl(res.data.url);
        setQrKey(res.data.authCode);
        setIsQrModalOpen(true);

        // 开始轮询登录状态
        startQrPolling();
    } catch (error) {
        console.error('Failed to get QR code:', error);
        show('获取二维码失败', 'error');
        setBiliLoading(false);
    }
};

// 轮询登录状态
const startQrPolling = () => {
    let attempts = 0;
    const maxAttempts = 30; // 60秒超时 (2秒间隔)

    const interval = setInterval(async () => {
        attempts++;

        if (attempts > maxAttempts) {
            clearInterval(interval);
            setIsQrModalOpen(false);
            setBiliLoading(false);
            show('登录超时，请重试', 'error');
            return;
        }

        try {
            const statusRes = await api.post('/api/bili/check-login', {
                authCode: qrKey
                // 不传groupId，表示全局登录
            });

            if (statusRes.data.status === 'success') {
                clearInterval(interval);
                setIsQrModalOpen(false);
                setBiliLoading(false);
                show('B站全局登录成功！', 'success');

                // 刷新登录状态
                const newStatus = await api.get('/api/bili/global-status');
                setBiliGlobalStatus({
                    isLoggedIn: true,
                    uid: newStatus.data.uid,
                    username: newStatus.data.username,
                    timestamp: newStatus.data.timestamp
                });
            } else if (statusRes.data.status === 'expired') {
                clearInterval(interval);
                setBiliLoading(false);
                show('二维码已过期', 'error');
                setIsQrModalOpen(false);
            }
        } catch (error) {
            clearInterval(interval);
            setBiliLoading(false);
            console.error('Login polling error:', error);
            setIsQrModalOpen(false);
            show('登录检查失败', 'error');
        }
    }, 2000);

    setQrPollInterval(interval);
};

// 处理退出登录
const handleBiliGlobalLogout = async () => {
    if (!window.confirm('确定要退出全局B站登录吗？这将影响所有未单独登录的群组。')) {
        return;
    }

    setBiliLoading(true);
    try {
        await api.post('/api/bili/logout', {});  // 不传groupId表示退出全局登录
        setBiliGlobalStatus({
            isLoggedIn: false,
            uid: null,
            username: '',
            timestamp: null
        });
        show('已退出B站全局登录', 'success');
    } catch (error) {
        console.error('Failed to logout:', error);
        show('退出登录失败', 'error');
    } finally {
        setBiliLoading(false);
    }
};

// 清理轮询（组件卸载时）
useEffect(() => {
    return () => {
        if (qrPollInterval) {
            clearInterval(qrPollInterval);
        }
    };
}, [qrPollInterval]);
```

#### 3.4 UI组件
**位置**: 在 `<section>` 标签中，建议放在"常规设置"后、"全局黑名单"前

```jsx
{/* B站全局Cookie Section */}
<section>
    <div className="flex items-center gap-2 mb-4">
        <svg
            className="w-5 h-5 text-pink-400"
            viewBox="0 0 24 24"
            fill="currentColor"
        >
            <path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373z"/>
        </svg>
        <h2 className="text-xl font-semibold text-white">B站全局Cookie</h2>
    </div>
    <GlassCard>
        <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg p-4 mb-4">
            <p className="text-sm text-white/70">
                全局Cookie用于所有未单独登录的群组。优先级：群组Cookie &gt; 全局Cookie
            </p>
        </div>

        {biliGlobalStatus.isLoggedIn ? (
            // 已登录状态
            <div className="space-y-4">
                <div className="flex items-center justify-between bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
                        <div>
                            <p className="text-white font-medium">
                                {biliGlobalStatus.username}{' '}
                                <span className="text-gray-400">
                                    (UID: {biliGlobalStatus.uid})
                                </span>
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                                更新时间：{biliGlobalStatus.timestamp
                                    ? new Date(biliGlobalStatus.timestamp * 1000).toLocaleString('zh-CN')
                                    : '未知'
                                }
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleBiliGlobalLogout}
                            disabled={biliLoading}
                            className="px-3 py-1.5 bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-sm transition-colors disabled:opacity-50"
                        >
                            退出登录
                        </button>
                        <button
                            onClick={handleBiliGlobalLogin}
                            disabled={biliLoading}
                            className="px-3 py-1.5 bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 border border-pink-500/30 rounded-lg text-sm transition-colors disabled:opacity-50"
                        >
                            重新登录
                        </button>
                    </div>
                </div>
            </div>
        ) : (
            // 未登录状态
            <div className="flex items-center justify-between bg-gray-500/10 border border-gray-500/20 rounded-lg p-4">
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-gray-500" />
                    <p className="text-gray-400">未登录</p>
                </div>
                <button
                    onClick={handleBiliGlobalLogin}
                    disabled={biliLoading}
                    className="px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                    {biliLoading ? '加载中...' : '扫码登录'}
                </button>
            </div>
        )}
    </GlassCard>
</section>
```

#### 3.5 二维码弹窗
**位置**: 在组件末尾，其他Modal之后

```jsx
{/* QR Code Modal for Global Login */}
<GlassModal
    isOpen={isQrModalOpen}
    onClose={() => {
        setIsQrModalOpen(false);
        setBiliLoading(false);
        if (qrPollInterval) {
            clearInterval(qrPollInterval);
            setQrPollInterval(null);
        }
    }}
    title="扫码登录 B 站（全局）"
>
    <div className="flex flex-col items-center space-y-4">
        <p className="text-gray-300 text-sm text-center">
            请使用 B 站 App 扫描下方二维码完成登录
        </p>
        {qrCodeUrl && (
            <img
                src={qrCodeUrl}
                alt="QR Code"
                className="w-64 h-64 border-2 border-white/20 rounded-lg"
            />
        )}
        <div className="flex items-center gap-2 text-blue-400">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-400 border-t-transparent" />
            <span className="text-sm">等待扫码...</span>
        </div>
        <p className="text-xs text-gray-500">
            二维码有效期60秒，超时请重新获取
        </p>
    </div>
</GlassModal>
```

---

## 测试计划

### 单元测试

#### Python层测试
```python
# 测试 load_credential() fallback逻辑
def test_load_credential_fallback():
    # 1. 测试群组Cookie存在时优先使用
    assert load_credential('123456') is not None

    # 2. 测试群组Cookie不存在时fallback到全局
    assert load_credential('999999') is not None  # 假设999999无群组Cookie

    # 3. 测试全局Cookie不存在时返回None
    # (需要临时移除cookies.json文件)

# 测试 /credential-info 端点
async def test_credential_info_endpoint():
    # 1. 测试有效Cookie
    resp = await client.post('/credential-info', json={})
    assert resp.status == 'success'
    assert 'uid' in resp.data

    # 2. 测试无Cookie场景
    # (需要临时移除所有Cookie文件)
```

#### Node.js层测试
```javascript
// 测试 getGlobalCredentialInfo()
describe('biliApi.getGlobalCredentialInfo', () => {
    it('should return user info when logged in', async () => {
        const result = await biliApi.getGlobalCredentialInfo();
        expect(result.status).toBe('success');
        expect(result.data).toHaveProperty('uid');
        expect(result.data).toHaveProperty('username');
    });

    it('should return error when not logged in', async () => {
        // Mock: 移除Cookie文件
        const result = await biliApi.getGlobalCredentialInfo();
        expect(result.status).toBe('error');
    });
});
```

### 集成测试

#### 场景1: 全局Cookie登录流程
1. 访问 `http://localhost:3000/settings`
2. 确认显示"未登录"状态
3. 点击"扫码登录"按钮
4. 使用B站App扫描二维码
5. 确认登录成功，显示用户名和UID
6. 刷新页面，确认状态持久化

#### 场景2: Cookie优先级验证
1. 全局登录账号A
2. 某群组单独登录账号B
3. 发送该群组的B站链接，确认使用账号B的Cookie
4. 发送其他未登录群组的B站链接，确认使用账号A的Cookie
5. 退出全局登录
6. 发送未登录群组的B站链接，确认降级为匿名访问

#### 场景3: 动态详情子查询BugFix验证
1. 全局登录
2. 在未单独登录的群组中发送包含投票的动态链接
3. 确认投票信息正确显示（使用全局Cookie）
4. 确认作者装饰和等级信息正确显示（使用全局Cookie）

#### 场景4: 订阅功能验证
1. 全局登录
2. 在未单独登录的群组添加订阅
3. 确认订阅查询使用全局Cookie
4. 确认推送消息正常

### 边界测试

1. **Cookie过期场景**
   - 使用7天前的Cookie
   - 确认警告日志输出
   - 确认功能是否正常降级

2. **并发请求**
   - 多个群组同时请求B站API
   - 确认Cookie加载逻辑无竞态条件

3. **文件权限问题**
   - 模拟 `data/cookies.json` 无读权限
   - 确认优雅降级，不影响其他功能

4. **恶意Cookie数据**
   - 写入格式错误的JSON
   - 确认解析异常被捕获，不会导致服务崩溃

---

## 回滚方案

如果出现严重问题，可按以下步骤回滚：

### 代码回滚
```bash
# 1. 回滚到功能开发前的commit
git log --oneline | head -10  # 找到目标commit
git revert <commit-hash>

# 2. 或使用分支策略
git checkout main
git branch -D feat/global-cookie
```

### 数据回滚
```bash
# 全局Cookie不影响现有群组Cookie
# 只需删除全局Cookie文件即可
rm data/cookies.json
```

### 服务重启
```bash
# Docker环境
docker-compose restart bili-qq-bot

# 本地环境
npm restart
```

---

## 风险评估

### 高风险点
1. **Python `load_credential()` 修改**
   - 影响范围: 所有B站API调用
   - 缓解措施: 充分的单元测试 + 灰度发布
   - 回滚难度: 低（单函数修改）

2. **动态详情子查询BugFix**
   - 影响范围: 动态卡片渲染
   - 缓解措施: 对比修改前后的输出
   - 回滚难度: 低（两行代码）

### 中风险点
1. **前端轮询逻辑**
   - 可能问题: 内存泄漏（未清理interval）
   - 缓解措施: useEffect清理函数
   - 回滚难度: 低（前端独立模块）

2. **缓存策略**
   - 可能问题: 全局Cookie信息缓存过期
   - 缓解措施: 设置短TTL（60秒）
   - 回滚难度: 低（仅影响查询性能）

### 低风险点
1. **UI布局调整**
   - 影响范围: 仅Settings页面
   - 回滚难度: 极低（前端独立）

---

## 上线检查清单

### 开发阶段
- [ ] Python服务层修改完成
- [ ] Node.js API层修改完成
- [ ] 前端UI开发完成
- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 代码审查完成

### 测试阶段
- [ ] 本地环境测试通过
- [ ] Docker环境测试通过
- [ ] 边界场景测试通过
- [ ] 性能测试通过（无明显延迟）
- [ ] 回滚流程验证

### 部署阶段
- [ ] 备份现有配置和数据
- [ ] 更新代码到生产环境
- [ ] 重启服务
- [ ] 验证基础功能（链接解析、订阅）
- [ ] 验证新功能（全局Cookie登录）
- [ ] 监控日志输出

### 文档阶段
- [ ] 更新 CLAUDE.md（如需要）
- [ ] 更新用户文档/README
- [ ] 记录已知问题和限制
- [ ] 更新API文档（如有）

---

## 预期工作量

- **Python开发**: 2-3小时
- **Node.js开发**: 1小时
- **前端开发**: 2-3小时
- **测试**: 2小时
- **文档**: 1小时
- **总计**: 8-10小时

---

## 附录

### 相关文件清单
```
src/
├── services/
│   ├── bili_server.py          # Python服务（主要修改）
│   ├── biliApi.js              # Node.js封装（新增方法）
│   └── ServiceManager.js       # 无需修改
├── dashboard/
│   └── routes/
│       └── api.js              # Dashboard API（新增端点）
dashboard/
└── src/
    └── pages/
        └── Settings.jsx        # 设置页面（主要UI修改）
data/
└── cookies.json                # 全局Cookie存储
```

### API端点对照表
| 端点 | 方法 | 参数 | 返回 | 用途 |
|------|------|------|------|------|
| `/credential-info` | POST | `{group_id?}` | `{status, data: {uid, username, ...}}` | Python: 获取Cookie用户信息 |
| `/api/bili/global-status` | GET | - | `{isLoggedIn, uid?, username?, ...}` | Express: 查询全局Cookie状态 |
| `/api/bili/login-url` | GET | - | `{url, authCode}` | 现有: 获取登录二维码（复用） |
| `/api/bili/check-login` | POST | `{authCode, groupId?}` | `{status}` | 现有: 检查登录状态（复用） |
| `/api/bili/logout` | POST | `{groupId?}` | `{success}` | 现有: 退出登录（复用） |

### 日志关键字
便于调试和监控，建议搜索以下关键字：
- `使用群组Cookie`
- `使用全局Cookie`
- `未找到可用的Cookie`
- `群组 {id} Cookie不存在，尝试使用全局Cookie`
- `全局Cookie BUVID3 缺失`
- `获取凭证信息失败`
