# System Zone Agent 化重设计方案

**版本**: v1.0  
**日期**: 2026-04-06  
**状态**: 设计中  
**作者**: 锻（Duàn）+ 姜琦

---

## 0. 设计原则

1. **System Zone 本质就是 Zone** — 它是一个特殊的 Zone，目标是优化 Stratix 项目自身
2. **每个角色是独立的 LLM Agent** — 有自己的 prompt、记忆、决策能力
3. **基于 StratixAgent 框架实现** — 复用已有的 Agent、Skill、Memory、Session 基础设施
4. **已有代码不废弃** — 作为 Agent 可调用的工具/接口，而非独立运行的模块
5. **LLM 输出结构化 JSON** — modifications 足够细致，可以直接应用到代码里

---

## 1. 当前问题

### 1.1 执行链路断裂

```
StrategistLLMEnhancer
  → LLM 返回 codeSuggestion（代码文本描述）
  → 存到 Proposal.codeSuggestion

BootstrapEngine.convertToExecutorProposal()
  → 转换时完全忽略 codeSuggestion

Executor.buildModificationPlan()
  → 从 (proposal as any).modifications 取值 → 不存在 → 空数组
  → 创建沙箱 → 不改代码 → 跑测试 → 空 commit
```

### 1.2 角色不是 Agent

Observer/Strategist/Executor/Guardian/Fitness 各自独立运行，没有：
- Agent 身份（没有 StratixAgent 实例）
- 消息协议（没有 task_delegate/task_complete）
- 能力声明（没有注册到 ZoneCoordinator）
- 记忆系统（没有跨 session 的记忆）

### 1.3 没有 ZoneCoordinator

SystemZone.ts 手动编排各模块，但不是 ZoneCoordinator 实例。不参与：
- Zone 成员管理
- 任务分派
- Agent 能力匹配
- Task 流转记录
- 审计日志

---

## 2. 目标架构

### 2.1 全景图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           System Zone (Zone 实例)                         │
│  zoneId: "system-zone"                                                   │
│  title: "Stratix 项目自优化"                                              │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    ZoneCoordinator                               │    │
│  │  - 接收需求（用户输入 / 外部触发 / 定时扫描）                        │    │
│  │  - LLM 分解任务                                                  │    │
│  │  - 按能力分派给 Agent                                             │    │
│  │  - 监控进度、汇总结果                                             │    │
│  │  - 记录审计日志                                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│         │ task_delegate              │ task_delegate                     │
│         ▼                            ▼                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Observer    │  │ Strategist  │  │  Executor   │  │  Guardian   │    │
│  │  Agent       │  │ Agent       │  │  Agent      │  │  Agent      │    │
│  │             │  │             │  │             │  │             │    │
│  │ capability: │  │ capability: │  │ capability: │  │ capability: │    │
│  │  analysis:5 │  │  analysis:5 │  │  coding:5   │  │  analysis:5 │    │
│  │  research:4 │  │  coding:4   │  │             │  │             │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│         │                            │                    │              │
│         │ task_complete              │ task_complete      │ task_complete│
│         └────────────────────────────┴────────────────────┘              │
│                                      │                                   │
│                    ZoneCoordinator 汇总 → 下一步任务 or 结束              │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Agent 角色定义

| Agent | Agent ID | 能力 | 职责 | Soul 核心指令 |
|-------|----------|------|------|-------------|
| **Observer Agent** | `sz-observer` | analysis:5, research:4 | 接收输入（代码/文本/URL），深度分析并输出结构化洞察 | 你是项目健康分析专家 |
| **Strategist Agent** | `sz-strategist` | analysis:5, coding:4, research:3 | 基于洞察/扫描结果，生成结构化修改方案（JSON modifications） | 你是代码改进策略师，输出必须是可以直接执行的结构化修改 |
| **Executor Agent** | `sz-executor` | coding:5 | 在沙箱中应用 modifications，运行测试，验证通过后提交 | 你是代码执行者，严格按修改方案操作，不做额外改动 |
| **Guardian Agent** | `sz-guardian` | analysis:5 | 审查修改方案的安全性（路径、影响范围、回滚风险），通过/拒绝/建议修改 | 你是安全守门人，宁可误拒不可漏放 |

### 2.3 关键差异：Guardian 不是执行者

Guardian 的角色是**审查者**，不执行代码修改。它审查 Strategist 的 modifications，输出安全评估：
- `approved`：可以执行
- `rejected`：不安全，说明原因
- `conditional`：需要修改某些部分后才安全

---

## 3. 核心改造点

### 3.1 修改 Proposal 类型，增加结构化 modifications

```typescript
// src/stratix-systemzone/types.ts

/** 单个文件的 unified diff hunk */
export interface DiffHunk {
  oldStart: number;        // 原始文件起始行号
  oldLines: number;       // 原始文件行数
  newStart: number;       // 新文件起始行号
  newLines: number;       // 新文件行数
  header?: string;        // @@ ... @@ 头部
  lines: DiffLine[];      // diff 行
}

/** diff 行 */
export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
}

/** 文件修改操作（unified diff 格式） */
export interface FileModification {
  type: 'create' | 'edit' | 'delete' | 'rename';
  path: string;           // 相对于项目根目录的文件路径
  /** unified diff 格式的修改内容 */
  diff?: string;          // 完整 unified diff 字符串
  hunks?: DiffHunk[];     // 解析后的 hunk 列表
  /** create 时的完整文件内容 */
  content?: string;
  /** rename 时的目标路径 */
  newPath?: string;
  /** 这次修改的说明 */
  description: string;
}

/** 安全评估结果 */
export interface SafetyAssessment {
  approved: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  concerns: string[];      // 安全隐患列表
  suggestions: string[];   // 修改建议
  confidence: number;      // 0-1
}

export interface Proposal {
  id: string;
  timestamp: Date;
  type: ProposalType;
  title: string;
  description: string;
  target: ProposalTarget;
  selection: ProposalSelection;
  status: ProposalStatus;

  // ===== 新增：结构化修改 =====
  modifications: FileModification[];  // Strategist 生成的具体修改
  safetyAssessment?: SafetyAssessment; // Guardian 的安全审查结果

  // ===== 保留：兼容字段 =====
  codeSuggestion?: string;       // 保留，作为 fallback 或人类可读描述
  riskLevelStr?: 'high' | 'medium' | 'low';
  effortEstimate?: 'small' | 'medium' | 'large';
  reasoning?: string;
}
```

### 3.2 Strategist Agent 的核心 Prompt

Strategist Agent 的 LLM 必须输出结构化 JSON，包含完整的 modifications（unified diff 格式）：

```json
{
  "title": "修复 Executor.buildModificationPlan 空转问题",
  "description": "当前 buildModificationPlan 从不存在的 modifications 字段取值...",
  "reasoning": "根因是 Proposal 没有 modifications 字段...",
  "modifications": [
    {
      "type": "edit",
      "path": "src/stratix-systemzone/executor/Executor.ts",
      "diff": "--- a/src/stratix-systemzone/executor/Executor.ts\n+++ b/src/stratix-systemzone/executor/Executor.ts\n@@ -447,9 +447,7 @@\n   private buildModificationPlan(proposal: Proposal): ModificationPlan {\n-    const modifications: FileModification[] = [];\n-\n-    if ('modifications' in proposal && Array.isArray((proposal as any).modifications)) {\n-      modifications.push(...(proposal as any).modifications);\n-    }\n+    const modifications: FileModification[] = proposal.modifications ?? [];\n \n     return {\n       proposalId: proposal.id,",
      "description": “直接从 Proposal.modifications 取值，不再从 as any 取"
    }
  ],
  "riskLevel": "low",
  "effortEstimate": "small"
}
```

**关键约束**（写入 Strategist Agent 的 Soul）：
- `diff` 必须是**标准的 unified diff 格式**（可被 `git apply` 直接应用）
- 行号必须精确（基于实际文件的当前内容）
- 上下文行必须和源文件完全一致（包括空格、缩进）
- 每个 modification 必须附带 `description`
- 不确定的地方标记为 `// TODO: 需要人工确认`
- 对于新文件创建，使用 `type: "create"` + `content`（完整文件内容）

### 3.3 Agent 间协作流程

```
用户输入 → ZoneCoordinator.processRequirement()
               │
               ▼ LLM 分解
        ┌──────────────┐
        │ Task 1: 观察  │ → delegate → Observer Agent
        └──────────────┘
               │ task_complete({ output: insights })
               ▼
        ┌──────────────┐
        │ Task 2: 策略  │ → delegate → Strategist Agent
        └──────────────┘     (接收 insights 作为 context)
               │ task_complete({ output: proposal with modifications })
               ▼
        ┌──────────────┐
        │ Task 3: 审查  │ → delegate → Guardian Agent
        └──────────────┘     (接收 modifications 作为 context)
               │ task_complete({ output: safetyAssessment })
               ▼
        ┌──────────────────────────────────────────┐
        │ ZoneCoordinator 判断：                      │
        │ - approved → 创建 Task 4                   │
        │ - rejected → 结束或回退到 Task 2            │
        └──────────────────────────────────────────┘
               │ (if approved)
               ▼
        ┌──────────────┐
        │ Task 4: 执行  │ → delegate → Executor Agent
        └──────────────┘     (接收 approved modifications)
               │ task_complete({ output: executionResult })
               ▼
        ZoneCoordinator 汇总结果 → 通知用户
```

### 3.4 已有代码的定位

| 现有模块 | 新定位 | 说明 |
|---------|--------|------|
| `Observer.ts` | Observer Agent 的**工具**（tool/skill） | Agent 通过 skill 调用 Observer 的预处理和提取能力 |
| `InsightExtractor.ts` | Observer Agent 的 skill | Agent 调用此 skill 进行 LLM 提取 |
| `ProjectScanner.ts` | Strategist Agent 的 skill | Agent 调用此 skill 获取项目扫描数据 |
| `StrategistLLMEnhancer.ts` | Strategist Agent 的 skill | Agent 调用此 skill 进行 LLM 增强 |
| `Guardian.ts` | Guardian Agent 的**安全约束层** | Agent 决策前必须通过 Guardian 的规则检查 |
| `Executor.ts` | Executor Agent 的**执行引擎** | Agent 调用 Executor 的沙箱/测试/提交能力 |
| `CodeModifier.ts` | Executor Agent 的 **diff 应用引擎** | 改造为 unified diff 应用器（`git apply --check` 验证 → 应用） |
| `TestRunner.ts` | Executor Agent 的 skill | Agent 调用此 skill 运行测试 |
| `RollbackManager.ts` | Executor Agent 的 skill | Agent 调用此 skill 回滚 |
| `FitnessEvaluator.ts` | ZoneCoordinator 的评估工具 | 每次 cycle 结束后评估系统健康度 |
| `BootstrapEngine.ts` | **被 ZoneCoordinator 替代** | 编排逻辑由 ZoneCoordinator + Agent 协作完成 |
| `DiscoveryEngine.ts` | 合并到 Observer/Strategist | 发现职责分散到各 Agent |
| `DecisionEngine.ts` | 合并到 ZoneCoordinator | 决策由 Coordinator + Guardian Agent 完成 |

### 3.5 高风险暂停机制（用户确认）

Guardian Agent 判定高风险时的完整流程：

```
Guardian Agent 完成审查
  ↓
SafetyAssessment.riskLevel === 'high'
  ↓
ZoneCoordinator:
  1. 更新任务状态为 'blocked'
  2. 保存 SafetyAssessment 到 Proposal
  3. 通过 WebSocket 广播 'task_blocked' 事件
     payload: {
       taskId,
       proposalId,
       modifications: [...],  // 含 unified diff
       concerns: [...],       // Guardian 的安全隐患列表
       riskLevel: 'high'
     }
  4. 暂停该任务的后续执行
  ↓
前端 ZoneTaskConfirmPanel:
  - 收到 'task_blocked' 事件
  - 展示 diff 预览（新增行绿色、删除行红色）
  - 展示 Guardian 的 concerns
  - 用户点击「确认执行」或「拒绝」
  ↓
用户确认 → API 调用 → ZoneCoordinator 继续任务
用户拒绝 → API 调用 → ZoneCoordinator 取消任务
```

**API 端点**：
- `POST /api/zones/:zoneId/tasks/:taskId/confirm` — 用户确认执行
- `POST /api/zones/:zoneId/tasks/:taskId/reject` — 用户拒绝

### 3.6 DiffApplier（CodeModifier 改造）

```typescript
class DiffApplier {
  /**
   * 验证 diff 是否可以干净地应用
   * 使用 git apply --check 做精确验证
   */
  async validateDiff(workDir: string, diff: string): Promise<{
    valid: boolean;
    errors: string[];
  }>;

  /**
   * 应用 unified diff 到工作目录
   * 1. 先 git apply --check
   * 2. 通过则 git apply
   * 3. 失败则尝试逐 hunk 精确匹配 fallback
   */
  async applyDiff(workDir: string, diff: string): Promise<{
    success: boolean;
    appliedFiles: string[];
    errors: string[];
  }>;

  /**
   * 生成 diff 预览（用于前端展示）
   * 返回按文件分组的 diff，含行号和颜色标记
   */
  async previewDiff(diff: string): Promise<{
    files: Array<{
      path: string;
      hunks: Array<{
        header: string;
        lines: Array<{ type: 'context'|'add'|'remove'; content: string; lineNo?: number }>;
      }>;
    }>;
  }>;

  /**
   * 回滚已应用的 diff
   */
  async rollbackDiff(workDir: string, diff: string): Promise<void>;
}
```

### 3.7 System Zone 作为 Zone 实例

```typescript
// 在项目启动时，创建 System Zone 的 Zone 实例
const SYSTEM_ZONE_TITLE = 'Stratix 项目自优化';

// 1. 确保 Zone 存在
const zone = zoneRepository.getZone(SYSTEM_ZONE_ID) 
  ?? zoneRepository.createZone({
    zoneId: SYSTEM_ZONE_ID,
    projectId: 'stratix',
    title: SYSTEM_ZONE_TITLE,
    prompt: '持续优化 Stratix 项目的代码质量、测试覆盖率、架构健康度',
  });

// 2. 创建 ZoneCoordinator
const coordinator = await ZoneCoordinator.create(SYSTEM_ZONE_ID, {
  llmProvider: 'openai',
  autoDecompose: true,
  autoAssign: true,
  assignStrategy: 'capability_match',
});

// 3. 创建 4 个 Agent 实例
const observerAgent = new StratixAgent({
  agentId: 'sz-observer',
  name: 'Observer',
  type: 'analyst',
  provider: 'openai',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.3,
  maxTokens: 4096,
  maxShortTerm: 20,
  enableLongTerm: true,
}, {
  identity: '你是 Stratix 项目的健康分析专家。你的任务是深度分析项目代码、测试报告、用户输入，输出结构化的洞察。',
  personality: '严谨、细致、善于发现隐藏问题',
  goals: [
    '发现代码质量问题',
    '识别架构风险',
    '追踪技术债务',
    '生成可操作的洞察',
  ],
  constraints: [
    '输出必须是结构化 JSON',
    '不确定的信息必须标注置信度',
    '不能修改任何代码',
  ],
});

// ... 同理创建 strategist, executor, guardian agents

// 4. 注册为 Zone 成员
zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-observer', 'executor');
zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-strategist', 'executor');
zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-executor', 'executor');
zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-guardian', 'executor');

// 5. 注册能力
agentCapabilityRepository.setCapability('sz-observer', SYSTEM_ZONE_ID, 'analysis', 5);
agentCapabilityRepository.setCapability('sz-observer', SYSTEM_ZONE_ID, 'research', 4);
agentCapabilityRepository.setCapability('sz-strategist', SYSTEM_ZONE_ID, 'analysis', 5);
agentCapabilityRepository.setCapability('sz-strategist', SYSTEM_ZONE_ID, 'coding', 4);
agentCapabilityRepository.setCapability('sz-executor', SYSTEM_ZONE_ID, 'coding', 5);
agentCapabilityRepository.setCapability('sz-guardian', SYSTEM_ZONE_ID, 'analysis', 5);

// 6. 为每个 Agent 注册专用 skills
// Observer Agent skills:
observerAgent.skills.registerSkill({
  skillId: 'observe_input',
  name: '观察输入',
  description: '接收文本输入，通过 LLM 提取结构化洞察',
  parameters: [
    { name: 'content', type: 'string', required: true, description: '输入内容' },
    { name: 'source', type: 'string', required: false, description: '来源' },
  ],
  executor: 'builtin',
});

// Strategist Agent skills:
strategistAgent.skills.registerSkill({
  skillId: 'scan_project',
  name: '扫描项目',
  description: '运行覆盖率、类型检查、lint、文件大小扫描',
  parameters: [],
  executor: 'builtin',
});

strategistAgent.skills.registerSkill({
  skillId: 'generate_modifications',
  name: '生成修改方案',
  description: '基于洞察和扫描结果，生成结构化代码修改 JSON',
  parameters: [
    { name: 'insights', type: 'array', required: true, description: 'Observer 的洞察列表' },
    { name: 'targetFile', type: 'string', required: false, description: '目标文件路径' },
  ],
  executor: 'builtin',
});

// ... etc
```

---

## 4. 实现步骤

### Phase A：基础设施（让 Agent 能在 Zone 里跑起来）

**A1. System Zone Zone 实例创建**
- 文件: `src/stratix-systemzone/SystemZoneManager.ts`（新建）
- 任务: 创建 Zone 实例 + ZoneCoordinator + 4 个 Agent + 注册成员和能力
- 验收: ZoneCoordinator 能列出 4 个成员，能查到能力

**A2. Agent Skill 注册**
- 文件: 每个角色的 skill 定义文件
- 任务: 把现有模块的功能封装成 Skill（Observer → observe_input skill, Scanner → scan_project skill, etc.）
- 验收: 每个 Agent 的 skill 列表正确，能通过 `agent.skills.execute()` 调用

**A3. Proposal 类型扩展**
- 文件: `src/stratix-systemzone/types.ts`
- 任务: 增加 `modifications: FileModification[]` 和 `safetyAssessment: SafetyAssessment`
- 验收: TypeScript 编译通过，不破坏现有代码

### Phase B：核心链路（修好断裂的执行管道）

**B1. Strategist Agent 的 modifications 生成**
- 任务: 重写 Strategist 的核心 prompt，输出包含 modifications（unified diff 格式）的 JSON
- 关键: diff 必须是标准 unified diff 格式，可被 `git apply --check` 验证
- 验收: LLM 返回的 JSON 中 diff 字段能被 `git apply` 成功应用

**B2. CodeModifier 改造为 DiffApplier**
- 任务: 改造 `CodeModifier.ts` 支持 unified diff 应用
  - `validateDiff()` — 用 `git apply --check` 验证 diff 是否可以应用
  - `applyDiff()` — 用 `git apply` 应用 diff 到沙箱目录
  - `applyDiffFallback()` — 如果 `git apply` 失败，尝试逐 hunk 精确匹配应用
- 同时: 修改 `Executor.buildModificationPlan()` 从 `proposal.modifications` 取值
- 验收: 给定有效的 unified diff，能正确修改文件并通过测试

**B3. Guardian Agent 的安全审查 + 高风险暂停**
- 任务: Guardian Agent 审查 modifications 的安全性
- 输入: modifications 列表 + 目标文件内容 + diff 预览
- 输出: SafetyAssessment（approved/rejected/conditional + concerns）
- **高风险暂停机制**: 当 `riskLevel === 'high'` 时：
  1. 任务状态设为 `blocked`
  2. 通过 WebSocket 通知前端
  3. 用户在 ZoneTaskConfirmPanel 查看 diff 预览并确认/拒绝
  4. 确认后任务继续流向 Executor
  5. 拒绝则任务标记为 cancelled
- 验收: 能拦截危险修改，通过安全修改，高风险时暂停等用户确认

### Phase C：协作流程（ZoneCoordinator 驱动完整 cycle）

**C1. System Zone 专属的 Coordinator 编排逻辑**
- 任务: ZoneCoordinator.processRequirement() 的自定义版本
- 流程: 观察 → 策略 → 审查 → 执行 → 评估
- 验收: 完整 cycle 能跑通

**C2. Agent 间上下文传递**
- 任务: 前一个 Agent 的输出作为下一个 Agent 的 context
- 机制: 通过 ZoneCoordinator 的 task_delegate 参数传递
- 验收: Observer 的 insights 能被 Strategist 看到，Strategist 的 modifications 能被 Guardian 看到

**C3. 结果评估和反馈循环**
- 任务: FitnessEvaluator 在 cycle 结束后评估，结果反馈给 ZoneCoordinator
- 验收: 如果执行后系统变差，能触发回滚

### Phase D：UI 适配

**D1. System Zone 面板对接新的 Agent 架构**
- 任务: UI 展示 Zone 内 Agent 成员、任务流转、审计日志
- 复用: 现有的 Zone UI 组件
- 验收: 用户能在 UI 上看到完整的 Agent 协作过程

**D2. 手动触发和自动循环**
- 任务: 支持手动触发 cycle + 定时自动 cycle
- 验收: 和现有 BootstrapEngine 的自动循环功能对等

---

## 5. 关键设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| System Zone 是不是 Zone 实例 | **是** | 复用 Zone 的所有基础设施（成员、能力、任务流转、审计） |
| Agent 框架选择 | **StratixAgent** | 项目已有的框架，有完整的 Skill/Memory/Session 支持 |
| LLM 输出格式 | **JSON modifications** | 必须可直接执行，不能是描述性文本 |
| 代码修改粒度 | **Unified diff** | 可被 `git apply` 直接应用，有标准工具链支持，比 search/replace 更精确可靠 |
| Guardian 的定位 | **独立审查 Agent** | 不是 Executor 的前置校验，是有独立判断能力的 LLM Agent |
| BootstrapEngine 去留 | **被 ZoneCoordinator 替代** | 编排逻辑天然属于 Coordinator 职责 |
| 已有模块去留 | **保留为 Skill/Tool** | 不废弃，作为 Agent 可调用的能力 |

---

## 6. 风险和约束

1. **LLM 生成 diff 的准确性** — 行号和上下文可能不精确。缓解：Executor 在 apply 前先用 `git apply --check` 验证，失败则回退到让 LLM 重新生成
2. **Agent 间 LLM 调用成本** — 每个 Agent 各调一次 LLM，一次 cycle 至少 4 次调用。缓解：低风险任务可跳过 Guardian
3. **现有测试兼容性** — 现有测试是针对独立模块的，需要适配为 Agent skill 测试
4. **UI 改动范围** — Zone 通用 UI 已完整（成员、任务、审计），System Zone 需要增加 Agent 状态 Tab
5. **高风险暂停机制** — Guardian 判定高风险时，通过 ZoneTaskConfirmPanel 暂停等待用户确认

---

## 7. 下一步

确认这个设计方案后，我会：
1. 拆解为具体的开发 Task（含文件路径、验收标准、验证方式）
2. 按 Phase A → B → C → D 顺序执行
3. 每个 Phase 完成后做 review

## 8. 已确认的设计决策

- **代码修改方式**：Unified diff 或 AST 级别（不用 search/replace）
- **高风险修改**：暂停等待用户确认
- **Zone UI**：已有完整组件（ZoneDetail、ZoneAuditPanel、ZoneTaskConfirmPanel 等），System Zone 控制台也有独立 UI

## 9. Zone UI 现状确认

### 已有的 Zone 通用 UI 组件

| 组件 | 功能 |
|------|------|
| `ZoneDetail.vue` | Zone 详情（title、prompt、成员、任务、消息） |
| `ZonePanel.vue` | Zone 编辑弹窗（CRUD） |
| `ZoneList.vue` | Zone 列表 |
| `ZoneAuditPanel.vue` | 审计日志（事件类型过滤、Agent 过滤、时间范围、统计） |
| `ZoneTaskConfirmPanel.vue` | 任务确认面板（需求输入、任务分派建议、确认/拒绝） |
| `ZoneTaskReassignPanel.vue` | 任务重新分派 |
| `ZoneManualTaskCreator.vue` | 手动创建任务 |
| `ZoneEditor.vue` | Zone 编辑器 |
| `ZoneFilePicker.vue` / `ZoneFileTable.vue` | Zone 文件管理 |

### System Zone 独立 UI

| 组件 | 功能 |
|------|------|
| `SystemZoneConsole.vue` | System Zone 控制台（Tab 切换） |
| `InsightsPanel.vue` | 洞察列表 |
| `ProposalsPanel.vue` | 提案列表 |
| `ExecutionsPanel.vue` | 执行记录 |
| `SourcesPanel.vue` | 外部信息源 |
| `BootstrapPanel.vue` | 自举控制 |
| `FitnessPanel.vue` | 健康度评估 |
| `LLMConfigPanel.vue` | LLM 配置 |

### 结论

Zone 通用 UI **已完整支持**成员展示、任务流转、审计日志、需求输入、任务确认/分派。System Zone 改造后可以：
1. **复用 ZoneAuditPanel** — System Zone 的 Agent 活动自动记录到审计日志
2. **复用 ZoneTaskConfirmPanel** — 高风险修改暂停时，用户在确认面板操作
3. **保留 SystemZoneConsole** — 作为 System Zone 的专属视图，增加 Agent 状态 Tab
