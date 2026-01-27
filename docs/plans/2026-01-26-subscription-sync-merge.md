 # 订阅检查合并与关注同步修复方案
 
 ## 背景
 当前订阅检查流程将“关注同步”与“群订阅”分开处理，导致群订阅但未关注的用户不会被 feed 流检测。同时，关注同步数据中旧记录缺少 lastDynamicId、lastLiveStatus 字段，造成状态无法持久化。feed 处理使用 mid 作为匹配键，也会让仅含 uid 字段的同步关注用户无法命中。
 
 ## 目标
 - 群订阅用户与关注同步用户统一合并去重后进行检测
 - 合并后按是否在关注列表分流：在关注列表内走 feed，列表外走 uid 单点查询
 - 关注同步数据在加载与刷新时归一化状态字段
 - feed 与状态更新统一 ID 匹配策略，避免 uid/mid 不一致
 
 ## 范围
 - 订阅检查流程：updateChecker.js
 - 关注同步数据状态：subscriptionManager.js
 - 订阅服务/命令层仅保持接口兼容，不新增外部行为
 
 ## 方案
 ### 1. 订阅检查流程合并与分流
 - 从群订阅获取用户列表
 - 从关注同步分组获取用户列表
 - 合并并去重为 mergedIds
 - 对 mergedIds 判断是否在关注列表中
 - inFollowListIds：并行调用 feed 动态与直播
 - notInFollowListIds：串行调用 uid 动态与直播
 
 ### 2. 关注同步状态字段归一化
 - setCookieFollowings 合并新旧列表时，若缺失状态字段补默认值
 - _loadFollowers 读取历史文件后，对已存 followings 进行一次归一化补齐
 
 ### 3. 统一 ID 匹配策略
 - followerMap 的键使用 mid|uid|id 优先级统一生成
 - feed 作者匹配与状态更新保持同一策略
 
 ## 预期修改点
 - updateChecker.js
   - checkAll：新增合并与分流逻辑，替代当前串行遍历 userSubs 的方式
   - processDynamicFeed/processLiveFeed：使用统一 ID 生成逻辑构建 followerMap
 - subscriptionManager.js
   - _loadFollowers：在读取后补齐 lastDynamicId 与 lastLiveStatus
   - setCookieFollowings：合并列表时保证状态字段存在
 
 ## 测试与验证
 - 验证关注同步用户在 feed 中可命中并更新状态
 - 验证群订阅但未关注用户走 uid 检测仍能推送
 - 运行仓库现有 lint 与 typecheck/test 脚本（以 package.json 为准）
 
 ## 风险与回滚
 - 风险：分流逻辑可能增加 UID 单点查询数量
 - 回滚：恢复 checkAll 与 feed 旧逻辑即可
