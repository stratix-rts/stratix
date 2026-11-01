# Stratix Workbench — 本地多 Agent 工作台设计

> 版本: v1.0 · 日期: 2026-08-01 · 状态: 设计定稿（待 P0 实施）
> 维护者: Stratix Core Team

## 0. 一页纸摘要

Stratix 从"自建 Agent 框架"切换为**本地多 Agent 工作台（Workbench）**：保留 Zone、RTS、像素形象、命令面板等界面与交互资产，砍掉自研 Agent 大脑（`EnhancedStratixAgent`、`EnhancedPromptBuilder`、`Mixins`、`agency-agents` 模板导入、`stratix-ai-service`），改用统一的 **Agent Driver Protocol (ADP)** 接入本机已安装的第三方 Agent CLI。

- **产品名**：Stratix（不变）
- **自研 Agent**：砍掉。保留 Agent 像素模型与 UI 交互
- **Zone / RTS**：名称、交互、RTS 可视化全部保留
- **MVP 接入**：Claude Code（必选），Codex / OpenClaw / ClawAI 在后续阶段接入
- **发现机制**：用户触发 + 自动扫描 PATH（`which` / `where`）

**非目标**：

- ❌ 不再自研 Agent 大脑、Prompt 工程、Reflection、模板库
- ❌ 不托管 LLM API Key / 不做模型路由
- ❌ 不替代任何一个现有 Agent CLI

---

## 1. 需求理解（D1 — 关联结构）

### 1.1 显式需求（已与产品方确认）

| # | 需求 | 决策 |
|---|------|------|
| 1 | 名字不变 | 继续叫 Stratix |
| 2 | 自研 Agent 砍掉 | `stratix-agent`、`stratix-ai-service` 移除；Agent 像素模型/形象 UI 保留 |
| 3 | Zone / 交互 / RTS 不变 | 名称、行为、Phaser 场景全部保留 |
| 4 | MVP 接入 Claude Code | 第一阶段仅 Claude Code 跑通端到端 |
| 5 | 用户触发的 PATH 扫描 | 工作台有"扫描本机 Agent"按钮，自动扫 + 展示候选 |

### 1.2 隐含约束

- 第三方 Agent CLI 协议不统一 → 适配器层必须稳定
- 不改造第三方安装方式 → 适配器只读 `PATH` + 进程派生
- 既有 Zone / Project 数据不能丢 → 增量迁移
- 性能预算遵循 `docs/PERFORMANCE_GUIDELINES.md`

---

## 2. 方案完整性（D2 — 关联结构）

### 2.1 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 6  Workbench UI（Vue）                                  │
│   Library / Session / Terminal / Zone (RTS) / Permission Sheet│
├──────────────────────────────────────────────────────────────┤
│ Layer 5  Orchestration                                       │
│   SessionManager · TaskRouter · MultiAgentCoordinator        │
├──────────────────────────────────────────────────────────────┤
│ Layer 4  Agent Driver Protocol (ADP)  ← 核心稳定层           │
│   envelope · capabilities · permission · tool I/O · 事件流   │
├──────────────────────────────────────────────────────────────┤
│ Layer 3  Adapter SDK                                         │
│   StdioDriver · PTYDriver · JSONRPCDriver · MCPDriver        │
├──────────────────────────────────────────────────────────────┤
│ Layer 2  Discovery                                           │
│   PathScanner · CapabilityProbe · ManifestRegistry           │
├──────────────────────────────────────────────────────────────┤
│ Layer 1  Persistence（SQLite + 事件日志）                    │
├──────────────────────────────────────────────────────────────┤
│ Layer 0  Electron Host（main + preload + sandbox）           │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 关键数据流

**用户扫描 → 发现 → 启动**：

```
用户点击"扫描本机 Agent"
  → PathScanner 用 KNOWN_AGENTS 签名表并发探测
  → CapabilityProbe 用预填 capabilities 验证（无需沙箱询问）
  → ManifestRegistry 写入 SQLite + 广播 agent:discovered
  → Library 视图刷新
```

**P1 known signatures**（H2 修正）：

```typescript
const KNOWN_AGENTS: ProbeSignature[] = [
  { id: 'claude-code', names: ['claude', 'claude-code'],
    probeCmd: ['--version'], detectVersion: /^(\d+\.\d+\.\d+)/,
    capabilities: [/* 静态预填 4-6 个 */] },
];
// 探测命中 → 用静态 capabilities（O(1) 启动）
// 探测失败 → 走 generic-cli PTY driver 兜底
// P3 起加 heuristic 扫描所有 PATH（feature flag）
```

**Workbench 启动 Agent**：

```
用户在 Library 选 Claude Code → 点击"启动"
  → Orchestrator 选 adapter = stdio-driver + agent = claude-code
  → ADP.startSession({ agentId, cwd, systemPrompt })
  → Adapter spawn `claude` 进程，stdin/stdout 走 JSON 协议
  → 事件通过 IPC 推到渲染层
  → Zone 状态变为 busy / 像素形象播放 working 动画
```

**权限请求**：

```
Agent 触发 shell.exec
  → Adapter 发出 session.permission_required
  → 策略引擎匹配 PermissionPolicy
  → 若 ask：UI 弹 PermissionSheet
  → 用户决策回灌 adapter
  → 审计日志写入 agent_audit_log
```

### 2.3 现有模块改造决策

| 模块 | 决策 | 原因 |
|------|------|------|
| `stratix-rts` | ✅ 保留 | Zone 空间、Phaser 场景复用 |
| `stratix-project` (Zone) | ✅ 保留 | Zone = 工作上下文（任务/文件/权限），不改名 |
| `stratix-orchestration` | 🔧 改造 | 把 EnhancedStratixAgent 替换为 Orchestrator + ADP |
| `stratix-agent` | ❌ 删除 | 自建 Agent 大脑，违反目标 |
| `stratix-ai-service` | ❌ 删除 | LLM 路由下放给 Agent 自身 |
| `stratix-mcp` | 🔧 改造 | 升格为 ADP-MCP 适配器 |
| `stratix-openclaw-adapter` | 🔧 改造 | 进入 builtin adapters 目录 |
| `stratix-database` | 🔧 扩展 | 新增 agent_* / adapter_* 表 |
| `stratix-gateway` | ✅ 保留 | IPC + REST + WS 复用 |
| `stratix-task-executor` | 🔧 改造 | 并入 Orchestrator |
| `stratix-command-panel` | 🔧 改造 | Command 来源改为 ADP capability |
| `stratix-character-creator` | 🟡 归档 | 像素模型保留，编辑器转可选插件 |
| `stratix-designer` | ❌ 归档 | 与目标无关 |
| `stratix-nocodb` | ❌ 归档 | 与目标无关 |
| `stratix-tailscale` | 🟡 评估 | 远程 Agent 连接选项，延后到 P5 |
| `stratix-lra-bridge` | ✅ 保留 | LRA 任务追踪绑在 Zone |
| `stratix-blueprint` | ❌ 归档 | 与目标无关 |

### 2.4 Agent 像素模型

`stratix-character-creator` 的角色形象/动画/纹理**保留**。Agent 不再是"创建出来的"，而是"由 ADP 接入后被赋予视觉身份"：

- 每个 Agent Manifest 可选指定 `avatarRef`（像素资源 id）
- 启动 Session 时 Zone 中的形象从 idle 切到 working
- 取消 / 失败 / 完成触发不同动画
- 形象资源在 Library 视图中可作为 Agent 视觉标识

---

## 3. 接口契约（D3 — 关联结构）

### 3.1 核心领域类型

```typescript
// ── Agent 标识 ──
type AgentId = string & { __brand: "AgentId" };
type AdapterId = string & { __brand: "AdapterId" };
type SessionId = string & { __brand: "SessionId" };
type RunId = string & { __brand: "RunId" };

// ── Agent 描述（来自 Discovery + Probe）──
interface AgentManifest {
  id: AgentId;
  adapter: AdapterId;
  displayName: string;
  vendor?: string;
  version?: string;
  source: "path-scan" | "manual" | "plugin" | "remote";
  installPath?: string;
  avatarRef?: string;          // 像素资源 id（可选）
  capabilities: AgentCapability[];
  auth: AuthDescriptor;
  schemaVersion: 1;
}

interface AgentCapability {
  id: string;                  // "code.generate", "shell.exec" 等
  description?: string;
  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;
  requiresPermission: "always" | "dangerous-only" | "never";
  streaming: boolean;
}

interface AuthDescriptor {
  type: "none" | "oauth" | "api-key" | "device-code" | "external";
  scopes?: string[];
  statusHints?: string[];
}

// ── Adapter Driver 接口 ──
interface AgentAdapter {
  readonly id: AdapterId;
  readonly kind: "stdio" | "pty" | "json-rpc" | "mcp" | "http";

  probe(candidate: ProbeCandidate): Promise<AgentManifest | null>;
  startSession(opts: StartSessionOptions): Promise<AgentSession>;
  cancel(runId: RunId, reason?: string): Promise<void>;
  sendMessage(runId: RunId, msg: AgentMessage): Promise<void>;
  respondPermission(runId: RunId, decision: PermissionDecision): Promise<void>;
  resumeSession(opts: ResumeSessionOptions): Promise<AgentSession>;
}

// ── 会话与运行 ──
interface AgentSession {
  id: SessionId;
  agentId: AgentId;
  zoneId?: string;
  startedAt: string;            // ISO
  status: "starting" | "running" | "paused" | "completed" | "failed" | "cancelled";
  runIds: RunId[];
  events$: AsyncIterable<ADPEvent>;
}

interface StartSessionOptions {
  agentId: AgentId;
  zoneId?: string;
  cwd?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
  resumeFrom?: SessionId;
  toolAllowList?: string[];
  permissionPolicy?: PermissionPolicy;
}

interface PermissionPolicy {
  default: "allow" | "deny" | "ask";
  rules: Array<{
    capability?: string;
    pattern?: string;
    decision: "allow" | "deny" | "ask";
  }>;
  interactive: boolean;
}
```

### 3.2 ADP 协议 Envelope

```typescript
interface ADPEnvelope<T extends string = string> {
  v: 1;
  type: T;
  id: string;                   // ULID
  sessionId: SessionId;
  runId?: RunId;
  ts: string;                   // ISO
  payload: unknown;
}

// 事件
type ADPEvent =
  | { type: "session.started"; capabilities: AgentCapability[] }
  | { type: "session.message"; message: AgentMessage }
  | { type: "session.tool_call"; call: ToolCall; permission: "pending" | "auto-allowed" }
  | { type: "session.permission_required"; request: PermissionRequest }
  | { type: "session.completed"; summary: RunSummary }
  | { type: "session.failed"; error: ADPError }
  | { type: "session.heartbeat"; t: string; load?: { cpu: number; memMB: number } };
```

### 3.3 数据库契约（增量）

新增表（保留 `zones` / `zone_contexts` / `zone_files`）：

| 表 | 关键字段 |
|----|---------|
| `agent_manifests` | id, adapter_kind, source, install_path, manifest_json, last_probed_at |
| `agent_capabilities` | agent_id, capability_id, schema_json, requires_permission |
| `agent_sessions` | id, agent_id, zone_id, status, started_at, ended_at, snapshot_ref |
| `agent_runs` | id, session_id, status, input_ref, output_ref, started_at |
| `agent_events` | id, session_id, run_id, type, payload_json, ts |
| `agent_permissions` | id, agent_id, capability, pattern, decision, scope, granted_by |
| `adapter_manifests` | id, kind, entry_path, signature, enabled |
| `agent_audit_log` | id, session_id, action, target, result, ts |

### 3.4 IPC 契约

主进程暴露（typed，zod 校验）：

- `agent.scan`         — 触发 PATH 扫描
- `agent.list`         — 列出已登记 Agent
- `agent.probe`        — 重新探测某候选
- `agent.session.start`  — 启动 Session
- `agent.session.cancel` — 取消 Session
- `agent.permission.respond` — 权限决策
- `agent.event.subscribe`   — 事件流订阅

WebSocket 事件：

- `agent:discovered` / `agent:updated` / `agent:removed`
- `agent:session:started` / `agent:session:message` / `agent:session:tool_call`
- `agent:session:permission_required` / `agent:session:completed` / `agent:session:failed`

### 3.5 错误模型

```typescript
type ADPErrorCode =
  | "AGENT_NOT_FOUND" | "ADAPTER_UNAVAILABLE" | "AUTH_REQUIRED"
  | "PERMISSION_DENIED" | "SESSION_TIMEOUT" | "PROTOCOL_VERSION_MISMATCH"
  | "INTERNAL" | "USER_CANCELLED" | "AGENT_CRASHED";

interface ADPError {
  code: ADPErrorCode;
  message: string;
  retryable: boolean;
  hint?: string;
  cause?: unknown;
}
```

---

## 4. 架构一致性（D4 — 关联结构）

### 4.1 目录组织

```
src/
  stratix-adp/                  ← Layer 4 核心稳定层
    protocol/                   types.ts envelope.ts errors.ts
    capability/                 schema.ts registry.ts
  stratix-adapters/             ← Layer 3 适配器 SDK
    stdio/      pty/      json-rpc/      mcp/      http/
    builtin/
      claude-code/              MVP 必选
      codex/                    P3
      openclaw/                 P3
      clawai/                   P4
      generic-cli/              P2（PTY 兜底）
  stratix-orchestration/        ← 改造后的协调器
    session-manager.ts
    task-router.ts
    multi-agent-coordinator.ts
    policy-engine.ts
  stratix-discovery/            ← Layer 2
    path-scanner.ts
    capability-probe.ts
    manifest-registry.ts
  stratix-workbench/            ← UI 核心
    views/        LibraryView SessionView TerminalView ZoneView PermissionSheet
    composables/  useAgentLibrary useAgentSession usePermission
  stratix-rts/                  ✅ 保留
  stratix-gateway/              ✅ 保留
  stratix-database/             🔧 扩展
  stratix-lra-bridge/           ✅ 保留
  stratix-character-creator/    🟡 像素资源保留
```

### 4.2 与现有机制衔接

- `stratix-gateway` IPC + REST + WS 全保留
- `stratix-database` schema migration 机制沿用
- `stratix-rts` Zone 空间作为 Agent 状态画布
- `stratix-command-panel` 改造为消费 ADP capability
- Design System 继续作为 UI 一致性来源
- LRA 任务追踪绑在 Zone

### 4.3 性能约束（与 PERFORMANCE_GUIDELINES.md 对齐）

- Adapter 进程派生 `child_process.spawn` + `unref`
- 事件流 rxjs buffer + debounce 背压
- 1000+ Agent 列表虚拟滚动
- Probe 超时 5s，并发 ≤ 4
- Adapter 进程崩溃由 heartbeat + liveness 回收
- 单机最大并发 Agent session：8

### 4.4 增量改造原则

- 自研 Agent 代码先 deprecated 1 个版本，再删除
- Zone 数据双写期 + 旧表只读视图
- Feature flag `STRATIX_MODE = 'workbench' | 'legacy'`

---

## 5. 风险识别（D5 — 拓展抽象）

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| 第三方 CLI 协议不统一 | 高 | 高 | 适配器层 + 能力探测，偏差进隔离沙箱 |
| 适配器进程失控 | 中 | 高 | heartbeat + liveness + 自动回收 |
| 本地安全（Agent 拿 shell） | 高 | 高 | PermissionPolicy 默认 deny、危险操作 UI 确认、全审计 |
| 自研代码删除引发回归 | 中 | 中 | deprecated 1 版本 + feature flag |
| Zone 语义改造数据迁移失败 | 中 | 中 | 双写 + 旧表只读视图 + 可回滚脚本 |
| ADP 过早稳定限制扩展 | 中 | 中 | envelope 带 `v` 字段 + capability 探测 |
| Discovery 误报（PATH 命中非 Agent） | 中 | 低 | Probe 必须主动询问 + 失败即丢弃 |
| PATH 扫描吃满 CPU | 低 | 中 | 并发 ≤ 4 + 超时 5s + LRU 缓存 |
| Electron sandbox 限制派生进程 | 中 | 中 | 派生走 main 进程；preload 只做 typed 桥 |
| 远程 Agent 引入新攻击面 | 中 | 高 | P5 才考虑；先 SSH key 签名白名单 |

**回滚方案**：每个阶段保留旧入口与旧数据；`STRATIX_MODE=legacy` 30 秒内切回。

---

## 6. 可验证性（D6 — 关联结构 + 拓展抽象）

### P0 — 协议冻结

```bash
npm run typecheck
# 预期：0 error，ADP protocol 全链路类型完整
npm run test -- stratix-adp
# 预期：envelope / capability / error 单测通过
```

### P1 — Discovery + Claude Code Adapter

```bash
# 在装了 Claude Code 的机器上：
npx tsx scripts/scan-agents.ts
# 预期：列出 PATH 中可识别的 Agent，含 capabilities

npm run test:e2e -- e2e/agent-discover.spec.ts
# 预期：发现 → 启动 → 简单对话 → 结束
```

### P2 — Workbench UI

```bash
npm run dev
# 手动验收：Library 显示 Claude Code，点开 Session 跑 hello world
npx playwright test e2e/workbench-library.spec.ts
# 预期：UI 自动化通过
```

### P3 — Orchestrator

```bash
# 单任务多 Agent 串行
STRATIX_TEST_MODE=1 npm run test:e2e -- e2e/multi-agent.spec.ts
# 预期：录屏证据，Zone 状态从 idle → busy → done
```

### P4 — 权限与审计

```bash
npx playwright test e2e/permission-flow.spec.ts
# 预期：拒绝 / 允许路径均验证
# 审计：SELECT count(*) FROM agent_audit_log WHERE session_id=? == 交互数
```

### 性能边界

- 8 个 session × 1000 events：UI 60fps
- Discovery 扫描 1000 候选：≤ 5s
- Permission 弹窗响应：≤ 200ms
- Probe 并发 ≤ 4，超时 5s 必杀

---

## 7. 实施阶段

| 阶段 | 范围 | 验收 |
|------|------|------|
| P0 | 冻结 ADP v1 草案，抽出 Adapter SDK，删除 stratix-agent / stratix-ai-service（保留 deprecated 入口） | 协议类型完整、删除路径可构建 |
| P1 | PathScanner + CapabilityProbe + Claude Code Stdio Adapter | 扫描 → 启动 → 对话 → 结束 e2e 通过 |
| P2 | Workbench UI v1：Library / Session / Terminal / Zone 集成 | 录屏演示 |
| P3 | Orchestrator：单任务多 Agent 串行、Zone 状态联动 | 跑通多 Agent 任务 |
| P4 | PermissionPolicy + 审计 + Session 恢复 | 权限/审计 e2e |
| P5 | 远程 Agent（SSH/Tailscale）、Codex/OpenClaw/ClawAI 适配器、插件市场 | 可选验收 |

---

## 8. 配套产物

| 文档 | 路径 | 状态 |
|------|------|------|
| ADP 协议规范 | `docs/protocol/ADP_v1.md` | ✅ v1.0 |
| 现有模块改造图 | `docs/STRATIX_REFACTOR_MAP.md` | ✅ v1.2 |
| 本设计自评 | `docs/rubric/agent_workbench_eval.md` | ✅ 4.00/5.00 |
| 本设计评审 | `docs/rubric/agent_workbench_review.md` | ✅ H1–H4 已修 |
| 适配器编写指南 | `docs/ADAPTER_AUTHOR_GUIDE.md` | ⏳ P1 产出 |
| Claude Code 适配器研究 | `docs/claude-code-study/` | ✅ 已有，持续更新 |

---

## 9. 与 CLAUDE.md 引用关系

本设计在 `CLAUDE.md` 末尾"Quick Start"之后追加以下章节：

```markdown
## Agent Workbench（P0 实施中）

Stratix 当前定位为**本地多 Agent 工作台**，不再自建 Agent 大脑。
- 设计文档：[STRATIX_WORKBENCH_DESIGN.md](docs/STRATIX_WORKBENCH_DESIGN.md)
- 协议规范：docs/protocol/ADP_v1.md（P0 产出）
- 自研 Agent 模块（stratix-agent / stratix-ai-service）进入 deprecated 1 个版本后删除
- Zone / RTS / 像素形象保留
- MVP 接入 Claude Code；Codex / OpenClaw / ClawAI 在后续阶段
- 性能预算遵循 [PERFORMANCE_GUIDELINES.md](docs/PERFORMANCE_GUIDELINES.md)
```

---

## 10. 变更日志

- 2026-08-01 v1.0：设计定稿（产品方拍板 5 项决策）
