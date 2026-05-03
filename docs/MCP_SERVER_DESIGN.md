# Stratix MCP Server 设计文档

## 定位

Stratix 暴露 MCP Server，让任何"随身 Agent"（OpenClaw、Claude Code、未来任何 MCP Client）成为调度者。

**三层架构**：
```
随身 Agent（MCP Client / 调度者）
    ↓ MCP protocol
Stratix MCP Server（薄层，包装 Gateway REST API）
    ↓ 内部调用
Gateway → ZoneManager → ZoneCoordinator → 受控 Agent
```

## MCP Tools 映射表

### 核心工作流（第一优先级）

| MCP Tool | 映射到 Gateway API | 说明 |
|----------|-------------------|------|
| `stratix.list_zones` | `GET /api/zones?projectId=xxx` | 列出所有 Zone |
| `stratix.create_zone` | `POST /api/zones` | 创建 Zone（含意图描述） |
| `stratix.get_zone` | `GET /api/zones/:zoneId` | 获取 Zone 详情 |
| `stratix.submit_requirement` | `POST /api/zones/:zoneId/requirements` | **核心**：提交需求，ZoneCoordinator 自动拆解→分配 |
| `stratix.get_zone_status` | `GET /api/zones/:zoneId/coordinator/status` | 查询 Zone 执行状态 |
| `stratix.list_agents` | `GET /api/agents` 或 store 直接查 | 列出可用 Agent |
| `stratix.add_agent_to_zone` | `POST /api/zones/:zoneId/members/:agentId` | 将 Agent 加入 Zone |

### 任务管理（第二优先级）

| MCP Tool | 映射到 Gateway API | 说明 |
|----------|-------------------|------|
| `stratix.list_tasks` | `GET /api/zones/:zoneId/tasks` | 查看 Zone 内任务列表 |
| `stratix.confirm_task` | `POST /api/zones/:zoneId/tasks/:taskId/confirm` | 确认任务分配 |
| `stratix.reject_task` | `POST /api/zones/:zoneId/tasks/:taskId/reject` | 拒绝任务分配 |
| `stratix.create_manual_task` | `POST /api/zones/:zoneId/tasks/manual` | 手动创建任务 |
| `stratix.reassign_task` | `POST /api/zones/:zoneId/tasks/:taskId/reassign` | 重新分配任务 |
| `stratix.agent_poll_tasks` | `GET /api/agent/:agentId/tasks` | Agent 轮询自己的任务 |
| `stratix.agent_claim_task` | `POST /api/agent/:agentId/tasks/claim` | Agent 认领任务 |

### 可选（先不做）

| MCP Tool | 映射到 Gateway API | 说明 |
|----------|-------------------|------|
| `stratix.cycle_start` | `POST /api/zones/:zoneId/cycle` | 启动循环调度 |
| `stratix.update_coordinator_config` | `PUT /api/zones/:zoneId/coordinator/config` | 更新协调器配置 |
| `stratix.manage_zone_files` | Zone files API 组 | Zone 文件管理 |
| `stratix.send_zone_message` | `POST /api/zones/:zoneId/messages` | Zone 内消息 |

## 最小可行实现（MVP）

### Phase 1：跑通调度链（目标：随身 Agent 能创建 Zone + 提交需求 + 查看结果）

**新增文件：**
```
src/stratix-mcp/
├── index.ts              # MCP Server 入口（stdio/SSE transport）
├── tools/
│   ├── zone.ts           # Zone CRUD + 需求提交
│   ├── agent.ts          # Agent 列表 + 加入 Zone
│   └── task.ts           # 任务查询 + 确认
├── transport.ts          # Transport 配置（stdio / SSE）
└── types.ts              # MCP 相关类型
```

**实现方式：**
- MCP Server 薄层，直接调用 Gateway 内部服务（不走 HTTP，走函数调用）
- 或者如果 MCP Server 需要独立进程，走 HTTP 调 Gateway REST API
- 推荐前者（嵌入 Gateway 进程），减少网络跳转

### 关键改造点

**1. `submit_requirement` 是核心链路**

现有流程：
```
POST /api/zones/:zoneId/requirements
  → ZoneCoordinator.processRequirement(requirement)
    → LLM 拆解需求 → 生成任务列表 → 匹配 Agent → 分配/等待确认
```

需要验证：
- [ ] processRequirement 能否真正从头跑到尾？
- [ ] LLM 拆解是否需要配置？（provider/key/model）
- [ ] 拆解后的任务分配，受控 Agent 能否实际接收并执行？
- [ ] 执行结果如何回传？

**2. 受控 Agent 的任务执行闭环**

现有：
- Agent 轮询任务：`GET /api/agent/:agentId/tasks` ✅
- Agent 认领任务：`POST /api/agent/:agentId/tasks/claim` ✅
- Agent 开始执行：`POST /api/agent/:agentId/tasks/:taskId/start` ✅

需要确认：
- [ ] 执行完成后结果回传的 API 是否完整？
- [ ] 状态变更是否通过 WebSocket 推送到前端？

**3. 随身 Agent 的身份问题**

- 随身 Agent 通过 MCP 接入时，它以什么身份操作？
- 方案：MCP 连接时携带 token/identity，映射为 Zone 的 coordinator 权限
- 或者更简单：MCP 默认就是 operator 角色，有所有权限

## Transport 方案

### 方案 A：stdio（推荐用于集成）
```bash
# 随身 Agent 启动 Stratix MCP Server 作为子进程
stratix-mcp --transport stdio
```
- 优点：简单、标准、任何 MCP Client 都支持
- 缺点：需要 Node.js 环境

### 方案 B：SSE over HTTP（推荐用于远程）
```
GET http://localhost:3010/mcp/sse
POST http://localhost:3010/mcp/messages
```
- 优点：远程访问、多 Client 共享
- 缺点：需要 Gateway 运行

### 方案 C：嵌入 Gateway（最短路径）
- MCP Server 作为 Gateway 的一个路由挂载
- 不需要额外进程
- 最快实现

**推荐：先用方案 C（嵌入 Gateway），跑通后再抽离成独立服务。**

## 下一步行动

1. **验证核心链路**：`processRequirement` → 拆解 → 分配 → 执行 → 回传，手动测试一遍
2. **实现 MCP Server 薄层**：方案 C，嵌入 Gateway
3. **暴露 5 个核心 tools**：`list_zones`, `create_zone`, `submit_requirement`, `get_zone_status`, `list_agents`
4. **端到端测试**：用 MCP Client（比如 mcporter）调用，确认链路通
