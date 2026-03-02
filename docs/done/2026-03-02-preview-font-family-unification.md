# 预览字体调用顺序统一管理计划

## 背景
当前预览渲染中有多处重复写入相同 `font-family` 字符串（统一 CSS、帮助卡、AI 帮助卡、订阅列表）。虽然顺序基本一致，但维护成本高，后续调整易漏改。

## 目标
1. 抽取统一的字体链构造函数。
2. 保持现有行为不变：优先 `fonts/custom` 注入字体，其次 `"Noto Sans CJK SC", "Noto Sans Sinhala", "Noto Color Emoji", sans-serif`。
3. 将现有重复调用点改为统一入口。

## 实施范围
1. `src/utils/designSystem.js`
2. `src/services/imageGenerator/generators/helpCard.js`
3. `src/services/imageGenerator/generators/aiHelpCard.js`
4. `src/services/imageGenerator/generators/subscriptionList.js`

## 验证
1. 静态检索确认上述文件不再重复硬编码字体链表达式。
2. 简单 `require` 级别语法检查（受本地依赖环境限制时说明）。

## 回滚
回滚上述 4 个文件即可恢复原行为。
