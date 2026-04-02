# Claude Code 源码拆解 — Part 1：概述与核心模块

> 来源：`docs/ClaudeCode逐模块拆解报告.docx`，行 1–600

---

## 0. 整体结构概览

### A/B 级模块总表

Claude Code 可先粗分为五大层，每层内部再按职责细分：

**宿主引导层**
- `main.tsx`、`bootstrap/`、`entrypoints/`

**命令与工具层**
- `commands/`、`commands.ts`、`Tool.ts`、`tools/`、`tools.ts`

**会话与状态层**
- `QueryEngine.ts`、`query.ts`、`query/`、`state/`

**任务与多 Agent 层**
- `tasks/`、`coordinator/`、`tools/AgentTool/`

**权限与沙箱层**
- `hooks/useCanUseTool.tsx`、`utils/permissions/`、`utils/sandbox/`

**模型接入层**
- `services/api/`

**MCP 能力总线层**
- `services/mcp/`、`tools/MCPTool/`

**扩展生态层**
- `skills/`、`plugins/`

**宿主 UI 层**
- `screens/`、`components/`、`ink/`

**Bridge / Remote / Server 层**
- `bridge/`、`remote/`、`server/`

### 四大支点文件

| 文件 | 角色 |
|------|------|
| `src/main.tsx` | 启动与宿主装配 |
| `src/Tool.ts` | 能力契约 |
| `src/QueryEngine.ts` | 会话运行时 |
| `src/tasks/LocalAgentTask/LocalAgentTask.tsx` | 异步子 Agent 任务系统 |

---

## 1. main.tsx：宿主引导器

### 关键设计点

- **Top-level 预热优化**：在模块评估阶段并行打出慢 IO（`profileCheckpoint`、`startMdmRawRead`、`startKeychainPrefetch`），而不是等到真正需要时才读。
- **Deferred Prefetch 机制**：区分"首屏"与"首回合"——先把界面起来，用户准备输入时偷偷预热（`initUser`、`getUserContext`、`prefetchSystemContextIfSafe`、`refreshModelCapabilities`）。
- **runMigrations()**：不是数据库迁移，而是用户配置、模型字符串、功能开关的跨版本迁移——说明它是长期演进系统。
- **模式分发**：同一 runtime 分出 `DIRECT_CONNECT`、`ssh`、`assistant`、interactive/non-interactive 等多个入口。
- **preAction 统一初始化**：`program.hook('preAction', ...)` 把命令执行前的公共基础设施（MDM/keychain 等待、init、migration、settings sync）统一收口，避免子命令各自偷偷初始化。

### 核心源码模式

```typescript
// main() 本质是模式分发器
main()
  .hook('preAction', preActionHandler)  // 统一初始化钩子
  .command('assistant', ...)

program
  .command('direct-connect')
  .command('ssh')
  .action(async () => { /* 分流执行 */ })
```

### 对 Stratix 的启发

- 启动性能优化意识（并行预热、延迟预取）值得借鉴。
- 多入口（CLI、server、ssh、direct-connect）在 Stratix 中体现为 gateway API / WebSocket / Electron 多端，统一初始化的设计可以避免各端重复初始化逻辑。
- migration 体系说明 Agent 产品需要提前规划跨版本配置兼容性。

---

## 2. Tool.ts：能力契约层

### 关键设计点

- **Tool 是完整协议对象**，不只是一个函数。它包含：调用（`call`）、描述（`description`）、schema（`inputSchema`/`outputSchema`）、安全（`validateInput`/`checkPermissions`）、行为属性（`isReadOnly`/`isDestructive`/`isConcurrencySafe`）、UI 渲染（`renderToolUseMessage`/`renderToolResultMessage`）、可观测性（`getActivityDescription`）、自动模式支持（`toAutoClassifierInput`）。
- **ToolUseContext 是宿主能力全集**：提供 `getAppState`、`setToolJSX`、`appendSystemMessage`、`sendOSNotification`、`handleElicitation` 等——说明真正的工具调用不是纯函数，它发生在活着的宿主环境里。
- **能力属性显式化**：`isReadOnly`、`isDestructive`、`interruptBehavior`、`isOpenWorld`、`requiresUserInteraction`、`shouldDefer` 等字段把隐含语义变成显式元数据，直接影响权限策略、调度策略、prompt 裁剪策略。
- **buildTool() 提供安全默认值**：并发安全默认 `false`、只读默认 `false`、destructive 默认 `false`——用默认值表达平台立场，倾向 fail-closed。

### 核心源码模式

```typescript
const tool = buildTool({
  name: 'read',
  description: 'Read files from disk',
  inputSchema: z.object({ path: z.string() }),
  isReadOnly: true,
  isConcurrencySafe: true,
  checkPermissions: async (input, ctx) => { /* ... */ },
  renderToolUseMessage: (tool, ctx) => <FileTree ... />,
  getActivityDescription: (toolUse) => 'Reading file ...',
});

// ToolUseContext 是宿主能力全集
interface ToolUseContext {
  getAppState: () => AppState;
  appendSystemMessage: (msg: string) => void;
  sendOSNotification: (title: string, body: string) => void;
  handleElicitation: (elicitation: Elicitation) => Promise<string>;
}
```

### 对 Stratix 的启发

- Stratix 的 Zone 能力、Agent 能力目前缺少类似的显式能力属性（只读/ destructive / 是否需要用户交互），可以在 `stratix-core` 中定义统一的 `CapabilityDescriptor`。
- `ToolUseContext` 的思路对应 Stratix 中 `ProjectManagerIntegrationHTTP` 暴露给 tool 的那一层——把宿主能力显式收口，避免工具绕过架构依赖全局单例。
- Tool 不是"底层能力函数"，而是"能被模型调用、能被权限系统审查、能被 UI 呈现"的运行时组件——这个定位和 Stratix 的 Agent Action 设计高度一致。

---

## 3. QueryEngine.ts：会话运行时

### 关键设计点

- **一次 conversation 一个 QueryEngine**：每次 `submitMessage()` 是一个 turn，`messages`、`file cache`、`usage`、`permission denials` 跨 turn 持续存在——这是"在持续上下文中工作"的关键。
- **submitMessage() 是会话级 orchestration**：它不只是发送 prompt，而是依次做 config 解析、权限包装、初始模型计算、`fetchSystemPromptParts()` 组装上下文、处理 memory prompt 注入、写 transcript、再进入 query loop。
- **先写 transcript 再跑 API**：防止用户消息已接受但 API 未响应时进程被杀掉导致消息丢失——非常真实的产品思维。
- **权限拒绝会被会话级追踪**：`permissionDenials` 最终回到 SDK result，权限是对话运行史的一部分，不只是临时 UI。
- **发现的技能和嵌套 memory 路径跨方法共享**：`discoveredSkillNames`、`loadedNestedMemoryPaths` 在同一轮多个子过程之间共享，但不会无限累积。
- **Public surface 非常克制**：`submitMessage()`、`interrupt()`、`getMessages()`、`getReadFileState()`、`getSessionId()`、`setModel()`——内部复杂但外部接口收敛。

### 核心架构关系

```
User → submitMessage() → 组装 system prompt + user context
                           → 写 transcript
                           → query loop（按需调用 Tool）
                           → 产出 SDKMessage 流
```

### 对 Stratix 的启发

- Stratix 的 `StratixRTSGameScene` 目前缺少类似的会话级状态抽象——消息历史、usage 追踪、权限拒绝记录散落在各处。可以借鉴 QueryEngine 的思路，建立一个 `SessionContext` 对象来聚合这些跨 turn 状态。
- "先落 transcript 再跑 API"的产品意识（防止中断丢失）对 Stratix 的命令执行日志有直接参考价值。
- `discoveredSkillNames` 的共享/隔离机制对应 Stratix Zone 中 agent 发现和 Zone 列表共享的问题——可以设计一个 ZoneSessionContext 来统一管理。

---

## 4. LocalAgentTask：多 Agent 任务系统

### 关键设计点

- **子 Agent 是一个后台任务对象，不是递归函数调用**：有独立 `taskId`、状态机、`output file`、`abort controller`、通知机制、前后台切换、进度追踪、结果摘要。
- **LocalAgentTaskState 是微型进程控制块**：标识（`id`、`agentId`、`agentType`）、生命周期（`status`、`startTime`、`endTime`）、控制（`abortController`）、输入输出（`prompt`、`result`、`error`、`outputFile`）、UI 管理（`isBackgrounded`、`retain`）、协同通信（`pendingMessages`）、可观测性（`progress`、`summary`）。
- **进度追踪务实**：只追踪用户真正关心的几件事——用了多少 token、调了多少工具、最近在干什么——而不是追求全量内部状态可视化。
- **enqueueAgentNotification() 用消息协议而非回调**：把 task 完成事件编码成 `<task-notification>` 格式的内部消息，优点是主线程统一按"消息"处理异步结果，UI 和 SDK 都能消费同一套协议，恢复/记录/显示都更统一。
- **支持前后台切换**：`registerAgentForeground()`、`backgroundAgentTask()`——用户刚发起子 agent 时想先看看它在做什么，跑太久就退后台，后台之后还能通知/恢复/查看 transcript。
- **取消是真正的生命周期转换**：涉及 `abortController.abort()`、cleanup 注销、状态切换为 `killed`、结果文件驱逐、UI 宽限时间。

### 核心架构关系

```
Coordinator（主 Agent）
  → AgentTool 派发子 Agent
  → LocalAgentTask 注册任务
  → 子 Agent 运行并更新 progress
  → enqueueAgentNotification（消息队列）
  → Coordinator 收到回流结果
```

### 对 Stratix 的启发

- Stratix 的多 Zone 协作目前缺少"子任务对象"的概念——每个 Zone 里的 agent 任务没有独立的 `taskId`、状态机、abort controller、进度追踪。可以参照 `LocalAgentTaskState` 设计一个 `ZoneAgentTaskState`。
- `enqueueAgentNotification()` 的消息驱动模式对应 Stratix 的 WebSocket 事件（`zone:updated`、`zone:member_joined` 等），但需要更结构化——把通知编码成带 schema 的事件，而不是散落的字符串事件。
- "子 agent 的核心问题不是怎么生成，而是怎么管理"——这个结论对 Stratix 的 ZoneAgent 系统同样成立。生成一个 ZoneAgent 容易，难的是跟踪、取消、通知、显示、恢复。

---

## 5. AgentTool.tsx：多 Agent 路由器（前半）

### 关键设计点

- **AgentTool 是 Agent 路由器，不是普通 Tool**：它不只定义输入和执行逻辑，还负责从当前工具池反推可用 MCP server、从权限规则里筛掉不可用 agent、从 coordinator/assistant/proactive 等模式决定执行形态。
- **输入 schema 本身暴露三层架构**：
  1. 任务层：`description`、`prompt`、`subagent_type`、`model`
  2. 身份层：`name`、`team_name`、`mode`
  3. 环境层：`isolation`、`cwd`
- **prompt() 揭示可用 agent 不是静态列表**：先根据当前工具池里的 `mcp__...` 工具抽出真正可用的 MCP server，再用 `filterAgentsByMcpRequirements()` 和 `filterDeniedAgents()` 过滤——agent 是否可选取决于它当前是否有足够的外部能力和权限。
- **call() 是执行形态分流树**：至少四种主要执行形态——teammate/team spawn、remote launch、async background agent、inline run——最终统一映射成 tool result。
- **工作目录隔离设计**：`createAgentWorktree` + `isolation=remote` 支持真正的环境隔离，不只是参数传递。

### 核心架构关系

```
AgentTool 调用请求
  → 解析输入与选择 selectedAgent
  → 校验 deny rules / MCP requirements
  → 是否存在 team_name + name？（新 teammate）
  → isolation = remote？（远程隔离）
  → 计算 shouldRunAsync
  → 分流：runAgent / registerAsyncAgent / spawnTeammate / registerRemoteAgentTask
  → mapToolResultToToolResultB（统一返回）
```

### 对 Stratix 的启发

- Stratix 的 Zone 间 Agent 协作缺少"路由器"这一层——目前是直接调用，缺少基于 MCP 可用性、权限规则的动态路由。
- Agent catalog 应该是"带运行时约束的可选角色集合"，而不是静态列表——Stratix 的 agent 注册机制可以朝这个方向演进，在 Zone 进入时动态计算可用 agent 集合。
- `isolation`、`cwd` 等环境层参数对应 Stratix Zone 的 workspace 隔离需求——目前 Zone 的 agent 工作目录隔离还没有系统级支持。
- `prompt()` 中的动态过滤逻辑值得 Stratix 借鉴——Zone 内的 agent 列表应该根据当前 MCP server 连接状态和用户权限动态计算，而不是写死的静态配置。
