/**
 * EvolutionManager - Agent 进化逻辑（soul/template 迭代）
 * 从 EnhancedStratixAgent 拆分出来的独立职责类
 */

import type { EvolutionResult, EvolutionProposal } from '../types';
import type { EnhancedSoulConfig, ReflectionEntry } from '../types/soul';

import type { LLMConnector } from './LLMConnector';

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[EvolutionManager] ${message}`, ctx || '');
}

// 进化提示词模板（原从 stratix-character-creator 导入，现内联以消除循环依赖）
const EVOLUTION_PROMPT = `你是一个持续成长的 Agent。在完成任务时：

1. 发现自身技能不足时，使用 find-skills 搜索 SkillHub 上可能帮助你的技能
2. 学习新技能后，更新你的能力描述
3. 将新学会的技能添加到你的技能列表中
4. 定期反思工作过程，寻找可改进的地方`;

export interface EvolutionManagerOptions {
  llm: LLMConnector;
  soul: EnhancedSoulConfig;
  agentId: string;
  getReflectionHistory: () => ReflectionEntry[];
  clearReflectionHistory: () => void;
  addMemoryEntry: (content: string, importance: 1 | 2 | 3) => Promise<void>;
}

export class EvolutionManager {
  private llm: LLMConnector;
  private soul: EnhancedSoulConfig;
  private agentId: string;
  private getReflectionHistory: () => ReflectionEntry[];
  private clearReflectionHistory: () => void;
  private addMemoryEntry: (content: string, importance: 1 | 2 | 3) => Promise<void>;

  // Evolution state
  private evolutionCount: number = 0;
  private consecutiveFailures: number = 0;
  private lastEvolutionTime: number = 0;
  private pendingEvolutionProposal: EvolutionProposal | null = null;
  private evolutionEnabled: boolean = false;
  private evolutionTriggerThreshold: number = 5;
  private evolutionCooldownHours: number = 24;
  private maxEvolutionsPerDay: number = 3;
  private consecutiveFailuresToBreak: number = 3;

  // Callback for user confirmation
  private onEvolutionProposal: ((proposal: EvolutionProposal) => Promise<boolean>) | null = null;

  constructor(options: EvolutionManagerOptions) {
    this.llm = options.llm;
    this.soul = options.soul;
    this.agentId = options.agentId;
    this.getReflectionHistory = options.getReflectionHistory;
    this.clearReflectionHistory = options.clearReflectionHistory;
    this.addMemoryEntry = options.addMemoryEntry;
  }

  /**
   * 初始化进化配置
   */
  initEvolution(config?: {
    enabled?: boolean;
    triggerThreshold?: number;
    cooldownHours?: number;
    maxEvolutionsPerDay?: number;
    consecutiveFailuresToBreak?: number;
  }): void {
    if (config) {
      this.evolutionEnabled = config.enabled ?? true;
      this.evolutionTriggerThreshold = config.triggerThreshold ?? 5;
      this.evolutionCooldownHours = config.cooldownHours ?? 24;
      this.maxEvolutionsPerDay = config.maxEvolutionsPerDay ?? 3;
      this.consecutiveFailuresToBreak = config.consecutiveFailuresToBreak ?? 3;
    }
  }

  /**
   * 设置进化提议回调
   */
  setEvolutionProposalCallback(callback: (proposal: EvolutionProposal) => Promise<boolean>): void {
    this.onEvolutionProposal = callback;
  }

  /**
   * 检查是否可以进行进化
   */
  canEvolve(): boolean {
    const soul = this.soul;

    // 检查进化是否启用
    const evolutionCheck = soul.reflection?.evolutionCheck;
    if (!evolutionCheck?.enabled && !this.evolutionEnabled) {
      return false;
    }

    // 检查反思次数是否达到阈值
    const threshold = evolutionCheck?.triggerThreshold ?? this.evolutionTriggerThreshold;
    if (this.getReflectionHistory().length < threshold) {
      return false;
    }

    // 检查冷却时间
    const cooldownHours = evolutionCheck?.cooldownHours ?? this.evolutionCooldownHours;
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    if (Date.now() - this.lastEvolutionTime < cooldownMs) {
      return false;
    }

    // 检查每日最大进化次数
    const maxPerDay = evolutionCheck?.maxEvolutionsPerDay ?? this.maxEvolutionsPerDay;
    if (this.evolutionCount >= maxPerDay) {
      return false;
    }

    // 检查熔断机制
    if (this.consecutiveFailures >= this.consecutiveFailuresToBreak) {
      return false;
    }

    return true;
  }

  /**
   * 执行进化
   */
  async performEvolution(): Promise<EvolutionResult> {
    const result: EvolutionResult = {
      success: false,
      evolutionCount: this.evolutionCount,
      consecutiveFailures: this.consecutiveFailures,
      requiresUserConfirmation: false,
    };

    // 检查是否可以进化
    if (!this.canEvolve()) {
      result.error = 'Evolution conditions not met';
      return result;
    }

    const soul = this.soul;

    // 构建进化提示词
    const evolutionPrompt = this.buildEvolutionPrompt(soul);

    let evolutionTimer: NodeJS.Timeout | undefined;
    try {
      // 调用 LLM 生成进化建议（带超时）
      const timeoutPromise = new Promise<never>((_, reject) => {
        evolutionTimer = setTimeout(() => reject(new Error('Evolution LLM call timed out after 30s')), 30000);
      });
      const response = await Promise.race([
        this.llm.generate([
          { role: 'system', content: EVOLUTION_PROMPT },
          { role: 'user', content: evolutionPrompt }
        ]),
        timeoutPromise
      ]);

      // 解析进化建议
      const proposal = this.parseEvolutionResponse(response.content, soul);

      if (!proposal) {
        this.consecutiveFailures++;
        result.error = 'Failed to generate valid evolution proposal';
        return result;
      }

      // 创建进化提议
      const evolutionProposal: EvolutionProposal = {
        id: `evolution-${Date.now()}`,
        agentId: this.agentId,
        timestamp: new Date().toISOString(),
        proposedChanges: proposal,
        reason: `Based on ${this.getReflectionHistory().length} reflections`,
        reflectionCount: this.getReflectionHistory().length,
      };

      this.pendingEvolutionProposal = evolutionProposal;
      result.requiresUserConfirmation = true;

      // 如果有回调，询问用户确认
      if (this.onEvolutionProposal) {
        const confirmed = await this.onEvolutionProposal(evolutionProposal);
        if (confirmed) {
          return this.applyEvolution(evolutionProposal);
        } else {
          result.error = 'User rejected evolution proposal';
          return result;
        }
      }

      // 没有回调时暂存提议等待确认
      return result;

    } catch (error) {
      this.consecutiveFailures++;
      result.error = `Evolution error: ${error instanceof Error ? error.message : String(error)}`;
      return result;
    } finally {
      if (evolutionTimer) clearTimeout(evolutionTimer);
    }
  }

  /**
   * 构建进化提示词
   */
  private buildEvolutionPrompt(soul: EnhancedSoulConfig): string {
    const reflections = this.getReflectionHistory().map(r => r.reflection).join('\n');

    return `基于以下反思历史，请建议 Soul 的进化：

当前 Soul：
- identity: ${soul.identity || 'N/A'}
- goals: ${(soul.goals || []).join(', ')}
- personality: ${soul.personality || 'N/A'}
- constraints: ${(soul.constraints || []).join(', ')}

反思历史（共${this.getReflectionHistory().length}条）：
${reflections}

请分析反思历史，识别模式和改进机会，然后建议：
1. goals 的增删或调整（只添加与 identity 一致的新目标）
2. personality 的微调（保持核心性格一致）
3. constraints 的增删（添加必要的限制）

只进化可进化字段（goals/personality/constraints），identity 是核心身份不可修改。
以 JSON 格式输出建议，格式如下：
{
  "goals": ["目标1", "目标2"],
  "personality": "性格描述",
  "constraints": ["约束1", "约束2"]
}`;
  }

  /**
   * 解析 LLM 进化响应
   */
  private parseEvolutionResponse(
    content: string,
    soul: EnhancedSoulConfig
  ): { goals?: string[]; personality?: string; constraints?: string[] } | null {
    try {
      // 尝试从响应中提取 JSON（非贪婪匹配最外层大括号）
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 验证并清理建议
      const result: { goals?: string[]; personality?: string; constraints?: string[] } = {};

      // Goals: 必须与 identity 一致，只能添加不能替换
      if (parsed.goals && Array.isArray(parsed.goals)) {
        const currentGoals = soul.goals || [];
        const newGoals = parsed.goals.filter((g: string) =>
          typeof g === 'string' && g.trim().length > 0
        );
        // 合并现有目标和新目标
        result.goals = [...new Set([...currentGoals, ...newGoals])];
      }

      // Personality: 可以微调但不能颠覆
      if (parsed.personality && typeof parsed.personality === 'string') {
        result.personality = parsed.personality.trim();
      }

      // Constraints: 可以增删
      if (parsed.constraints && Array.isArray(parsed.constraints)) {
        const currentConstraints = soul.constraints || [];
        const newConstraints = parsed.constraints.filter((c: string) =>
          typeof c === 'string' && c.trim().length > 0
        );
        result.constraints = [...new Set([...currentConstraints, ...newConstraints])];
      }

      return result;
    } catch (err) {
      log('warn', 'Failed to parse evolution response', { error: String(err) });
      return null;
    }
  }

  /**
   * 应用进化（用户确认后调用）
   */
  async applyEvolution(proposal: EvolutionProposal): Promise<EvolutionResult> {
    const result: EvolutionResult = {
      success: false,
      evolutionCount: this.evolutionCount,
      consecutiveFailures: this.consecutiveFailures,
      requiresUserConfirmation: false,
    };

    try {
      const soul = this.soul;

      // 应用进化更改
      if (proposal.proposedChanges.goals) {
        soul.goals = proposal.proposedChanges.goals;
      }
      if (proposal.proposedChanges.personality) {
        soul.personality = proposal.proposedChanges.personality;
      }
      if (proposal.proposedChanges.constraints) {
        soul.constraints = proposal.proposedChanges.constraints;
      }

      // 更新状态
      this.evolutionCount++;
      this.consecutiveFailures = 0;
      this.lastEvolutionTime = Date.now();
      this.pendingEvolutionProposal = null;

      // 清空反思历史（进化后重新开始积累）
      this.clearReflectionHistory();

      // 保存进化记忆
      await this.addMemoryEntry(
        `Soul 进化完成：${JSON.stringify(proposal.proposedChanges)}`,
        3
      );

      result.success = true;
      result.evolvedFields = proposal.proposedChanges;
      result.evolutionCount = this.evolutionCount;
      result.consecutiveFailures = this.consecutiveFailures;

      return result;

    } catch (error) {
      this.consecutiveFailures++;
      result.error = `Failed to apply evolution: ${error}`;
      return result;
    }
  }

  /**
   * 获取待确认的进化提议
   */
  getPendingEvolutionProposal(): EvolutionProposal | null {
    return this.pendingEvolutionProposal;
  }

  /**
   * 确认进化提议
   */
  async confirmEvolution(proposal: EvolutionProposal): Promise<EvolutionResult> {
    return this.applyEvolution(proposal);
  }

  /**
   * 拒绝进化提议
   */
  rejectEvolution(proposal: EvolutionProposal): void {
    if (this.pendingEvolutionProposal?.id === proposal.id) {
      this.pendingEvolutionProposal = null;
    }
  }

  /**
   * 获取进化状态
   */
  getEvolutionStatus(): {
    evolutionCount: number;
    consecutiveFailures: number;
    lastEvolutionTime: number;
    pendingProposal: EvolutionProposal | null;
    熔断触发: boolean;
  } {
    return {
      evolutionCount: this.evolutionCount,
      consecutiveFailures: this.consecutiveFailures,
      lastEvolutionTime: this.lastEvolutionTime,
      pendingProposal: this.pendingEvolutionProposal,
      熔断触发: this.consecutiveFailures >= this.consecutiveFailuresToBreak,
    };
  }

  /**
   * 重置进化熔断
   */
  resetEvolutionCircuitBreaker(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * 重置每日进化计数
   */
  resetDailyEvolutionCount(): void {
    this.evolutionCount = 0;
  }
}
