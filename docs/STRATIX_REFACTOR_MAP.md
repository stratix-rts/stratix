# STRATIX_REFACTOR_MAP — 旧模块改造对照表

> 版本: v1.0 · 日期: 2026-08-01 · 配套: [STRATIX_WORKBENCH_DESIGN.md](./STRATIX_WORKBENCH_DESIGN.md) · [ADP v1](./protocol/ADP_v1.md)
> 维护者: Stratix Core Team

## 0. 目的

把现有 15 个模块的每一个文件 / 符号映射到 Workbench 改造后的新位置或删除理由，避免 P0 实施时遗漏。

---

## 1. 模块总览

| 模块 | 决策 | 新落点 | 删除/归档窗口 |
|------|------|--------|--------------|
| `stratix-agent` | ❌ 删除 | 全部能力下放给第三方 Agent | deprecated 1 版本后删 |
| `stratix-ai-service` | ❌ 删除 | LLM 路由下放给 Agent | deprecated 1 版本后删 |
| `stratix-orchestration` | 🔧 改造 | 拆为 `stratix-orchestration` + `stratix-adp` + `stratix-adapters` | 即时改造 |
| `stratix-openclaw-adapter` | 🔧 改造 | 移入 `stratix-adapters/builtin/openclaw/` | P3 适配 |
| `stratix-mcp` | 🔧 改造 | 移入 `stratix-adapters/builtin/mcp/` | P2 适配 |
| `stratix-task-executor` | 🔧 改造 | 并入 `stratix-orchestration/task-router.ts` | 即时改造 |
| `stratix-character-creator` | 🟡 保留像素资源 | `assets/` `types/` 留；`ui/` `CharacterCreatorScene.ts` 转可选插件 | 编辑器转插件 |
| `stratix-command-panel` | 🔧 改造 | 命令来源改为 ADP capability | 即时改造 |
| `stratix-rts` | ✅ 保留 | 不变 | — |
| `stratix-gateway` | ✅ 保留 | 新增 agent 通道 | — |
| `stratix-database` | 🔧 扩展 | 新增 agent_* / adapter_* 表 | — |
| `stratix-lra-bridge` | ✅ 保留 | LRA 绑在 Zone | — |
| `stratix-designer` | ❌ 归档 | 与目标无关 | P0 移 `archive/` |
| `stratix-nocodb` | ❌ 归档 | 与目标无关 | P0 移 `archive/` |
| `stratix-blueprint` | ❌ 归档 | 与目标无关 | P0 移 `archive/` |
| `stratix-tailscale` | 🟡 评估 | 远程 Agent 连接选项 | 延后到 P5 |

---

## 2. 逐模块改造清单

### 2.1 `stratix-agent` ❌ 删除

**当前导出**（`index.ts`）：

```
types/* · StratixAgent · EnhancedStratixAgent · core/LLMConnector ·
core/LLMConnectionPool · core/TokenManager · core/MemoryManager ·
core/SkillRegistry · core/SkillTrigger · core/executors · core/PromptBuilder ·
core/EnhancedPromptBuilder · core/SessionManager · core/HealthChecker ·
core/RateLimiter · core/MetricsCollector · core/AgentExporter ·
core/CredentialManager · core/SharedMemoryCache · core/StorageManager ·
core/StratixAgentManager · core/AutoSaver · parsers/AgencyAgentsParser ·
mixins/MixinComposer · templates/*
```

**改造动作**：

| 旧符号 | 处理 | 说明 |
|--------|------|------|
| `EnhancedStratixAgent` | 整文件删除 | 自研 Agent 大脑，违反目标 |
| `StratixAgent` | 整文件删除 | 同上 |
| `core/PromptBuilder` / `EnhancedPromptBuilder` | 删除 | 下放给 Agent |
| `core/MemoryManager` / `SharedMemoryCache` / `StorageManager` | 改写为 `stratix-orchestration/session-store.ts` | 只保留会话级存储，无 LLM 记忆 |
| `core/SkillRegistry` / `SkillTrigger` | 删除（被 capability 取代） | 改用 ADP capability |
| `core/CredentialManager` | 改写为 `stratix-adp/auth/credential-store.ts` | 保留 secret 存储，作用域改为 capability 范围 |
| `core/HealthChecker` | 改写为 `stratix-adp/runtime/health.ts` | 检测对象改为子进程/远程连接 |
| `core/RateLimiter` | 改写为 `stratix-orchestration/rate-limiter.ts` | 限流对象改为 adapter + session |
| `core/MetricsCollector` | 改写为 `stratix-orchestration/metrics.ts` | 收集 session/run 指标 |
| `core/SessionManager` | 改写为 `stratix-orchestration/session-manager.ts` | session 模型改用 ADP envelope |
| `core/StratixAgentManager` (`core/StratixAgentManager.ts`, 114 lines) | 删除（外层编排） | 改由 Orchestrator 调度 |
| `core/AutoSaver` / `AgentExporter` | 删除 | 移除"导出 Agent"功能 |
| `core/LLMConnector` / `LLMConnectionPool` | 删除 | 不托管 LLM 连接 |
| `parsers/AgencyAgentsParser` | 删除 | 不再需要模板解析 |
| `mixins/MixinComposer` | 删除 | 移除 Mixin 体系 |
| `templates/*` | 归档 `archive/stratix-agent-templates/` | 1 版本后删除。**注意**：`partials/layers/` 只剩 layer1/layer2/layer10 三个，layer3–layer9 partials 缺失，与 `layouts/full-prompt.hbs` 引用不一致；归档时一起清理 |
| `types/*` | 仅 `AgentId` / `Capability` 等通用类型 | 迁到 `stratix-adp/protocol/types.ts` |
| `runtime/SessionRuntime.ts` (451) + `TranscriptStore.ts` (199) | 删除 | TranscriptStore 无 rotation、无并发控制，删前确认无外部依赖 |
| `executors/` (http/builtin/fs/bash/zone) | 删除 | 整目录随 `EnhancedStratixAgent` 一起移除 |
| `ZoneAgent.ts` / `ZoneAgentSkills.ts` / `ZoneCoordinatorSkillExecutor.ts` | 删除 | bridge between skill registry and zone coordinator |

**迁移窗口**：

- P0：所有从 `stratix-agent` 的 import 走 deprecated barrel `src/stratix-agent/index.ts.deprecated.ts` 打 warning
- 1 个 release：清空 `stratix-agent/` 目录

---

### 2.2 `stratix-ai-service` ❌ 删除

**当前导出**：

```
core/AIServiceProvider · BaseAIProvider · OpenAIProvider · ClaudeProvider ·
OllamaProvider · AIServiceFactory · parsers/RequirementParser ·
parsers/TaskSplitter · prompts/requirement-parsing · prompts/task-splitting ·
types/*
```

**改造动作**：全部删除。

| 旧符号 | 处理 | 说明 |
|--------|------|------|
| `OpenAIProvider` / `ClaudeProvider` / `OllamaProvider` | 删除 | 不托管 LLM |
| `AIServiceFactory` | 删除 | 不做模型路由 |
| `RequirementParser` / `TaskSplitter` | 删除 | 不做需求解析和任务拆分（属于 Agent 工作） |
| `prompts/*` | 删除 | 提示词由 Agent 自身管理 |

**废弃检测**：`grep -RE "from ['\"]@?/?stratix-ai-service" src` 应在 P0 完成后为空。

---

### 2.3 `stratix-orchestration` 🔧 改造

**当前导出**（节选）：

```
zone/ZoneManager · zone/ZoneState · zone/ZoneConfig · zone/ZoneEvent · zone/ZoneCoordinator · zone/ZoneCoordinatorEvents
task-queue/TaskQueueService · task-queue/TaskItem
background/BackgroundAgentService · background/AgentProcess · background/AgentCheckpointManager
context/ContextCompressionService · context/RelevanceScorer · context/ContextManager
messaging/AgentMessageRouter · messaging/AgentMessageStore · messaging/ConversationConstraints · messaging/MessageTypes
OrchestrationSync · worker/AgentWorker
```

**改造动作**：

| 旧符号 | 新落点 | 说明 |
|--------|--------|------|
| `zone/*` | `stratix-orchestration/zone/*`（保留） | Zone 含义不变；修 `ZoneManager.ts:52` 的 lazy `require('../task-queue/TaskQueueService')` 改为静态 import |
| `zone/ZoneCoordinator` + `ZoneCoordinatorEvents` | `stratix-orchestration/zone-coordinator.ts` | 整合：原依赖 `agentCapabilityRepository` / `taskFlowRepository` 改为 ADP capability；保留 PermissionOrchestrator 集成 |
| `task-queue/*` | `stratix-orchestration/task-router.ts` | 改为基于 ADP session 的路由；**修 bug**：`TaskQueueService.ts:66` `getDatabase().getDatabase()` 双重取 db 改为单次 |
| `background/BackgroundAgentService` | `stratix-orchestration/multi-agent-coordinator.ts` | 改为协调多 ADP session |
| `background/AgentProcess` | `stratix-adapters/runtime/process.ts` | 子进程管理下沉到 adapter runtime |
| `background/AgentCheckpointManager` | `stratix-orchestration/checkpoint.ts` + `agent_sessions.snapshot_ref` | 走 ADP session 恢复协议 |
| `context/ContextCompressionService` | 删除 | 上下文压缩属于 Agent 自身能力 |
| `context/RelevanceScorer` | 删除 | 同上 |
| `context/ContextManager` | 改写为 `stratix-orchestration/zone-context.ts` | 只管 Zone 上下文，不做 LLM 上下文压缩 |
| `messaging/*` | `stratix-orchestration/messaging/*`（保留，扩展 agent 事件） | — |
| `OrchestrationSync` | `stratix-orchestration/sync.ts` | 改用 ADP event stream |
| `worker/AgentWorker` | 删除（合并进 coordinator） | — |

**Gateway 侧 6 个 consumer 文件**（改造时必须保持类型兼容 1 版本）：

- `stratix-gateway/index.ts` — `OrchestrationSync`
- `stratix-gateway/agent/agents/LLMAgent.ts` — `TaskQueueService`
- `stratix-gateway/api/websocket/StatusSync.ts` — `ZoneCoordinatorEventEmitter` + `ZoneCoordinatorEventPayload`
- `stratix-gateway/api/routes/agentTask.ts` — `TaskQueueService` + `ZoneCoordinatorEventEmitter`
- `stratix-gateway/api/routes/zone-coordinator.ts` — `ZoneCoordinator` + `TaskItem` + `ProcessResult` + `ZoneStatusSummary` + `DelegateResult`
- `stratix-gateway/agent-runtime/AgentRuntimeService.ts` — `TaskItem` + `TaskQueueService` + `ZoneCoordinatorEventEmitter`（**最高耦合入口**）

**重要：与 ADP 边界**

`stratix-orchestration` 知道 ADP envelope，但**不**直接 spawn 进程——通过 `stratix-adapters` 提供的 `AgentAdapter` 接口。

---

### 2.4 `stratix-openclaw-adapter` 🔧 改造

**当前文件**：`ConnectionPool.ts` `GatewayOpenClawAdapter.ts` `LocalOpenClawAdapter.ts` `RemoteOpenClawAdapter.ts` `WebSocketOpenClawAdapter.ts` `types.ts` + 演示/测试文件 (`demo-one-to-many.ts`, `test-connection.ts`)

**改造动作**：

- 移动到 `src/stratix-adapters/builtin/openclaw/`
- `LocalOpenClawAdapter` → `stdio/driver.ts` 的 OpenClaw 实现
- `WebSocketOpenClawAdapter` → `http/driver.ts` 的 OpenClaw 实现（保留 `createWebSocketAdapter` 工厂）
- `RemoteOpenClawAdapter` → `ssh/driver.ts`（P5 评估）
- `GatewayOpenClawAdapter` → 删除（gateway 走 ADP event bus）
- `ConnectionPool` → 改写为 `stratix-orchestration/connection-pool.ts`（通用，按 adapter 缓存）

**Phase**：P3 接入。

---

### 2.5 `stratix-mcp` 🔧 改造

**当前**：`server.ts`（1,239 lines，单一文件）— 15 MCP tools（list_zones / create_zone / submit_requirement / get_zone_status / list_agents / add_agent_to_zone / get_task_detail / cancel_task / reassign_task / remove_agent_from_zone / delete_zone / list_zone_files / create_manual_task / update_zone / get_agent_status）、5 resources、3 prompts；用 ZoneCoordinator 缓存（TTL 30min）；**SSE transport**。

**重要角色区分**（H1 修正）：

- 旧 `stratix-mcp/server.ts` **是 Stratix 自己暴露的 MCP 服务器**（让外部 MCP 客户端调用 Stratix 工具）
- 不是消费外部 MCP server
- 必须与"MCP 客户端适配器"分开存放，避免角色错位

**改造动作**：

| 旧符号 | 新落点 | 说明 |
|--------|--------|------|
| `stratix-mcp/server.ts` | `stratix-gateway/api/mcp/server.ts` | Stratix 自有 MCP 服务，**作为 Workbench 的可被外部调用接口**，随 Zone/RTS 保留 |
| 新增（无旧） | `stratix-adapters/builtin/mcp/client-adapter.ts` | MCP 客户端适配器，**消费外部 MCP server**，把外部 tool 转 ADP `AgentCapability`（P3+） |
| ZoneCoordinator 缓存（30min TTL） | 保留 | 作为 capability cache hint |

**Phase**：P2 改 server 路径（不删功能）；P3 写 client-adapter。

---

### 2.6 `stratix-task-executor` 🔧 改造

**当前导出**：

```
TaskExecution · ProjectExecution · TaskResult · ProgressFile ·
TaskStatus · ProjectStatus · PROGRESS_FILE_NAME · RESULT_FILE_NAME ·
LRAClient · LRAWatcher · AgentOrchestratorClient · AgentState · AgentInterface
```

**改造动作**：

- 全部并入 `stratix-orchestration/`：
  - `LRAClient` / `LRAWatcher` → 来自 `stratix-lra-bridge`，已在用，保留引用
  - `AgentOrchestratorClient` (144 lines) → **删除**（被 ADP `control.session.*` 取代）；注意 `isAgentWorking` 当前抛 "Not implemented"，删除前确认无外部调用
  - `TaskExecution` / `ProjectExecution` → 改写为 `Run` 概念
  - `ProgressFile` / `RESULT_FILE_NAME` → 改由 session event 表达，不再用文件
  - `collection/ResultCollector.ts` (183 lines) → 迁入 `stratix-orchestration/result-collector.ts`；**已知 bug**：`getTaskFiles` 有 path accumulation 问题，迁入前先修
- `stratix-task-executor/` 目录在 P0 完成后删除

---

### 2.7 `stratix-character-creator` 🟡 保留像素资源

**当前结构**：

```
assets/ · CharacterCreatorScene.ts · config/ · constants.ts · core/ ·
index.ts · init.md · types/ · ui/
```

**改造动作**：

| 子目录 | 处理 | 说明 |
|--------|------|------|
| `assets/` | ✅ 保留 | 像素素材库 |
| `types/` | ✅ 保留（迁到 `stratix-rts/character/types/`） | 角色类型 |
| `core/` | ✅ 保留为 `stratix-rts/character/core/` | 形象合成逻辑 |
| `CharacterCreatorScene.ts` | 🟡 移到 `stratix-rts/character/scene/CharacterCreatorScene.ts` | Phaser scene 转可复用组件 |
| `ui/` | 🔧 改写为 `stratix-rts/character/ui/` | 接入 Workbench 主题 |
| `index.ts`（`createCharacterCreator`） | 🟡 转可选插件入口 | 不在主菜单强推 |
| `config/` / `constants.ts` | ✅ 保留 | — |
| `ui/workflow-editor/WorkflowCanvas.ts` (1,206) + `WorkflowEditorPanel.ts` (896) | 🟡 移到 `archive/stratix-character-creator-workflow-editor/` | DIY drag-drop 硬编码 THEME 绕过 DS，包装的 npm 包 `sequential-workflow-designer` 走可选插件 |

**隐藏 bug（P0 实施前必须修）**：

| 文件 | Bug | 处理 |
|------|-----|------|
| `core/ZoneContextManager.ts:239,308` | 硬编码 `http://127.0.0.1:7524`（陈旧，实际 3010） | 改成从 config 读取 |
| `core/ZoneContextManager.ts:7` | `import from ../../stratix-agent/types`（deprecated 路径） | 改为 `stratix-adp/protocol/types` |
| `core/SkillTree.ts:132` | root auto-unlock bug | 改写 |
| `core/SoulTemplateRenderer.ts:115, 80-96 vs 152-180` | regex `g` flag + 重复 builder | 合并去重 |
| `core/SharedSkillStore.ts:235` | 每次写都 sync localStorage | 改异步 / 批量 |
| `core/BrowserStorage.ts:149` | 无 QuotaExceededError 处理 | 加 catch |
| `core/EventEmitter.ts:103, 245-249` | 全 `as any` 转型 | 类型收窄 |

**与 ADP 关系**：`AgentManifest.avatarRef` 引用 `assets/` 下的资源 id。

---

### 2.8 `stratix-command-panel` 🔧 改造

**当前导出与文件行数**：

```
CommandLog.vue (640) · SkillList.vue (367) · ParamForm.vue (413) ·
ConfirmDialog.vue · CancelConfirmDialog.vue · LogDetailModal.vue ·
utils/ParamValidator.ts (203) · utils/CommandBuilder.ts (148)
```

**改造动作**：

- `SkillList.vue` (367) → 改名为 `CapabilityList.vue`，数据源从 `core/SkillRegistry` 改为 `AgentManifest.capabilities`
- `ParamForm.vue` (413) → 改用 `capability.inputSchema` 渲染（zod → form）；**唯一 binding pin**：原 `import { SkillDefinition } from 'stratix-agent'` 改为 `import type { AgentCapability } from 'stratix-adp/protocol/types'`
- `CommandBuilder.ts` (148) → 删除（改由 adapter 接受 capability.params）；**修 bug**：`Math.random()` 改 `crypto.randomUUID()`（即使是过渡期也先修，避免扩散）
- `CommandLog.vue` (640) / `LogDetailModal.vue` → 改读 `agent_events` 表
- `ParamValidator.ts` (203) → 改用 zod schema 校验（`AgentCapability.inputSchema` 已是 JSON Schema）
- 其他组件保留

**新 binding pin**：`ParamForm.vue` 改 import `AgentCapability` 而非 `SkillDefinition`。

---

### 2.9 `stratix-rts` ✅ 保留

**当前结构**（20+ 子目录）：`audio buildings config debug effects error events ground history managers performance scripts services spatial sprites state`

**改造动作**：不改动。

**新增点**：

- `stratix-rts/character/` — 接收 character-creator 迁入的角色资源
- `stratix-rts/agents/` — 新增：将每个活跃 ADP session 渲染为 Zone 中的形象
- `stratix-rts/state/agent-store.ts` — 订阅 `agent:session:*` 事件

---

### 2.10 `stratix-gateway` ✅ 保留

**当前结构**（实测）：

```
agent-runtime/AgentRuntimeService.ts          ← EnhancedStratixAgent 最高耦合入口
agent/AgentOrchestrationService.ts
agent/agents/LLMAgent.ts
agent/agents/OpenClawAgent.ts
agent/agents/types.ts
api/routes/agent.ts · agentOrchestration.ts · agentTask.ts · command.ts ·
           lra.ts · openclaw.ts · skill.ts · template.ts · texture.ts ·
           zone-audit.ts · zone-context.ts · zone-coordinator.ts · zone.ts
api/websocket/StatusSync.ts
api/apiKeyStore.ts · client.ts · types/ · retry/
```

**改造动作**：

- 新增 `api/routes/agent-runtime.ts`（基于 ADP `control.session.*`）
- 新增 `api/routes/agent-library.ts`（基于 ADP `manifest.*`，供 scan / list / probe）
- 扩展 `GatewayEventBus` 转发 `agent:discovered` `agent:session:*` 事件
- **修必清单一处**：`gateway/index.ts:244` setInterval callback 内 `require()` 改为顶层静态 import
- 既有 `api/routes/openclaw.ts` 在 P3 接入后转为 builtin adapter 注册入口（不改 route 行为）
- `agent/agents/LLMAgent.ts` 与 `OpenClawAgent.ts` 在 P0 末走 deprecated → 删除；P1 后只剩 `agent/agents/types.ts` 作为 type-only re-export 中心

**反向耦合清单**（被 `stratix-orchestration` 等模块 import 的 gateway 符号）：

- `LLMAgent` ← `EnhancedStratixAgent`
- `AgentState` / `AgentInterface` (in `agents/types.ts`) ← `stratix-task-executor`

---

### 2.11 `stratix-database` 🔧 扩展

**当前 repository 文件清单**（实测 12 个）：

| Repository | 关键导出 | 改造决策 |
|-----------|---------|---------|
| `StratixDatabase.ts` | `getDatabase()` / `initializeDatabase()` | 保留；扩展 export `agent*Repository` 单例 |
| `sqlite-adapter.ts` | SQLite 适配器 | 保留 |
| `migrate.ts` | 迁移执行器 | 保留；新增 ADP 表迁移 |
| `ZoneRepository.ts` | `zoneRepository` / `ZoneRepository` | 保留；保留旧 `projectRepository` 别名 |
| `ZoneMemberRepository.ts` | `zoneMemberRepository` | 保留 |
| `ZoneCoordinatorConfigRepository.ts` | 配置库 | 保留 |
| `AgentRepository.ts` | `agentRepository` | 保留（语义：自研 Agent 元数据）；P0 末清空数据 |
| `AgentCapabilityRepository.ts` | `agentCapabilityRepository` | **重写** → 改为 ADP `AgentManifest.capabilities` 存储 |
| `AgentChatMessageRepository.ts` | `agentChatMessageRepository` | **重写** → 改为 ADP `agent_events` 存储 |
| `SkillRepository.ts` | `skillRepository`（`SharedSkill` / `AgentLearnedSkill`） | 归档 P0 末（自研 Agent 概念） |
| `TaskFlowRepository.ts` | `taskFlowRepository` | **重写** → 改为 ADP `agent_runs` 存储 |
| `AuditLogRepository.ts` | `auditLogRepository` | 保留为 `agent_audit_log` 写入路径 |

**新增迁移脚本** `migrations/2026_08_xx_add_agent_tables.ts`：

```sql
CREATE TABLE agent_manifests (
  id TEXT PRIMARY KEY,
  adapter_kind TEXT NOT NULL,
  source TEXT NOT NULL,
  install_path TEXT,
  manifest_json TEXT NOT NULL,
  last_probed_at TEXT NOT NULL
);
CREATE TABLE agent_capabilities (
  agent_id TEXT NOT NULL REFERENCES agent_manifests(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  schema_json TEXT,
  requires_permission TEXT NOT NULL,
  PRIMARY KEY (agent_id, capability_id)
);
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent_manifests(id),
  zone_id TEXT REFERENCES zone_contexts(zone_id),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  snapshot_ref TEXT
);
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  input_ref TEXT,
  output_ref TEXT,
  started_at TEXT NOT NULL
);
CREATE TABLE agent_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX idx_agent_events_session_ts ON agent_events(session_id, ts);
CREATE TABLE agent_permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  pattern TEXT,
  decision TEXT NOT NULL,
  scope TEXT NOT NULL,
  granted_by TEXT
);
CREATE TABLE adapter_manifests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  signature TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE agent_audit_log (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  result TEXT,
  ts TEXT NOT NULL
);
```

---

### 2.12 `stratix-lra-bridge` ✅ 保留

**改造动作**：LRA task 与 Zone 关联；`run.id` 作为 LRA task id 的影子字段。

---

### 2.13 `stratix-designer` / `stratix-nocodb` / `stratix-blueprint` ❌ 归档

**动作**：

```bash
mkdir -p src/archive
git mv src/stratix-designer src/archive/stratix-designer
git mv src/stratix-nocodb   src/archive/stratix-nocodb
git mv src/stratix-blueprint src/archive/stratix-blueprint
```

---

### 2.14 `stratix-tailscale` 🟡 评估

**当前**：本地 SSH + Tailscale 集成

**改造动作**：暂不改动。P5 时考虑作为 remote adapter 的网络层（`http/ssh`）。

---

## 3. 删除窗口与 feature flag

### 3.1 feature flag

```typescript
// src/stratix-core/feature-flags.ts
export const STRATIX_MODE: 'workbench' | 'legacy' =
  process.env.STRATIX_MODE === 'legacy' ? 'legacy' : 'workbench';
```

### 3.2 deprecated barrel

`src/stratix-agent/index.ts` 改造为：

```typescript
// DEPRECATED: stratix-agent will be removed in v0.x+1
// Use @/stratix-adapters + @/stratix-orchestration instead.
console.warn('[stratix-agent] DEPRECATED. Migrate to ADP.');

export type {} from './types';
```

`src/stratix-ai-service/index.ts` 同理。

### 3.3 删除时序

| 时间点 | 动作 |
|--------|------|
| P0 完成 | 三大自研模块进入 deprecated，gateway 不再 import，UI 不再 mount |
| 1 release 后 | 删除 `stratix-agent` / `stratix-ai-service` / `stratix-task-executor` 目录 |
| 评估 | `stratix-designer` / `stratix-nocodb` / `stratix-blueprint` 移 archive 后 2 release 删除 |

---

## 4. 验证清单

P0 完成的判定：

```bash
# 0) 自研 Agent 模块应只剩 deprecated 入口
ls src/stratix-agent/ | wc -l       # 预期：≤ 2（types.ts + index.ts.deprecated.ts）
ls src/stratix-ai-service/ | wc -l  # 预期：≤ 2

# 1) 业务代码不应再 import 自研 Agent
grep -RE "from ['\"]@?/?stratix-agent" src --include='*.ts' --include='*.vue' | grep -v deprecated
# 预期：空

grep -RE "from ['\"]@?/?stratix-ai-service" src --include='*.ts' --include='*.vue' | grep -v deprecated
# 预期：空

# 2) 新模块就位
test -d src/stratix-adp/protocol && echo OK
test -d src/stratix-adapters && echo OK
test -d src/stratix-discovery && echo OK

# 3) DB 迁移成功
npm run typecheck
# 预期：0 error
npm run test -- stratix-database
# 预期：migration 单测通过
```

---

## 5. 风险与回滚

- 风险：`stratix-orchestration` 改动面大，可能引入回归
- 应对：保留 `OrchestrationSync` 旧接口 1 版本；feature flag 切回 legacy
- 风险：数据库迁移破坏旧 zone 数据
- 应对：迁移脚本全在事务内；迁移前自动 backup；提供 rollback migration

---

## 6. 变更日志

- 2026-08-01 v1.0：初版。基于实际 `index.ts` 导出清单。
- 2026-08-01 v1.1：接入子 agent full mapping 报告，校正：
  - `stratix-agent` 加入 `runtime/SessionRuntime.ts` (451) + `TranscriptStore.ts` (199) + `executors/` + `ZoneAgent*.ts` + templates partials 7/10 缺失
  - `stratix-mcp` 校正为 1,239 行 / 15 tools / SSE / 30min TTL
  - `stratix-character-creator` 列出 7 个隐藏 bug（7524 端口、deprecated types 导入、SkillTree root auto-unlock、SoulTemplateRenderer regex g flag、SharedSkillStore sync 写、BrowserStorage 无 Quota 处理、EventEmitter 全 as any）
  - `stratix-task-executor` 标注 `AgentOrchestratorClient.isAgentWorking` NotImplemented + `ResultCollector` path accumulation bug
  - `stratix-orchestration` 加入 6 个 gateway consumer 路径 + `TaskQueueService:66` 双重 `getDatabase().getDatabase()` bug + `ZoneManager:52` lazy require 改静态
  - `stratix-openclaw-adapter` 补全 `WebSocketOpenClawAdapter` + `createWebSocketAdapter` factory
  - `stratix-command-panel` 标注行数 + ParamForm binding pin + CommandBuilder Math.random 修复
  - 新增第 7 节「P0 实施前必修 bug 清单」集中归档 14 项
- 2026-08-01 v1.2：实测 §2.10/§2.11 子目录：
  - 12 个 repository：4 个重写为 ADP 形态（AgentCapabilityRepository / AgentChatMessageRepository / TaskFlowRepository / AuditLogRepository），2 个归档（SkillRepository、AgentRepository 末态），6 个保留
  - gateway：14 个 route + agent-runtime/agent 子目录 + index.ts:244 require-in-setInterval bug 列入 P0 必修
  - 反向耦合：LLMAgent ← EnhancedStratixAgent，AgentState/AgentInterface ← task-executor

---

## 7. P0 实施前必修 bug 清单（子 agent 实测发现）

| # | 文件:行 | Bug | 处理优先级 | 关联决策 |
|---|---------|-----|-----------|---------|
| 1 | `stratix-character-creator/core/ZoneContextManager.ts:239,308` | 硬编码 `http://127.0.0.1:7524`（陈旧端口，实际 3010） | P0 必修 | character-creator 保留 |
| 2 | `stratix-character-creator/core/ZoneContextManager.ts:7` | `import from ../../stratix-agent/types`（deprecated 路径） | P0 必修 | stratix-agent 删除前必须解耦 |
| 3 | `stratix-character-creator/core/SkillTree.ts:132` | root auto-unlock bug | P0 必修 | — |
| 4 | `stratix-character-creator/core/SoulTemplateRenderer.ts:115` | regex `g` flag bug | P0 必修 | — |
| 5 | `stratix-character-creator/core/SoulTemplateRenderer.ts:80-96 vs 152-180` | 重复 builder 代码 | P0 必修 | — |
| 6 | `stratix-character-creator/core/SharedSkillStore.ts:235` | 每次写都 sync localStorage | P0 必修 | 性能 |
| 7 | `stratix-character-creator/core/BrowserStorage.ts:149` | 无 QuotaExceededError 处理 | P0 必修 | 稳定性 |
| 8 | `stratix-character-creator/core/EventEmitter.ts:103, 245-249` | 全 `as any` 转型 | P0 必修 | 类型安全 |
| 9 | `stratix-task-executor/AgentOrchestratorClient.ts` | `isAgentWorking` 抛 "Not implemented" | P0 必修（先确认无外部调用再删） | stratix-task-executor 删除前 |
| 10 | `stratix-task-executor/collection/ResultCollector.ts:183` | `getTaskFiles` path accumulation bug | P0 必修 | 迁入 orchestrator 前修 |
| 11 | `stratix-orchestration/task-queue/TaskQueueService.ts:66` | `getDatabase().getDatabase()` 双重取 db | P0 必修 | 改造前修 |
| 12 | `stratix-orchestration/zone/ZoneManager.ts:52` | `lazy require('../task-queue/TaskQueueService')` | P0 必修 | 改为静态 import |
| 13 | `stratix-command-panel/utils/CommandBuilder.ts:148` | `Math.random()` 用于 ID | P0 必修 | 安全 |
| 14 | `stratix-gateway/index.ts:244` | setInterval callback 内用 `require()` | P0 必修 | 改造前修（已在子 agent 早期 pass 标出） |

**P0 实施时序**：

1. 先修 #11、#12、#14（orchestration/gateway 的低风险清理）
2. 再修 #1、#2、#3、#4、#5、#6、#7、#8（character-creator 必保留模块的解耦与 bug）
3. 再修 #9、#10（task-executor 迁入前修）
4. 最后修 #13（command-panel）
5. 全部修完才进 deprecated barrel + 删目录
