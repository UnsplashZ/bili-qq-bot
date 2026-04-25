# Bili QQ Bot WebUI

这是主 Bot 内置管理面板的前端工程，基于 React、Vite 和 Tailwind CSS。生产构建输出到 `dashboard/dist`，由主进程的 Express 服务托管。

当前 WebUI 覆盖运行状态、群组、订阅、视频下载、日志、B 站登录、系统设置，以及新 Agent 的配置与记忆管理；旧 AI/MCP 配置入口已移除。

## 开发

```bash
cd dashboard
npm install
npm run dev
```

开发服务器默认运行在 `http://localhost:5173`，API 请求代理到主 Bot 服务（默认 `http://localhost:3000`）。开发前需要先在项目根目录启动主服务：

```bash
cd ..
npm start
```

## 构建

```bash
cd dashboard
npm run build
```

构建产物会写入 `dashboard/dist`。主服务启动后会在 Dashboard 端口托管这些静态文件，默认访问地址为 `http://localhost:3000`。

## 主要页面

- `src/pages/Dashboard.jsx`：运行状态与资源概览
- `src/pages/Groups.jsx`：群组配置、订阅与视频下载策略
- `src/pages/Settings.jsx`：全局配置、B 站登录与视频下载策略
- `src/pages/AgentSettings.jsx`：新 Agent 运行模式、LLM、预算、工具和群级覆盖配置
- `src/pages/AgentMemory.jsx`：新 Agent 长期记忆查看、筛选和清理
- `src/pages/Logs.jsx`：实时日志与历史缓冲
- `src/pages/Login.jsx`：管理面板登录

## 登录与配置

Dashboard 登录密码配置在主项目 `config/.env` 的 `DASHBOARD_PASSWORD`，默认值为 `admin`。公网访问时请配置 `DASHBOARD_ALLOWED_ORIGINS`，避免未授权来源访问管理接口。
