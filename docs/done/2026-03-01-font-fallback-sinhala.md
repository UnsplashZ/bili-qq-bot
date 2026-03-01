# 字体回退链与 Docker Sinhala 覆盖改造计划

## 背景/问题
- 动态文本中的 `ෆ` 等字符在当前字体链下出现方框，容器实测确认缺字。
- 现有 Docker 构建仅安装 `fonts-noto-cjk` / `fonts-noto-color-emoji`，未保证 Sinhala 覆盖。

## 目标
- 将预览渲染默认字体链调整为：
  - `"Noto Sans CJK SC", "Noto Sans Sinhala", "Noto Color Emoji", sans-serif`
- 在 Docker 镜像内保证 `Noto Sans Sinhala` 可用。
- 同步更新 README 字体说明，避免与实现不一致。

## 方案/改动点
- 代码字体链（4 处）
  - `src/utils/designSystem.js`
  - `src/services/imageGenerator/generators/helpCard.js`
  - `src/services/imageGenerator/generators/aiHelpCard.js`
  - `src/services/imageGenerator/generators/subscriptionList.js`
- Docker 依赖
  - `Dockerfile`
  - `Dockerfile.action`
  - 安装 `fonts-noto-core`，并避免删除 `NotoSans*.ttf` 以保留 Sinhala 字体。
- 文档
  - `README.md`：默认字体、Docker 内置字体说明、致谢段落说明。

## 验证与回滚
- 验证：
  - 检查上述文件字体链字符串与安装包是否更新。
  - 通过容器渲染目标动态确认颜文字不再方框。
- 回滚：
  - 还原上述文件到变更前版本即可。
