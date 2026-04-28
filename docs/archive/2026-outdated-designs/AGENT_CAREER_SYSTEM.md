# Agent 职业规划 + 技能养成系统设计方案

> 版本：v2.0（修订版）
> 修订日期：2026-03-26
> 修订依据：Backend/AI/Frontend 评审意见

## 背景

当前 Agent 配置（Soul/Rules/Skills）是静态的 RPG 数值系统，与实际能力脱节：
- Skills 是战斗属性（health +10, attack +2），对 Agent 能力没有实际意义
- Soul 模板是通用角色定位，没有 Zone 协作概念
- Rules 缺乏 Zone 行为规范
- Agent 无法通过工作积累经验和技能

## 目标

1. **职业规划系统** - Agent 从 agency-agents（144+ 模板）创建时确定职能
2. **Soul 进化** - Soul 模板内置进化提示词，Agent 可自我完善
3. **共享技能库** - Skills 来自 SkillHub.tencent.com，安装后所有 Agent 共享
4. **用户养成** - Skills 面板显示已安装/已学习技能，支持养成

## 整体架构

```
Agent 创建
├── 1. 选择职业（agency-agents 144+ 模板）
│   └── 确定 Soul（identity + goals + personality + 进化提示词）
│
├── 2. 安装技能（SkillHub 技能库）
│   └── 技能安装后共享给所有 Agent
│
└── 3. 创建完成
        │
        ▼
    Agent 工作
    ├── 利用 find-skills 学习新技能（Soul 进化）
    ├── 学会的技能存储到记忆系统
    └── Skills 面板展示已学习技能
```

---

## 数据模型（修订 v2.0）

### 类型命名规范

为避免与现有类型冲突，引入以下命名规范：

| 概念 | 类型名 | 说明 |
|------|--------|------|
| 角色配置 | `CharacterProfile` | 现有类型，保持不变 |
| Agent静态配置 | `StratixAgentConfig` | 现有类型，保持不变 |
| 职业档案（新增） | `AgentCareerProfile` | 扩展 Agent 职业能力 |
| 技能定义 | `StratixSkillConfig` | 现有静态技能配置（parameters/scripts） |
| 已安装技能 | `InstalledSkillBinding` | 共享技能库绑定（关联表） |
| 已学会技能 | `LearnedSkill` | Agent 通过工作学会的技能 |

### Agent 职业档案

```typescript
interface AgentCareerProfile {
  agentId: string;
  name: string;
  career: string;                      // 职业（来自 agency-agents）
  soul: StratixSoulConfig;
  rules: string[];

  // 技能定义（静态）- 来自 StratixSkillConfig
  installedSkillDefs: StratixSkillConfig[];

  // 已学会的技能（动态）- 通过工作学习获得
  learnedSkills: LearnedSkill[];

  // 技能点（用于学习）
  skillPoints: number;

  // 进化配置
  evolutionConfig: EvolutionConfig;

  createdAt: string;
  updatedAt: string;
}
```

### 已安装技能 vs 已学会技能

| 概念 | 定义 | 特点 |
|------|------|------|
| **已安装 (InstalledSkillBinding)** | 从 SkillHub 安装到共享库 | 所有 Agent 共享，可卸载，无等级 |
| **已学会 (LearnedSkill)** | Agent 工作后真正掌握 | 绑定到特定 Agent，带等级和经验 |

**语义明确**：
- `installed` = Agent 可用的技能（安装到系统，共享）
- `learned` = Agent 通过工作掌握的技能（有等级和经验）
- **安装是前提，学习是结果**

### 已学会技能（养成系统）

```typescript
interface LearnedSkill {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;

  // 养成字段
  level: number;                    // 等级（1-5）
  experiencePoints: number;           // 经验值
  proficiency: number;               // 熟练度 0-100
  certified: boolean;                // 是否通过认证

  // 学习记录
  learnedFrom?: string;              // 从哪个 SkillHub 学的
  learnedAt: number;                // 学习时间
  lastPracticedAt: number;          // 最后练习时间
}
```

### 共享技能库

```typescript
interface SharedSkill {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  icon?: string;
  mcpTool?: string;                 // MCP 工具名称
  endpoint?: string;                // 技能端点
  provider: SkillProvider;           // 'builtin' | 'skillhub'
  createdAt: string;
  updatedAt: string;
}

// 已安装技能绑定（关联表替代数组）
interface InstalledSkillBinding {
  skillId: string;
  agentId: string;
  installedAt: number;
  installedBy: string;               // 'user' | agentId
}
```

---

## 数据库 Schema（新增）

### 新增表

```sql
-- 共享技能库
CREATE TABLE shared_skills (
  skill_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  icon TEXT,
  mcp_tool TEXT,
  endpoint TEXT,
  provider TEXT DEFAULT 'builtin',
  created_at INTEGER,
  updated_at INTEGER
);

-- 技能安装关联表（替代 installedAgents 数组）
CREATE TABLE shared_skill_installs (
  skill_id TEXT REFERENCES shared_skills(skill_id),
  agent_id TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  installed_by TEXT NOT NULL,
  PRIMARY KEY (skill_id, agent_id)
);

-- Agent 学会的技能
CREATE TABLE agent_learned_skills (
  skill_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  level INTEGER DEFAULT 1,
  experience_points INTEGER DEFAULT 0,
  proficiency INTEGER DEFAULT 0,
  certified INTEGER DEFAULT 0,
  learned_from TEXT,
  learned_at INTEGER NOT NULL,
  last_practiced_at INTEGER,
  UNIQUE(skill_id, agent_id)
);

-- Zone 上下文
CREATE TABLE zone_contexts (
  zone_id TEXT PRIMARY KEY,
  context_json TEXT,
  updated_at INTEGER
);

-- Agent-Zone 关联
CREATE TABLE agent_zone_bindings (
  agent_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, zone_id)
);
```

### 迁移策略

在 `stratix-database/migrate.ts` 中添加新表迁移逻辑：
- Phase 1：添加 `shared_skills`、`shared_skill_installs`
- Phase 2：添加 `agent_learned_skills`
- Phase 3：添加 `zone_contexts`、`agent_zone_bindings`

---

## API 契约（修订 v2.0）

### ZoneContextManager 接口

```typescript
interface ZoneContextResult {
  success: boolean;
  context?: ZoneContext;
  error?: string;
  injectedAt: number;
}

interface ZoneContextManager {
  // 进入 Zone 时调用
  inject(agentId: string, zoneId: string): Promise<ZoneContextResult>;

  // 离开 Zone 时调用（离开所有 Zone）
  detach(agentId: string): Promise<void>;

  // 离开指定 Zone
  detachFromZone(agentId: string, zoneId: string): Promise<void>;

  // 更新 Zone 上下文
  updateContext(zoneId: string, updates: Partial<ZoneContext>): Promise<ZoneContextResult>;

  // 获取当前上下文
  getContext(agentId: string): ZoneContext | null;

  // 获取 Agent 所属的所有 Zone
  getAgentZones(agentId: string): ZoneContext[];

  // 注册 MCP 工具绑定
  registerMCPTool(binding: MCPToolBinding): void;

  // 获取技能对应的 MCP 工具
  getMCPTool(skillId: string): MCPToolBinding | null;
}
```

**说明**：
- `inject` 是异步的，返回操作结果
- 失败时返回 `success: false` 和 `error` 信息
- Agent 崩溃时由 Zone 管理器调用 `detach`（心跳检测触发）
- 多 Zone 场景：Agent 可属于多个 Zone，上下文合并（优先级：当前 Zone > 其他 Zone）

### MCP 工具动态绑定

```typescript
interface MCPToolBinding {
  skillId: string;
  mcpToolName: string;
  endpoint: string;
  authType: 'none' | 'bearer' | 'apikey';
  timeout: number;
}

interface ZoneContextManager {
  // 注册 MCP 工具绑定
  registerMCPTool(binding: MCPToolBinding): void;

  // 获取技能对应的 MCP 工具
  getMCPTool(skillId: string): MCPToolBinding | null;
}
```

### find-skills 工具定义

```typescript
// Agent 调用 find-skills 的输入输出
interface FindSkillsInput {
  query?: string;                    // 搜索关键词
  category?: SkillCategory;          // 按分类筛选
  limit?: number;                    // 返回数量限制
}

interface FindSkillsOutput {
  skills: Array<{
    skillId: string;
    name: string;
    description: string;
    category: SkillCategory;
    mcpTool?: string;
  }>;
  total: number;                     // 总匹配数
  source: 'builtin' | 'skillhub';   // 结果来源
}
```

**实现路径**：
1. **短期**：使用 `SharedSkillStore.searchSkills()` 本地搜索
2. **中期**：实现 SkillHub API 客户端
3. **长期**：考虑 MCP 工具动态注入

### Skill API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/skills` | 获取所有共享技能 |
| GET | `/api/skills/:skillId` | 获取单个技能详情 |
| POST | `/api/skills` | 创建共享技能 |
| PUT | `/api/skills/:skillId` | 更新共享技能 |
| DELETE | `/api/skills/:skillId` | 删除共享技能 |
| GET | `/api/skills/installs/:agentId` | 获取Agent已安装技能 |
| POST | `/api/skills/installs` | 为Agent安装技能 |
| DELETE | `/api/skills/installs` | 从Agent卸载技能 |
| GET | `/api/skills/learned/:agentId` | 获取Agent已学会技能 |
| POST | `/api/skills/learned` | Agent学习新技能 |
| PUT | `/api/skills/learned/:skillId/:agentId/practice` | 练习增加经验 |
| PUT | `/api/skills/learned/:skillId/:agentId/certify` | 设置技能认证状态 |
| DELETE | `/api/skills/learned/:skillId/:agentId` | 删除已学会技能 |

### Zone Context API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/zone-context/inject` | Agent进入Zone |
| DELETE | `/api/zone-context/detach` | Agent离开Zone |
| GET | `/api/zone-context/:agentId` | 获取Agent上下文 |
| GET | `/api/zone-context/:agentId/zones` | 获取Agent所属Zone |
| POST | `/api/zone-context/mcp-tools` | 注册MCP工具绑定 |
| GET | `/api/zone-context/mcp-tools/:skillId` | 获取MCP工具 |

---

## Soul 进化机制（修订 v2.0）

### 进化触发条件

通过 `ReflectionConfig.evolutionCheck` 与 `performReflection()` 整合：

```typescript
interface EvolutionConfig {
  enabled: boolean;
  triggerThreshold: number;         // 积累 N 次反思后检查
  cooldownHours: number;            // 进化冷却时间
  maxEvolutionsPerDay: number;     // 每日最大进化次数
}

interface ReflectionConfig {
  enabled: boolean;
  afterEachTask: boolean;
  onError: boolean;
  weeklyReview: boolean;
  evolutionCheck?: EvolutionConfig;  // 新增
}
```

**触发流程**：
1. 每次 `chat()` 后触发 `performReflection()`
2. 反思历史积累达 `triggerThreshold` 次后，检查是否可以进化
3. 检查 `cooldownHours` 冷却时间
4. 调用 `performEvolution()` 执行进化

### Soul 字段可进化性

| 字段 | 可进化 | 说明 |
|------|--------|------|
| `identity` | ❌ | 核心身份定位，固定 |
| `goals` | ✅ | 目标列表可扩展 |
| `personality` | ✅ | 性格描述可微调 |
| `constraints` | ✅ | 约束条件可增删 |

### 进化质量控制

```typescript
interface EvolutionLimits {
  maxEvolutionPerDay: number;           // 每日最大进化次数
  maxRefinementsPerEvolution: number;   // 每次进化的最大微调次数
  consecutiveFailuresToBreak: number;    // 连续失败 N 次后暂停
}

interface EvolutionResult {
  success: boolean;
  evolvedFields?: Partial<StratixSoulConfig>;
  error?: string;
  evolutionCount: number;              // 当日进化次数
}
```

**熔断机制**：
- 连续失败 `consecutiveFailuresToBreak` 次后暂停进化
- 每日进化次数超过 `maxEvolutionPerDay` 停止
- 进化结果需要用户确认才写入配置文件

### 进化提示词模板

```typescript
const EVOLUTION_PROMPT = `你是一个持续成长的 Agent。在完成任务时：

1. 发现自身技能不足时，使用 find-skills 搜索 SkillHub 上可能帮助你的技能
2. 学习新技能后，更新你的能力描述
3. 将新学会的技能添加到你的技能列表中
4. 定期反思工作过程，寻找可改进的地方

你已安装的技能：
{installed_skills}

你已学会的技能：
{learned_skills}

【进化规则】
- 只可进化 goals、personality、constraints 字段
- identity 是你的核心定位，不可修改
- 每次进化尝试都会记录，请勿重复提交相同的进化请求`;

const EVOLUTION_RESULT_PROMPT = `基于你的工作反思，你建议进行以下进化：

当前 Soul：
- identity: {current_identity}
- goals: {current_goals}
- personality: {current_personality}

建议进化为：
- goals: {proposed_goals}
- personality: {proposed_personality}

请确认是否采纳此进化建议（回复"确认"或提出修改意见）`;
```

---

## Skills 分类（修订 v2.0）

| Category | 能力 ID | MCP 工具 | 描述 |
|----------|---------|----------|------|
| `file` | `zone_file_read` | `filesystem_read` | 读取 Zone 内的文件 |
| `file` | `zone_file_write` | `filesystem_write` | 写入文件到 Zone |
| `code` | `code_generate` | `code_execute` | 生成和执行代码 |
| `data` | `data_process` | - | 处理和分析数据 |
| `content` | `content_create` | - | 创建文案和文档 |
| `mcp` | `web_search` | `web_search` | 搜索互联网 |
| `mcp` | `web_fetch` | `web_fetch` | 获取网页内容 |
| `collab` | `zone_communicate` | `agent_message` | 与同 Zone Agent 协作 |

---

## Zone 上下文自动注入

**注入时机**：
- Agent 进入 Zone → 调用 `zoneContextManager.inject(agentId, zoneId)`
- Agent 离开 Zone → 调用 `zoneContextManager.detach(agentId)`
- Zone 上下文变化 → 调用 `zoneContextManager.updateContext(zoneId)`

**注入内容**：
```typescript
interface ZoneContext {
  zoneId: string;
  title: string;         // Zone 标题
  prompt: string;       // Zone 提示词
  files: ZoneFile[];     // 上下文文件
  members: string[];    // 同 Zone Agent ID 列表
  enteredAt?: number;
}

// 注入到 System Prompt 的格式：
const zoneContextPrompt = `【当前 Zone: ${title}】
${prompt}

【上下文文件】
${files.map(f => `- ${f.name}: ${f.content?.slice(0, 200)}...`).join('\n')}

【协作成员】
${members.map(m => `- Agent ${m}`).join('\n')}
`;
```

---

## 实现步骤（修订 v2.0）

### Phase 1: 数据模型和内置技能（最优先）

**状态**：✅ 已完成 soulTemplates.ts 和 ruleTemplates.ts 更新

**待完成**：
1. [ ] 定义 `AgentCareerProfile` 类型（避免与 StratAgentConfig 冲突）
2. [ ] 区分 `installedSkillDefs`（静态）vs `learnedSkills`（动态）
3. [ ] 实现 `SharedSkillStore` 内存版本
4. [ ] 内置 18+ 技能配置

### Phase 2: 数据库持久化（最优先）

**待完成**：
1. [ ] 添加 `shared_skills`、`shared_skill_installs` 表
2. [ ] 添加 `agent_learned_skills` 表
3. [ ] 实现技能安装/卸载 CRUD API
4. [ ] 解决并发问题（事务包装）

### Phase 3: ZoneContextManager（次优先）

**待完成**：
1. [ ] 创建 `ZoneContextManager.ts`
2. [ ] 实现 `inject/detach/getContext` 逻辑
3. [ ] 定义 Zone 上下文注入 System Prompt 格式
4. [ ] 实现 MCP 工具绑定注册表

### Phase 4: agency-agents 模板解析（次优先）

**待完成**：
1. [ ] 扩展模板解析器支持按领域分组
2. [ ] 模板搜索/过滤功能
3. [ ] 144+ 模板导入脚本

### Phase 5: 进化机制（按需）

**待完成**：
1. [ ] `ReflectionConfig.evolutionCheck` 配置
2. [ ] `performEvolution()` 方法
3. [ ] 进化质量控制（熔断、冷却）
4. [ ] 进化结果用户确认流程

### Phase 6: SkillHub API 集成（最后）

**状态**：待研究

**待完成**：
1. [ ] 研究 SkillHub.tencent.com API
2. [ ] 实现技能同步
3. [ ] 处理认证和限流

---

## 关键文件（修订 v2.0）

### 已完成
- ✅ `src/stratix-character-creator/config/skillHubConfig.ts`（18个内置技能）
- ✅ `src/stratix-character-creator/core/SharedSkillStore.ts`（共享技能库管理）
- ✅ `src/stratix-character-creator/config/soulTemplates.ts`（14个模板）
- ✅ `src/stratix-character-creator/config/ruleTemplates.ts`（4个Zone规范）
- ✅ `src/stratix-agent/types.ts`（类型定义）
- ✅ `src/stratix-agent/types/soul.ts`（EvolutionConfig扩展）
- ✅ `src/stratix-agent/core/MemoryManager.ts`（技能上下文）
- ✅ `src/stratix-character-creator/ui/AgentConfigPanel.ts`（Skills面板）
- ✅ `src/stratix-character-creator/core/ZoneContextManager.ts`（Zone上下文管理）
- ✅ `src/stratix-gateway/api/routes/zone-context.ts`（Zone API）
- ✅ `src/stratix-gateway/api/routes/skill.ts`（技能CRUD API）
- ✅ `src/stratix-database/SkillRepository.ts`（技能数据库操作）
- ✅ `src/stratix-database/migrate.ts`（新表迁移）
- ✅ `src/stratix-agent/core/EnhancedStratixAgent.ts`（进化机制）

---

## 技术风险和缓解措施

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| SkillHub API 不确定 | 高 | 先用内置技能库，预留扩展点 |
| 并发数据一致性 | 中 | 使用关联表替代数组，添加事务 |
| 现有 skillTreeConfig 迁移 | 中 | 并行双系统，不破坏现有功能 |
| 进化配置损坏 | 低 | 添加熔断机制，进化需用户确认 |

---

## 验证方式

1. `npm run dev:frontend` 启动前端
2. 打开 Character Creator → 创建 Agent
3. 选择 agency-agents 模板 → 验证 Soul + 推荐技能
4. 搜索安装 SkillHub 技能 → 验证共享
5. 查看 Skills 面板 → 验证展示已安装/已学习
6. Agent 工作后 → 验证新技能学习记忆
7. 进入 Zone → 验证上下文注入
8. 多次任务后 → 验证进化触发

---

## 附录：评审意见汇总

### Backend 评审主要问题

1. **类型命名冲突** - `AgentProfile` vs `StratixAgentConfig` vs `CharacterProfile` → 已统一为 `AgentCareerProfile`
2. **Skills 概念混淆** - 区分静态技能定义 vs 动态学会技能
3. **installedAgents 并发问题** - 改为关联表 `shared_skill_installs`
4. **缺失养成字段** - 添加 `experiencePoints/proficiency/certified/lastPracticedAt`

### AI 评审主要问题

1. **进化触发条件缺失** - 与 `performReflection()` 整合，添加 `evolutionCheck`
2. **能力描述无法持久化** - 定义可进化字段，进化需用户确认
3. **进化质量控制缺失** - 添加 `EvolutionLimits` 熔断机制

### Frontend 评审主要问题

1. **Skills 面板分层** - ✅ 已完成 4 子 Tab
2. **System Prompt 预览** - ✅ 已完成
3. **已安装 vs 已学习区分** - ✅ 已区分
