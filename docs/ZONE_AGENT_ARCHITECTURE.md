# Zone Agent 架构设计文档

**版本**: v1.0
**创建日期**: 2026-04-01
**状态**: 设计中
**维护者**: Stratix Team

---

## 1. 背景与目标

### 1.1 问题陈述

当前 Stratix 的 Zone 系统存在以下问题：

1. **Zone 定位不清**: Zone 既是容器又是上下文，缺乏明确的 Agent 行为定义
2. **Agent 间通信缺失**: Agent 无法在 Zone 内有效协作，消息传递机制未被充分利用
3. **Task 流转无记录**: 任务分派后无追踪，无法审计谁在何时做了什么事
4. **用户不透明**: 用户在 UI 上看不到 Zone 内 Agent 的协作过程

### 1.2 设计目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| **Zone as Agent** | Zone 本身就是 Coordinator Agent，负责分解需求和分派任务 | P0 |
| **Agent 协作协议** | 定义 Zone↔Agent、Agent↔Agent 的标准化通信方式 | P0 |
| **可审计** | 所有操作持久化，用户可在 UI 上追溯协作过程 | P0 |
| **用户透明** | Zone 面板显示成员状态、任务流转、消息记录 | P1 |
| **自主与可控** | Agent 可自主行动，用户可干预关键决策点 | P1 |

### 1.3 非目标

- 不实现跨 Zone 的显式层级关系（Zone 之间通过文件/消息间接协作）
- 不实现 claude-code-cli 式的显式 Coordinator Agent 进程
- 不实现实时的多用户协作编辑（CRDT）

---

## 2. 核心概念

### 2.1 实体关系图

```
┌─────────────────────────────────────────────────────────────┐
│                        Zone (Coordinator)                    │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Identity: title (O) + prompt (KR)                 │  │
│  │  Brain: LLM for requirement decomposition           │  │
│  │  Responsibilities:                                  │  │
│  │    - 接收需求                                        │  │
│  │    - 分解任务                                        │  │
│  │    - 分派任务                                        │  │
│  │    - 监控进度                                        │  │
│  │    - 汇总结果                                        │  │
│  └─────────────────────────────────────────────────────┘  │
│                           │                                 │
│           ┌───────────────┼───────────────┐                 │
│           ▼               ▼               ▼                 │
│     ┌─────────┐      ┌─────────┐      ┌─────────┐          │
│     │ Agent A │      │ Agent B │      │ Agent C │          │
│     │(执行者) │      │(执行者) │      │(执行者) │          │
│     └─────────┘      └─────────┘      └─────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Zone 的双重身份

| 身份 | 职责 | 类比 |
|------|------|------|
| **容器 (Team)** | 提供协作边界，存储成员、任务、消息、文件 | 物理空间 |
| **协调者 (Coordinator)** | 分解需求、分派任务、监控进度、汇总结果 | 团队领导 |

### 2.3 Agent 的角色

| 角色 | 职责 | 触发方式 |
|------|------|----------|
| **执行者 (Executor)** | 接收任务、执行任务、上报结果 | Zone 分派 / 自主认领 |
| **协作者 (Collaborator)** | 接收消息、响应 @mention、参与讨论 | 消息到达 |

---

## 3. 架构设计

### 3.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend (RTS/UI)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ ZonePanel   │  │ TaskList    │  │ MessageFeed │  │ AuditTrail  │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Gateway (Express + WS)                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                     OrchestrationSync                        │    │
│  │   监听 Zone/Task/Agent/Message 事件，广播到 WebSocket        │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│    ZoneManager     │   │  TaskQueueService  │   │ AgentMessageRouter │
│  (Zone CRUD + 成员)│   │  (任务队列管理)     │   │  (消息路由)        │
└───────────────────┘   └───────────────────┘   └───────────────────┘
        │                         │                         │
        └─────────────────────────┼─────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          ZoneCoordinator                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Zone Brain (LLM)                                          │    │
│  │  - 解析需求 → TaskItem[]                                    │    │
│  │  - 匹配 Agent 能力                                          │    │
│  │  - 分派任务                                                 │    │
│  │  - 汇总结果                                                 │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EnhancedStratixAgent (Executor)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │ SkillExecutor│  │ MemoryManager│  │ Reflection  │                  │
│  └─────────────┘  └─────────────┘  └─────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心模块职责

| 模块 | 职责 | 关键类 |
|------|------|--------|
| **ZoneCoordinator** | Zone 的协调者大脑，分解需求、分派任务 | `ZoneCoordinator.ts` |
| **ZoneManager** | Zone 的容器管理，成员进出、CRUD | `ZoneManager.ts` |
| **TaskQueueService** | 任务队列管理，认领、执行、完成 | `TaskQueueService.ts` |
| **TaskFlowRepository** | 任务流转记录，持久化审计 | `TaskFlowRepository.ts` |
| **AgentMessageRouter** | Agent 间消息路由，支持多种消息类型 | `AgentMessageRouter.ts` |
| **AuditLogRepository** | 操作审计日志，持久化可查询 | `AuditLogRepository.ts` |
| **OrchestrationSync** | 桥接后端事件到 WebSocket | `OrchestrationSync.ts` |

---

## 4. 数据模型

### 4.1 实体关系

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│      Zone       │       │   ZoneMember    │       │      Agent      │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id              │───────│ zoneId          │       │ agentId         │
│ title (O)       │       │ agentId         │───────│ name            │
│ prompt (KR)     │       │ role            │       │ capabilities[]  │
│ coordinatorConfig│       │ enteredAt       │       │ status         │
│ createdAt       │       │ leftAt          │       └─────────────────┘
└─────────────────┘       └─────────────────┘
        │
        │ 1:N
        ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   ZoneTask      │       │    TaskFlow     │       │  AgentMessage    │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id              │───────│ taskId          │       │ messageId       │
│ zoneId          │       │ flowId          │       │ conversationId  │
│ title           │       │ fromAgentId     │       │ senderId        │
│ description     │       │ toAgentId       │       │ recipientId     │
│ type            │       │ action          │       │ content         │
│ status          │       │ metadata        │       │ messageType     │
│ assigneeId      │       │ createdAt       │       │ createdAt       │
│ createdBy       │       └─────────────────┘       └─────────────────┘
└─────────────────┘
        │
        │ 1:N
        ▼
┌─────────────────┐       ┌─────────────────┐
│   TaskStep      │       │  AuditLog       │
├─────────────────┤       ├─────────────────┤
│ id              │       │ id              │
│ taskId          │       │ zoneId          │
│ name            │       │ eventType       │
│ status          │       │ actorId         │
│ executedBy      │       │ targetId        │
│ result          │       │ metadata        │
│ createdAt       │       │ createdAt       │
└─────────────────┘       └─────────────────┘
```

### 4.2 数据库 Schema

```sql
-- Zone 表（扩展）
CREATE TABLE zones (
  zone_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(project_id),
  title TEXT NOT NULL,                    -- Zone 标题 (Objective)
  prompt TEXT,                           -- Zone 提示词 (Key Results)
  coordinator_config TEXT,               -- JSON: Coordinator 配置
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,                    -- 软删除
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- Zone 成员表（新增）
CREATE TABLE zone_members (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  role TEXT DEFAULT 'executor',         -- 'coordinator' | 'executor'
  entered_at INTEGER NOT NULL,
  left_at INTEGER,
  UNIQUE(zone_id, agent_id),
  INDEX idx_members_zone (zone_id),
  INDEX idx_members_agent (agent_id)
);

-- Zone Coordinator 配置表（新增）
CREATE TABLE zone_coordinators (
  zone_id TEXT PRIMARY KEY REFERENCES zones(zone_id) ON DELETE CASCADE,
  llm_provider TEXT DEFAULT 'openai',
  model TEXT,
  auto_decompose INTEGER DEFAULT 1,
  auto_assign INTEGER DEFAULT 1,
  require_user_confirm INTEGER DEFAULT 0,
  assign_strategy TEXT DEFAULT 'capability_match',  -- 'random' | 'capability_match' | 'load_balance' | 'priority'
  entry_condition TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Agent 能力表（新增）
CREATE TABLE agent_capabilities (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
  capability TEXT NOT NULL,              -- 'coding' | 'writing' | 'analysis' | 'research' | 'general'
  level INTEGER DEFAULT 1,               -- 1-5 熟练度
  current_load INTEGER DEFAULT 0,        -- 当前任务数
  updated_at INTEGER NOT NULL,
  UNIQUE(agent_id, zone_id, capability),
  INDEX idx_cap_zone (zone_id),
  INDEX idx_cap_load (zone_id, current_load)
);

-- Task 流转记录表（新增）
CREATE TABLE task_flow (
  flow_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  from_agent_id TEXT,                    -- null 表示 Zone 初始创建
  to_agent_id TEXT NOT NULL,
  action TEXT NOT NULL,                  -- 'created' | 'delegated' | 'claimed' | 'started' | 'completed' | 'failed' | 'cancelled'
  metadata TEXT,                         -- JSON: { reason, output, issues, etc. }
  created_at INTEGER NOT NULL,
  INDEX idx_flow_task (task_id),
  INDEX idx_flow_zone (zone_id),
  INDEX idx_flow_agent (to_agent_id)
);

-- 操作审计日志表（新增）
CREATE TABLE zone_audit_log (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL,
  event_type TEXT NOT NULL,              -- 'agent_entered' | 'agent_left' | 'task_created' | 'task_assigned' | 'task_completed' | 'message_sent' | 'skill_executed'
  actor_id TEXT,                         -- agentId 或 userId
  target_id TEXT,                        -- agentId / taskId / messageId
  metadata TEXT,                          -- JSON 扩展数据
  created_at INTEGER NOT NULL,
  INDEX idx_audit_zone (zone_id),
  INDEX idx_audit_actor (actor_id),
  INDEX idx_audit_type (event_type),
  INDEX idx_audit_time (created_at)
);
```

### 4.3 核心类型定义

```typescript
// ============================================
// Zone Coordinator 类型
// ============================================

/**
 * Zone Coordinator 配置
 */
export interface ZoneCoordinatorConfig {
  llmProvider: 'openai' | 'anthropic' | 'ollama' | 'deepseek';
  model: string;
  autoDecompose: boolean;       // 自动分解需求
  autoAssign: boolean;          // 自动分派任务
  requireUserConfirm: boolean;   // 分派前需用户确认
  assignStrategy: 'random' | 'capability_match' | 'load_balance' | 'priority';
  entryCondition?: string;      // Agent 进入 Zone 的条件
}

/**
 * Zone 角色
 */
export type ZoneMemberRole = 'coordinator' | 'executor';

/**
 * Zone 成员
 */
export interface ZoneMember {
  id: string;
  zoneId: string;
  agentId: string;
  role: ZoneMemberRole;
  enteredAt: number;
  leftAt?: number;
}

/**
 * Agent 能力
 */
export interface AgentCapability {
  id: string;
  agentId: string;
  zoneId: string;
  capability: 'coding' | 'writing' | 'analysis' | 'research' | 'general';
  level: 1 | 2 | 3 | 4 | 5;
  currentLoad: number;  // 当前执行中的任务数
  updatedAt: number;
}

// ============================================
// Task 流转类型
// ============================================

/**
 * Task 流转动作
 */
export type TaskFlowAction =
  | 'created'    // Zone 创建任务
  | 'delegated'  // Zone 分派给 Agent
  | 'claimed'    // Agent 主动认领
  | 'started'    // Agent 开始执行
  | 'completed'  // Agent 完成
  | 'failed'     // Agent 失败
  | 'cancelled'; // 取消

/**
 * Task 流转记录
 */
export interface TaskFlowRecord {
  flowId: string;
  taskId: string;
  zoneId: string;
  fromAgentId: string | null;  // null 表示 Zone 创建
  toAgentId: string;
  action: TaskFlowAction;
  metadata?: {
    reason?: string;
    output?: string;
    files?: string[];
    issues?: string[];
    duration?: number;
  };
  createdAt: number;
}

// ============================================
// 审计日志类型
// ============================================

/**
 * 审计事件类型
 */
export type AuditEventType =
  | 'agent_entered'      // Agent 进入 Zone
  | 'agent_left'         // Agent 离开 Zone
  | 'task_created'       // 任务创建
  | 'task_assigned'      // 任务分派
  | 'task_claimed'        // 任务认领
  | 'task_started'       // 任务开始执行
  | 'task_completed'     // 任务完成
  | 'task_failed'        // 任务失败
  | 'message_sent'       // 消息发送
  | 'skill_executed'     // Skill 执行
  | 'context_shared';    // 上下文共享

/**
 * 审计日志记录
 */
export interface AuditLogRecord {
  id: string;
  zoneId: string;
  eventType: AuditEventType;
  actorId: string | null;   // agentId 或 userId
  targetId: string | null;
  metadata?: Record<string, any>;
  createdAt: number;
}

// ============================================
// 消息类型扩展
// ============================================

/**
 * Zone 内消息类型
 */
export type ZoneMessageType =
  | 'chat'              // 普通聊天
  | 'task_delegate'     // 任务分派通知
  | 'task_progress'     // 任务进度汇报
  | 'task_result'       // 任务结果汇报
  | 'mention'           // @提及
  | 'broadcast'         // 广播
  | 'context_share'     // 上下文共享
  | 'system';           // 系统消息
```

---

## 5. Skill 协议设计

### 5.1 Zone → Agent Skills

| Skill ID | 触发者 | 描述 | 关键参数 |
|---------|--------|------|----------|
| `task_delegate` | Zone | 分派任务给 Agent | `{taskId, taskDescription, taskType, priority, deadline}` |
| `task_cancel` | Zone | 取消任务 | `{taskId, reason}` |
| `context_update` | Zone | 更新 Agent 上下文 | `{contextDelta}` |
| `capability_query` | Zone | 查询 Agent 能力 | `{}` |

### 5.2 Agent → Zone Skills

| Skill ID | 触发者 | 描述 | 关键参数 |
|---------|--------|------|----------|
| `task_claim` | Agent | 认领任务 | `{taskId, capability}` |
| `task_progress` | Agent | 上报进度 | `{taskId, progress, status}` |
| `task_complete` | Agent | 完成任务 | `{taskId, success, output, files}` |
| `task_issue` | Agent | 上报问题 | `{taskId, issue, severity}` |
| `capability_update` | Agent | 更新能力状态 | `{capabilities, currentLoad}` |

### 5.3 Skill 参数定义

```typescript
// ============================================
// Zone → Agent Skills
// ============================================

/**
 * task_delegate - Zone 分派任务给 Agent
 */
interface TaskDelegateParams {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  taskType: 'coding' | 'writing' | 'analysis' | 'research' | 'general';
  priority: 1 | 2 | 3 | 4 | 5;
  deadline?: number;           // Unix timestamp
  outputPath?: string;
  context?: {
    files?: string[];         // 相关文件路径
    references?: string[];     // 参考文档
    previousTaskId?: string;   // 前置任务
  };
  requireUserConfirm?: boolean;
}

/**
 * task_cancel - Zone 取消任务
 */
interface TaskCancelParams {
  taskId: string;
  reason: string;
}

// ============================================
// Agent → Zone Skills
// ============================================

/**
 * task_progress - Agent 上报进度
 */
interface TaskProgressParams {
  taskId: string;
  progress: number;           // 0-100
  status: 'in_progress' | 'blocked' | 'waiting';
  message?: string;
  currentStep?: string;
}

/**
 * task_complete - Agent 完成任务
 */
interface TaskCompleteParams {
  taskId: string;
  success: boolean;
  output?: string;            // 执行结果描述
  files?: string[];           // 产出文件路径
  summary?: string;           // 任务总结
  issues?: string[];          // 遗留问题
  duration?: number;          // 执行耗时（毫秒）
}

/**
 * task_issue - Agent 上报问题
 */
interface TaskIssueParams {
  taskId: string;
  issue: string;              // 问题描述
  severity: 'low' | 'medium' | 'high' | 'critical';
  suggestedFix?: string;      // 建议解决方案
}

/**
 * capability_update - Agent 更新能力
 */
interface CapabilityUpdateParams {
  capabilities: Array<{
    capability: 'coding' | 'writing' | 'analysis' | 'research' | 'general';
    level: 1 | 2 | 3 | 4 | 5;
  }>;
  currentLoad: number;        // 当前任务数
}
```

---

## 6. 核心流程

### 6.1 需求分解与任务分派流程

```
┌──────────────────────────────────────────────────────────────────────┐
│                         需求处理流程                                  │
└──────────────────────────────────────────────────────────────────────┘

用户/上游Zone
     │
     │ 1. 提交需求
     ▼
┌────────────────────────────────────────────────────────────────────┐
│                      ZoneCoordinator                                │
│                                                                    │
│  2. LLM 解析需求                                                    │
│     ┌─────────────────────────────────────────────────────────┐    │
│     │ Prompt: 你是一个 ${zone.title} 的协调者。                  │    │
│     │ 用户需求: ${requirement}                                  │    │
│     │ 当前成员: ${memberAgents}                                 │    │
│     │ 请分解任务并选择合适的执行者。                               │    │
│     └─────────────────────────────────────────────────────────┘    │
│                                                                    │
│  3. 生成 TaskItem[]                                                 │
│     - task_1: 需求分析                                              │
│     - task_2: 代码实现                                              │
│     - task_3: 测试验证                                              │
│                                                                    │
│  4. 匹配 Agent 能力                                                  │
│     - task_1 → Agent-A (analysis能力强)                             │
│     - task_2 → Agent-B (coding能力强)                               │
│     - task_3 → Agent-C (通用)                                       │
│                                                                    │
│  5. 分派任务 (task_delegate skill)                                  │
└────────────────────────────────────────────────────────────────────┘
     │
     │ 6. 发送 task_delegate
     ▼
┌────────────────────────────────────────────────────────────────────┐
│                      EnhancedStratixAgent                           │
│                                                                    │
│  7. 接收任务                                                        │
│  8. 执行任务                                                        │
│  9. 上报进度 (task_progress skill)                                  │
│  10. 完成任务 (task_complete skill)                                 │
└────────────────────────────────────────────────────────────────────┘
     │
     │ 11. 发送 task_complete
     ▼
┌────────────────────────────────────────────────────────────────────┐
│                      ZoneCoordinator                                │
│                                                                    │
│  12. 汇总结果                                                       │
│  13. 检查是否所有任务完成                                            │
│  14. 如需继续 → 分解新任务                                           │
│  15. 否则 → 向用户/上游 Zone 汇报结果                                │
└────────────────────────────────────────────────────────────────────┘
```

### 6.2 Agent 自主认领流程

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Agent 自主认领流程                                │
└──────────────────────────────────────────────────────────────────────┘

     │
     │ 1. Zone 发布任务 (task_delegate → 所有成员)
     ▼
┌────────────────────────────────────────────────────────────────────┐
│                      EnhancedStratixAgent (Executor)                 │
│                                                                    │
│  2. 监听 Zone 广播的任务                                            │
│  3. 检查自身能力是否匹配                                            │
│  4. 检查当前负载是否允许                                            │
│  5. 如果匹配 → 调用 task_claim skill                               │
└────────────────────────────────────────────────────────────────────┘
     │
     │ 6. 发送 task_claim
     ▼
┌────────────────────────────────────────────────────────────────────┐
│                      ZoneCoordinator                                │
│                                                                    │
│  7. 验证认领者能力                                                  │
│  8. 确认任务分配                                                    │
│  9. 更新 task_flow 记录                                            │
│  10. 通知其他 Agent 任务已被认领                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 6.3 协作消息流程

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Agent 间协作流程                                  │
└──────────────────────────────────────────────────────────────────────┘

┌─────────┐                              ┌─────────┐
│ Agent-A  │                              │ Agent-B  │
└────┬────┘                              └────┬────┘
     │                                        │
     │ 1. 发现需要 Agent-B 的输出               │
     │    发送 @mention 消息                    │
     ▼                                        │
     │ ──────────────────────────────────────►│
     │   messageType: 'mention'               │
     │   content: '@Agent-B 我需要你的分析结果   │
     │   references: [analysis_task_id]       │
     │                                        │
     │ 2. Agent-B 执行分析                     │
     ▼                                        │
     │ ◄──────────────────────────────────────│
     │   messageType: 'context_share'         │
     │   content: '这是分析结果...'            │
     │   references: [analysis_result_file]   │
     │                                        │
     │ 3. Agent-A 使用结果继续工作             │
     ▼                                        │
```

---

## 7. 审计与透明化

### 7.1 审计事件列表

| 事件 | 触发时机 | Actor | Target | Metadata |
|------|---------|-------|--------|----------|
| `agent_entered` | Agent 进入 Zone | Agent | Zone | `{method: 'drag' \| 'api'}` |
| `agent_left` | Agent 离开 Zone | Agent | Zone | `{reason: 'complete' \| 'kick' \| 'api'}` |
| `task_created` | Zone 创建任务 | Zone | Task | `{taskType, priority}` |
| `task_assigned` | Zone 分派任务 | Zone | Agent | `{taskId, taskTitle}` |
| `task_claimed` | Agent 认领任务 | Agent | Task | `{taskId, claimedFor}` |
| `task_started` | Agent 开始执行 | Agent | Task | `{taskId}` |
| `task_completed` | Agent 完成 | Agent | Task | `{taskId, success, duration}` |
| `task_failed` | Agent 失败 | Agent | Task | `{taskId, error}` |
| `message_sent` | 发送消息 | Sender | Recipient | `{messageId, type}` |
| `skill_executed` | 执行 Skill | Agent | Target | `{skillId, params, success}` |
| `context_shared` | 共享上下文 | Agent | Agent | `{scope}` |

### 7.2 Zone Audit Trail API

```typescript
/**
 * 获取 Zone 审计轨迹
 */
async getZoneAuditTrail(
  zoneId: string,
  options?: {
    eventTypes?: AuditEventType[];
    actorId?: string;
    targetId?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    offset?: number;
  }
): Promise<{
  events: AuditLogRecord[];
  total: number;
  hasMore: boolean;
}>;

/**
 * 获取任务流转历史
 */
async getTaskFlowHistory(
  taskId: string
): Promise<TaskFlowRecord[]>;

/**
 * 获取 Agent 在 Zone 的活动记录
 */
async getAgentActivityLog(
  agentId: string,
  zoneId: string,
  options?: {
    startTime?: number;
    endTime?: number;
    limit?: number;
  }
): Promise<AuditLogRecord[]>;
```

### 7.3 UI 展示设计

```
┌─────────────────────────────────────────────────────────────────────┐
│ Zone: 代码开发区                        [👥 3] [⏸ 暂停] [⚙ 设置]   │
├─────────────────────────────────────────────────────────────────────┤
│ [概览] [任务] [消息] [成员] [审计]                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  审计轨迹                                              2026-04-01 ▼  │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                      │
│  14:32  Agent-C 完成了任务 "集成测试"                     ✓ completed │
│          耗时 2h 34m，产出 3 个测试文件                              │
│                                                                      │
│  14:30  Agent-B 开始了任务 "功能开发"                   ● in_progress│
│          当前进度 65%                                                │
│                                                                      │
│  14:28  Zone 向 Agent-C 分派了任务 "集成测试"           → delegated  │
│          优先级: 高                                                  │
│                                                                      │
│  14:25  Agent-A 认领了任务 "功能开发"                   → claimed   │
│                                                                      │
│  14:20  Agent-B 执行了 skill: web_search                   ⚡ skill  │
│          查询: "React best practices 2026"                          │
│                                                                      │
│  14:15  Agent-A 向 Agent-C 发送消息                     💬 message    │
│          @Agent-C 完成基础模块后请通知我                         │
│                                                                      │
│  14:10  Agent-C 进入了 Zone                              ↑ entered  │
│          进入方式: 拖拽                                              │
│                                                                      │
│  14:02  Zone 创建了任务 "功能开发"                     + created   │
│          类型: coding, 优先级: 5                                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. ZoneCoordinator 实现设计

### 8.1 类结构

```typescript
// ============================================
// ZoneCoordinator - Zone 的协调者大脑
// ============================================

export class ZoneCoordinator {
  readonly zoneId: string;
  readonly title: string;
  readonly prompt: string;
  private config: ZoneCoordinatorConfig;
  private llm: LLMConnector;

  // 成员管理
  private members: Map<string, ZoneMember>;
  private agentCapabilities: Map<string, Map<string, AgentCapability>>; // agentId → (capability → level)

  // 任务管理
  private pendingTasks: TaskItem[];
  private activeTasks: Map<string, TaskItem>;  // taskId → task

  constructor(zone: Zone, config: ZoneCoordinatorConfig);

  // ==================== 核心方法 ====================

  /**
   * 处理输入需求
   * @param requirement 用户或上游 Zone 输入的需求描述
   */
  async processRequirement(requirement: string): Promise<ProcessResult>;

  /**
   * 分解需求为任务
   */
  private async decomposeRequirement(requirement: string): Promise<TaskItem[]>;

  /**
   * 匹配任务给 Agent
   */
  private async matchTaskToAgent(task: TaskItem): Promise<string | null>;

  /**
   * 分派任务
   */
  async delegateTask(taskId: string, toAgentId: string): Promise<DelegateResult>;

  /**
   * 接收任务完成报告
   */
  async receiveTaskReport(report: TaskCompleteParams): Promise<void>;

  /**
   * 获取 Zone 状态摘要
   */
  getStatusSummary(): ZoneStatusSummary;

  // ==================== 能力管理 ====================

  /**
   * 更新 Agent 能力
   */
  updateAgentCapability(agentId: string, capabilities: AgentCapability[]): void;

  /**
   * 获取可用 Agent
   */
  getAvailableAgents(taskType?: TaskType): string[];

  /**
   * 获取 Agent 能力
   */
  getAgentCapabilityLevel(agentId: string, taskType: TaskType): number;
}

// ============================================
// ProcessResult - 处理结果
// ============================================

interface ProcessResult {
  success: boolean;
  tasks: TaskItem[];           // 创建的任务
  delegated: string[];         // 已分派的任务
  pending: string[];           // 待分派的任务
  requiresUserConfirm: string[]; // 需要用户确认的
  error?: string;
}

// ============================================
// ZoneStatusSummary - Zone 状态摘要
// ============================================

interface ZoneStatusSummary {
  zoneId: string;
  memberCount: number;
  activeTaskCount: number;
  completedTaskCount: number;
  pendingTaskCount: number;
  recentActivity: AuditLogRecord[];
}
```

### 8.2 Zone Brain Prompt 模板

```typescript
const ZONE_COORDINATOR_PROMPT = `你是 {zoneTitle} 的协调者。

## Zone 身份
{zoneTitle} 是一个{zoneDescription}的协作空间。

## Zone 目标 (Key Results)
{prompt}

## 当前成员
{memberList}

## 成员能力
{capabilityList}

## 你的职责
1. 接收并理解需求
2. 将需求分解为可执行的任务
3. 根据成员能力分配任务
4. 监控任务进度
5. 汇总结果并反馈

## 任务类型定义
- coding: 代码编写、重构、调试
- writing: 文案、文档、报告
- analysis: 数据分析、需求分析
- research: 信息检索、调研
- general: 其他通用任务

## 分派规则
{assignStrategyDescription}

## 你的输出格式
当接收到需求时，请按以下格式输出：

### 任务分解
1. [任务名称] - [任务描述] (类型: xxx, 优先级: 1-5)
2. ...

### 分派方案
- 任务1 → Agent-A (原因: xxx)
- 任务2 → Agent-B (原因: xxx)
...

### 需要确认
- [任务X] 需要用户确认是否分派 (原因: xxx)
`;
```

---

## 9. 与现有系统的集成

### 9.1 现有组件适配

| 现有组件 | 适配方式 |
|---------|----------|
| `ZoneContextManager` | 保留，作为 Zone↔Agent 上下文注入的基础设施 |
| `ZoneManager` | 扩展支持成员角色，新增 `zone_members` 表操作 |
| `TaskQueueService` | 扩展支持 task_flow 记录，新增 `task_flow` 表操作 |
| `AgentMessageRouter` | 扩展支持 Skill 消息类型 |
| `OrchestrationSync` | 扩展监听 ZoneCoordinator 事件 |
| `EnhancedStratixAgent` | 新增 `ZoneCoordinatorSkillExecutor` 处理 Zone→Agent 技能 |

### 9.2 集成点

```
┌─────────────────────────────────────────────────────────────────────┐
│                        集成点示意图                                   │
└─────────────────────────────────────────────────────────────────────┘

stratix-gateway/
├── api/routes/zone.ts
│   └── POST /zones/:zoneId/requirements  ← 新增: 提交需求接口
│
├── project/ZoneService.ts
│   └── 新增: ZoneCoordinator 实例管理
│
└── websocket/StatusSync.ts
    └── 新增: Coordinator 事件广播

stratix-orchestration/
├── zone/ZoneManager.ts
│   └── 新增: 成员角色管理
│
├── zone/ZoneCoordinator.ts  ← 新增
│
├── task-queue/TaskQueueService.ts
│   └── 新增: task_flow 记录
│
├── task-queue/TaskFlowRepository.ts  ← 新增
│
├── messaging/AgentMessageRouter.ts
│   └── 扩展: Skill 消息类型支持
│
├── audit/AuditLogRepository.ts  ← 新增
│
└── OrchestrationSync.ts
    └── 新增: ZoneCoordinator 事件

stratix-agent/
├── core/SkillExecutors.ts
│   └── 新增: ZoneCoordinatorSkillExecutor
│
└── EnhancedStratixAgent.ts
    └── 新增: task_claim, task_progress, task_complete 处理
```

---

## 10. 实施路线图

### Phase 1: 基础设施 (P0)

| 任务 | 依赖 | 工作量 | 验收标准 |
|------|------|--------|----------|
| `zone_members` 表 + Repository | 无 | 1d | CRUD 正常，索引正确 |
| `zone_coordinators` 表 + Repository | 无 | 0.5d | 配置读写正常 |
| `agent_capabilities` 表 + Repository | 无 | 1d | 能力更新/查询正常 |
| `task_flow` 表 + Repository | 无 | 1d | 流转记录正确 |
| `zone_audit_log` 表 + Repository | 无 | 1d | 审计写入/查询正常 |

### Phase 2: 核心逻辑 (P0)

| 任务 | 依赖 | 工作量 | 验收标准 |
|------|------|--------|----------|
| `ZoneCoordinator` 类骨架 | Phase 1 | 2d | 基础方法可用 |
| Skill 协议实现 | Phase 1 | 2d | task_delegate/claim/complete 正常 |
| LLM 集成 (需求分解) | ZoneCoordinator 骨架 | 2d | 能分解简单需求 |
| 能力匹配算法 | agent_capabilities | 1d | 按能力分派正确 |

### Phase 3: 审计透明 (P1)

| 任务 | 依赖 | 工作量 | 验收标准 |
|------|------|--------|----------|
| Audit Trail API | Phase 1 | 1d | API 响应正确 |
| OrchestrationSync 扩展 | Phase 2 | 1d | 事件正确广播 |
| Zone Audit Panel UI | Audit API | 2d | Timeline 显示正确 |

### Phase 4: 用户控制 (P1)

| 任务 | 依赖 | 工作量 | 验收标准 |
|------|------|--------|----------|
| 分派确认 UI | Phase 2 | 1d | 用户可批准/拒绝 |
| 强制重分派 | Phase 3 | 0.5d | 可强制转移任务 |
| 手动任务创建 | Phase 3 | 1d | 用户可手动创建任务 |

### Phase 5: 优化增强 (P2)

| 任务 | 依赖 | 工作量 | 验收标准 |
|------|------|--------|----------|
| 自动委派规则 | Phase 2 | 2d | 可配置策略生效 |
| 跨 Zone 协作 | Phase 2 | 3d | 上游 Zone 可触发下游 |
| 智能负载均衡 | Phase 2 | 2d | 负载考虑进分派 |

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM 分解质量不可控 | 任务分派不合理 | 人工确认机制 (`requireUserConfirm`) |
| Agent 能力数据不准确 | 分派效率低 | 动态学习 + 手动校正 |
| Zone 消息过多 | 干扰执行 | 消息分级 + 折叠 |
| 循环依赖 | Zone A→B→A | 任务 dependency 检查 |
| 单点故障 | Zone Coordinator 挂了 | 定期快照 + 恢复 |

---

## 12. 附录

### 12.1 术语表

| 术语 | 定义 |
|------|------|
| Zone | 协作空间，对应 Team 概念 |
| Coordinator | 协调者，负责分解需求和分派任务 |
| Executor | 执行者，负责具体任务执行 |
| Task Flow | 任务在 Agent 间的流转记录 |
| Audit Log | 所有操作的审计日志 |

### 12.2 参考资料

- claude-code-cli Coordinator Mode: `/Users/kingj/code/claude-code-cli/coordinator/`
- Stratix Agent Design: `docs/STRATIX_AGENT_DESIGN.md`
- Zone Design: `docs/ZONE_DESIGN.md`

---

**文档版本**: v1.0
**最后更新**: 2026-04-01
**状态**: 设计中
