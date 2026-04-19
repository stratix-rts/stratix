/**
 * 增强的 StratixAgent
 * 支持工作流执行、反思机制、多步骤规划
 */

import { EVOLUTION_PROMPT } from '../stratix-character-creator/config/skillHubConfig';
import { zoneContextManager } from '../stratix-character-creator/core/ZoneContextManager';

import { StratixAgent } from './StratixAgent';
import { EnhancedPromptBuilder } from './core/EnhancedPromptBuilder';
import { MixinComposer } from './mixins/MixinComposer';
import { SessionRuntime } from './runtime/SessionRuntime';
import type { SessionContext, TokenUsage, ChatMessage as RuntimeChatMessage } from './runtime/types';
import { AgentConfig, SoulConfig, SkillResult, EvolutionResult, EvolutionProposal, ChatMessage as AgentChatMessage } from './types';
import { EnhancedSoulConfig, ReflectionEntry } from './types/soul';
import { AgentTemplate, WorkflowDefinition, WorkflowStep } from './types/template';


export interface AgentCapabilities {
  workflowExecution: boolean;
  reflection: boolean;
  toolUse: boolean;
  multiStepPlanning: boolean;
  selfCorrection: boolean;
}

export interface EnhancedAgentResponse {
  sessionId: string;
  response: string;
  skillExecutions?: SkillResult[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  workflowUsed?: string;
  reflectionUsed?: boolean;
}

interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  importance: number;
  createdAt: string;
}

/**
 * 增强的 StratixAgent
 * 支持模板加载、工作流执行、反思机制
 */
export class EnhancedStratixAgent extends StratixAgent {
  private template: AgentTemplate | null = null;
  private enhancedPromptBuilder: EnhancedPromptBuilder;
  private mixinComposer: MixinComposer;
  private capabilities: AgentCapabilities;
  private currentWorkflow: WorkflowStep[] = [];
  private reflectionHistory: ReflectionEntry[] = [];
  private memoryEntries: MemoryEntry[] = [];
  private runtime: SessionRuntime;
  private currentSessionId: string | null = null;

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

  constructor(config: AgentConfig, soul: SoulConfig, template?: AgentTemplate) {
    super(config, soul);
    this.template = template ? this.loadTemplate(template) : null;
    this.enhancedPromptBuilder = new EnhancedPromptBuilder();
    this.mixinComposer = new MixinComposer();
    this.capabilities = this.detectCapabilities();
    this.runtime = new SessionRuntime('.transcripts', this);
  }

  /**
   * 加载模板
   */
  loadTemplate(template: AgentTemplate): AgentTemplate {
    // 应用 mixin 组合
    if (template.mixins.length > 0) {
      template = this.mixinComposer.compose(template, template.mixins);
    }
    this.template = template;
    this.capabilities = this.detectCapabilities();
    return template;
  }

  /**
   * 应用 Mixin
   */
  applyMixin(mixin: 'base' | 'resource' | 'compliance'): void {
    if (!this.template) return;
    this.template = this.mixinComposer.compose(this.template, [mixin]);
    this.capabilities = this.detectCapabilities();
  }

  /**
   * 移除 Mixin
   */
  removeMixin(mixin: 'base' | 'resource' | 'compliance'): void {
    if (!this.template) return;
    this.template = this.mixinComposer.removeMixin(this.template, mixin);
    this.capabilities = this.detectCapabilities();
  }

  /**
   * 获取当前模板
   */
  getTemplate(): AgentTemplate | null {
    return this.template;
  }

  /**
   * 获取能力列表
   */
  getCapabilities(): AgentCapabilities {
    return { ...this.capabilities };
  }

  /**
   * 检测 Agent 能力
   */
  private detectCapabilities(): AgentCapabilities {
    return {
      workflowExecution: (this.template?.workflows.length ?? 0) > 0,
      reflection: true,
      toolUse: this.skills.getEnabledSkills().length > 0,
      multiStepPlanning: (this.template?.workflowSteps.length ?? 0) > 1,
      selfCorrection: true,
    };
  }

  /**
   * 增强的聊天方法
   */
  async chat(
    message: string,
    options?: {
      sessionId?: string;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
      includeWorkflow?: boolean;
      includeReflection?: boolean;
    }
  ): Promise<EnhancedAgentResponse> {
    const { includeWorkflow = true, includeReflection = true } = options || {};

    // 如果没有模板，使用标准聊天
    if (!this.template) {
      return super.chat(message, options) as Promise<EnhancedAgentResponse>;
    }

    // 1. 检测是否需要执行工作流
    if (includeWorkflow && this.template.workflows.length > 0) {
      const matchedWorkflow = this.matchWorkflow(message);
      if (matchedWorkflow) {
        return this.executeWorkflow(matchedWorkflow, message, options);
      }
    }

    // 2. 获取 Zone 上下文
    const zoneContext = await zoneContextManager.getZonePromptContext(this.config.agentId);

    // 3. 获取历史消息（用于构建增强提示词）
    const recentMessages: AgentChatMessage[] = [];
    if (options?.sessionId) {
      const sess = await this.runtime.getSession(options.sessionId);
      if (sess) {
        // Convert from SessionRuntime ChatMessage to AgentChatMessage
        for (const m of sess.messages.slice(-10)) {
          recentMessages.push({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
          });
        }
      }
    }

    // 4. 构建增强提示词
    const systemMessages = this.enhancedPromptBuilder.buildFullSystemPrompt(
      this.template,
      this.soul as EnhancedSoulConfig,
      this.memory.buildContext(),
      this.skills.getEnabledSkills(),
      recentMessages,
      { includeReflection, includeWorkflow, includeLearnedSkills: true, includeZoneContext: true, zoneContext },
      this.memory.buildSkillContext()
    );

    // 5. 使用 SessionRuntime 管理会话
    let session;
    if (options?.sessionId) {
      const existingSession = await this.runtime.getSession(options.sessionId);
      if (existingSession) {
        session = existingSession;
      }
    }
    if (!session) {
      session = await this.runtime.createSession(this.config.agentId);
    }
    this.currentSessionId = session.sessionId;

    // 6. 存储增强上下文到 session.memory（供 executeAgentTurn 使用）
    session.memory.set('enhancedPrompt', systemMessages);
    session.memory.set('includeWorkflow', includeWorkflow);
    session.memory.set('includeReflection', includeReflection);
    session.memory.set('recentMessages', recentMessages);
    session.memory.set('zoneContext', zoneContext);

    // 7. 执行聊天（通过 SessionRuntime.executeTurn 调用 executeAgentTurn）
    this.memory.addMessage('user', message);
    const turnResult = await this.runtime.executeTurn(session.sessionId, message);
    this.memory.addMessage('assistant', turnResult.response);

    const response: EnhancedAgentResponse = {
      sessionId: session.sessionId,
      response: turnResult.response,
      usage: turnResult.usage,
      reflectionUsed: false,
    };

    // 8. 反思机制
    if (includeReflection && (this.soul as EnhancedSoulConfig).reflection?.afterEachTask) {
      try {
        await this.performReflection(message, turnResult.response);
        response.reflectionUsed = true;
      } catch {
        // 反思失败静默处理
      }
    }

    return response;
  }

  /**
   * Execute agent turn using enhanced prompt from session memory.
   * SessionRuntime calls this method to execute each turn.
   */
  public async executeAgentTurn(
    session: SessionContext,
    message: string,
    _timeout: number,
    _signal?: AbortSignal
  ): Promise<{ response: string; usage: TokenUsage }> {
    // Retrieve enhanced context stored by chat()
    // enhancedPrompt is AgentChatMessage[] (from ./types)
    const enhancedPrompt = session.memory.get('enhancedPrompt') as AgentChatMessage[] | undefined;
    // recentMessages from session.memory was stored as AgentChatMessage[]
    const recentMessages = session.memory.get('recentMessages') as AgentChatMessage[] | undefined;

    if (!enhancedPrompt) {
      // Fallback: simple response without enhanced prompt
      const result = await this.llm.generate([{ role: 'user', content: message }]);
      return { response: result.content, usage: { ...result.usage!, turnCount: 1 } };
    }

    // Build messages array with system prompt + recent history + current message
    const messages: AgentChatMessage[] = [
      ...enhancedPrompt,
      ...(recentMessages || []),
      { role: 'user', content: message },
    ];

    // Call LLM
    const result = await this.llm.generate(messages);

    return {
      response: result.content,
      usage: { ...result.usage!, turnCount: 1 },
    };
  }

  /**
   * 匹配工作流
   */
  private matchWorkflow(message: string): WorkflowDefinition | null {
    if (!this.template?.workflows) return null;

    const messageLower = message.toLowerCase();

    for (const workflow of this.template.workflows) {
      // 检查触发条件
      if (workflow.triggerConditions) {
        for (const condition of workflow.triggerConditions) {
          if (messageLower.includes(condition.toLowerCase())) {
            return workflow;
          }
        }
      }

      // 检查步骤中的工具/技能是否匹配
      for (const step of workflow.steps) {
        if (step.tools?.some(tool => messageLower.includes(tool.toLowerCase()))) {
          return workflow;
        }
        if (step.skills?.some(skill => messageLower.includes(skill.toLowerCase()))) {
          return workflow;
        }
        // 检查步骤名称是否匹配
        if (messageLower.includes(step.name.toLowerCase())) {
          return workflow;
        }
      }
    }

    return null;
  }

  /**
   * 执行工作流
   */
  private async executeWorkflow(
    workflow: WorkflowDefinition,
    initialMessage: string,
    options?: {
      sessionId?: string;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<EnhancedAgentResponse> {
    const results: string[] = [];
    let context = initialMessage;

    // 使用 SessionRuntime 管理会话
    let session;
    if (options?.sessionId) {
      const existingSession = await this.runtime.getSession(options.sessionId);
      if (existingSession) {
        session = existingSession;
      }
    }
    if (!session) {
      session = await this.runtime.createSession(this.config.agentId);
    }
    this.currentSessionId = session.sessionId;

    results.push(`[开始执行工作流: ${workflow.name}]\n`);

    for (const step of workflow.steps) {
      try {
        // 执行步骤
        const stepResult = await this.executeWorkflowStep(step, context, options);
        results.push(`\n[Step ${step.order}: ${step.name}]\n${stepResult}\n`);

        // 更新上下文
        context = stepResult;

        // 检查错误处理
        if (step.onError && stepResult.includes('[ERROR]')) {
          const errorResult = await this.handleWorkflowError(step, context);
          results.push(`\n[错误处理]\n${errorResult}\n`);
          if (step.onError === 'stop') break;
        }

        // 执行后续步骤
        if (step.nextSteps && step.nextSteps.length > 0) {
          for (const nextStepId of step.nextSteps) {
            const nextStep = workflow.steps.find(s => s.id === nextStepId);
            if (nextStep) {
              const nextResult = await this.executeWorkflowStep(nextStep, context, options);
              results.push(`\n[Step ${nextStep.order}: ${nextStep.name}]\n${nextResult}\n`);
              context = nextResult;
            }
          }
        }
      } catch (error) {
        results.push(`\n[ERROR in Step ${step.order}]: ${error}\n`);
        if (step.onError === 'stop') break;
      }
    }

    results.push(`\n[工作流完成: ${workflow.name}]`);

    const finalResponse = results.join('\n');

    // 保存到会话（通过 SessionRuntime）
    session.messages.push({ id: `user_${Date.now()}`, role: 'user', content: initialMessage, timestamp: Date.now() });
    session.messages.push({ id: `asst_${Date.now()}`, role: 'assistant', content: finalResponse, timestamp: Date.now() });

    // 记录到 transcript
    await this.runtime.getTranscriptStore().append({
      sessionId: session.sessionId,
      turnId: `user_${Date.now()}`,
      role: 'user',
      content: initialMessage,
      timestamp: Date.now(),
    });
    await this.runtime.getTranscriptStore().append({
      sessionId: session.sessionId,
      turnId: `asst_${Date.now()}`,
      role: 'assistant',
      content: finalResponse,
      timestamp: Date.now(),
    });

    return {
      sessionId: session.sessionId,
      response: finalResponse,
      workflowUsed: workflow.name,
    };
  }

  /**
   * 执行单个工作流步骤
   */
  private async executeWorkflowStep(
    step: WorkflowStep,
    context: string,
    options?: {
      stream?: boolean;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<string> {
    let prompt = `任务: ${step.description}\n\n上下文: ${context}\n\n`;

    if (step.skills && step.skills.length > 0) {
      const relevantSkills = this.skills.getEnabledSkills()
        .filter(s => step.skills!.includes(s.skillId));

      if (relevantSkills.length > 0) {
        prompt += `使用技能:\n`;
        for (const skill of relevantSkills) {
          prompt += `- **${skill.name}**: ${skill.description}\n`;
        }
        prompt += '\n';
      }
    }

    if (step.expectedOutput) {
      prompt += `预期输出: ${step.expectedOutput}\n`;
    }

    prompt += `\n请执行这个步骤并给出结果。`;

    // 调用 LLM
    const messages: AgentChatMessage[] = [{ role: 'user', content: prompt }];

    let result;
    if (options?.stream && options?.onChunk) {
      result = await this.llm.generateStream(messages, options.onChunk);
    } else {
      result = await this.llm.generate(messages);
    }

    return result.content;
  }

  /**
   * 处理工作流错误
   */
  private async handleWorkflowError(step: WorkflowStep, context: string): Promise<string> {
    const errorPrompt = `错误发生在了步骤: ${step.name}
错误上下文: ${context}

请分析错误原因并提供解决方案。`;

    const response = await this.llm.generate([{ role: 'user', content: errorPrompt }]);
    return response.content;
  }

  /**
   * 反思机制
   */
  private async performReflection(task: string, result: string): Promise<void> {
    const reflectionConfig = (this.soul as EnhancedSoulConfig).reflection;
    if (!reflectionConfig?.enabled) return;

    const reflectionPrompt = `任务: ${task}
结果: ${result}

请简短反思:
1. 任务完成度如何？
2. 有什么可以改进的地方？
3. 从中学到了什么？`;

    const response = await this.llm.generate([{ role: 'user', content: reflectionPrompt }]);
    const reflectionContent = response.content;

    // 创建反思条目
    const entry: ReflectionEntry = {
      id: `reflection-${Date.now()}`,
      timestamp: new Date().toISOString(),
      task,
      result,
      reflection: reflectionContent,
    };

    this.reflectionHistory.push(entry);

    // 如果启用了长期记忆，保存重要反思
    if (this.reflectionHistory.length > 10) {
      const summary = await this.summarizeReflections();
      await this.addMemoryEntry(summary, 2);
      this.reflectionHistory = [];
    }

    // 自我纠正检查
    if (reflectionConfig.onError && result.includes('[ERROR]')) {
      await this.selfCorrect(task, result, reflectionContent);
    }

    // 进化检查
    if (reflectionConfig.evolutionCheck?.enabled) {
      this.initEvolution({
        enabled: reflectionConfig.evolutionCheck.enabled,
        triggerThreshold: reflectionConfig.evolutionCheck.triggerThreshold,
        cooldownHours: reflectionConfig.evolutionCheck.cooldownHours,
        maxEvolutionsPerDay: reflectionConfig.evolutionCheck.maxEvolutionsPerDay,
      });

      // 尝试执行进化（可能需要用户确认）
      if (this.canEvolve()) {
        // 注意：performEvolution 可能是异步的，需要用户确认
        // 这里只检查是否满足条件，实际进化由外部触发
        const proposal = this.getPendingEvolutionProposal();
        if (!proposal) {
          // 触发进化检查但不阻塞
          this.performEvolution().catch(() => {
            // 进化失败静默处理
          });
        }
      }
    }
  }

  /**
   * 自我纠正
   */
  private async selfCorrect(task: string, result: string, reflection: string): Promise<void> {
    const correctionPrompt = `原始任务: ${task}
执行结果: ${result}
反思: ${reflection}

请分析问题并提出纠正方案。不要重复相同的错误。`;

    const correction = await this.llm.generate([{ role: 'user', content: correctionPrompt }]);

    // 保存纠正历史
    await this.addMemoryEntry(
      `自我纠正: ${correction.content}`,
      3
    );
  }

  /**
   * 总结反思历史
   */
  private async summarizeReflections(): Promise<string> {
    if (this.reflectionHistory.length === 0) return '';

    const summaryPrompt = `请总结以下反思要点，提取关键经验（不超过 200 字）:\n\n${
      this.reflectionHistory.map(r => `- ${r.reflection}`).join('\n')
    }`;

    const response = await this.llm.generate([{ role: 'user', content: summaryPrompt }]);
    return response.content;
  }

  /**
   * 添加长期记忆
   */
  private async addMemoryEntry(content: string, importance: 1 | 2 | 3 = 2): Promise<void> {
    if (this.memory) {
      // 使用内置的记忆系统
      const entry: MemoryEntry = {
        id: `memory-${Date.now()}`,
        title: content.substring(0, 50),
        content,
        importance,
        createdAt: new Date().toISOString(),
      };
      this.memoryEntries.push(entry);

      // 如果支持长期记忆，添加到 MemoryManager
      if ((this.memory as any).addLongTermMemory) {
        (this.memory as any).addLongTermMemory({
          title: entry.title,
          content: entry.content,
          importance: entry.importance,
        });
      }
    }
  }

  /**
   * 获取反思历史
   */
  getReflectionHistory(): ReflectionEntry[] {
    return [...this.reflectionHistory];
  }

  /**
   * 获取记忆条目
   */
  getMemoryEntries(): MemoryEntry[] {
    return [...this.memoryEntries];
  }

  /**
   * 清空反思历史
   */
  clearReflectionHistory(): void {
    this.reflectionHistory = [];
  }

  /**
   * 清空记忆
   */
  clearMemory(): void {
    this.memoryEntries = [];
  }

  /**
   * 停止 agent 并清理资源（包括 SessionRuntime）
   * 调用此方法确保 session 被销毁，防止内存泄漏
   */
  async stop(): Promise<void> {
    // Stop task polling first
    this.stopTaskPolling();

    if (this.currentSessionId) {
      try {
        await this.runtime.destroy(this.currentSessionId);
      } catch {
        // Session 可能已经不存在，忽略错误
      }
      this.currentSessionId = null;
    }
    this.shouldStop = true;
  }

  /**
   * 清理资源（stop 的同步版本）
   */
  cleanup(): void {
    if (this.currentSessionId) {
      try {
        this.runtime.destroy(this.currentSessionId);
      } catch {
        // Session 可能已经不存在，忽略错误
      }
      this.currentSessionId = null;
    }
  }

  private shouldStop = false;

  // ============================================
  // Task Polling (Agent Task Management)
  // ============================================

  private taskPollInterval: NodeJS.Timeout | null = null;
  private pendingTasks: Array<{
    taskId: string;
    zoneId: string;
    name: string;
    description?: string;
    type: string;
    priority: number;
  }> = [];

  /**
   * Start polling for tasks assigned to this agent
   * Uses TaskQueueService via REST API to fetch pending tasks
   */
  async startTaskPolling(intervalMs: number = 5000): Promise<void> {
    if (this.taskPollInterval) {
      console.warn(`[Agent ${this.config.agentId}] Task polling already running`);
      return;
    }

    console.log(`[Agent ${this.config.agentId}] Starting task polling every ${intervalMs}ms`);

    // Initial fetch
    await this.pollTasksInternal();

    // Set up interval
    this.taskPollInterval = setInterval(async () => {
      await this.pollTasksInternal();
    }, intervalMs);
  }

  /**
   * Stop polling for tasks
   */
  stopTaskPolling(): void {
    if (this.taskPollInterval) {
      clearInterval(this.taskPollInterval);
      this.taskPollInterval = null;
      console.log(`[Agent ${this.config.agentId}] Task polling stopped`);
    }
  }

  /**
   * Internal method to poll tasks from TaskQueueService
   */
  private async pollTasksInternal(): Promise<void> {
    if (this.shouldStop) return;

    try {
      // Dynamic require to avoid circular dependency
      const TaskQueueService = require('../stratix-orchestration/task-queue/TaskQueueService').TaskQueueService;
      const taskQueue = TaskQueueService.getInstance();

      const tasks: any[] = await taskQueue.getTasksByAgent(this.config.agentId);

      if (tasks.length > 0) {
        this.pendingTasks = tasks.map((t: any) => ({
          taskId: t.taskId,
          zoneId: t.zoneId,
          name: t.name,
          description: t.description,
          type: t.type,
          priority: t.priority,
        }));

        console.log(`[Agent ${this.config.agentId}] Polled ${tasks.length} pending tasks`);

        // Emit event for external listeners
        this.emitTaskReceived(this.pendingTasks);
      }
    } catch (error) {
      console.error(`[Agent ${this.config.agentId}] Task polling error:`, error);
    }
  }

  /**
   * Get current pending tasks
   */
  getPendingTasks(): Array<{
    taskId: string;
    zoneId: string;
    name: string;
    description?: string;
    type: string;
    priority: number;
  }> {
    return this.pendingTasks;
  }

  /**
   * Mark a task as complete
   */
  async completeTask(taskId: string, result?: Record<string, unknown>): Promise<boolean> {
    try {
      const TaskQueueService = require('../stratix-orchestration/task-queue/TaskQueueService').TaskQueueService;
      const taskQueue = TaskQueueService.getInstance();

      const task = await taskQueue.updateTask(taskId, {
        status: 'completed',
        result,
      });

      if (task) {
        // Remove from pending tasks
        this.pendingTasks = this.pendingTasks.filter(t => t.taskId !== taskId);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`[Agent ${this.config.agentId}] Failed to complete task ${taskId}:`, error);
      return false;
    }
  }

  /**
   * Emit task received event (for external listeners like WebSocket)
   */
  private emitTaskReceived(tasks: typeof this.pendingTasks): void {
    // This can be connected to the event system if needed
    // For now, tasks are stored in pendingTasks for retrieval via getPendingTasks()
  }

  // ============================================
  // SessionRuntime Getters
  // ============================================

  /**
   * 获取当前 session ID
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 获取当前 session 的 transcript（最近 N 条）
   */
  getTranscript(limit: number = 50): RuntimeChatMessage[] {
    if (!this.currentSessionId) return [];
    return this.runtime.getRecentMessages(this.currentSessionId, limit) as RuntimeChatMessage[];
  }

  /**
   * 获取当前 session 的 token usage
   */
  getUsage(): TokenUsage {
    if (!this.currentSessionId) {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0, turnCount: 0 };
    }
    return this.runtime.getUsage(this.currentSessionId);
  }

  // ============================================
  // Evolution Mechanism
  // ============================================

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
  private canEvolve(): boolean {
    const soul = this.soul as EnhancedSoulConfig;

    // 检查进化是否启用
    const evolutionCheck = soul.reflection?.evolutionCheck;
    if (!evolutionCheck?.enabled && !this.evolutionEnabled) {
      return false;
    }

    // 检查反思次数是否达到阈值
    const threshold = evolutionCheck?.triggerThreshold ?? this.evolutionTriggerThreshold;
    if (this.reflectionHistory.length < threshold) {
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

    const soul = this.soul as EnhancedSoulConfig;

    // 构建进化提示词
    const evolutionPrompt = this.buildEvolutionPrompt(soul);

    try {
      // 调用 LLM 生成进化建议
      const response = await this.llm.generate([
        { role: 'system', content: EVOLUTION_PROMPT },
        { role: 'user', content: evolutionPrompt }
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
        agentId: this.config.agentId,
        timestamp: new Date().toISOString(),
        proposedChanges: proposal,
        reason: `Based on ${this.reflectionHistory.length} reflections`,
        reflectionCount: this.reflectionHistory.length,
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
      result.error = `Evolution error: ${error}`;
      return result;
    }
  }

  /**
   * 构建进化提示词
   */
  private buildEvolutionPrompt(soul: EnhancedSoulConfig): string {
    const reflections = this.reflectionHistory.map(r => r.reflection).join('\n');

    return `基于以下反思历史，请建议 Soul 的进化：

当前 Soul：
- identity: ${soul.identity || 'N/A'}
- goals: ${(soul.goals || []).join(', ')}
- personality: ${soul.personality || 'N/A'}
- constraints: ${(soul.constraints || []).join(', ')}

反思历史（共${this.reflectionHistory.length}条）：
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
      // 尝试从响应中提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
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
    } catch {
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
      const soul = this.soul as EnhancedSoulConfig;

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
      this.reflectionHistory = [];

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

export default EnhancedStratixAgent;
