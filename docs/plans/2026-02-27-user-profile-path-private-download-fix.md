# 2026-02-27 用户画像路径安全与私聊下载发送修复方案

## 背景
本方案针对两个已确认问题：
1. `userProfileService` 基于 `groupId` 拼接文件路径，存在目录穿越风险。
2. 视频下载发送逻辑在私聊虚拟群（`private_<userId>`）场景仍走群转发接口，导致发送失败。

## 目标
- 消除用户画像文件读写的路径穿越风险。
- 让私聊场景的视频下载发送行为可预期（不再发送失败）。
- 保持现有群聊行为不变，改动最小化。

## 范围
- `src/services/userProfileService.js`
- `src/dashboard/routes/api.js`
- `src/services/videoDownloadService.js`
- （可选）`src/commands/download.js` 的提示文案

## 非目标
- 不调整视频下载核心流程（下载、清理、限流）。
- 不改动群聊 `send_group_forward_msg` 的现有行为。

## 方案一：用户画像路径安全加固

### 风险点
当前 `_profilePath(groupId)` 直接使用输入拼接 `${groupId}.json`，若上游参数未严格约束，可能通过路径片段跳出 `data/profiles`。

### 改造设计
1. **API 层输入白名单**（第一道）
   - 在画像相关路由（`GET /api/profiles/:groupId`、`DELETE /api/profiles/:groupId/:userId`）校验 `groupId`。
   - 仅允许：
     - 群：`^\d+$`
     - 若未来需要私聊画像，再显式放开：`^private_\d+$`
   - 不合法直接 `400`。

2. **Service 层路径边界校验**（第二道）
   - 新增内部方法（示意）：
     - `_validateGroupId(groupId)`
     - `_safeResolveProfilePath(groupId)`
   - 构造路径后做 `path.resolve`，并校验：
     - `resolvedPath.startsWith(path.resolve(this.dataDir) + path.sep)`
   - 不满足则抛错并拒绝读写。

3. **统一入口使用安全路径方法**
   - `_loadGroupProfiles`、`_saveGroupProfilesDebounced` 等全部改为调用 `_safeResolveProfilePath`。

### 预期结果
即使 API 层后续出现校验疏漏，Service 层仍能阻断越权文件访问。

## 方案二：私聊视频下载发送路径修复

### 风险点
`_sendForwardMessage` 固定走 `send_group_forward_msg`，并对 `groupId` 做 `Number(groupId)`。在 `private_<userId>` 下会变为 `NaN/null`，导致发送失败。

### 改造设计
1. **在 `_sendForwardMessage` 入口识别私聊虚拟群 ID**
   - 条件：`typeof groupId === 'string' && groupId.startsWith('private_')`

2. **私聊分支改用 `send_private_msg`**
   - 解析真实 `userId`：`groupId.replace('private_', '')`
   - 发送消息建议使用普通视频消息链（`type: 'video'`），不使用群转发结构。

3. **失败策略**
   - 若私聊视频不被客户端支持，降级发送文本提示（例如“私聊暂不支持该格式，请在群聊使用”），避免静默失败。

4. **群聊分支保持原状**
   - 仍使用 `send_group_forward_msg`，避免影响已上线行为。

### 预期结果
私聊触发下载时，不再出现“下载成功但发送失败”的空结果。

## 实施步骤
1. 在 `api.js` 增加 `groupId` 白名单校验函数并应用到画像路由。
2. 在 `userProfileService.js` 增加安全路径解析方法，替换直接拼接路径的调用点。
3. 在 `videoDownloadService.js` 中为 `_sendForwardMessage` 增加私聊分支与发送降级逻辑。
4. 根据最终行为补充 `/下载` 帮助文案（如私聊限制说明）。

## 测试与验证

### 单元/接口验证
1. 画像 API：
   - 合法 `groupId`（数字）返回正常。
   - 非法 `groupId`（`../x`、`%2e%2e%2f`）返回 `400`。
2. 路径安全：
   - 模拟非法 `groupId`，确认 service 抛错且不会产生越界文件。
3. 私聊下载发送：
   - root 管理员私聊发送视频链接，确认最终收到视频或明确降级提示。
4. 群聊回归：
   - 群聊链接自动下载与 `/下载 P2` 行为保持正常。

### 建议执行命令
- `node test/unit/videoDownloadConfig.test.js`
- 补充新增测试（建议）：
  - `test/unit/userProfile-pathSafety.test.js`
  - `test/unit/videoDownload-privateRoute.test.js`

## 风险与回滚
- 风险：`groupId` 校验过严可能误伤历史数据键名。
- 缓解：先记录日志并对历史键做一次检查（仅数字群 ID）。
- 回滚：本次改动均为局部逻辑分支，可按文件级回退。

## 完成标准（DoD）
- 画像路由无法通过非法 `groupId` 访问目录外文件。
- 私聊下载不再走 `send_group_forward_msg`。
- 群聊下载与转发行为无回归。
