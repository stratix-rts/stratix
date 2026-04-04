# System Zone 自举设计文档

> **版本**: 2.0
>
> **转折点日期**: 2026-04-04
>
> **核心理念**: 让 Stratix 成为真正活着的系统 —— 持续观察世界、感知自身、主动进化

---

## 1. 愿景

### 1.1 从工具到生命体

```
传统软件：人操作工具，工具被动响应
Stratix 当前：人指挥 Agent，Agent 执行任务
Stratix 未来：System Zone 观察世界 → 分析趋势 → 主动进化
```

**终极愿景**：
- Stratix 不再只是人用的工具
- 它是一个「数字生命体」，有感知、有思考、有行动
- 人是它的「造物主」和「教练」，不是它的操作员
- 它会自我迭代，从代码到架构到功能，不断进化

### 1.2 类比：物种进化

| 阶段 | 描述 | 类比 |
|------|------|------|
| **阶段 1** | 人告诉 AI 要做什么 | 原始人使用工具 |
| **阶段 2** | AI 观察世界，自己发现该做什么 | 动物学会使用工具 |
| **阶段 3** | AI 自己决定，自己做，人只监督 | 人类进化出智慧 |
| **阶段 4** | AI 能创造全新功能，不是人教的 | 人类文明爆发 |
| **阶段 5** | AI 系统自我迭代，形成文明 | 生命体自我进化 |

Stratix 现在处于 **阶段 1 末期**，目标是 **阶段 4**。

### 1.3 Phase 1 定位（v2.0 调整）

Phase 1 是**最小可行骨架**，不是完整系统：

```
Phase 1 范围（v2.0）：
✅ System Zone 类型定义 + 数据库 schema
✅ Observer 骨架：用户输入 → 信息提取
✅ Strategist 骨架：分析 → 生成提案
✅ 手动触发循环：用户点按钮跑一圈
✅ 复用手边基础设施

Phase 1 不做（推迟到 Phase 2/3）：
❌ Executor（代码修改能力）
❌ 外部信息源自动爬取
❌ Web 独立界面（复用 RTS 场景 + Vue 组件）
```

---

## 2. 架构：复用现有模块

### 2.1 核心原则

**System Zone 必须建立在已有基础设施上，不是全新模块。**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        System Zone 架构                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   现有模块                              System Zone 角色                  │
│   ─────────                            ───────────────                  │
│   StratixStateStore              →     System Zone 的状态管理             │
│   PermissionOrchestrator         →     Executor 的权限检查               │
│   AgentRouter                    →     System Zone 的 Agent 调度         │
│   RetryPolicyEngine              →     外部调用重试                      │
│   BudgetController               →     System Zone 自身的预算控制         │
│   SessionRuntime                 →     Observer/Strategist 会话管理       │
│   CommandOrchestrator            →     System Zone 的命令注册             │
│                                                                          │
│   skills/memory-manager          →     记忆系统复用（分类归档）           │
│   .learnings/                    →     ERRORS.md + LEARNINGS.md          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 组件概览

```
System Zone (用户私有)
│
├── 🌐 Observer (观察者)
│   ├── 信息接收：用户通过 API/界面输入观察到的信息
│   │   ├── 用户粘贴：新闻、趋势分析、想法、代码片段
│   │   └── 格式：文本、JSON、结构化数据
│   │
│   └── 信息处理：结构化提取 + 存储
│       ├── 实体识别：项目名、技术栈、人物、事件
│       ├── 关键词提取：主题、领域、趋势
│       └── 分类归档：复用 memory-manager 机制
│
├── 🧠 Strategist (战略家)
│   ├── 自我分析：针对 Stratix 项目本身
│   │   ├── 代码问题发现：死代码、坏味道、性能瓶颈
│   │   ├── 测试缺口识别：未覆盖的路径
│   │   └── 架构改进点：耦合、职责不清
│   │
│   └── 提案生成
│       ├── 改进提案：具体改动建议
│       ├── 优先级：基于影响度和成本
│       └── 风险评估：低/中/高
│
└── 🛡️ Guardian (守护者)
    ├── 安全边界
    │   ├── 禁止修改路径：**/payment/**, **/permission/**
    │   └── 只读敏感区域：密钥、配置
    │
    └── 保护机制
        ├── Git Rollback：改动可回滚
        ├── 通知机制：每次提案通知用户
        └── 熔断器：异常时暂停
```

### 2.3 数据流

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           用户输入                                       │
│   用户粘贴信息：新闻 / 趋势 / 想法 / 代码片段 / 测试报告                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Observer                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  用户输入 ──▶ 清洗 ──▶ 结构化 ──▶ 归档到 memory-manager          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                      │                                 │
│                                      ▼                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       信息库（复用 .learnings/）                  │   │
│  │   insights[]  trends[]  observations[]  project_metrics{}       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Strategist                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  分析引擎（Self-Iteration 优先）                                  │   │
│  │   ├── 项目自检：代码质量、测试覆盖、性能                           │   │
│  │   ├── 问题识别：坏味道、风险点、改进点                            │   │
│  │   └── 提案生成：具体、可执行、有优先级                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                      │                                 │
│                                      ▼                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       提案队列                                    │   │
│  │   proposals: [                                                       │   │
│  │     { type: 'improve', target: 'test', suggestion: '...', risk }, │   │
│  │     { type: 'improve', target: 'code', suggestion: '...', risk }, │   │
│  │   ]                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Guardian                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  审批 + 保护                                                       │   │
│  │   ├── 用户审批：高风险提案需人工确认                               │   │
│  │   ├── 权限检查：PermissionOrchestrator 校验                       │   │
│  │   └── 路径保护：禁止修改路径拦截                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                      │                                 │
│                              Phase 2: Executor（未实现）                │
│                                      │                                 │
│                              Phase 3: 外部信息源（未实现）              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心接口

### 3.1 System Zone 类型定义

```typescript
// System Zone 类型
interface SystemZone {
  id: string;
  ownerId: string;  // 私有，只有创建者能访问
  name: string;
  status: 'active' | 'paused' | 'learning';

  // 两个核心 Agent（Phase 1）
  observer: ObserverState;
  strategist: StrategistState;
  // Phase 2: executor: ExecutorState;
  guardian: GuardianState;

  // 配置
  config: {
    loopIntervalMs: number;        // 观察循环间隔，Phase 1 为手动
    autoExecuteThreshold: 'none';  // Phase 1: 所有提案需审批
    notifyOnChange: boolean;
  };

  // 知识库（复用 .learnings/）
  knowledge: {
    insights: Insight[];           // 从用户输入提取的洞察
    proposals: Proposal[];         // 待审批提案
    history: ChangeHistory[];       // 变更历史（Phase 2）
    lessonsLearned: Lesson[];       // 学到的教训（复用 ERRORS.md）
  };
}

// Observer
interface ObserverState {
  status: 'idle' | 'receiving' | 'processing';
  lastReceive: Date | null;
  pendingInputs: UserInput[];       // 待处理的用户输入
  processedInputs: UserInput[];     // 已处理的输入
  metrics: {
    inputsReceived: number;
    insightsGenerated: number;
  };
}

// User Input（用户作为信息提供者）
interface UserInput {
  id: string;
  timestamp: Date;
  content: string;                  // 用户提供的原始文本
  source: 'manual' | 'api';         // 输入方式
  type: 'news' | 'idea' | 'analysis' | 'code' | 'test_report' | 'other';
  metadata?: {
    url?: string;
    tags?: string[];
  };
}

// Strategist
interface StrategistState {
  status: 'idle' | 'analyzing' | 'proposing';
  lastAnalysis: Date | null;
  currentProposals: Proposal[];    // 当前提案队列
  analysisContext: {
    target: 'stratix_project' | 'external';  // Phase 1 只分析 Stratix 自身
    findings: string[];
    confidence: number;
  } | null;
}

// Proposal
interface Proposal {
  id: string;
  timestamp: Date;
  type: 'improve_code' | 'improve_test' | 'improve_architecture' | 'new_zone';
  title: string;
  description: string;
  target: {
    file?: string;                  // 目标文件
    component?: string;              // 目标组件
    zone?: string;                  // 目标 Zone
  };

  // 选择相关的元数据
  selection: {
    confidence: number;             // AI 置信度 0-1
    cost: number;                   // 实施成本 1-10
    benefit: number;                // 预期收益 1-10
    risk: 'low' | 'medium' | 'high';
  };

  // 状态（Phase 1: 全需审批）
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'rolled_back';
  approvedBy?: string;
  executedAt?: Date;
}

// Guardian
interface GuardianState {
  status: 'guarding' | 'alert';
  permissions: PermissionMatrix;
  recentAlerts: Alert[];

  // 保护配置
  protection: {
    forbiddenPaths: string[];       // 禁止修改路径，如 ['**/payment/**']
    requireApproval: boolean;       // Phase 1: 始终需要审批
    notifyOnProposal: boolean;      // 提案生成时通知
    circuitBreakerEnabled: boolean;
  };
}

// Insight（从用户输入提取）
interface Insight {
  id: string;
  timestamp: Date;
  sourceInputId: string;            // 关联的 UserInput
  type: 'trend' | 'opportunity' | 'risk' | 'pattern';
  content: string;                  // 提取的洞察内容
  entities: string[];               // 识别的实体
  confidence: number;
  archived: boolean;                // 是否归档到 .learnings/
}

// Lesson（复用 .learnings/ 格式）
interface Lesson {
  id: string;
  timestamp: Date;
  type: 'error' | 'learning' | 'success';
  category: string;                 // 分类：performance, testing, architecture...
  content: string;
  context: string;                  // 发生场景
  avoidanceRule?: string;           // 规避规则（仅 error 类型）
  reuseCount: number;               // 复用次数
}
```

### 3.2 数据库 Schema

```sql
-- system_zones 表
CREATE TABLE system_zones (
  zone_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',  -- active, paused, learning

  -- Phase 1 配置
  config JSON DEFAULT '{}',

  -- 知识库引用（复用 .learnings/ 目录）
  insights_ref TEXT,              -- 关联的 insights 文件路径
  lessons_ref TEXT,               -- 关联的 lessons 文件路径

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- system_zone_inputs 表（用户输入记录）
CREATE TABLE system_zone_inputs (
  input_id TEXT PRIMARY KEY,
  zone_id TEXT REFERENCES system_zones(zone_id),
  content TEXT NOT NULL,          -- 用户提供的原始文本
  source TEXT DEFAULT 'manual',  -- manual, api
  input_type TEXT,               -- news, idea, analysis, code, test_report, other
  metadata JSON,
  processed BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- system_zone_insights 表（提取的洞察）
CREATE TABLE system_zone_insights (
  insight_id TEXT PRIMARY KEY,
  zone_id TEXT REFERENCES system_zones(zone_id),
  source_input_id TEXT REFERENCES system_zone_inputs(input_id),
  type TEXT,                     -- trend, opportunity, risk, pattern
  content TEXT NOT NULL,
  entities JSON DEFAULT '[]',
  confidence REAL DEFAULT 0.5,
  archived BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- system_zone_proposals 表（提案队列）
CREATE TABLE system_zone_proposals (
  proposal_id TEXT PRIMARY KEY,
  zone_id TEXT REFERENCES system_zones(zone_id),
  type TEXT NOT NULL,            -- improve_code, improve_test, improve_architecture, new_zone
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target JSON,                    -- { file, component, zone }

  -- 选择元数据
  confidence REAL DEFAULT 0.5,
  cost INTEGER DEFAULT 5,
  benefit INTEGER DEFAULT 5,
  risk TEXT DEFAULT 'medium',    -- low, medium, high

  -- 状态
  status TEXT DEFAULT 'pending', -- pending, approved, rejected, executed, rolled_back
  approved_by TEXT,
  executed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- system_zone_lessons 表（复用 .learnings/ 机制）
CREATE TABLE system_zone_lessons (
  lesson_id TEXT PRIMARY KEY,
  zone_id TEXT REFERENCES system_zones(zone_id),
  type TEXT NOT NULL,            -- error, learning, success
  category TEXT NOT NULL,        -- performance, testing, architecture, security
  content TEXT NOT NULL,
  context TEXT,
  avoidance_rule TEXT,
  reuse_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. 手动触发循环

### 4.1 Phase 1 循环流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Phase 1: 手动触发循环                            │
└─────────────────────────────────────────────────────────────────────┘

                         ╭────────────────────────╮
                         │    用户输入信息          │
                         │  （粘贴文本/想法/新闻）   │
                         ╰────────────┬───────────╯
                                      │
                                      ▼
                         ╭────────────────────────╮
                         │    OBSERVE (观察)       │
                         │                        │
                         │  • 接收用户输入          │
                         │  • 结构化提取洞察        │
                         │  • 归档到 memory        │
                         ╰────────────┬───────────╯
                                      │
                                      ▼
                         ╭────────────────────────╮
                         │    ANALYZE (分析)       │
                         │                        │
                         │  • 自我分析 Stratix     │
                         │  • 代码/测试/架构       │
                         │  • 识别改进点           │
                         ╰────────────┬───────────╯
                                      │
                                      ▼
                         ╭────────────────────────╮
                         │    PROPOSE (提案)       │
                         │                        │
                         │  • 生成改进提案          │
                         │  • 评估风险和收益       │
                         │  • 排序优先级           │
                         ╰────────────┬───────────╯
                                      │
                                      ▼
                         ╭────────────────────────╮
                         │    用户审批             │
                         │                        │
                         │  • 查看提案列表          │
                         │  • 批准/拒绝            │
                         ╰────────────┬───────────╯
                                      │
                         ┌────────────┴────────────┐
                         │                           │
                         ▼                           ▼
              ┌──────────────────┐       ┌──────────────────┐
              │   APPROVED        │       │    REJECTED      │
              │                  │       │                  │
              │  进入 Phase 2    │       │  记录到 lessons   │
              │  等待 Executor   │       │  调整策略        │
              └──────────────────┘       └──────────────────┘
                         │
              Phase 2: Executor（未实现）
```

### 4.2 用户交互

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户交互方式                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 信息输入                                                          │
│     ├── API: POST /api/systemzone/inputs                             │
│     │   { content: "粘贴的新闻/想法/分析..." }                        │
│     │                                                               │
│     └── 界面: RTS 场景中的 System Zone 面板                          │
│         └── Vue 组件复用现有 ZonePanel 样式                          │
│                                                                      │
│  2. 触发观察循环                                                     │
│     ├── 按钮: "分析当前项目"                                          │
│     └── 快捷键: Ctrl+Shift+S                                         │
│                                                                      │
│  3. 查看提案                                                         │
│     ├── 列表: System Zone 面板显示提案队列                           │
│     ├── 详情: 点击查看完整提案                                       │
│     └── 操作: 批准 / 拒绝 / 延迟                                     │
│                                                                      │
│  4. 通知                                                             │
│     └── OpenClaw: openclaw system event --text "新提案待审批"        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. 自我迭代机制

### 5.1 自我分析范围

Phase 1 优先分析 Stratix 项目本身，发现：

```
┌─────────────────────────────────────────────────────────────────────┐
│                       自我分析范围                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  代码质量                                                            │
│  ├── 死代码检测：未使用的函数/变量/import                            │
│  ├── 坏味道识别：过长函数、嵌套过深、重复代码                         │
│  ├── 类型安全：any 滥用、类型守卫缺失                                │
│  └── 错误处理：未捕获异常、裸 catch                                 │
│                                                                      │
│  测试覆盖                                                            │
│  ├── 未覆盖路径：条件分支、异常分支                                  │
│  ├── 覆盖率统计：行覆盖、分支覆盖                                    │
│  └── 测试质量：断言不足、测试孤立性差                                │
│                                                                      │
│  性能                                                                │
│  ├── 依赖分析：重复依赖、过时依赖                                     │
│  ├── 包体积：大文件、未懒加载                                        │
│  └── 响应时间：慢 API、阻塞调用                                      │
│                                                                      │
│  架构                                                                │
│  ├── 模块耦合：循环依赖、过度耦合                                     │
│  ├── 职责不清：过大组件、模糊边界                                    │
│  └── 扩展性：硬编码、未来变化支持差                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Fitness 函数（Phase 2 准备）

**Fitness 函数需要覆盖率数据支撑，Phase 2 才能启用。**

```typescript
interface FitnessMetrics {
  codeQuality: {
    testCoverage: number;          // 测试覆盖率（越高越好）
    cyclomaticComplexity: number;  // 圈复杂度（越低越好）
    duplicationRate: number;       // 重复率（越低越好）
  };

  performance: {
    responseTime: number;          // 响应时间（越低越好）
    bundleSize: number;           // 包体积（越低越好）
  };

  systemHealth: {
    errorRate: number;            // 错误率（越低越好）
    crashCount: number;           // 崩溃次数
  };
}

// Phase 1: 仅用于展示，不驱动决策
// Phase 2: Executor 启用需满足: testCoverage >= 80%
```

---

## 6. 记忆系统复用

### 6.1 复用机制

```
┌─────────────────────────────────────────────────────────────────────┐
│                       记忆系统复用                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  skills/memory-manager                                               │
│  └── 复用分类归档机制                                                │
│      ├── category: 'error' | 'learning' | 'success'                │
│      ├── tags: ['performance', 'testing', 'architecture']          │
│      └── search: 按分类和标签检索                                   │
│                                                                      │
│  .learnings/ 目录                                                   │
│  ├── ERRORS.md          ← 失败教训（追加）                          │
│  └── LEARNINGS.md       ← 成功经验（追加）                          │
│                                                                      │
│  System Zone 写入格式：                                              │
│  ```markdown                                                       │
│  ## [ERROR] {timestamp}                                            │
│  ### Category: {category}                                           │
│  ### Context: {发生场景}                                            │
│  ### What Went Wrong: {错误描述}                                    │
│  ### Avoidance: {规避规则}                                         │
│                                                                      │
│  ## [LEARNING] {timestamp}                                         │
│  ### What Worked: {成功描述}                                         │
│  ### Pattern: {提取的模式}                                           │
│  ```                                                                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Lesson 接口

```typescript
interface Lesson {
  id: string;
  timestamp: Date;
  type: 'error' | 'learning' | 'success';
  category: string;                 // performance, testing, architecture, security
  content: string;
  context: string;                // 发生场景
  avoidanceRule?: string;           // 规避规则（仅 error 类型）
  reuseCount: number;              // 复用次数

  // 归档目标
  archiveTo: '.learnings/ERRORS.md' | '.learnings/LEARNINGS.md';
}
```

---

## 7. 前提条件

### 7.1 Executor 启用条件（Phase 2）

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Executor 代码修改能力前提                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  硬性条件：                                                          │
│  ├── 测试覆盖率 >= 80%                                              │
│  │   └── Fitness 函数需要覆盖率数据支撑                              │
│  │                                                               │
│  软性条件（强烈建议）：                                               │
│  ├── Guardian 熔断器经过验证                                         │
│  ├── Rollback 机制经过演练                                          │
│  └── 至少 10 个低风险提案成功执行                                   │
│                                                                      │
│  不满足条件时：                                                       │
│  └── Executor 保持只读，Phase 1 审批流程不变                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Phase 依赖关系

```
Phase 1 (当前)
└── System Zone 骨架 + Observer + Strategist + 手动循环
    └── 前提：无

Phase 2
├── Executor 启用（代码修改能力）
└── 前提：
    ├── 测试覆盖率 >= 80%
    └── Guardian 熔断器验证通过

Phase 3
├── 外部信息源自动接入
└── 前提：
    ├── Phase 2 稳定运行
    └── Fitness 函数校准完成

Phase 4
├── 真正自举
└── 前提：
    ├── Phase 3 稳定运行
    └── 自我改进提案成功率 > 70%
```

---

## 8. 实现计划

### 8.1 Phase 1 关键文件

```
src/
├── stratix-systemzone/                    # 新模块
│   ├── SystemZone.ts                      # 主类
│   │
│   ├── observer/
│   │   ├── Observer.ts                    # 观察者
│   │   ├── InputReceiver.ts               # 用户输入接收
│   │   ├── InsightExtractor.ts            # 洞察提取
│   │   └── types.ts                       # 类型定义
│   │
│   ├── strategist/
│   │   ├── Strategist.ts                  # 战略家
│   │   ├── SelfAnalyzer.ts                # 自我分析（Phase 1 重点）
│   │   ├── ProjectScanner.ts              # 项目扫描
│   │   └── ProposalGenerator.ts           # 提案生成
│   │
│   ├── guardian/
│   │   ├── Guardian.ts                    # 守护者
│   │   ├── PermissionMatrix.ts            # 权限矩阵（复用 PermissionOrchestrator）
│   │   └── PathProtection.ts              # 路径保护
│   │
│   ├── memory/
│   │   ├── MemoryArchiver.ts              # 归档到 .learnings/
│   │   └── LessonManager.ts               # Lesson 管理
│   │
│   └── api/
│       └── routes/
│           └── systemzone.ts              # API 路由

复用现有模块：
├── stratix-state/                         # 状态管理
│   └── StratixStateStore → SystemZone 状态
├── stratix-permissions/                    # 权限系统
│   └── PermissionOrchestrator → Executor 检查
├── stratix-router/                         # 路由
│   └── AgentRouter → Agent 调度
├── stratix-retry/                         # 重试
│   └── RetryPolicyEngine → 外部调用
├── stratix-budget/                        # 预算
│   └── BudgetController → Zone 预算
└── stratix-session/                        # 会话
    └── SessionRuntime → Observer 会话
```

### 8.2 API 路由

```typescript
// POST /api/systemzone/inputs
// 用户输入信息
{
  content: string;           // 必填：用户提供的文本
  type?: 'news' | 'idea' | 'analysis' | 'code' | 'test_report' | 'other';
  metadata?: {
    url?: string;
    tags?: string[];
  };
}

// POST /api/systemzone/observe
// 触发观察循环
{
  trigger: 'manual';         // Phase 1: 仅手动
}

// GET /api/systemzone/proposals
// 获取提案列表
{
  status?: 'pending' | 'approved' | 'rejected';
  limit?: number;
}

// POST /api/systemzone/proposals/:id/approve
// 审批提案
{
  action: 'approve' | 'reject';
  comment?: string;
}

// GET /api/systemzone/insights
// 获取洞察列表
{
  archived?: boolean;
  limit?: number;
}
```

---

## 9. 保护机制

### 9.1 路径保护（Phase 1）

```typescript
const FORBIDDEN_PATHS = [
  '**/payment/**',           // 支付逻辑
  '**/permission/**',        // 权限核心
  '**/.env*',               // 环境变量
  '**/credentials/**',      // 凭证
];

const ALWAYS_READONLY = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
];

// Guardian 在提案生成时检查
function validateProposal(proposal: Proposal): ValidationResult {
  if (proposal.target.file) {
    for (const pattern of FORBIDDEN_PATHS) {
      if (matchesGlob(proposal.target.file, pattern)) {
        return { valid: false, reason: `Path ${pattern} is protected` };
      }
    }
  }
  return { valid: true };
}
```

### 9.2 熔断器

```typescript
interface CircuitBreaker {
  metrics: {
    consecutiveFailures: number;
    lastFailureTimestamp: Date | null;
  };

  thresholds: {
    maxConsecutiveFailures: 3;
    resetAfterMs: 60000;  // 1分钟后重试
  };

  state: 'closed' | 'open' | 'half-open';

  onTrip(): void {
    // 1. 暂停所有提案执行
    // 2. 通知用户
    // 3. 记录到 lessons
  };
}
```

---

## 10. 修订历史

| 日期 | 版本 | 修订内容 |
|-----|------|---------|
| 2026-04-04 | 1.0 | 初始版本，记录 System Zone 自举设计 |
| 2026-04-04 | 1.1 | 补充进化机制：选择机制、Fitness 函数、记忆系统、进化方向引导、退化保护 |
| 2026-04-04 | 2.0 | 大幅缩小 Phase 1 范围；明确复用现有模块；用户作为信息提供者；专注自我迭代；明确 Executor 前提条件 |

---

## 11. 附录

### 11.1 名词解释

| 术语 | 解释 |
|-----|------|
| **自举** | 系统能够观察自身、分析自身、改进自身 |
| **Bootstrap Zone** | System Zone 的别称，控制整个 Stratix World |
| **Observer** | 观察者 Agent，负责接收用户输入并提取洞察 |
| **Strategist** | 战略家 Agent，负责分析 Stratix 项目并生成改进提案 |
| **Guardian** | 守护者 Agent，负责安全边界和保护机制 |
| **memory-manager** | 技能系统中的记忆管理器，提供分类归档机制 |

### 11.2 Zone 类型一览

| Zone 类型 | 描述 | 创建者 |
|---------|------|-------|
| **System Zone** | 控制塔，自举核心 | 用户私有 |
| **实验 Zone** | 探索新想法 | System Zone（Phase 2） |
| **应用 Zone** | 垂直应用 | 用户/模板 |
| **工具 Zone** | 提供公共服务 | System Zone |

---

> **最后更新**: 2026-04-04
>
> **状态**: v2.0 - Phase 1 骨架设计
>
> **下一步**: Phase 1 实现（类型定义 + Observer 骨架 + Strategist 骨架 + 手动循环）
