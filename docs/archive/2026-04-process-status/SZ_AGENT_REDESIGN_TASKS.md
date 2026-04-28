# System Zone Agent 化重设计 — 开发任务 v2

**基于**: `docs/SYSTEM_ZONE_AGENT_REDESIGN.md` v1.0
**创建时间**: 2026-04-06 14:55
**重拆时间**: 2026-04-06 15:16
**状态**: 待开始

---

## 总览

| Phase | 名称 | Task 数 | 依赖 |
|-------|------|---------|------|
| A | 基础设施 | 6 | 无 |
| B | 核心链路 | 5 | Phase A |
| C | 协作流程 | 4 | Phase B |
| D | UI 适配 | 2 | Phase C |

**总计 17 个 Task**

---

## Phase A：基础设施（6 个 Task）

---

### A1. 新增类型定义（DiffHunk / DiffLine / SystemZoneFileModification / SafetyAssessment + Proposal 扩展）

**改什么文件**:
- `src/stratix-systemzone/types.ts` — 新增类型 + 扩展 Proposal

**做什么**:

1. 在 `types.ts` 的 `Proposal` interface 之前新增以下类型：

```typescript
/** diff 行 */
export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
}

/** 单个文件的 unified diff hunk */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header?: string;       // @@ -oldStart,oldLines +newStart,newLines @@
  lines: DiffLine[];
}

/** 文件修改操作（unified diff 格式） */
export interface SystemZoneFileModification {
  type: 'create' | 'edit' | 'delete' | 'rename';
  path: string;          // 相对于项目根目录
  diff?: string;         // 完整 unified diff 字符串（edit 时必有）
  hunks?: DiffHunk[];    // 解析后的 hunk 列表（可选，用于前端预览）
  content?: string;      // create 时的完整文件内容
  newPath?: string;      // rename 时的目标路径
  description: string;   // 这次修改的说明
}

/** 安全评估结果（Guardian Agent 输出） */
export interface SafetyAssessment {
  decision: 'approved' | 'rejected' | 'conditional';
  riskLevel: 'low' | 'medium' | 'high';
  concerns: string[];
  suggestions: string[];
  confidence: number;    // 0-1
}
```

2. 在 `Proposal` interface 末尾新增两个可选字段：

```typescript
// 在 Proposal interface 现有字段之后追加：
  /** Strategist Agent 生成的结构化修改（unified diff） */
  modifications?: SystemZoneFileModification[];
  /** Guardian Agent 的安全审查结果 */
  safetyAssessment?: SafetyAssessment;
```

**关键约束**:
- `modifications` 和 `safetyAssessment` 都是**可选字段**（`?`），不破坏现有代码
- `SystemZoneFileModification` 命名避免和 `src/stratix-systemzone/executor/types.ts` 的 `FileModification` 冲突
- 后续 Task 会写映射函数把 `SystemZoneFileModification` 转为 executor 的 `FileModification`

**验收标准**:
- [ ] `npx tsc --noEmit` 编译通过，0 errors
- [ ] 新增 4 个 export type/interface
- [ ] Proposal interface 有 `modifications?` 和 `safetyAssessment?` 字段
- [ ] 现有 `FileModification`（executor/types.ts）不变
- [ ] `src/stratix-systemzone/index.ts` 的 `export * from './types'` 自动导出新类型

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

**测试**: 不需要额外测试文件，编译检查即可

---

### A2. 新建 SystemZoneSkillExecutor（注册到 createExecutor）

**改什么文件**:
- 新建 `src/stratix-agent/core/SystemZoneSkillExecutor.ts`
- 改 `src/stratix-agent/core/SkillExecutors.ts` — import + 在 `createExecutor()` 中注册

**做什么**:

1. 新建 `SystemZoneSkillExecutor` 类，实现 `SkillExecutor` 接口：

```typescript
import { SkillExecutor, SkillDefinition, ExecutionContext } from '../types';

/**
 * SystemZoneSkillExecutor — 调用 System Zone 内部 TS 模块
 *
 * 所有 System Zone Agent 的 skill 都走这个 executor。
 * 模块实例通过 injectModules() 延迟注入（因为初始化顺序依赖）。
 */
export class SystemZoneSkillExecutor implements SkillExecutor {
  // 延迟注入的模块引用
  private modules: {
    observer?: any;          // Observer 实例
    projectScanner?: any;    // ProjectScanner 实例
    strategistLLM?: any;     // StrategistLLMEnhancer 实例
    diffApplier?: any;       // DiffApplier 实例（A3 才实现，先占位）
    testRunner?: any;        // TestRunner 实例
    sandbox?: any;           // Sandbox 实例
    rollbackManager?: any;   // RollbackManager 实例
    codeModifier?: any;      // CodeModifier 实例（回退用）
  } = {};

  /** 延迟注入模块实例（SystemZoneManager.initialize() 中调用） */
  injectModules(modules: Partial<typeof this.modules>): void {
    Object.assign(this.modules, modules);
  }

  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    switch (skill.skillId) {
      case 'observe_input':
        return this.observeInput(params);
      case 'scan_project':
        return this.scanProject(params);
      case 'generate_modifications':
        return this.generateModifications(params);
      case 'validate_diff':
        return this.validateDiff(params);
      case 'apply_diff':
        return this.applyDiff(params);
      case 'run_tests':
        return this.runTests(params);
      case 'create_sandbox':
        return this.createSandbox(params);
      case 'destroy_sandbox':
        return this.destroySandbox(params);
      case 'rollback':
        return this.rollback(params);
      case 'review_modifications':
        return this.reviewModifications(params);
      default:
        throw new Error(`Unknown systemzone skill: ${skill.skillId}`);
    }
  }

  // ---- 以下每个方法的具体实现 ----
  // 当前阶段（A2）只做空壳：检查 modules 是否注入 + 调用对应模块方法
  // A3 完善 DiffApplier 后 validate_diff/apply_diff 才有实际实现
  // B1 完善 Strategist prompt 后 generate_modifications 才有实际实现

  private async observeInput(params: any) {
    if (!this.modules.observer) throw new Error('Observer not injected');
    return this.modules.observer.receiveInput(params.content, params.source, params.type);
  }

  private async scanProject(params: any) {
    if (!this.modules.projectScanner) throw new Error('ProjectScanner not injected');
    return this.modules.projectScanner.scanAll();
  }

  private async generateModifications(params: any) {
    // Phase B1 完善实现
    throw new Error('generate_modifications: not yet implemented (Phase B1)');
  }

  private async validateDiff(params: any) {
    if (!this.modules.diffApplier) throw new Error('DiffApplier not injected');
    return this.modules.diffApplier.validateDiff(params.workDir, params.diff);
  }

  private async applyDiff(params: any) {
    if (!this.modules.diffApplier) throw new Error('DiffApplier not injected');
    return this.modules.diffApplier.applyDiff(params.workDir, params.diff);
  }

  private async runTests(params: any) {
    if (!this.modules.testRunner) throw new Error('TestRunner not injected');
    return this.modules.testRunner.runTests(params.workDir);
  }

  private async createSandbox(params: any) {
    if (!this.modules.sandbox) throw new Error('Sandbox not injected');
    return this.modules.sandbox.createSandbox(params.proposalId);
  }

  private async destroySandbox(params: any) {
    if (!this.modules.sandbox) throw new Error('Sandbox not injected');
    return this.modules.sandbox.destroySandbox(params.proposalId);
  }

  private async rollback(params: any) {
    if (!this.modules.rollbackManager) throw new Error('RollbackManager not injected');
    return this.modules.rollbackManager.rollback(params.snapshotId, params.workDir);
  }

  private async reviewModifications(params: any) {
    // Phase B3 完善实现
    throw new Error('review_modifications: not yet implemented (Phase B3)');
  }
}
```

2. 在 `SkillExecutors.ts` 的 `createExecutor()` switch 中增加：

```typescript
import { SystemZoneSkillExecutor } from './SystemZoneSkillExecutor';

// createExecutor() switch 中加：
case 'systemzone':
  return new SystemZoneSkillExecutor();
```

**关键约束**:
- 使用**延迟注入模式**（`injectModules()`），因为模块初始化顺序不确定
- `generate_modifications` 和 `review_modifications` 当前抛 "not yet implemented"，Phase B 再实现
- `SkillExecutor` 接口在 `src/stratix-agent/types.ts` 中定义

**验收标准**:
- [ ] `npx tsc --noEmit` 编译通过
- [ ] `createExecutor('systemzone')` 返回 `SystemZoneSkillExecutor` 实例
- [ ] 10 个 skillId 都有对应 switch 分支

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

**测试**: 不需要额外测试文件，编译检查即可

---

### A3. 新建 DiffApplier（完整的 unified diff 应用器，包含 fallback）

**改什么文件**:
- 新建 `src/stratix-systemzone/executor/DiffApplier.ts`

**做什么**:

创建 `DiffApplier` 类，**一次性实现完整功能**（不分骨架+完善）：

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { DiffHunk, DiffLine, SystemZoneFileModification } from '../types';

export interface DiffValidationResult {
  valid: boolean;
  errors: string[];
}

export interface DiffApplyResult {
  success: boolean;
  appliedFiles: string[];
  errors: string[];
}

export interface DiffPreviewFile {
  path: string;
  hunks: Array<{
    header: string;
    lines: Array<{ type: 'context' | 'add' | 'remove'; content: string; lineNo?: number }>;
  }>;
}

export class DiffApplier {
  /**
   * 1. validateDiff — 用 git apply --check 验证 diff 能否干净应用
   */
  async validateDiff(workDir: string, diff: string): Promise<DiffValidationResult> {
    try {
      execSync('git apply --check', {
        input: diff,
        cwd: workDir,
        timeout: 10_000,
        encoding: 'utf-8',
      });
      return { valid: true, errors: [] };
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      return { valid: false, errors: [stderr.trim()] };
    }
  }

  /**
   * 2. applyDiff — 验证 + 应用 unified diff
   *    先 git apply --check，通过则 git apply
   *    失败则尝试逐 hunk fallback
   */
  async applyDiff(workDir: string, diff: string): Promise<DiffApplyResult> {
    // 先尝试 git apply --check
    const validation = await this.validateDiff(workDir, diff);
    if (validation.valid) {
      try {
        execSync('git apply', {
          input: diff,
          cwd: workDir,
          timeout: 30_000,
          encoding: 'utf-8',
        });
        return { success: true, appliedFiles: this.extractFilePaths(diff), errors: [] };
      } catch (err: any) {
        // git apply --check 通过但 git apply 失败（罕见），走 fallback
      }
    }

    // Fallback: 逐 hunk 精确匹配
    return this.applyFallback(workDir, diff);
  }

  /**
   * 3. applyFallback — 逐 hunk 精确匹配回退策略
   *
   * 规则：
   * - 按 hunk 的 oldStart 行号定位文件位置
   * - 逐行验证 context lines 是否匹配
   * - 匹配则应用该 hunk
   * - 不匹配则跳过，记录错误
   * - 如果有任何 hunk 失败 → 回滚所有已应用的 hunk
   */
  private async applyFallback(workDir: string, diff: string): Promise<DiffApplyResult> {
    const hunks = this.parseDiffHunks(diff);
    if (hunks.length === 0) {
      return { success: false, appliedFiles: [], errors: ['No valid hunks found in diff'] };
    }

    const appliedHunks: Array<{ filePath: string; hunk: ParsedHunk; originalContent: string }> = [];
    const errors: string[] = [];

    for (const hunk of hunks) {
      const fullPath = path.join(workDir, hunk.filePath);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        // 验证 context lines
        const contextLines = hunk.lines.filter(l => l.type === 'context');
        let matchStart = hunk.oldStart - 1; // 0-indexed

        let allContextMatch = true;
        for (const ctxLine of contextLines) {
          if (matchStart >= lines.length || lines[matchStart] !== ctxLine.content) {
            allContextMatch = false;
            break;
          }
          matchStart++;
        }

        if (!allContextMatch) {
          // 尝试搜索匹配位置
          const foundIndex = this.searchContextMatch(lines, contextLines);
          if (foundIndex === -1) {
            errors.push(`Hunk at ${hunk.filePath}:${hunk.oldStart} context mismatch`);
            continue; // 跳过此 hunk 但继续尝试其他
          }
          matchStart = foundIndex;
        }

        // 应用修改
        const newLines = this.applyHunkToLines(lines, hunk, matchStart - contextLines.length);
        await fs.writeFile(fullPath, newLines.join('\n'), 'utf-8');

        appliedHunks.push({ filePath: hunk.filePath, hunk, originalContent: content });
      } catch (err: any) {
        errors.push(`Failed to apply hunk to ${hunk.filePath}: ${err.message}`);
      }
    }

    // 如果有 hunk 失败，回滚所有已应用的
    if (errors.length > 0 && appliedHunks.length > 0) {
      for (const { filePath, originalContent } of appliedHunks) {
        const fullPath = path.join(workDir, filePath);
        await fs.writeFile(fullPath, originalContent, 'utf-8');
      }
      return {
        success: false,
        appliedFiles: [],
        errors: [...errors, 'Rolled back all applied hunks due to failures'],
      };
    }

    return {
      success: errors.length === 0,
      appliedFiles: [...new Set(appliedHunks.map(h => h.filePath))],
      errors,
    };
  }

  /**
   * 4. previewDiff — 解析 diff 为前端可展示的结构
   */
  async previewDiff(diff: string): Promise<{ files: DiffPreviewFile[] }> {
    // 解析 @@ headers 和行内容
    // 返回按文件分组的结构
    // 具体实现：解析 diff 文本
  }

  /**
   * 5. rollbackDiff — 用 git apply -R 回滚
   */
  async rollbackDiff(workDir: string, diff: string): Promise<void> {
    execSync('git apply -R', {
      input: diff,
      cwd: workDir,
      timeout: 30_000,
      encoding: 'utf-8',
    });
  }

  // ---- 辅助方法 ----

  private extractFilePaths(diff: string): string[] {
    const matches = diff.matchAll(/^--- a\/(.+)$/gm);
    return [...matches].map(m => m[1]);
  }

  private parseDiffHunks(diff: string): ParsedHunk[] {
    // 解析 diff 为 hunks 数组
    // 提取 filePath（从 --- a/xxx 行），每个 @@...@@ 块的行
  }

  private searchContextMatch(lines: string[], contextLines: DiffLine[]): number {
    // 在文件中搜索 context lines 的匹配位置
  }

  private applyHunkToLines(lines: string[], hunk: ParsedHunk, startPos: number): string[] {
    // 在指定位置应用 hunk 的增删改
  }
}

interface ParsedHunk {
  filePath: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}
```

**关键约束**:
- 不修改现有 `CodeModifier.ts`，保留作为过渡
- `applyFallback` 实现**原子性**：部分 hunk 失败时回滚所有已应用 hunk
- `execSync` 必须设 `timeout`，防止卡死
- 所有文件路径操作用 `path.join(workDir, ...)` 确保安全

**验收标准**:
- [ ] `npx tsc --noEmit` 编译通过
- [ ] `validateDiff` 用 `git apply --check` 实现
- [ ] `applyDiff` 先试 git apply，失败走 fallback
- [ ] fallback 实现：逐 hunk context line 匹配 + 原子回滚
- [ ] `rollbackDiff` 用 `git apply -R` 实现

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

**测试**: 写一个简单测试文件，手动创建 diff 并调用 applyDiff 验证。或者等集成测试。

---

### A4. 新建 Agent 定义文件（4 个 Agent 的 config + soul + skills）

**改什么文件**:
- 新建 `src/stratix-systemzone/agents/` 目录
- 新建 `src/stratix-systemzone/agents/observer.ts`
- 新建 `src/stratix-systemzone/agents/strategist.ts`
- 新建 `src/stratix-systemzone/agents/executor.ts`
- 新建 `src/stratix-systemzone/agents/guardian.ts`
- 新建 `src/stratix-systemzone/agents/index.ts`

**做什么**:

1. 每个 Agent 文件导出一个工厂函数，返回 `StratixAgent` 实例

2. **observer.ts** 示例结构：

```typescript
import { StratixAgent } from '../../stratix-agent/StratixAgent';
import type { AgentConfig, SoulConfig } from '../../stratix-agent/types';

export function createObserverAgent(): StratixAgent {
  const config: AgentConfig = {
    agentId: 'sz-observer',
    name: 'Observer',
    type: 'analyst',
    provider: 'openai',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.3,
    maxTokens: 4096,
    maxShortTerm: 20,
    enableLongTerm: true,
  };

  const soul: SoulConfig = {
    identity: '你是 Stratix 项目的健康分析专家。',
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
  };

  const agent = new StratixAgent(config, soul);

  // 注册 skills（使用 systemzone executor）
  agent.skills.registerSkill({
    skillId: 'observe_input',
    name: '观察输入',
    description: '接收文本输入，通过 LLM 提取结构化洞察',
    parameters: [
      { name: 'content', type: 'string', required: true, description: '输入内容' },
      { name: 'source', type: 'string', required: false, description: '来源' },
    ],
    executorType: 'systemzone',
  });

  return agent;
}
```

3. **strategist.ts** — 注册 `scan_project` 和 `generate_modifications` skills
4. **executor.ts** — 注册 `apply_diff`、`run_tests`、`create_sandbox`、`destroy_sandbox`、`commit_changes`、`rollback` skills
5. **guardian.ts** — 注册 `review_modifications` skill

6. **index.ts** 统一导出：

```typescript
export { createObserverAgent } from './observer';
export { createStrategistAgent } from './strategist';
export { createExecutorAgent } from './executor';
export { createGuardianAgent } from './guardian';
```

**关键约束**:
- 看清楚 `StratixAgent` 的构造函数签名（`src/stratix-agent/StratixAgent.ts`）— 需要 `AgentConfig` + `SoulConfig`
- 看清楚 `SkillRegistry.registerSkill()` 的参数结构（`src/stratix-agent/core/SkillRegistry.ts`）— 需要 `SkillDefinition` 对象
- 每个 skill 的 `executorType` 固定为 `'systemzone'`
- SoulConfig 的 identity/personality/goals/constraints 必须具体，不能泛泛而谈

**验收标准**:
- [ ] `npx tsc --noEmit` 编译通过
- [ ] 4 个工厂函数各返回 `StratixAgent` 实例
- [ ] 每个 Agent 的 `agent.skills.list()` 返回正确的 skill 列表
- [ ] observer: 1 skill, strategist: 2 skills, executor: 6 skills, guardian: 1 skill

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

**测试**: 不需要额外测试文件

---

### A5. 修改 Executor.buildModificationPlan（修复空转 bug）

**改什么文件**:
- `src/stratix-systemzone/executor/Executor.ts` — 修改 `buildModificationPlan` 方法

**做什么**:

当前代码（447-459 行）：
```typescript
private buildModificationPlan(proposal: Proposal): ModificationPlan {
    const modifications: FileModification[] = [];
    if ('modifications' in proposal && Array.isArray((proposal as any).modifications)) {
      modifications.push(...(proposal as any).modifications);
    }
    return { ... };
}
```

改为：
```typescript
private buildModificationPlan(proposal: Proposal): ModificationPlan {
    // 从 Proposal.modifications（A1 新增的 SystemZoneFileModification[]）映射到 executor 的 FileModification
    const modifications: FileModification[] = (proposal.modifications ?? []).map(m => ({
      type: m.type,
      path: m.path,
      content: m.content,
      description: m.description,
      ...(m.newPath ? { newPath: m.newPath } : {}),
    }));

    return {
      proposalId: proposal.id,
      modifications,
      estimatedRisk: proposal.selection?.risk ?? 'low',
      affectedFiles: modifications.map(m => m.path),
      description: proposal.description,
    };
}
```

同时增加 DiffApplier 集成入口（在执行流程中判断用 DiffApplier 还是 CodeModifier）：
- 在 Executor 类中新增 `private diffApplier: DiffApplier | null = null;`
- 新增 `setDiffApplier(applier: DiffApplier): void` setter
- 在 `applyModifications` 相关流程中：如果 modification 有 `diff` 字段且 `diffApplier` 存在，走 DiffApplier；否则走原 CodeModifier

**关键约束**:
- **最小改动** — 只改 `buildModificationPlan` + 新增 `setDiffApplier`
- 旧的没有 `modifications` 的 proposal（即 `proposal.modifications === undefined`）仍然返回空数组 → 向后兼容
- 不删除 CodeModifier 的使用，DiffApplier 是可选替代路径
- `SystemZoneFileModification` → `FileModification` 的映射只取交集字段（type, path, content, description, newPath）

**验收标准**:
- [ ] `npx tsc --noEmit` 编译通过
- [ ] `buildModificationPlan` 不再使用 `(proposal as any)` 取值
- [ ] 旧 proposal（无 modifications）仍然返回空数组
- [ ] 新 proposal（有 modifications）正确映射到 FileModification[]

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

**测试**: 查看现有测试 `src/stratix-systemzone/executor/__tests__/` 是否有 `buildModificationPlan` 的测试，如果没有则不需要新增

---

### A6. 新建 SystemZoneManager（Zone 实例创建 + 模块注入）

**改什么文件**:
- 新建 `src/stratix-systemzone/SystemZoneManager.ts`
- 改 `src/stratix-systemzone/index.ts` — 导出 SystemZoneManager

**做什么**:

1. 创建 `SystemZoneManager` 类：

```typescript
import { ZoneCoordinator } from '../../stratix-orchestration/zone/ZoneCoordinator';
import { zoneRepository, zoneMemberRepository, agentCapabilityRepository } from '../../stratix-database';
import { SystemZoneSkillExecutor } from '../../stratix-agent/core/SystemZoneSkillExecutor';
import { createObserverAgent, createStrategistAgent, createExecutorAgent, createGuardianAgent } from './agents';
import { Observer } from './observer/Observer';
import { ProjectScanner } from './stratist/ProjectScanner';
import { StrategistLLMEnhancer } from './stratist/StrategistLLMEnhancer';
import { DiffApplier } from './executor/DiffApplier';
import { TestRunner } from './executor/TestRunner';
import { Sandbox } from './executor/Sandbox';
import { RollbackManager } from './executor/RollbackManager';
import { CodeModifier } from './executor/CodeModifier';

const SYSTEM_ZONE_ID = 'system-zone';
const SYSTEM_ZONE_TITLE = 'Stratix 项目自优化';

export class SystemZoneManager {
  private coordinator: ZoneCoordinator | null = null;
  private agents: {
    observer?: StratixAgent;
    strategist?: StratixAgent;
    executor?: StratixAgent;
    guardian?: StratixAgent;
  } = {};
  private skillExecutor: SystemZoneSkillExecutor | null = null;

  /**
   * 初始化 System Zone 的完整 Agent 架构
   *
   * 步骤：
   * 1. 确保 Zone 记录存在（zoneRepository）
   * 2. 创建 ZoneCoordinator 实例
   * 3. 创建 DiffApplier 实例
   * 4. 创建 4 个 Agent 实例（observer, strategist, executor, guardian）
   * 5. 注册为 Zone 成员（zoneMemberRepository）
   * 6. 注册能力（agentCapabilityRepository）
   * 7. 创建 System Zone 子模块实例（Observer, ProjectScanner 等）
   * 8. 通过 SystemZoneSkillExecutor.injectModules() 注入
   */
  async initialize(): Promise<void> {
    // 1. 确保 Zone 存在
    let zone = zoneRepository.getZone(SYSTEM_ZONE_ID);
    if (!zone) {
      zoneRepository.createZone({
        zoneId: SYSTEM_ZONE_ID,
        projectId: 'stratix',
        title: SYSTEM_ZONE_TITLE,
        prompt: '持续优化 Stratix 项目的代码质量、测试覆盖率、架构健康度',
      });
    }

    // 2. 创建 Coordinator
    this.coordinator = await ZoneCoordinator.create(SYSTEM_ZONE_ID);

    // 3. 创建 DiffApplier
    const diffApplier = new DiffApplier();

    // 4. 创建 4 个 Agent
    this.agents.observer = createObserverAgent();
    this.agents.strategist = createStrategistAgent();
    this.agents.executor = createExecutorAgent();
    this.agents.guardian = createGuardianAgent();

    // 5. 注册 Zone 成员
    zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-observer', 'executor');
    zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-strategist', 'executor');
    zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-executor', 'executor');
    zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-guardian', 'executor');

    // 6. 注册能力
    agentCapabilityRepository.setCapability('sz-observer', SYSTEM_ZONE_ID, 'analysis', 5);
    agentCapabilityRepository.setCapability('sz-observer', SYSTEM_ZONE_ID, 'research', 4);
    agentCapabilityRepository.setCapability('sz-strategist', SYSTEM_ZONE_ID, 'analysis', 5);
    agentCapabilityRepository.setCapability('sz-strategist', SYSTEM_ZONE_ID, 'coding', 4);
    agentCapabilityRepository.setCapability('sz-executor', SYSTEM_ZONE_ID, 'coding', 5);
    agentCapabilityRepository.setCapability('sz-guardian', SYSTEM_ZONE_ID, 'analysis', 5);

    // 7. 创建子模块实例
    // 注意：这些模块的构造参数需要从现有 SystemZone.ts 中了解
    const observer = new Observer(/* config */);
    const projectScanner = new ProjectScanner();
    // ... 其他模块

    // 8. 注入到 SkillExecutor
    // 获取 systemzone executor 单例并注入
    this.skillExecutor = ...; // 从 SkillRegistry 或 Agent 获取
    this.skillExecutor.injectModules({
      observer,
      projectScanner,
      diffApplier,
      testRunner: new TestRunner(),
      sandbox: new Sandbox(),
      rollbackManager: new RollbackManager(),
    });
  }

  getCoordinator(): ZoneCoordinator | null { return this.coordinator; }
  getAgents() { return this.agents; }

  async shutdown(): Promise<void> {
    // 清理定时器、销毁沙箱等
  }
}
```

**关键约束**:
- 这是 Phase A 的收尾 Task，**把前面 A1-A5 的所有组件串联起来**
- Observer/ProjectScanner 等子模块的构造参数，需要看现有 `SystemZone.ts`（169-215 行）怎么初始化的，照着写
- `SystemZoneSkillExecutor` 的单例获取方式：看 `SkillRegistry` 怎么创建 executor 的（通过 `createExecutor('systemzone')`），可能需要自己持有一份引用
- ZoneCoordinator.create() 需要 Zone 先存在于数据库，所以先 `zoneRepository.createZone()`
- `zoneMemberRepository.addMember` 的第三个参数是 role（`'coordinator' | 'executor'`），4 个 Agent 都是 executor

**验收标准**:
- [ ] `npx tsc --noEmit` 编译通过
- [ ] `initialize()` 执行后：Zone 存在、4 个成员已注册、能力已注册
- [ ] `skillExecutor.injectModules()` 被调用，各模块实例已注入
- [ ] `getCoordinator()` 返回有效的 ZoneCoordinator
- [ ] 不修改现有 `SystemZone.ts`（新旧并存）

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

**测试**: 不需要额外测试文件

---

## Phase B：核心链路（5 个 Task）

---

### B1. Strategist Agent 的 modifications 生成 prompt

**改什么文件**:
- `src/stratix-systemzone/agents/strategist.ts` — 扩展 generate_modifications skill 实现
- `src/stratix-agent/core/SystemZoneSkillExecutor.ts` — 实现 `generateModifications` 方法

**做什么**:

1. 编写 Strategist Agent 的核心 LLM prompt，要求输出包含 modifications 的 JSON。

prompt 模板（写入 strategist.ts 作为常量）：

```
你是代码改进策略师。你的任务是基于分析结果生成精确的代码修改方案。

## 输入
- insights: 前序 Observer Agent 的分析结果
- scanResult: 项目扫描数据（覆盖率、lint、类型检查等）
- targetFile: 要修改的文件路径（可选）

## 输出格式
你必须输出严格符合以下 JSON schema 的结果：
{
  "title": "修改标题",
  "description": "修改描述",
  "reasoning": "为什么要这样改",
  "modifications": [
    {
      "type": "edit",
      "path": "src/xxx/file.ts",
      "diff": "--- a/src/xxx/file.ts\n+++ b/src/xxx/file.ts\n@@ -行号,行数 +行号,行数 @@\n context line\n-removed line\n+added line\n",
      "description": "这次修改的说明"
    }
  ],
  "riskLevel": "low" | "medium" | "high",
  "effortEstimate": "small" | "medium" | "large"
}

## diff 格式要求（极其重要）
1. diff 必须是标准 unified diff 格式，可被 git apply 直接应用
2. 文件头必须是 --- a/path 和 +++ b/path
3. hunk 头必须是 @@ -oldStart,oldLines +newStart,newLines @@
4. 上下文行（以空格开头）必须和源文件完全一致，包括缩进和空格
5. 删除行以 - 开头，新增行以 + 开头
6. 行号必须基于文件的当前内容，精确到行
7. 新建文件用 type: "create" + content（完整文件内容），不用 diff

## 约束
- 每个 modification 必须附带 description
- 不确定的地方用 // TODO: 需要人工确认 标注
- 一次修改尽量控制在最小范围
- 不要修改不相关的代码
```

2. 在 `SystemZoneSkillExecutor.generateModifications()` 中实现调用逻辑：
   - 获取 insights 和 scanResult 作为 context
   - 构造 prompt
   - 调用 `StratistLLMEnhancer` 获取扫描数据
   - 将 LLM 输出解析为 `SystemZoneFileModification[]`
   - 返回结构化结果

3. 写一个 JSON 解析验证函数：确保 LLM 输出的 modifications 数组每项都有必需字段（type, path, diff 或 content, description）

**验收标准**:
- [ ] prompt 包含完整的 diff 格式说明、约束、JSON schema
- [ ] `generateModifications` 方法实现完整（不再是 "not yet implemented"）
- [ ] LLM 输出的 JSON 能被解析为 `SystemZoneFileModification[]`
- [ ] 有 JSON schema 验证函数

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

**测试**: 编写一个 mock 测试——构造一段 LLM 返回的 JSON 字符串，验证解析函数能正确提取 modifications。在 `src/stratix-systemzone/strategist/__tests__/` 中新增测试文件。

---

### B2. Executor DiffApplier 集成（修改执行流程支持 diff 应用）

**改什么文件**:
- `src/stratix-systemzone/executor/Executor.ts` — 在执行流程中集成 DiffApplier

**做什么**:

当前 Executor 的执行流程（142-250 行）：
```
createSandbox → createSnapshot → buildModificationPlan → codeModifier.applyModifications → runTests → commit/cleanup
```

需要修改为：
```
createSandbox → createSnapshot → buildModificationPlan
  → 对每个 modification：
    - 如果 modification.diff 存在且 diffApplier 可用 → DiffApplier.applyDiff
    - 否则 → codeModifier.applyModifications（原逻辑）
  → runTests → commit/cleanup
```

具体改动：
1. 在 `applyModifications` 相关逻辑中（182-199 行区域），增加 diff 判断分支
2. 需要从 `Proposal.modifications`（A1 类型）中判断哪些有 `diff` 字段
3. 有 diff 的走 `DiffApplier`，无 diff 的走原 `CodeModifier`

**关键约束**:
- 最小改动 — 只在现有流程中增加分支判断
- 不删除 CodeModifier 的使用路径
- DiffApplier 的 `workDir` 参数就是 `sandboxPath`
- `buildModificationPlan` 的结果已经是 `FileModification[]`（A5 已改好映射），但原始 Proposal 的 `modifications` 有 diff 字段需要传入

**验收标准**:
- [ ] `npx tsc --noEmit` 编译通过
- [ ] 有 diff 的 modification 通过 DiffApplier 应用
- [ ] 无 diff 的 modification 走原 CodeModifier 逻辑
- [ ] 现有测试不受影响

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

---

### B3. Guardian Agent 安全审查实现

**改什么文件**:
- `src/stratix-systemzone/agents/guardian.ts` — 扩展 review_modifications skill
- `src/stratix-agent/core/SystemZoneSkillExecutor.ts` — 实现 `reviewModifications` 方法

**做什么**:

1. 编写 Guardian Agent 的 system prompt：

```
你是代码安全守门人。你的任务是审查代码修改方案的安全性。

## 审查维度
1. **路径安全**: 修改是否触及禁止路径（如 executor/guardian 自身）
2. **影响范围**: 修改影响的文件数量、代码行数
3. **回滚风险**: 修改是否可逆，回滚是否安全
4. **数据安全**: 是否可能导致数据丢失
5. **依赖影响**: 是否影响外部接口或依赖关系

## 输入
- modifications: FileModification[] 数组
- targetFiles: 每个修改的文件当前内容（可选）
- projectContext: 项目结构信息

## 输出格式
{
  "decision": "approved" | "rejected" | "conditional",
  "riskLevel": "low" | "medium" | "high",
  "concerns": ["具体的安全隐患"],
  "suggestions": ["修改建议"],
  "confidence": 0.0-1.0
}

## 约束
- 宁可误拒不可漏放
- high risk 的修改必须给出明确的 concerns
- conditional 的修改必须给出具体的 suggestions
- confidence < 0.5 时应倾向 rejected
```

2. 在 `SystemZoneSkillExecutor.reviewModifications()` 中实现：
   - 接收 modifications 数组
   - 调用 Guardian 的路径保护规则（`PathProtection.validateProposal`）
   - 调用 LLM 进行深度审查
   - 返回 `SafetyAssessment`

3. **高风险暂停逻辑**：
   - 当 `SafetyAssessment.decision === 'rejected'` 或 `riskLevel === 'high'` 时
   - 不直接执行，而是标记状态等待后续流程处理（C1 的编排逻辑会处理这个）

**验收标准**:
- [ ] Guardian prompt 包含 5 个审查维度
- [ ] 输出符合 SafetyAssessment interface
- [ ] `reviewModifications` 方法实现完整（不再是 "not yet implemented"）
- [ ] 路径保护规则仍然生效（复用现有 Guardian/PathProtection）

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

---

### B4. SystemZoneFileModification → FileModification 映射工具函数

**改什么文件**:
- 新建 `src/stratix-systemzone/executor/modificationMapper.ts`

**做什么**:

写一个纯函数，负责把 `SystemZoneFileModification`（types.ts，A1 定义）映射为 `FileModification`（executor/types.ts）：

```typescript
import type { SystemZoneFileModification } from '../types';
import type { FileModification } from './types';

export function mapModification(m: SystemZoneFileModification): FileModification {
  return {
    type: m.type,
    path: m.path,
    content: m.content,
    description: m.description,
    ...(m.newPath ? { newPath: m.newPath } : {}),
  };
}

export function mapModifications(ms: SystemZoneFileModification[]): FileModification[] {
  return ms.map(mapModification);
}
```

这是 A5 中 `buildModificationPlan` 需要用的映射。如果 A5 已经内联写了映射逻辑，这个 Task 就**提取为独立函数**，让 A5 调用它。

**验收标准**:
- [ ] `npx tsc --noEmit` 编译通过
- [ ] 映射函数覆盖所有字段
- [ ] A5 的 `buildModificationPlan` 调用此映射函数

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

---

### B5. DiffApplier 单元测试

**改什么文件**:
- 新建 `src/stratix-systemzone/executor/__tests__/DiffApplier.test.ts`

**做什么**:

为 A3 的 DiffApplier 写测试：
1. `validateDiff` — 正确 diff 返回 valid: true，错误 diff 返回 valid: false
2. `applyDiff` — git apply 成功路径
3. `applyFallback` — context line 匹配 + 原子回滚
4. `rollbackDiff` — git apply -R 回滚
5. 边界情况：空 diff、不存在的文件、行号偏移

测试方法：
- 在 `/tmp` 创建临时 git 仓库
- 创建测试文件
- 生成真实 diff
- 调用 DiffApplier 方法验证

**验收标准**:
- [ ] 测试文件覆盖 4 个核心方法
- [ ] `npx jest src/stratix-systemzone/executor/__tests__/DiffApplier.test.ts` 全部通过
- [ ] 覆盖正常路径和 fallback 路径

**验证命令**: `cd ~/code/Stratix && npx jest src/stratix-systemzone/executor/__tests__/DiffApplier.test.ts --maxWorkers=2 2>&1 | tail -20`

---

## Phase C：协作流程（4 个 Task）

---

### C1. SystemZoneCycle 状态机 + 编排逻辑

**改什么文件**:
- 新建 `src/stratix-systemzone/SystemZoneCycle.ts`

**做什么**:

创建 `SystemZoneCycle` 类，实现固定编排流程的状态机：

```typescript
export type CyclePhase = 'idle' | 'observing' | 'strategizing' | 'reviewing' | 'executing' | 'evaluating' | 'completed' | 'failed' | 'blocked';

export interface CycleState {
  phase: CyclePhase;
  cycleId: string;
  startedAt: Date | null;
  completedAt: Date | null;
  currentTaskId: string | null;
  lastError: string | null;
  // 各阶段输出
  insights?: any[];          // observing 输出
  proposal?: any;            // strategizing 输出
  assessment?: any;          // reviewing 输出
  executionResult?: any;     // executing 输出
  fitnessReport?: any;       // evaluating 输出
}

export class SystemZoneCycle {
  private state: CycleState;
  private manager: SystemZoneManager;
  private eventListeners: Map<string, Function[]> = new Map();

  constructor(manager: SystemZoneManager) {
    this.manager = manager;
    this.state = {
      phase: 'idle',
      cycleId: '',
      startedAt: null,
      completedAt: null,
      currentTaskId: null,
      lastError: null,
    };
  }

  /**
   * 执行完整 cycle
   * 固定流程：observe → strategize → review → execute → evaluate
   */
  async run(input?: { content: string; type?: string }): Promise<CycleState> {
    this.state = { ...initialState, cycleId: generateId(), startedAt: new Date() };

    try {
      // 1. Observing
      this.transition('observing');
      this.state.insights = await this.observe(input);

      // 2. Strategizing
      this.transition('strategizing');
      this.state.proposal = await this.strategize(this.state.insights);

      // 3. Reviewing
      this.transition('reviewing');
      this.state.assessment = await this.review(this.state.proposal);

      // 3b. 检查审查结果
      if (this.state.assessment.decision === 'rejected') {
        this.transition('failed');
        this.state.lastError = `Guardian rejected: ${this.state.assessment.concerns.join(', ')}`;
        return this.state;
      }

      if (this.state.assessment.riskLevel === 'high') {
        this.transition('blocked');
        // 等待用户确认（C2 实现）
        this.emit('blocked', { proposal: this.state.proposal, assessment: this.state.assessment });
        return this.state;
      }

      // 4. Executing
      this.transition('executing');
      this.state.executionResult = await this.execute(this.state.proposal);

      // 5. Evaluating
      this.transition('evaluating');
      this.state.fitnessReport = await this.evaluate();

      this.transition('completed');
      this.state.completedAt = new Date();
    } catch (err: any) {
      this.state.lastError = err.message;
      this.transition('failed');
    }

    return this.state;
  }

  /**
   * 用户确认后继续（从 blocked 状态恢复）
   */
  async confirmAndContinue(): Promise<CycleState> {
    if (this.state.phase !== 'blocked') throw new Error('Not in blocked state');
    this.transition('executing');
    this.state.executionResult = await this.execute(this.state.proposal);
    this.transition('evaluating');
    this.state.fitnessReport = await this.evaluate();
    this.transition('completed');
    this.state.completedAt = new Date();
    return this.state;
  }

  /**
   * 用户拒绝后取消
   */
  cancel(): void {
    if (this.state.phase !== 'blocked') throw new Error('Not in blocked state');
    this.state.lastError = 'Cancelled by user';
    this.transition('failed');
  }

  getState(): CycleState { return this.state; }

  // ---- 各阶段实现 ----

  private async observe(input?: any): Promise<any[]> {
    const coordinator = this.manager.getCoordinator();
    // 调用 ZoneCoordinator.delegateTask 分派给 Observer Agent
    // 返回 insights
  }

  private async strategize(insights: any[]): Promise<any> {
    // 分派给 Strategist Agent
  }

  private async review(proposal: any): Promise<SafetyAssessment> {
    // 分派给 Guardian Agent
  }

  private async execute(proposal: any): Promise<any> {
    // 分派给 Executor Agent
  }

  private async evaluate(): Promise<any> {
    // 调用 FitnessEvaluator
  }

  private transition(phase: CyclePhase): void {
    const old = this.state.phase;
    this.state.phase = phase;
    this.emit('phase_changed', { from: old, to: phase });
  }
}
```

**关键约束**:
- **固定流程**（方案 A）— 不依赖 LLM 分解任务
- blocked 状态的处理：暂停执行，发事件等用户确认
- 错误处理：任何阶段失败 → 整个 cycle 失败
- 状态转换必须经过 `transition()` 方法，确保事件广播

**验收标准**:
- [ ] `npx tsc --noEmit` 编译通过
- [ ] 状态机覆盖所有 phase 转换
- [ ] blocked → confirmAndContinue/cancel 流程正确
- [ ] 错误处理完整（try/catch，lastError 记录）
- [ ] 每个阶段通过 ZoneCoordinator.delegateTask 分派

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

---

### C2. Agent 间上下文传递（上下文序列化 + 注入）

**改什么文件**:
- `src/stratix-systemzone/SystemZoneCycle.ts` — 完善 observe/strategize/review/execute 的上下文传递

**做什么**:

实现各阶段之间的数据传递：

1. **Observer → Strategist**: insights 数组序列化为 JSON，作为 Strategist task 的 context 参数
2. **Strategist → Guardian**: proposal（含 modifications）序列化，作为 Guardian task 的 context
3. **Guardian → Executor**: 如果通过，assessment + modifications 作为 Executor task 的 context
4. **Executor → Evaluator**: executionResult 传给 FitnessEvaluator

具体实现方式：
- `ZoneCoordinator.delegateTask()` 的参数中有 `context` 字段
- 在 task_delegate 的 params 中传递前置阶段的输出

**验收标准**:
- [ ] Observer 的 insights 能被 Strategist 看到
- [ ] Strategist 的 modifications 能被 Guardian 看到
- [ ] Guardian 的 assessment 能决定是否执行
- [ ] 所有中间结果保存在 CycleState 中

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

---

### C3. FitnessEvaluator 反馈循环（变差自动回滚）

**改什么文件**:
- `src/stratix-systemzone/SystemZoneCycle.ts` — evaluate 阶段增加回滚逻辑
- `src/stratix-systemzone/fitness/FitnessEvaluator.ts` — 可能需要增加 before/after 对比方法

**做什么**:

1. 在 cycle 的 evaluate 阶段：
   - 调用 FitnessEvaluator.evaluate() 获取当前指标
   - 与 cycle 开始前的 baseline 指标对比
   - 如果 overall score 下降 → 触发回滚

2. 回滚流程：
   - 调用 DiffApplier.rollbackDiff 回滚所有 modifications
   - 记录到审计日志
   - 更新 Proposal 状态为 'rolled_back'

3. baseline 获取：
   - 在 cycle 开始前（observing 之前）记录一次 FitnessEvaluator 快照
   - 在 evaluate 阶段再取一次，对比

**验收标准**:
- [ ] cycle 开始前记录 baseline
- [ ] evaluate 阶段对比 before/after
- [ ] score 下降时自动回滚
- [ ] 回滚使用 DiffApplier.rollbackDiff
- [ ] 审计日志记录

**验证命令**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -30`

---

### C4. SystemZoneCycle 单元测试

**改什么文件**:
- 新建 `src/stratix-systemzone/__tests__/SystemZoneCycle.test.ts`

**做什么**:

为 SystemZoneCycle 写测试：
1. 完整 cycle 流程（mock 所有 Agent 调用）
2. blocked 状态 → confirmAndContinue
3. blocked 状态 → cancel
4. Guardian rejected → cycle 失败
5. FitnessEvaluator 变差 → 自动回滚

**验收标准**:
- [ ] 测试覆盖 4 个主要流程
- [ ] `npx jest src/stratix-systemzone/__tests__/SystemZoneCycle.test.ts --maxWorkers=2` 全部通过

**验证命令**: `cd ~/code/Stratix && npx jest src/stratix-systemzone/__tests__/SystemZoneCycle.test.ts --maxWorkers=2 2>&1 | tail -20`

---

## Phase D：UI 适配（2 个 Task）

---

### D1. System Zone 面板对接 Agent 架构

**改什么文件**:
- `src/stratix-systemzone/ui/SystemZoneConsole.vue` — 新增 Agent 状态 Tab
- 可能需要新增 `src/stratix-systemzone/ui/AgentStatusPanel.vue`

**做什么**:

1. 新增 Agent 状态 Tab：
   - 展示 4 个 Agent（observer, strategist, executor, guardian）的在线状态
   - 展示每个 Agent 的当前任务和能力
   - 展示最后一次 cycle 的状态（idle/observing/strategizing/...）

2. 复用现有组件：
   - ZoneAuditPanel — Agent 活动日志
   - ZoneTaskConfirmPanel — 高风险确认（blocked 状态时弹出）

3. 任务流转可视化：
   - Observer → Strategist → Guardian → Executor 的流转进度条
   - 当前阶段高亮

**验收标准**:
- [ ] 能看到 4 个 Agent 的状态
- [ ] 任务流转过程可视化
- [ ] 高风险修改时弹出确认面板
- [ ] 不破坏现有 SystemZoneConsole 的其他 Tab

**验证**: 手动 UI 验证（`npm run dev` 启动前端）

---

### D2. 手动触发 + 自动循环 API

**改什么文件**:
- 新建或改 `src/stratix-systemzone/api/systemZoneCycleRoutes.ts` — API 路由
- 改 `src/stratix-gateway/` 注册路由
- 改 `src/stratix-systemzone/ui/` 相关组件 — 按钮对接

**做什么**:

1. API 端点：
   - `POST /api/system-zone/cycle/trigger` — 手动触发一次 cycle（可带 input 参数）
   - `POST /api/system-zone/cycle/start` — 开始自动循环（interval 可配置）
   - `POST /api/system-zone/cycle/stop` — 停止自动循环
   - `GET /api/system-zone/cycle/status` — 获取当前 cycle 状态
   - `POST /api/system-zone/cycle/confirm` — 确认 blocked 的 cycle 继续
   - `POST /api/system-zone/cycle/reject` — 拒绝 blocked 的 cycle

2. 自动循环：
   - 使用 setInterval，interval 从配置读取（默认 1 小时）
   - 每次 interval 触发 `cycle.run()`

3. UI 按钮对接这些端点

**验收标准**:
- [ ] 手动触发能跑一次完整 cycle
- [ ] 自动循环能按 interval 反复执行
- [ ] 停止按钮能中断循环
- [ ] confirm/reject 端点能解除 blocked 状态

**验证**: 手动测试 + `curl` 调用 API

---

## 执行顺序

```
A1 → A2 → A3 → A4 → A5 → A6
                         ↓
               B1 → B2 → B3 → B4 → B5
                                    ↓
                              C1 → C2 → C3 → C4
                                                ↓
                                             D1 → D2
```

## 开发约束

1. **每次只给 Claude Code 安排一个 Task**
2. **最小改动原则** — 不重构不相关代码
3. **每个 Task 完成后必须 `npx tsc --noEmit` 验证编译**
4. **遵循现有代码风格**（看周围代码怎么写的）
5. **不删除现有代码** — 标注 `@deprecated` 或保留兼容
6. **每个 Task 完成后 review 改动**
7. **CPU 密集操作同时只能跑一个 agent**
8. **不确定影响时，宁可保守**
