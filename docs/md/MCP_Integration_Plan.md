# NapCat QQ Bot - MCP (Model Context Protocol) 接入方案

本方案旨在通过引入 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)，使 NapCat QQ Bot 能够以标准化的方式连接外部工具和数据源（如 Mem0 记忆服务、文件系统、数据库等），实现功能的动态扩展。

## 1. 架构设计

### 1.1 核心组件
*   **MCP Host (Bot)**: NapCat Bot 作为 MCP Host，负责加载配置、管理与 MCP Server 的连接，并将工具暴露给 LLM。
*   **MCP Manager**: 新增的核心模块 (`src/services/mcpManager.js`)，负责具体的连接管理和工具路由。
*   **MCP Servers**: 外部独立进程，提供实际的能力（如 `mem0-mcp`, `filesystem-server`）。
*   **Config**: 配置文件 (`config/mcp_servers.json`)，定义需要启用的 Servers。

### 1.2 工作流程
1.  **启动阶段**: Bot 启动 -> `mcpManager` 读取配置文件 -> 启动各个 MCP Server 子进程 -> 建立连接并获取工具列表。
2.  **交互阶段**:
    *   用户发送消息。
    *   AI Handler 构建 Prompt，并将所有 MCP 工具转换为 OpenAI Function Calling 格式。
    *   LLM 决定调用某个工具（如 `search_memory`）。
    *   `mcpManager` 接收调用请求，路由到对应的 MCP Server 执行。
    *   执行结果返回给 LLM，生成最终回复。

## 2. 详细实现规划

### 2.1 配置文件 (`config/mcp_servers.json`)
用户通过此文件管理扩展功能，无需修改代码。

```json
{
  "mem0": {
    "command": "uvx",
    "args": ["mem0-mcp"],
    "env": {
      "MEM0_API_KEY": "用户提供的KEY"
    }
  },
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/app/data"],
    "enabled": true
  }
}
```

### 2.2 核心模块 (`src/services/mcpManager.js`)
需要引入 SDK: `npm install @modelcontextprotocol/sdk`

主要功能：
*   `init()`: 解析配置，初始化 Clients。
*   `getOpenAITools()`: 返回符合 OpenAI 格式的工具定义列表。
*   `executeTool(name, args)`: 根据工具名查找对应的 Client 并执行。
*   `cleanup()`: 进程退出时关闭所有 Server 连接。

### 2.3 集成改造 (`src/handlers/aiHandler.js`)
*   在 `getReply` 方法中，动态获取 `mcpManager.getOpenAITools()`。
*   处理 LLM 的 `tool_calls` 响应，形成多轮对话循环（Loop），直到 LLM 生成文本回复。

## 3. 接入 Mem0 (示例)

用户只需在配置中添加 Mem0 的 MCP Server 定义：

1.  用户获取 Mem0 API Key。
2.  在 `config/mcp_servers.json` 中添加配置。
3.  重启 Bot。
4.  Bot 自动获得 `add_memory`, `search_memory` 等能力，LLM 会自动根据上下文决定何时读写记忆。

## 4. 优势
*   **零代码扩展**: 用户只需修改 JSON 配置即可接入新能力。
*   **生态兼容**: 支持所有标准 MCP Server（不仅限于 Mem0，还包括 GitHub, PostgreSQL, Google Drive 等）。
*   **解耦**: Bot 核心逻辑保持轻量，复杂能力委托给外部进程。

## 5. 后续实施步骤
1.  安装 SDK: `npm install @modelcontextprotocol/sdk zod`
2.  创建 `src/services/mcpManager.js`。
3.  修改 `src/handlers/aiHandler.js` 支持 Function Calling 循环。
4.  添加示例配置文件。
