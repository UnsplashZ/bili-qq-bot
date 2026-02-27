# QQ 视频封面异常修复计划

- 日期: 2026-02-27
- 目标: 修复“下载后在 QQ 中视频封面显示异常（显示已过期），但点击可播放”的问题。

## 背景

当前群聊下载视频通过 `send_group_forward_msg` 发送，视频位于合并转发节点内。用户反馈该形态下封面异常。
同时 Python 下载器输出 MP4 时未统一设置 `faststart`，可能影响客户端预览信息解析。

## 方案

1. 调整群聊发送路径为 `send_group_msg` 普通视频消息（私聊保持 `send_private_msg`）。
2. Python 端对输出文件统一增强兼容性：
   - DASH 合并增加 `-movflags +faststart`
   - 单流下载后尝试 ffmpeg 重封装为 `faststart` MP4，失败回退原始流
3. 更新并执行相关单元测试。

## 影响范围

- `src/services/videoDownloadService.js`
- `src/services/bili_server.py`
- `test/unit/videoDownload-privateRoute.test.js`

## 风险与回退

- 风险: 群聊消息形态从“合并转发”改为“普通视频消息”。
- 回退: 若出现兼容性问题，可恢复群聊 action 为 `send_group_forward_msg`。

## 验证

- `node test/unit/videoDownload-privateRoute.test.js`
- `node test/unit/videoDownloadConfig.test.js`
- `python3 -m py_compile src/services/bili_server.py`

## 实施结果

- 已将群聊下载视频发送改为 `send_group_msg`，避免合并转发中的视频封面异常展示。
- 已在 Python 下载器输出链路补充 `faststart` MP4 处理（DASH 与单流场景）。
- 以上 3 项验证命令均执行通过。
