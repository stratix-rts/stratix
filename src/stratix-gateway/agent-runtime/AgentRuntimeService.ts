/**
 * AgentRuntimeService - 管理 StratixAgent 的生命周期和任务执行
 *
 * 当 Agent 加入 Zone 时：
 * 1. 创建 EnhancedStratixAgent 实例
 * 2. 启动 task polling
 * 3. 从 TaskQueue 认领任务 → 调 LLM 执行 → 上报结果
 */

import { EnhancedStratixAgent } from '../../stratix-agent/EnhancedStratixAgent';
import { agentRepository } from '../../stratix-database';
import type { TaskItem } from '../../stratix-orchestration/task-queue/TaskItem';
import { TaskQueueService } from '../../stratix-orchestration/task-queue/TaskQueueService';
import ZoneCoordinatorEventEmitter from '../../stratix-orchestration/zone/ZoneCoordinatorEvents';

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[AgentRuntime] ${message}`, ctx || '');
}

const TASK_POLL_INTERVAL_MS = 3000;      // 3 秒轮询一次
const TASK_EXECUTE_TIMEOUT_MS = 120000;  // 单任务执行超时 2 分钟

interface RuntimeEntry {
  agent: EnhancedStratixAgent;
  agentId: string;
  zoneId: string;
  pollTimer: NodeJS.Timeout;
  busy: boolean;    // 正在执行任务
  stopping: boolean; // 正在停止，避免执行期间被重复操作
  currentExecution?: Promise<void>; // 当前正在执行的任务 promise
}

export class AgentRuntimeService {
  private static instance: AgentRuntimeService;
  private runtimes: Map<string, RuntimeEntry> = new Map();  // agentId → entry

  private constructor() {}

  static getInstance(): AgentRuntimeService {
    if (!AgentRuntimeService.instance) {
      AgentRuntimeService.instance = new AgentRuntimeService();
    }
    return AgentRuntimeService.instance;
  }

  /**
   * 启动一个 Agent runtime（Agent 加入 Zone 时调用）
   */
  async startAgent(agentId: string, zoneId: string): Promise<boolean> {
    // 已经在跑了就跳过
    if (this.runtimes.has(agentId)) {
      const existing = this.runtimes.get(agentId)!;
      if (existing.zoneId === zoneId) {
        log('info', `Agent ${agentId} already running in zone ${zoneId}`);
        return true;
      }
      // 换了 Zone，先停旧的
      await this.stopAgent(agentId);
    }

    // 从数据库读 Agent 配置
    const agentConfig = agentRepository.getAgent(agentId);
    if (!agentConfig) {
      log('error', `Agent ${agentId} not found in database`);
      return false;
    }

    // 解析 stratixConfig
    const stratixConfig = agentConfig.stratixConfig;
    const provider = this.normalizeProvider(stratixConfig?.provider || 'openai');
    const model = stratixConfig?.model || 'gpt-4o-mini';
    const apiKey = stratixConfig?.apiKey || process.env.OPENAI_API_KEY || '';
    const endpoint = stratixConfig?.endpoint || this.defaultEndpoint(provider);

    if (!apiKey && provider !== 'ollama') {
      log('warn', `No API key for agent ${agentId}, provider ${provider}`);
    }

    try {
      const agent = new EnhancedStratixAgent(
        {
          agentId,
          name: agentConfig.name || agentId,
          type: 'custom',
          provider: provider as any,
          model,
          apiKey,
          endpoint,
          temperature: 0.7,
          maxTokens: 4096,
          maxShortTerm: 20,
          enableLongTerm: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          identity: `你是 ${agentConfig.name || agentId}，一个在 Zone 中执行任务的 AI Agent。`,
          goals: ['高效完成分配的任务'],
          personality: '专注、高效、准确',
        }
      );

      await agent.initialize();
      agent.startBackgroundTasks();

      const entry: RuntimeEntry = {
        agent,
        agentId,
        zoneId,
        pollTimer: setInterval(() => this.pollAndExecute(agentId), TASK_POLL_INTERVAL_MS),
        busy: false,
        stopping: false,
      };

      this.runtimes.set(agentId, entry);
      log('info', `Agent ${agentId} started in zone ${zoneId}`, { provider, model });

      // 立即尝试认领一个任务
      setImmediate(() => this.pollAndExecute(agentId));

      return true;
    } catch (error) {
      log('error', `Failed to start agent ${agentId}`, { error: String(error) });
      return false;
    }
  }

  /**
   * 停止一个 Agent runtime（Agent 离开 Zone 时调用）
   */
  async stopAgent(agentId: string): Promise<void> {
    const entry = this.runtimes.get(agentId);
    if (!entry) return;

    entry.stopping = true;
    clearInterval(entry.pollTimer);
    entry.agent.stopTaskPolling();

    // 等待当前执行的任务完成，避免 dispose 时竞争
    if (entry.currentExecution) {
      try {
        await entry.currentExecution;
      } catch (err) {
        log('warn', `Agent ${agentId} current execution failed during stop`, { error: String(err) });
      }
    }

    try {
      await entry.agent.dispose();
    } catch (err) {
      log('warn', `Error disposing agent ${agentId}`, { error: String(err) });
    }

    this.runtimes.delete(agentId);
    log('info', `Agent ${agentId} stopped`);
  }

  /**
   * 停止所有 runtime
   */
  async stopAll(): Promise<void> {
    const ids = Array.from(this.runtimes.keys());
    for (const id of ids) {
      await this.stopAgent(id);
    }
  }

  /**
   * 获取运行状态
   */
  getStatus(): { running: number; agents: Array<{ agentId: string; zoneId: string; busy: boolean }> } {
    return {
      running: this.runtimes.size,
      agents: Array.from(this.runtimes.values()).map(e => ({
        agentId: e.agentId,
        zoneId: e.zoneId,
        busy: e.busy,
      })),
    };
  }

  // ==================== 内部逻辑 ====================

  /**
   * 轮询并执行任务
   */
  private async pollAndExecute(agentId: string): Promise<void> {
    const entry = this.runtimes.get(agentId);
    if (!entry || entry.busy || entry.stopping) return;

    const executionPromise = this.doPollAndExecute(agentId, entry);
    entry.currentExecution = executionPromise;

    try {
      await executionPromise;
    } finally {
      entry.currentExecution = undefined;
    }
  }

  private async doPollAndExecute(agentId: string, entry: RuntimeEntry): Promise<void> {
    const taskQueue = TaskQueueService.getInstance();

    try {
      // 1. 先找已分配给该 agent 的任务
      const tasks = await taskQueue.getTasksByAgent(agentId);
      let assignedTask = tasks.find(t => t.status === 'assigned');

      // 2. 如果没有 assigned 的，主动从 Zone 的 pending 池中认领
      if (!assignedTask) {
        const dequeued = await taskQueue.dequeueTask(agentId, entry.zoneId).catch(() => null);
        if (dequeued) {
          assignedTask = dequeued;
          log('info', `Agent ${agentId} claimed pending task: ${dequeued.name}`, { taskId: dequeued.taskId });
        }
      }

      if (!assignedTask) return;

      entry.busy = true;
      log('info', `Agent ${agentId} executing task: ${assignedTask.name}`, { taskId: assignedTask.taskId });

      // 标记为 in_progress
      await taskQueue.updateTask(assignedTask.taskId, { status: 'in_progress' });

      // 构建执行 prompt
      const prompt = this.buildTaskPrompt(assignedTask, entry.zoneId);

      // 调用 Agent 执行
      const result = await Promise.race([
        entry.agent.chat(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Task execution timeout')), TASK_EXECUTE_TIMEOUT_MS)
        ),
      ]);

      // 上报完成
      await taskQueue.updateTask(assignedTask.taskId, {
        status: 'completed',
        result: {
          output: result.response,
          summary: result.response?.slice(0, 200),
        },
      });

      // 通知 ZoneCoordinator
      ZoneCoordinatorEventEmitter.getInstance().emit({
        type: 'task_completed',
        zoneId: entry.zoneId,
        taskId: assignedTask.taskId,
        agentId,
        report: {
          success: true,
          output: result.response,
        },
        timestamp: Date.now(),
      });

      log('info', `Agent ${agentId} completed task: ${assignedTask.name}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log('error', `Agent ${agentId} task execution failed`, { error: errMsg });

      // 尝试标记当前任务为 failed
      try {
        const tasks = await taskQueue.getTasksByAgent(agentId);
        const activeTask = tasks.find(t => t.status === 'in_progress');
        if (activeTask) {
          await taskQueue.updateTask(activeTask.taskId, {
            status: 'failed',
            error: errMsg,
          });

          ZoneCoordinatorEventEmitter.getInstance().emit({
            type: 'task_failed',
            zoneId: entry.zoneId,
            taskId: activeTask.taskId,
            agentId,
            report: { success: false, output: errMsg },
            timestamp: Date.now(),
          });
        }
      } catch (reportErr) {
        log('error', `Failed to report task failure`, { error: String(reportErr) });
      }
    } finally {
      // 如果正在停止，不再更新状态，由 stopAgent 接管清理
      if (!entry.stopping) {
        entry.busy = false;
      }
    }
  }

  /**
   * 构建任务执行 prompt
   */
  private buildTaskPrompt(task: TaskItem, zoneId: string): string {
    return `## 任务
你被分配了以下任务，请直接执行并输出结果。

**任务名称**: ${task.name}
**任务类型**: ${task.type}
**优先级**: ${task.priority}
${task.description ? `**详细描述**: ${task.description}` : ''}

## 要求
1. 直接给出执行结果，不要重复任务描述
2. 如果任务需要分析，给出分析结论
3. 如果任务需要写代码，给出完整代码
4. 如果任务需要调研，给出调研结果摘要

## Zone
Zone ID: ${zoneId}

请开始执行。`;
  }

  // ==================== 工具方法 ====================

  private normalizeProvider(provider: string): string {
    const lower = provider.toLowerCase();
    if (lower.includes('openai')) return 'openai';
    if (lower.includes('anthropic') || lower.includes('claude')) return 'anthropic';
    if (lower.includes('deepseek')) return 'deepseek';
    if (lower.includes('ollama')) return 'ollama';
    if (lower.includes('qwen') || lower.includes('dashscope')) return 'qwen';
    if (lower.includes('minimax')) return 'custom';   // MiniMax 用 openai-compatible API
    if (lower.includes('moonshot') || lower.includes('kimi')) return 'custom';
    return lower;
  }

  private defaultEndpoint(provider: string): string {
    switch (provider) {
      case 'openai': return 'https://api.openai.com/v1';
      case 'anthropic': return 'https://api.anthropic.com/v1';
      case 'deepseek': return 'https://api.deepseek.com/v1';
      case 'ollama': return 'http://localhost:11434';
      case 'qwen': return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      default: return '';
    }
  }
}
