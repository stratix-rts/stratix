# ADP v1 — Agent Driver Protocol

> 版本: v1.0 · 日期: 2026-08-01 · 状态: 草案冻结
> 配套: [STRATIX_WORKBENCH_DESIGN.md](../STRATIX_WORKBENCH_DESIGN.md)
> 维护者: Stratix Core Team

## 0. 目标

ADP 是 Stratix Workbench 与第三方 Agent CLI 之间的**核心稳定协议**。
它定义：

- **Manifest** — Agent 的能力描述
- **Envelope** — 所有消息的统一格式
- **Session 生命周期** — start / message / permission / cancel / resume
- **事件流** — Adapter → Orchestrator → UI
- **错误模型** — 跨实现的统一错误码

ADP v1 故意不绑定任何具体实现语言、不绑定任何具体 Agent CLI。

---

## 1. 总体原则

| 原则 | 含义 |
|------|------|
| **envelope 永远有 version** | `v: 1` 字段强制；接收方不识别的 v 立即拒绝 |
| **branded id** | `AgentId` / `SessionId` / `RunId` 是 string 但带品牌类型，避免误用 |
| **单向事件流** | Adapter → Orchestrator 走事件；反向走 request/response |
| **能力探测先行** | 任何 capability 在使用前必须出现在 manifest 中 |
| **权限显式** | 任何会"产生副作用"的 capability 必须能触发 permission_required |
| **幂等恢复** | 会话可基于 `sessionId` + checkpoint 恢复 |
| **降级友好** | capability 缺失/版本不匹配时优雅降级而非崩溃 |

---

## 2. 标识与品牌类型

```typescript
type ULID = string;                          // 26 char Crockford base32
type ISODate = string;                       // RFC 3339, e.g. "2026-08-01T07:00:00Z"
type JSONSchema = object;                    // Draft 2020-12

type AgentId   = string & { __brand: "AgentId" };
type AdapterId = string & { __brand: "AdapterId" };
type SessionId = string & { __brand: "SessionId" };
type RunId     = string & { __brand: "RunId" };
type ZoneId    = string & { __brand: "ZoneId" };
type CallId    = string & { __brand: "CallId" };
```

**规则**：

- 全部 ULID，按时间排序
- 跨进程边界持久化为字符串
- TypeScript 中用 branded type 防止误用

---

## 3. Agent Manifest

Agent 的**只读**能力描述。Discovery 阶段产出。

```typescript
interface AgentManifest {
  schemaVersion: 1;                          // 必填，用于未来演进
  id: AgentId;
  adapter: AdapterId;
  displayName: string;                       // 人类可读，最多 64 字符
  vendor?: string;                           // "anthropic" | "openai" | "openclaw" | ...
  version?: string;                          // 自由格式
  source: "path-scan" | "manual" | "plugin" | "remote";
  installPath?: string;                      // 绝对路径；source=path-scan 时必填
  avatarRef?: string;                        // 像素资源 id
  capabilities: AgentCapability[];
  auth: AuthDescriptor;
  probedAt: ISODate;                         // 最近一次能力探测时间
  schemaHints?: {                            // 可选，告知 UI 怎么渲染
    iconHint?: string;
    colorHint?: string;
  };
}

interface AgentCapability {
  id: string;                                // 反向 DNS: "code.generate" | "shell.exec"
  description?: string;                      // 人类可读
  inputSchema?: JSONSchema;                  // 参数 schema
  outputSchema?: JSONSchema;                 // 输出 schema
  requiresPermission: "always" | "dangerous-only" | "never";
  streaming: boolean;                        // 是否支持流式输出
  riskLevel: "low" | "medium" | "high";
}

interface AuthDescriptor {
  type: "none" | "oauth" | "api-key" | "device-code" | "external";
  scopes?: string[];
  statusHints?: string[];                    // 帮助 UI 提示用户去哪里获取 key
  envVars?: string[];                        // 适配器期望的 env 变量名
}
```

**字段约束**：

- `id` / `adapter` 全局唯一
- `capabilities` 至少包含一条
- `riskLevel=high` 的 capability 必须 `requiresPermission != "never"`

---

## 4. 协议 Envelope

**所有** ADP 消息都包在这个 envelope 里。Stdio / JSON-RPC / HTTP 适配器都遵守。

```typescript
interface ADPEnvelope<T extends string = string, P = unknown> {
  v: 1;                                      // 协议版本
  type: T;                                   // 消息类型
  id: ULID;                                  // 消息唯一 id，用于 request/response 配对
  sessionId: SessionId | null;               // null 表示 manifest 级别消息
  runId: RunId | null;                       // null 表示 session 级别消息
  ts: ISODate;
  payload: P;
}
```

**type 命名空间**：

| 前缀 | 方向 | 含义 |
|------|------|------|
| `manifest.*` | Adapter → Orchestrator | 能力描述 |
| `session.*` | 双向 | 会话级消息 |
| `run.*` | 双向 | 单次执行 |
| `control.*` | Orchestrator → Adapter | 控制（start/cancel/pause） |
| `event.*` | Adapter → Orchestrator | 事件流 |

---

## 5. 消息类型详细定义

### 5.1 Session 生命周期

```typescript
// Orchestrator → Adapter
interface ControlStartSession {
  sessionId: SessionId;
  agentId: AgentId;
  zoneId?: ZoneId;
  cwd?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
  resumeFrom?: SessionId;
  toolAllowList?: string[];                  // 显式允许的 capability id 列表
  permissionPolicy?: PermissionPolicy;
  timeoutMs?: number;                        // 派生进程的超时
}

// Adapter → Orchestrator
interface SessionStarted {
  sessionId: SessionId;
  capabilities: AgentCapability[];           // 该 session 实际可用能力
  runId: RunId;                             // 第一条 run 的 id
}

interface SessionCompleted {
  sessionId: SessionId;
  runId: RunId;
  summary: {
    durationMs: number;
    messageCount: number;
    toolCallCount: number;
    costTokens?: { input: number; output: number };
  };
}

interface SessionFailed {
  sessionId: SessionId;
  runId?: RunId;
  error: ADPError;
}

interface SessionHeartbeat {
  sessionId: SessionId;
  t: ISODate;
  load?: { cpu: number; memMB: number };
}
```

### 5.2 消息与 Tool Call

```typescript
// 双向
interface AgentMessage {
  role: "user" | "agent" | "system" | "tool";
  parts: MessagePart[];
  ts: ISODate;
}

type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string; signature?: string }
  | { kind: "tool_use"; callId: CallId; capability: string; params: unknown }
  | { kind: "tool_result"; callId: CallId; result: unknown; isError?: boolean }
  | { kind: "image_ref"; ref: string; mime: string }
  | { kind: "file_ref"; ref: string };

interface ToolCall {
  callId: CallId;
  capability: string;                        // 必须出现在 manifest.capabilities
  params: unknown;                           // 必须满足 capability.inputSchema
  reason?: string;                           // Agent 解释为什么需要
  risk: "low" | "medium" | "high";
}
```

### 5.3 权限流程

```typescript
// Adapter → Orchestrator
interface PermissionRequest {
  sessionId: SessionId;
  runId: RunId;
  callId: CallId;
  capability: string;
  params: unknown;
  risk: "low" | "medium" | "high";
  reason?: string;
}

// Orchestrator → Adapter
interface PermissionDecision {
  callId: CallId;
  decision: "allow" | "deny" | "always-allow" | "always-deny";
  scope?: "once" | "session" | "agent" | "global";
  reason?: string;                           // 用户/策略解释
}
```

**约束**：

- `risk=high` 必须等 decision 才能继续
- `risk=low` 可由 adapter 默认 allow，但仍要写审计
- `always-*` 必须落库（`agent_permissions` 表）
- adapter 超时（默认 30s）未收 decision 视为 deny；超时必须：
  1. 发 `event.session.failed` with `code=PERMISSION_TIMEOUT`（不静默）
  2. 写 `agent_audit_log`
  3. UI 必须弹通知 + 标注最近一次决策为 deny（H3 修正）

### 5.4 事件流

```typescript
// Adapter → Orchestrator 的所有事件走同一 envelope
type ADPEvent =
  | { type: "event.session.started"; payload: SessionStarted }
  | { type: "event.session.message"; payload: { sessionId: SessionId; runId: RunId; message: AgentMessage } }
  | { type: "event.session.tool_call"; payload: { sessionId: SessionId; runId: RunId; call: ToolCall; permission: "auto-allowed" | "pending" } }
  | { type: "event.session.permission_required"; payload: PermissionRequest }
  | { type: "event.session.completed"; payload: SessionCompleted }
  | { type: "event.session.failed"; payload: SessionFailed }
  | { type: "event.session.heartbeat"; payload: SessionHeartbeat }
  | { type: "event.run.user_message"; payload: { sessionId: SessionId; runId: RunId; message: AgentMessage } };
```

**事件约束**：

- 同一 session 的事件按 ts 单调递增
- 不可丢失关键事件（started / completed / failed）
- 工具调用结果可丢失（由 session 恢复机制补）

### 5.5 控制消息

```typescript
// Orchestrator → Adapter
type ControlMessage =
  | { type: "control.session.start"; payload: ControlStartSession }
  | { type: "control.session.cancel"; payload: { sessionId: SessionId; reason?: string } }
  | { type: "control.session.pause"; payload: { sessionId: SessionId } }
  | { type: "control.session.resume"; payload: { sessionId: SessionId } }
  | { type: "control.run.send_message"; payload: { sessionId: SessionId; runId: RunId; message: AgentMessage } }
  | { type: "control.permission.respond"; payload: { sessionId: SessionId; runId: RunId; decision: PermissionDecision } };
```

---

## 6. 权限策略

```typescript
interface PermissionPolicy {
  default: "allow" | "deny" | "ask";
  rules: Array<{
    capability?: string;                     // 匹配 capability id
    pattern?: string;                        // glob 匹配 params 的关键字段
    decision: "allow" | "deny" | "ask";
    scope: "once" | "session" | "agent" | "global";
  }>;
  interactive: boolean;                      // 是否允许 UI 弹窗
  auditLevel: "none" | "dangerous" | "all";
}
```

**决策优先级**（从高到低）：

1. 持久化策略（`agent_permissions` 表）匹配
2. policy.rules 按顺序匹配，第一条命中即用
3. policy.default
4. capability.requiresPermission 字段
5. **若仍不确定 → ask**（不直接 deny）

---

## 7. 错误模型

```typescript
type ADPErrorCode =
  | "AGENT_NOT_FOUND"        // AgentId 找不到对应 manifest
  | "ADAPTER_UNAVAILABLE"    // Adapter 未注册 / 加载失败
  | "AUTH_REQUIRED"          // 需要鉴权但未配置
  | "AUTH_FAILED"            // 鉴权失败
  | "PERMISSION_DENIED"      // 用户/策略拒绝
  | "PERMISSION_TIMEOUT"     // 决策超时
  | "SESSION_TIMEOUT"        // 会话整体超时
  | "PROTOCOL_VERSION_MISMATCH"   // v 字段不识别
  | "CAPABILITY_NOT_DECLARED"     // 调用的 capability 不在 manifest
  | "CAPABILITY_PARAMS_INVALID"   // params 不符合 inputSchema
  | "AGENT_CRASHED"          // 子进程崩溃
  | "USER_CANCELLED"         // 用户主动取消
  | "RATE_LIMITED"           // Agent 自身限流
  | "INTERNAL"               // 兜底
  | "ADAPTER_BUG";           // adapter 协议错误

interface ADPError {
  code: ADPErrorCode;
  message: string;
  retryable: boolean;
  hint?: string;
  cause?: unknown;
  ts: ISODate;
}
```

**UI 渲染**：

- `retryable=true` → 显示"重试"按钮
- `hint` → 上下文提示，如 "请先在设置中配置 ANTHROPIC_API_KEY"
- `cause` → 折叠在"详细信息"中

---

## 8. 传输约束

| Adapter | 传输 | 帧边界 | 推荐 |
|---------|------|--------|------|
| `stdio` | 子进程 stdin/stdout | NDJSON（每行一个 envelope） | 默认 |
| `pty` | 伪终端 | 自由文本 + 解析器 | 兜底（generic-cli） |
| `json-rpc` | LSP 风格 | Content-Length 头 | MCP 用 |
| `http` | 双向 SSE | SSE 事件 | 远程 Agent |
| `mcp` | JSON-RPC over stdio | LSP 风格 | 标准 MCP 服务器 |

**背压**：

- Adapter → Orchestrator 走 reactive stream，UI 端用 rxjs `bufferTime(50ms)` + `throttle`
- Orchestrator → Adapter 的 control 消息必须等上一条 ack（id 配对）
- 慢消费者必须显式抛 backpressure，adapter 选择丢弃非关键事件或暂停子进程

---

## 9. 会话恢复

```typescript
interface SessionCheckpoint {
  sessionId: SessionId;
  agentId: AgentId;
  adapter: AdapterId;
  createdAt: ISODate;
  // adapter-specific snapshot, opaque to orchestrator
  snapshot: unknown;
  // replay context
  cwd: string;
  env: Record<string, string>;
  messageCount: number;
  // 用于恢复的最小元数据
  lastMessage?: AgentMessage;
  pendingPermission?: PermissionRequest;
}
```

**规则**：

- `agent_sessions.snapshot_ref` 存 checkpoint 引用
- 恢复时 adapter 决定如何把 snapshot 喂回子进程
- checkpoint 写入失败不阻塞当前 session，但要告警

---

## 10. Schema 校验策略

- 所有 envelope 落地用 **zod** 校验（TypeScript 类型仅作 IDE 提示）
- adapter ↔ orchestrator 边界做严格校验；内部接口可放宽
- 未来 codegen：从 zod schema 生成 TypeScript 类型 + OpenAPI spec

**codegen 路径**（P0 后规划）：

```
zod schema (source of truth)
  ↓ ts-typegen
TypeScript types
  ↓ zod-to-openapi
OpenAPI spec
  ↓ openapi-typescript
前端 typed client
```

---

## 11. 版本演进

| 规则 | 含义 |
|------|------|
| `v=1` 不变即可加 type | 新增 envelope type 不破坏 v=1 协议 |
| `v=1` 删除 type 必须走 v=2 | 删除 = 不兼容 |
| `v=2` 时并存 | 旧 v=1 adapter 继续工作，新 manifest 标注 `minProtocol: 2` |
| Adapter 必须实现 capability 探测 | 接收方可通过 `manifest.capabilities` 知道对方能力 |
| unknown type 处理 | 接收方收到不识别的 type：`event.*` 忽略；`control.*` / `request.*` 返回 `PROTOCOL_VERSION_MISMATCH` |

**deprecation 流程**：

1. 在 v=1.1 标记 type 为 `@deprecated`
2. 至少 1 个 minor 版本共存
3. 在 `docs/protocol/CHANGELOG.md` 公布迁移路径
4. v=2.0 删除

---

## 12. 落地映射

| ADP 概念 | Stratix 模块 |
|---------|-------------|
| Manifest | `stratix-discovery/manifest-registry.ts` |
| Envelope | `stratix-adp/protocol/envelope.ts` |
| Stdio Driver | `stratix-adapters/stdio/` |
| Claude Code Adapter | `stratix-adapters/builtin/claude-code/` |
| MCP Client Adapter | `stratix-adapters/builtin/mcp/client-adapter.ts` |
| Stratix 自有 MCP Server | `stratix-gateway/api/mcp/server.ts` |
| Session Manager | `stratix-orchestration/session-manager.ts` |
| Policy Engine | `stratix-orchestration/policy-engine.ts` |
| Checkpoint | `agent_sessions.snapshot_ref` + `stratix-database/snapshots/` |
| 事件流 | `stratix-gateway/GatewayEventBus` + IPC `agent.event.subscribe` |
| Capability Schema | zod schemas in `stratix-adp/capability/schema.ts` |

---

## 13. 配套产物

| 文件 | 状态 |
|------|------|
| `docs/STRATIX_WORKBENCH_DESIGN.md` | ✅ v1.0 |
| `docs/protocol/ADP_v1.md` | ✅ 本文件 |
| `docs/STRATIX_REFACTOR_MAP.md` | ⏳ P0 产出 |
| `docs/ADAPTER_AUTHOR_GUIDE.md` | ⏳ P1 产出 |
| `docs/rubric/agent_workbench_eval.md` | ✅ 4.00/5.00 |

---

## 14. 变更日志

- 2026-08-01 v1.0：协议草案冻结，与 design 文档 §3 对齐；解决 SOLO 评分中 3 处薄弱点（schema 校验选型、deprecation 流程、unknown type 处理）
