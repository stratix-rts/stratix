/**
 * 增强的 StratixAgent
 * 支持工作流执行、反思机制、多步骤规划
 *
 * 架构：EnhancedStratixAgent 作为协调/入口，核心逻辑委托给：
 * - WorkflowExecutor      工作流执行逻辑
 * - ReflectionManager     反思和自校正
 * - EvolutionManager      Agent 进化（soul/template 迭代）
 */

import type { TaskItem } from '../stratix-orchestration/task-queue/TaskItem';
import { TaskQueueService } from '../stratix-orchestration/task-queue/TaskQueueService';

import { StratixAgent } from './StratixAgent';
import { EnhancedPromptBuilder } from './core/EnhancedPromptBuilder';
import { EvolutionManager } from './core/EvolutionManager';
import { ReflectionManager } from './core/ReflectionManager';
import { WorkflowExecutor, type EnhancedAgentResponse } from './core/WorkflowExecutor';
import { MixinComposer } from './mixins/MixinComposer';
import { SessionRuntime } from './runtime/SessionRuntime';
import type { SessionContext, TokenUsage, ChatMessage as RuntimeChatMessage } from './runtime/types';
import { AgentConfig, SoulConfig, SkillResult, EvolutionResult, EvolutionProposal, ChatMessage as AgentChatMessage, ZonePromptContext } from './types';
import { EnhancedSoulConfig, ReflectionEntry } from './types/soul';
import { AgentTemplate, WorkflowDefinition, WorkflowStep } from './types/template';

export interface AgentCapabilities {
  workflowExecution: boolean;
  reflection: boolean;
  toolUse: boolean;
  multiStepPlanning: boolean;
  selfCorrection: boolean;
}

export { type EnhancedAgentResponse };

export interface ZoneContextProvider {
  getZonePromptContext(agentId: string): Promise<ZonePromptContext>;
}

interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  importance: number;
  createdAt: string;
}

const DEFAULT_ZONE_PROVIDER: ZoneContextProvider = {
  getZonePromptContext: async () => ({ inZone: false, availableZones: [] }),
};

// ============================================
// Constants
// ============================================
const DEFAULT_RECENT_MESSAGE_COUNT = 10;
const DEFAULT_TASK_POLL_INTERVAL_MS = 5000;
const DEFAULT_TRANSCRIPT_LIMIT = 50;

// ============================================
// Structured logging helper
// ============================================
function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[EnhancedStratixAgent] ${message}`, ctx || '');
}

// ============================================
// Internal interfaces for test-proxy access
// Eliminates `as any` casts by typing the private shape
// ============================================
interface ReflectionManagerInternal {
  reflectionHistory: ReflectionEntry[];
  memoryEntries: MemoryEntry[];
}

interface EvolutionManagerInternal {
  evolutionCount: number;
  consecutiveFailures: number;
  consecutiveFailuresToBreak: number;
  lastEvolutionTime: number;
  pendingEvolutionProposal: EvolutionProposal | null;
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
  private runtime: SessionRuntime;
  private currentSessionId: string | null = null;
  private zoneContextProvider: ZoneContextProvider;

  // Sub-managers
  private workflowExecutor: WorkflowExecutor;
  private reflectionManager: ReflectionManager;
  private evolutionManager: EvolutionManager;

  // ============================================
  // Test-compatibility proxy properties
  // Tests access private fields via (agent as any).field
  // These proxies ensure the same access pattern works
  // after delegation to sub-managers.
  // ============================================

  /** @internal proxy for test access */
  get reflectionHistory(): ReflectionEntry[] {
    return (this.reflectionManager as unknown as ReflectionManagerInternal).reflectionHistory;
  }

  /** @internal proxy for test access */
  get memoryEntries(): MemoryEntry[] {
    return (this.reflectionManager as unknown as ReflectionManagerInternal).memoryEntries;
  }

  /** @internal proxy for test access */
  get evolutionCount(): number {
    return (this.evolutionManager as unknown as EvolutionManagerInternal).evolutionCount;
  }

  /** @internal proxy for test access */
  get consecutiveFailures(): number {
    return (this.evolutionManager as unknown as EvolutionManagerInternal).consecutiveFailures;
  }
  set consecutiveFailures(value: number) {
    (this.evolutionManager as unknown as EvolutionManagerInternal).consecutiveFailures = value;
  }

  /** @internal proxy for test access */
  get consecutiveFailuresToBreak(): number {
    return (this.evolutionManager as unknown as EvolutionManagerInternal).consecutiveFailuresToBreak;
  }
  set consecutiveFailuresToBreak(value: number) {
    (this.evolutionManager as unknown as EvolutionManagerInternal).consecutiveFailuresToBreak = value;
  }

  /** @internal proxy for test access */
  get lastEvolutionTime(): number {
    return (this.evolutionManager as unknown as EvolutionManagerInternal).lastEvolutionTime;
  }
  set lastEvolutionTime(value: number) {
    (this.evolutionManager as unknown as EvolutionManagerInternal).lastEvolutionTime = value;
  }

  /** @internal proxy for test access */
  get pendingEvolutionProposal(): EvolutionProposal | null {
    return (this.evolutionManager as unknown as EvolutionManagerInternal).pendingEvolutionProposal;
  }
  set pendingEvolutionProposal(value: EvolutionProposal | null) {
    (this.evolutionManager as unknown as EvolutionManagerInternal).pendingEvolutionProposal = value;
  }

  /**
   * Typed accessor for EnhancedSoulConfig (eliminates repeated `as` casts).
   */
  private get enhancedSoul(): EnhancedSoulConfig {
    return this.soul as EnhancedSoulConfig;
  }

  constructor(config: AgentConfig, soul: SoulConfig, template?: AgentTemplate, zoneContextProvider?: ZoneContextProvider) {
    super(config, soul);
    this.template = template ? this.loadTemplate(template) : null;
    this.enhancedPromptBuilder = new EnhancedPromptBuilder();
    this.mixinComposer = new MixinComposer();
    this.capabilities = this.detectCapabilities();
    this.runtime = new SessionRuntime('.transcripts', this);
    this.zoneContextProvider = zoneContextProvider || DEFAULT_ZONE_PROVIDER;

    // Initialize sub-managers
    this.workflowExecutor = new WorkflowExecutor({
      llm: this.llm,
      getRuntime: () => this.runtime,
      skills: this.skills,
      agentId: this.config.agentId,
    });

    this.reflectionManager = new ReflectionManager({
      llm: this.llm,
      soul: this.enhancedSoul,
      memory: this.memory,
      onEvolutionCheck: () => {
        if (this.enhancedSoul.reflection?.evolutionCheck?.enabled) {
          this.evolutionManager.initEvolution({
            enabled: true,
            triggerThreshold: this.enhancedSoul.reflection.evolutionCheck.triggerThreshold,
            cooldownHours: this.enhancedSoul.reflection.evolutionCheck.cooldownHours,
            maxEvolutionsPerDay: this.enhancedSoul.reflection.evolutionCheck.maxEvolutionsPerDay,
          });
          if (this.evolutionManager.canEvolve()) {
            if (!this.evolutionManager.getPendingEvolutionProposal()) {
              this.evolutionManager.performEvolution().catch((err: unknown) => {
                log('warn', 'Evolution failed', { error: String(err) });
              });
            }
          }
        }
      },
    });

    this.evolutionManager = new EvolutionManager({
      llm: this.llm,
      soul: this.enhancedSoul,
      agentId: this.config.agentId,
      getReflectionHistory: () => this.reflectionManager.getReflectionHistory(),
      clearReflectionHistory: () => this.reflectionManager.clearReflectionHistory(),
      addMemoryEntry: (content, importance) => this.reflectionManager.addMemoryEntry(content, importance),
    });
  }

  /**
   * 加载模板
   */
  loadTemplate(template: AgentTemplate): AgentTemplate {
    // 应用 mixin 组合
    if (template.mixins && template.mixins.length > 0) {
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

    // 2. 获取 Zone 上下文（通过注入的 provider，消除硬依赖）
    const zoneContext = await this.zoneContextProvider.getZonePromptContext(this.config.agentId);

    // 3. 获取历史消息
    const recentMessages = await this.buildRecentMessages(options?.sessionId);

    // 4. 构建增强提示词
    const systemMessages = this.enhancedPromptBuilder.buildFullSystemPrompt(
      this.template,
      this.enhancedSoul,
      this.memory.buildContext(),
      this.skills.getEnabledSkills(),
      recentMessages,
      { includeReflection, includeWorkflow, includeLearnedSkills: true, includeZoneContext: true, zoneContext },
      this.memory.buildSkillContext()
    );

    // 5. 解析或创建会话
    const session = await this.resolveSession(options?.sessionId);
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
    if (includeReflection && this.enhancedSoul.reflection?.afterEachTask) {
      try {
        await this.performReflection(message, turnResult.response);
        response.reflectionUsed = true;
      } catch (err: unknown) {
        log('warn', 'Reflection failed', { error: String(err) });
      }
    }

    return response;
  }

  /**
   * 从 SessionRuntime 构建最近的历史消息列表
   */
  private async buildRecentMessages(sessionId?: string): Promise<AgentChatMessage[]> {
    const recentMessages: AgentChatMessage[] = [];
    if (!sessionId) return recentMessages;

    const sess = await this.runtime.getSession(sessionId);
    if (!sess) return recentMessages;

    for (const m of sess.messages.slice(-DEFAULT_RECENT_MESSAGE_COUNT)) {
      recentMessages.push({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
      });
    }
    return recentMessages;
  }

  /**
   * 获取现有会话或创建新会话
   */
  private async resolveSession(sessionId?: string): Promise<SessionContext> {
    if (sessionId) {
      const existingSession = await this.runtime.getSession(sessionId);
      if (existingSession) {
        return existingSession;
      }
    }
    return this.runtime.createSession(this.config.agentId);
  }

  /**
   * Execute agent turn using enhanced prompt from session memory.
   * SessionRuntime calls this method to execute each turn.
   */
  public async executeAgentTurn(
    session: SessionContext,
    message: string,
    timeout: number,
    signal?: AbortSignal
  ): Promise<{ response: string; usage: TokenUsage }> {
    // Retrieve enhanced context stored by chat()
    const enhancedPrompt = session.memory.get('enhancedPrompt') as AgentChatMessage[] | undefined;
    const recentMessages = session.memory.get('recentMessages') as AgentChatMessage[] | undefined;

    const generatePromise = (promptMessages: AgentChatMessage[]): Promise<{ response: string; usage: TokenUsage }> =>
      this.llm.generate(promptMessages).then(result => ({
        response: result.content,
        usage: {
          promptTokens: result.usage?.promptTokens ?? 0,
          completionTokens: result.usage?.completionTokens ?? 0,
          totalTokens: result.usage?.totalTokens ?? 0,
          turnCount: 1,
        },
      }));

    if (!enhancedPrompt) {
      // Fallback: simple response without enhanced prompt
      const result = await this.raceWithTimeout(generatePromise([{ role: 'user', content: message }]), timeout, signal);
      return result;
    }

    // Build messages array with system prompt + recent history + current message
    const messages: AgentChatMessage[] = [
      ...enhancedPrompt,
      ...(recentMessages || []),
      { role: 'user', content: message },
    ];

    // Call LLM with timeout and abort signal
    const result = await this.raceWithTimeout(generatePromise(messages), timeout, signal);
    return result;
  }

  // ============================================
  // Workflow delegation
  // ============================================

  /**
   * 匹配工作流
   */
  private matchWorkflow(message: string): WorkflowDefinition | null {
    return this.workflowExecutor.matchWorkflow(message, this.template);
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
    const result = await this.workflowExecutor.executeWorkflow(workflow, initialMessage, options);
    this.currentSessionId = result.sessionId;
    return result;
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
    return this.workflowExecutor.executeWorkflowStep(step, context, options);
  }

  /**
   * 处理工作流错误
   */
  private async handleWorkflowError(step: WorkflowStep, context: string): Promise<string> {
    return this.workflowExecutor.handleWorkflowError(step, context);
  }

  // ============================================
  // Reflection delegation
  // ============================================

  /**
   * 反思机制
   */
  private async performReflection(task: string, result: string): Promise<void> {
    return this.reflectionManager.performReflection(task, result);
  }

  /**
   * 自我纠正
   */
  private async selfCorrect(task: string, result: string, reflection: string): Promise<void> {
    return this.reflectionManager.selfCorrect(task, result, reflection);
  }

  /**
   * 总结反思历史
   */
  private async summarizeReflections(): Promise<string> {
    return this.reflectionManager.summarizeReflections();
  }

  /**
   * 添加长期记忆
   */
  private async addMemoryEntry(content: string, importance: 1 | 2 | 3 = 2): Promise<void> {
    return this.reflectionManager.addMemoryEntry(content, importance);
  }

  /**
   * 获取反思历史
   */
  getReflectionHistory(): ReflectionEntry[] {
    return this.reflectionManager.getReflectionHistory();
  }

  /**
   * 获取记忆条目
   */
  getMemoryEntries(): MemoryEntry[] {
    return this.reflectionManager.getMemoryEntries();
  }

  /**
   * 清空反思历史
   */
  clearReflectionHistory(): void {
    this.reflectionManager.clearReflectionHistory();
  }

  /**
   * 清空记忆
   */
  clearMemory(): void {
    this.reflectionManager.clearMemory();
  }

  // ============================================
  // Lifecycle
  // ============================================

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
      } catch (err: unknown) {
        log('warn', 'Failed to destroy session on stop', { error: String(err) });
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
      } catch (err: unknown) {
        log('warn', 'Failed to destroy session on cleanup', { error: String(err) });
      }
      this.currentSessionId = null;
    }
  }

  /**
   * Graceful shutdown - stops polling, destroys sessions, and disposes runtime.
   */
  async dispose(): Promise<void> {
    await this.stop();
    this.runtime.dispose();
  }

  /**
   * Health check for the enhanced agent and its subsystems.
   */
  isHealthy(): boolean {
    return !this.shouldStop && this.runtime.isHealthy();
  }

  private shouldStop = false;

  /**
   * Race a promise against a timeout and optional abort signal.
   */
  private async raceWithTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    signal?: AbortSignal
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timerPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Agent turn timed out after ${timeout}ms`)), timeout);
    });
    if (signal) {
      let abortHandler: (() => void) | undefined;
      const abortPromise = new Promise<never>((_, reject) => {
        abortHandler = () => reject(new Error('Agent turn aborted'));
        signal.addEventListener('abort', abortHandler, { once: true });
      });
      try {
        return await Promise.race([promise, timerPromise, abortPromise]);
      } finally {
        clearTimeout(timer);
        if (abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      }
    }
    try {
      return await Promise.race([promise, timerPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

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

  private getTaskQueueService(): TaskQueueService {
    return TaskQueueService.getInstance();
  }

  /**
   * Start polling for tasks assigned to this agent
   * Uses TaskQueueService via REST API to fetch pending tasks
   */
  async startTaskPolling(intervalMs: number = DEFAULT_TASK_POLL_INTERVAL_MS): Promise<void> {
    if (this.taskPollInterval) {
      log('warn', 'Task polling already running', { agentId: this.config.agentId });
      return;
    }

    log('info', 'Starting task polling', { agentId: this.config.agentId, intervalMs });

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
      log('info', 'Task polling stopped', { agentId: this.config.agentId });
    }
  }

  /**
   * Internal method to poll tasks from TaskQueueService
   */
  private async pollTasksInternal(): Promise<void> {
    if (this.shouldStop) return;

    try {
      const taskQueue = this.getTaskQueueService();
      const tasks: TaskItem[] = await taskQueue.getTasksByAgent(this.config.agentId);

      if (tasks.length > 0) {
        this.pendingTasks = tasks.map((t) => ({
          taskId: t.taskId,
          zoneId: t.zoneId,
          name: t.name,
          description: t.description,
          type: t.type,
          priority: t.priority,
        }));

        log('info', 'Polled pending tasks', { agentId: this.config.agentId, count: tasks.length });
      }
    } catch (error) {
      log('error', 'Task polling error', { agentId: this.config.agentId, error: String(error) });
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
      const taskQueue = this.getTaskQueueService();

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
      log('error', 'Failed to complete task', { agentId: this.config.agentId, taskId, error: String(error) });
      return false;
    }
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
  getTranscript(limit: number = DEFAULT_TRANSCRIPT_LIMIT): RuntimeChatMessage[] {
    if (!this.currentSessionId) return [];
    return this.runtime.getRecentMessages(this.currentSessionId, limit);
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
  // Evolution delegation
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
    this.evolutionManager.initEvolution(config);
  }

  /**
   * 设置进化提议回调
   */
  setEvolutionProposalCallback(callback: (proposal: EvolutionProposal) => Promise<boolean>): void {
    this.evolutionManager.setEvolutionProposalCallback(callback);
  }

  /**
   * 检查是否可以进行进化
   */
  private canEvolve(): boolean {
    return this.evolutionManager.canEvolve();
  }

  /**
   * 执行进化
   */
  async performEvolution(): Promise<EvolutionResult> {
    return this.evolutionManager.performEvolution();
  }

  /**
   * 应用进化（用户确认后调用）
   */
  async applyEvolution(proposal: EvolutionProposal): Promise<EvolutionResult> {
    return this.evolutionManager.applyEvolution(proposal);
  }

  /**
   * 获取待确认的进化提议
   */
  getPendingEvolutionProposal(): EvolutionProposal | null {
    return this.evolutionManager.getPendingEvolutionProposal();
  }

  /**
   * 确认进化提议
   */
  async confirmEvolution(proposal: EvolutionProposal): Promise<EvolutionResult> {
    return this.evolutionManager.confirmEvolution(proposal);
  }

  /**
   * 拒绝进化提议
   */
  rejectEvolution(proposal: EvolutionProposal): void {
    this.evolutionManager.rejectEvolution(proposal);
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
    return this.evolutionManager.getEvolutionStatus();
  }

  /**
   * 重置进化熔断
   */
  resetEvolutionCircuitBreaker(): void {
    this.evolutionManager.resetEvolutionCircuitBreaker();
  }

  /**
   * 重置每日进化计数
   */
  resetDailyEvolutionCount(): void {
    this.evolutionManager.resetDailyEvolutionCount();
  }
}

export default EnhancedStratixAgent;
