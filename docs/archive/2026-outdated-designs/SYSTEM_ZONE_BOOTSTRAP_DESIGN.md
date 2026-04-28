# System Zone 自举设计文档

> **版本**: 3.0
>
> **更新日期**: 2026-04-05

---

## 1. 定位

**目标**：System Zone 让 Stratix 具备自我观察、自我分析、自我改进的能力。

**当前状态**：阶段 1（人指挥 Agent 执行）→ 目标：阶段 4（AI 自主发现、决定、创造）

### Phase 1 范围

```
Phase 1（最小可行骨架）：
✅ System Zone 类型定义 + 数据库 schema
✅ Observer：规则预处理 + LLM 语义提取（复用 SessionRuntime）
✅ Strategist：确定性扫描 + LLM 辅助分析（复用 SessionRuntime）
✅ Guardian：路径保护 + 熔断器
✅ 手动触发循环：用户点按钮跑一圈
✅ 复用现有基础设施（无预算限制）

Phase 1 不做（推迟到 Phase 2/3）：
❌ Executor（代码修改能力）
❌ 外部信息源自动爬取
❌ Web 独立界面（复用 RTS 场景 + Vue 组件）
```

---

## 2. 架构：复用现有模块

### 2.1 核心原则

**System Zone 必须建立在已有基础设施上，不是全新模块。所有 LLM 能力通过 Stratix Agent 机制接入，无预算限制。**

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
│   SessionRuntime                 →     Observer/Strategist LLM 会话      │
│   RetryPolicyEngine              →     外部调用重试                      │
│   CommandOrchestrator            →     System Zone 的命令注册             │
│                                                                          │
│   stratix-data-store             →     持久化层（替代外部 .learnings/）    │
│   stratix-database               →     数据库存储                        │
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
│   ├── 规则预处理（本地，零成本）
│   │   ├── 格式检测：代码 / URL / 纯文本 / JSON
│   │   ├── 语言检测：中 / 英 / 混合
│   │   └── 基础清洗：去空白、去重复
│   │
│   └── LLM 语义提取（复用 SessionRuntime）
│       ├── 实体识别：项目名、技术栈、人物、事件
│       ├── 关键词提取：主题、领域、趋势
│       ├── 洞察分类：trend / opportunity / risk / pattern
│       └── 结构化输出：JSON schema 约束
│
├── 🧠 Strategist (战略家)
│   ├── 确定性扫描（本地命令，不依赖 LLM）
│   │   ├── jest --coverage --json → 覆盖率缺口
│   │   ├── tsc --noEmit → 类型错误
│   │   ├── eslint --format json → lint 问题
│   │   └── 文件行数统计 → 过大文件（>500行）
│   │
│   ├── LLM 辅助分析（复用 SessionRuntime）
│   │   ├── 代码质量评估：结合源码 + 扫描结果
│   │   ├── 具体改进建议：针对性、可执行
│   │   └── 风险评估：基于变更影响范围
│   │
│   └── 提案生成
│       ├── 从扫描结果确定性映射：覆盖率低 → test 提案
│       ├── LLM 增强：补充具体改进建议
│       ├── 优先级排序：risk × benefit 矩阵
│       └── 输出结构化 Proposal[]
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
│                     Observer Pipeline                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 1: 规则预处理（本地）                                       │   │
│  │   格式检测 → 语言检测 → 清洗 → 基础分类                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                      │                                 │
│                                      ▼                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 2: LLM 语义提取（SessionRuntime → AgentRouter → LLM）      │   │
│  │   实体识别 → 关键词提取 → 洞察分类 → 结构化输出                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                      │                                 │
│                                      ▼                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              知识库（stratix-database 持久化）                     │   │
│  │   insights[]  trends[]  observations[]  project_metrics{}       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Strategist Pipeline                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 1: 确定性扫描（本地命令）                                    │   │
│  │   jest --coverage → tsc --noEmit → eslint → 文件行数统计         │   │
│  │   结果缓存到 StratixStateStore                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                      │                                 │
│                                      ▼                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 2: 确定性映射                                               │   │
│  │   覆盖率低 → test 提案 | 类型错误 → code 提案 | 大文件 → arch 提案│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                      │                                 │
│                                      ▼                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 3: LLM 增强（SessionRuntime → AgentRouter → LLM）          │   │
│  │   提案 + 源码 → 具体改进建议 + 风险评估                           │   │
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
│                     Guardian                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  审批 + 保护                                                       │   │
│  │   ├── 路径保护：禁止修改 payment/permission/.env 等               │   │
│  │   ├── 用户审批：所有提案需人工确认                                │   │
│  │   └── 熔断器：连续失败 3 次暂停                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
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
    llmBudget: 'unlimited';       // 无预算限制，复用 Agent 机制
  };

  // 知识库（持久化到 stratix-database）
  knowledge: {
    insights: Insight[];           // 从用户输入提取的洞察
    proposals: Proposal[];         // 待审批提案
    history: ChangeHistory[];       // 变更历史（Phase 2）
    lessonsLearned: Lesson[];       // 学到的教训
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

// Observer 实现策略
interface ObserverPipeline {
  // 第一步：规则预处理（本地）
  preprocessor: {
    detectFormat(content: string): 'code' | 'url' | 'text' | 'json';
    detectLanguage(content: string): 'zh' | 'en' | 'mixed';
    clean(content: string): string;        // 去空白、去重复
    classifyInput(content: string, format: string): UserInput['type'];
  };

  // 第二步：LLM 语义提取（通过 SessionRuntime）
  extractor: {
    model: string;                         // 通过 AgentRouter 选择模型
    prompt: string;                        // 预设提取 prompt
    outputSchema: InsightExtractionResult; // JSON schema 约束
  };
}

// LLM 提取结果
interface InsightExtractionResult {
  entities: string[];
  keywords: string[];
  type: 'trend' | 'opportunity' | 'risk' | 'pattern';
  summary: string;
  confidence: number;
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
  status: 'idle' | 'scanning' | 'analyzing' | 'proposing';
  lastScan: Date | null;
  lastAnalysis: Date | null;
  currentProposals: Proposal[];    // 当前提案队列
  scanResult: ScanResult | null;   // 最新扫描结果
}

// Strategist 实现策略：两层架构

// 第一层：确定性扫描（本地命令）
interface ProjectScanner {
  // 可用命令（package.json 已配置）
  runTestCoverage(): Promise<CoverageReport>;    // npm test -- --coverage --json
  runTypeCheck(): Promise<TypeCheckResult>;      // npm run typecheck
  runLint(): Promise<LintResult>;               // npm run lint -- --format json
  scanFileSizes(): Promise<FileSizeReport>;      // 本地文件扫描，>500行标记
}

interface ScanResult {
  timestamp: Date;
  coverage: CoverageReport;
  types: TypeCheckResult;
  lint: LintResult;
  sizes: FileSizeReport;
  // 缓存到 StratixStateStore，避免重复扫描
}

// 确定性映射：扫描结果 → 提案
interface ProposalMapper {
  fromCoverage(report: CoverageReport): Proposal[];  // 覆盖率 < 阈值 → test 提案
  fromTypeErrors(errors: TypeCheckResult): Proposal[]; // 类型错误 → code 提案
  fromLintIssues(issues: LintResult): Proposal[];    // lint 问题 → code 提案
  fromLargeFiles(files: FileSizeReport): Proposal[];  // >500行 → architecture 提案
}

// 第二层：LLM 辅助分析（通过 SessionRuntime）
interface StrategistLLMEnhancer {
  // 输入：提案 + 目标源码 → 输出：增强后的提案（含具体建议）
  enrichProposal(proposal: Proposal, sourceCode: string): Promise<Proposal>;
  // 输入：扫描结果全貌 → 输出：架构级改进建议
  analyzeArchitecture(scanResult: ScanResult): Promise<Proposal[]>;
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

-- system_zone_lessons 表（存储在 stratix-database）
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

-- 索引策略
CREATE INDEX idx_sz_inputs_zone_processed ON system_zone_inputs(zone_id, processed);
CREATE INDEX idx_sz_insights_zone_type ON system_zone_insights(zone_id, type);
CREATE INDEX idx_sz_proposals_zone_status ON system_zone_proposals(zone_id, status);
CREATE INDEX idx_sz_proposals_status ON system_zone_proposals(status);
CREATE INDEX idx_sz_lessons_category ON system_zone_lessons(zone_id, category);
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

Phase 1 通过确定性扫描 + LLM 增强分析 Stratix 项目本身：

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Phase 1 自我分析范围                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  确定性扫描（本地命令，不依赖 LLM）                                   │
│  ├── 测试覆盖：jest --coverage --json                               │
│  │   └── 覆盖率低于阈值的文件 → improve_test 提案                    │
│  ├── 类型检查：tsc --noEmit                                         │
│  │   └── 类型错误列表 → improve_code 提案                           │
│  ├── 代码规范：eslint --format json                                 │
│  │   └── lint 问题列表 → improve_code 提案                          │
│  └── 文件体积：本地扫描                                              │
│      └── >500行的文件 → improve_architecture 提案                   │
│                                                                      │
│  LLM 辅助分析（SessionRuntime → AgentRouter）                        │
│  ├── 具体改进建议：针对扫描发现的文件，结合源码分析                    │
│  ├── 架构评估：识别模块耦合、职责不清等问题                           │
│  └── 风险评估：基于变更影响范围判断                                   │
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

## 6. 记忆系统

### 6.1 持久化方案

```
┌─────────────────────────────────────────────────────────────────────┐
│                       记忆持久化（stratix-database）                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  system_zone_insights 表                                            │
│  └── 结构化洞察存储，按 zone_id + type 检索                         │
│                                                                      │
│  system_zone_lessons 表                                              │
│  └── 错误/学习/成功记录，按 category 分类                           │
│      ├── category: performance, testing, architecture, security     │
│      └── avoidance_rule: 规避规则（error 类型专用）                  │
│                                                                      │
│  Lesson 写入格式（数据库记录）：                                      │
│  {                                                                   │
│    type: 'error',                                                    │
│    category: 'testing',                                              │
│    content: '覆盖率扫描超时',                                         │
│    context: 'ProjectScanner.runTestCoverage()',                     │
│    avoidance_rule: '设置 60s 超时上限'                               │
│  }                                                                   │
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
│   │   ├── InputPreprocessor.ts           # 规则预处理（本地）
│   │   ├── InsightExtractor.ts            # LLM 语义提取（SessionRuntime）
│   │   └── types.ts                       # 类型定义
│   │
│   ├── strategist/
│   │   ├── Strategist.ts                  # 战略家
│   │   ├── ProjectScanner.ts              # 确定性扫描（jest/tsc/eslint）
│   │   ├── ProposalMapper.ts              # 扫描结果 → 提案映射
│   │   ├── StrategistLLMEnhancer.ts       # LLM 辅助分析（SessionRuntime）
│   │   └── types.ts                       # 类型定义
│   │
│   ├── guardian/
│   │   ├── Guardian.ts                    # 守护者
│   │   ├── PermissionMatrix.ts            # 权限矩阵（复用 PermissionOrchestrator）
│   │   └── PathProtection.ts              # 路径保护
│   │
│   ├── memory/
│   │   ├── LessonManager.ts               # Lesson 管理（stratix-database）
│   │   └── types.ts
│   │
│   └── api/
│       ├── routes/
│       │   └── systemzone.ts              # API 路由
│       └── auth/
│           └── ZoneAuthGuard.ts           # Zone owner 认证（复用 Gateway auth）

复用现有模块：
├── stratix-core/                         # 核心能力
│   ├── state/StratixStateStore → SystemZone 状态 + 扫描结果缓存
│   ├── permission/PermissionOrchestrator → Guardian 权限检查
│   ├── command/CommandOrchestrator → System Zone 命令注册
│   ├── retry/RetryPolicyEngine → 扫描命令重试
│   └── budget/ → 保留接口，Phase 1 不设预算上限
├── stratix-agent/                        # Agent 能力
│   └── runtime/SessionRuntime → Observer/Strategist LLM 会话
├── stratix-gateway/                      # 网关
│   └── agent/AgentOrchestrationService → Agent 调度
├── stratix-data-store/                   # 持久化
│   └── 数据访问层 → System Zone 数据读写
└── stratix-database/                     # 数据库
    └── System Zone 表结构
```

### 8.2 API 路由

**认证**：所有 `/api/systemzone/*` 路由复用 Gateway 现有认证中间件，校验 `owner_id` 与当前用户匹配。

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
| 2026-04-05 | 3.0 | 实现 strategy 明确：Observer 规则预处理+LLM语义提取；Strategist 确定性扫描+LLM辅助分析；LLM 通过 SessionRuntime/AgentRouter 接入无预算限制；持久化改用 stratix-database；补充数据库索引；补充 API 认证；删除愿景叙事；新增 auth 模块 |

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

## 12. 开发计划

### 12.1 开发顺序与依赖

```
Step 1: 类型定义 + 数据库 schema
  └── 无依赖，其他所有模块的基础

Step 2: Guardian 路径保护 + 熔断器
  └── 依赖 Step 1，安全层先于业务逻辑就位

Step 3: ProjectScanner 确定性扫描
  └── 依赖 Step 1，不依赖 LLM，可独立验证

Step 4: Observer（规则预处理 + LLM 语义提取）
  └── 依赖 Step 1，验证 LLM 通过 SessionRuntime 可调通

Step 5: Strategist（扫描映射 + LLM 增强）
  └── 依赖 Step 3 + Step 4 的 LLM 通道

Step 6: API 路由 + 认证
  └── 依赖 Step 1-5，暴露 HTTP 接口

Step 7: 手动触发循环（端到端集成）
  └── 依赖全部，跑通完整流程
```

### 12.2 每个 Step 的交付物与验收标准

#### Step 1: 类型定义 + 数据库 schema

**交付物：**
- `src/stratix-systemzone/types.ts` — 所有接口定义（SystemZone, ObserverState, StrategistState, Proposal, Insight, Lesson, ScanResult 等）
- 数据库 migration 文件 — 5 张表 + 5 个索引

**验收标准：**
- [ ] TypeScript 编译通过（`npm run typecheck` 无新增错误）
- [ ] migration 文件可直接执行，表和索引创建成功
- [ ] 所有文档中的接口在 types.ts 中有对应定义，无遗漏

#### Step 2: Guardian 路径保护 + 熔断器

**交付物：**
- `src/stratix-systemzone/guardian/Guardian.ts`
- `src/stratix-systemzone/guardian/PathProtection.ts`
- `src/stratix-systemzone/guardian/PermissionMatrix.ts`

**验收标准：**
- [ ] `validateProposal()` 对 `**/payment/**` 等保护路径返回 invalid
- [ ] 对普通路径返回 valid
- [ ] CircuitBreaker 连续失败 3 次后状态变为 open，1 分钟后变为 half-open
- [ ] 单元测试覆盖以上场景

#### Step 3: ProjectScanner 确定性扫描

**交付物：**
- `src/stratix-systemzone/strategist/ProjectScanner.ts`
- `src/stratix-systemzone/strategist/ProposalMapper.ts`
- `src/stratix-systemzone/strategist/types.ts`

**验收标准：**
- [ ] `runTestCoverage()` 执行 `npm test -- --coverage --json` 并解析为 CoverageReport
- [ ] `runTypeCheck()` 执行 `npm run typecheck` 并解析为 TypeCheckResult
- [ ] `runLint()` 执行 `npm run lint -- --format json` 并解析为 LintResult
- [ ] `scanFileSizes()` 标记 >500 行的文件
- [ ] 每个命令有 60s 超时保护，超时返回部分结果
- [ ] `ProposalMapper` 将扫描结果正确映射为 Proposal[]
- [ ] 扫描结果缓存到 StratixStateStore，30 分钟内不重复扫描

#### Step 4: Observer（规则预处理 + LLM 语义提取）

**交付物：**
- `src/stratix-systemzone/observer/Observer.ts`
- `src/stratix-systemzone/observer/InputPreprocessor.ts`
- `src/stratix-systemzone/observer/InsightExtractor.ts`
- `src/stratix-systemzone/observer/types.ts`

**验收标准：**
- [ ] `InputPreprocessor` 正确检测格式（code/url/text/json）和语言（zh/en/mixed）
- [ ] `InsightExtractor` 通过 SessionRuntime → AgentRouter 调用 LLM 成功
- [ ] LLM 返回符合 InsightExtractionResult schema 的 JSON
- [ ] 输入一段测试文本，输出包含 entities、keywords、type、summary 的结构化结果
- [ ] 预处理结果写入 stratix-database 的 system_zone_insights 表

#### Step 5: Strategist（扫描映射 + LLM 增强）

**交付物：**
- `src/stratix-systemzone/strategist/Strategist.ts`
- `src/stratix-systemzone/strategist/StrategistLLMEnhancer.ts`

**验收标准：**
- [ ] Strategist 组合 ProjectScanner + ProposalMapper + StrategistLLMEnhancer 完成完整流程
- [ ] 对 Stratix 项目执行一次完整扫描，产出 Proposal[]
- [ ] LLM 增强后的提案包含具体改进建议（不是泛泛而谈）
- [ ] 提案写入 stratix-database 的 system_zone_proposals 表
- [ ] Guardian 对每条提案执行路径保护检查

#### Step 6: API 路由 + 认证

**交付物：**
- `src/stratix-systemzone/api/routes/systemzone.ts`
- `src/stratix-systemzone/api/auth/ZoneAuthGuard.ts`

**验收标准：**
- [ ] `POST /api/systemzone/inputs` 接收用户输入，触发 Observer
- [ ] `POST /api/systemzone/observe` 触发完整观察循环
- [ ] `GET /api/systemzone/proposals` 返回提案列表（支持 status 过滤）
- [ ] `POST /api/systemzone/proposals/:id/approve` 审批提案
- [ ] `GET /api/systemzone/insights` 返回洞察列表
- [ ] 所有路由校验 owner_id，非 owner 返回 403
- [ ] 路由注册到 Gateway 现有 Express/Fastify 实例

#### Step 7: 手动触发循环（端到端集成）

**交付物：**
- `src/stratix-systemzone/SystemZone.ts`（主类，串联所有模块）
- 集成测试

**验收标准：**
- [ ] 用户输入一段文本 → Observer 提取洞察 → 写入数据库
- [ ] 用户触发"分析项目" → Scanner 扫描 → Strategist 生成提案 → 写入数据库
- [ ] 提案列表可在 API 查询到
- [ ] 审批流程正常：approve/reject 状态变更
- [ ] Guardian 拦截对保护路径的提案
- [ ] 熔断器在连续失败后正确触发
- [ ] 完整流程无报错，日志可追踪

### 12.3 预估工作量

| Step | 新文件数 | 依赖外部 | 预估 |
|------|---------|---------|------|
| Step 1 | 2 | 无 | 小 |
| Step 2 | 3 | 无 | 小 |
| Step 3 | 3 | npm test/typecheck/lint | 中 |
| Step 4 | 4 | SessionRuntime + LLM | 中 |
| Step 5 | 2 | Step 3 + 4 | 中 |
| Step 6 | 2 | Gateway auth | 小 |
| Step 7 | 1 + 测试 | 全部 | 中 |

### 12.4 风险点

| 风险 | 影响 | 应对 |
|------|------|------|
| jest/tsc/eslint 命令输出格式解析失败 | Step 3 阻塞 | 先手动跑命令记录输出格式，写 fixture 测试 |
| SessionRuntime LLM 调用链路不通 | Step 4-5 阻塞 | Step 4 优先验证最小 LLM 调用，不通则降级为纯确定性模式 |
| 数据库 migration 与现有 schema 冲突 | Step 1 阻塞 | 新表独立命名（system_zone_ 前缀），不修改现有表 |

---

> **最后更新**: 2026-04-05
>
> **状态**: v3.0 - Phase 1 可投入开发
>
> **下一步**: Step 1（类型定义 + 数据库 schema）
