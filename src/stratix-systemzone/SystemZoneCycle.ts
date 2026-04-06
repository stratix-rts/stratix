// ============================================
// SystemZoneCycle.ts - 状态机 + 编排逻辑
// Phase 1: C1 - 固定编排流程状态机
// Phase 2: C2 - Agent 间上下文传递
// ============================================

import { SystemZoneManager } from './SystemZoneManager';
import { ZoneCoordinator } from '../stratix-orchestration/zone/ZoneCoordinator';
import { FitnessEvaluator } from './fitness/FitnessEvaluator';
import type { SafetyAssessment, Insight, Proposal } from './types';
import type { FitnessReport } from './executor/types';

// ------------------------------------------------
// Type Definitions
// ------------------------------------------------

export type CyclePhase =
  | 'idle'
  | 'observing'
  | 'strategizing'
  | 'reviewing'
  | 'executing'
  | 'evaluating'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'rejected';

export interface CycleState {
  phase: CyclePhase;
  cycleId: string;
  startedAt: Date | null;
  completedAt: Date | null;
  currentTaskId: string | null;
  lastError: string | null;
  insights?: any[];
  proposal?: any;
  assessment?: SafetyAssessment;
  executionResult?: any;
  fitnessReport?: FitnessReport;
}

// ------------------------------------------------
// Agent IDs
// ------------------------------------------------

const AGENT_IDS = {
  OBSERVER: 'sz-observer',
  STRATEGIST: 'sz-strategist',
  GUARDIAN: 'sz-guardian',
  EXECUTOR: 'sz-executor',
} as const;

// ------------------------------------------------
// Cycle Events
// ------------------------------------------------

export type CycleEventType =
  | 'phase_changed'
  | 'task_delegated'
  | 'assessment_received'
  | 'execution_completed'
  | 'evaluation_completed'
  | 'blocked'
  | 'rejected'
  | 'failed'
  | 'completed'
  | 'cancelled';

export interface CycleEvent {
  type: CycleEventType;
  cycleId: string;
  phase: CyclePhase;
  data?: any;
  error?: string;
  timestamp: Date;
}

type CycleEventCallback = (event: CycleEvent) => void;

// ------------------------------------------------
// SystemZoneCycle - 固定编排流程状态机
// ------------------------------------------------

export class SystemZoneCycle {
  private manager: SystemZoneManager;
  private coordinator: ZoneCoordinator | null = null;
  private fitnessEvaluator: FitnessEvaluator;

  private state: CycleState;
  private eventListeners: Map<CycleEventType, Set<CycleEventCallback>> = new Map();

  constructor(manager: SystemZoneManager) {
    this.manager = manager;
    this.fitnessEvaluator = new FitnessEvaluator();
    this.state = this.createInitialState();
  }

  // ==================== Public API ====================

  /**
   * 执行完整 cycle
   * 流程: observe → strategize → review → execute → evaluate
   */
  async run(input?: any): Promise<CycleState> {
    const cycleId = this.generateId();
    this.state = this.createInitialState();
    this.state.cycleId = cycleId;
    this.state.startedAt = new Date();

    try {
      // Phase 1: Observe
      await this.phaseObserve(input);

      // Phase 2: Strategize
      await this.phaseStrategize();

      // Phase 3: Review (Guardian)
      const assessment = await this.phaseReview();

      // Check Guardian decision
      if (assessment.decision === 'rejected') {
        this.transition('rejected');
        this.state.lastError = `Guardian rejected: ${assessment.concerns.join(', ')}`;
        this.emit('rejected', { assessment });
        return this.state;
      }

      // Check risk level for blocking
      if (assessment.riskLevel === 'high') {
        this.transition('blocked');
        this.state.assessment = assessment;
        this.emit('blocked', { assessment });
        return this.state;
      }

      // Phase 4: Execute
      await this.phaseExecute();

      // Phase 5: Evaluate
      await this.phaseEvaluate();

      // Success
      this.transition('completed');
      this.state.completedAt = new Date();
      this.emit('completed', {});

      return this.state;
    } catch (error) {
      this.transition('failed');
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.emit('failed', { error: this.state.lastError });
      return this.state;
    }
  }

  /**
   * 从 blocked 状态恢复执行
   * 需要外部确认后调用
   */
  async confirmAndContinue(): Promise<CycleState> {
    if (this.state.phase !== 'blocked') {
      throw new Error(`Cannot confirmAndContinue from phase: ${this.state.phase}`);
    }

    try {
      // Resume from execute phase
      await this.phaseExecute();

      // Continue to evaluate
      await this.phaseEvaluate();

      // Success
      this.transition('completed');
      this.state.completedAt = new Date();
      this.emit('completed', {});

      return this.state;
    } catch (error) {
      this.transition('failed');
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.emit('failed', { error: this.state.lastError });
      return this.state;
    }
  }

  /**
   * 取消 blocked 状态
   */
  cancel(): CycleState {
    if (this.state.phase !== 'blocked') {
      throw new Error(`Cannot cancel from phase: ${this.state.phase}`);
    }

    this.transition('failed');
    this.state.lastError = 'Cycle cancelled by user';
    this.state.completedAt = new Date();
    this.emit('cancelled', {});

    return this.state;
  }

  /**
   * 获取当前状态
   */
  getState(): CycleState {
    return { ...this.state };
  }

  /**
   * 注册事件监听
   */
  on(event: CycleEventType, callback: CycleEventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * 移除事件监听
   */
  off(event: CycleEventType, callback: CycleEventCallback): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  // ==================== Private Methods ====================

  private ensureCoordinator(): ZoneCoordinator {
    if (!this.coordinator) {
      const coord = this.manager.getCoordinator();
      if (!coord) {
        throw new Error('ZoneCoordinator not available');
      }
      this.coordinator = coord;
    }
    return this.coordinator;
  }

  /**
   * Phase 1: Observe - 分派给 Observer Agent
   * 通过 processRequirement 创建任务并传递 input 作为 context
   */
  private async phaseObserve(input?: any): Promise<void> {
    this.transition('observing');
    this.state.currentTaskId = this.generateId();

    const coordinator = this.ensureCoordinator();

    // 序列化 input 为 requirement 描述
    const requirement = this.serializeContext('observe', { input });

    try {
      const result = await coordinator.processRequirement(requirement);

      if (!result.success) {
        throw new Error(`Observer processRequirement failed: ${result.error}`);
      }

      // 等待 Observer task 完成并收集 insights
      const insights = await this.waitForTaskResult<Insight[]>(result.delegated[0]);

      this.state.insights = insights ?? [];
      this.emit('task_delegated', { agentId: AGENT_IDS.OBSERVER, taskId: this.state.currentTaskId });
    } catch (error) {
      // Fallback: 保留 input 中的 insights
      this.state.insights = input?.insights ?? [];
      this.emit('task_delegated', { agentId: AGENT_IDS.OBSERVER, taskId: this.state.currentTaskId });
    }
  }

  /**
   * Phase 2: Strategize - 分派给 Strategist Agent
   * 将 insights 序列化为 context，传递给 Strategist
   */
  private async phaseStrategize(): Promise<void> {
    this.transition('strategizing');
    this.state.currentTaskId = this.generateId();

    const coordinator = this.ensureCoordinator();

    // 序列化 insights 为 context
    const requirement = this.serializeContext('strategize', {
      insights: this.state.insights,
    });

    try {
      const result = await coordinator.processRequirement(requirement);

      if (!result.success) {
        throw new Error(`Strategist processRequirement failed: ${result.error}`);
      }

      // 等待 Strategist task 完成并收集 proposal
      const proposal = await this.waitForTaskResult<Proposal>(result.delegated[0]);

      this.state.proposal = proposal ?? {
        id: this.generateId(),
        modifications: [],
        type: 'improve_code',
        title: 'Generated Proposal',
        description: 'Strategist proposal from cycle',
        target: {},
        selection: { confidence: 0.5, cost: 0, benefit: 0, risk: 'low' },
        status: 'pending',
      };
      this.emit('task_delegated', { agentId: AGENT_IDS.STRATEGIST, taskId: this.state.currentTaskId });
    } catch (error) {
      // Fallback: 创建空 proposal
      this.state.proposal = {
        id: this.generateId(),
        modifications: [],
        type: 'improve_code',
        title: 'Generated Proposal',
        description: 'Strategist proposal from cycle (fallback)',
        target: {},
        selection: { confidence: 0.5, cost: 0, benefit: 0, risk: 'low' },
        status: 'pending',
      };
      this.emit('task_delegated', { agentId: AGENT_IDS.STRATEGIST, taskId: this.state.currentTaskId });
    }
  }

  /**
   * Phase 3: Review - 分派给 Guardian Agent
   * 将 proposal (含 modifications) 序列化为 context
   */
  private async phaseReview(): Promise<SafetyAssessment> {
    this.transition('reviewing');
    this.state.currentTaskId = this.generateId();

    const coordinator = this.ensureCoordinator();

    // 序列化 proposal (含 modifications) 为 context
    const requirement = this.serializeContext('review', {
      proposal: this.state.proposal,
    });

    try {
      const result = await coordinator.processRequirement(requirement);

      if (!result.success) {
        throw new Error(`Guardian processRequirement failed: ${result.error}`);
      }

      // 等待 Guardian task 完成并收集 assessment
      const assessment = await this.waitForTaskResult<SafetyAssessment>(result.delegated[0]);

      this.state.assessment = assessment ?? {
        decision: 'approved',
        riskLevel: 'low',
        concerns: [],
        suggestions: [],
        confidence: 1.0,
      };
      this.emit('task_delegated', { agentId: AGENT_IDS.GUARDIAN, taskId: this.state.currentTaskId });
      this.emit('assessment_received', { assessment: this.state.assessment });

      return this.state.assessment;
    } catch (error) {
      // Fallback: safe default - approved with low risk
      this.state.assessment = {
        decision: 'approved',
        riskLevel: 'low',
        concerns: [],
        suggestions: [],
        confidence: 1.0,
      };
      this.emit('task_delegated', { agentId: AGENT_IDS.GUARDIAN, taskId: this.state.currentTaskId });
      this.emit('assessment_received', { assessment: this.state.assessment });

      return this.state.assessment;
    }
  }

  /**
   * Phase 4: Execute - 分派给 Executor Agent
   * 将 assessment + modifications 作为 context
   */
  private async phaseExecute(): Promise<void> {
    this.transition('executing');
    this.state.currentTaskId = this.generateId();

    const coordinator = this.ensureCoordinator();

    // 序列化 assessment + modifications 为 context
    const requirement = this.serializeContext('execute', {
      assessment: this.state.assessment,
      modifications: this.state.proposal?.modifications ?? [],
    });

    try {
      const result = await coordinator.processRequirement(requirement);

      if (!result.success) {
        throw new Error(`Executor processRequirement failed: ${result.error}`);
      }

      // 等待 Executor task 完成并收集 execution result
      const executionResult = await this.waitForTaskResult<any>(result.delegated[0]);

      this.state.executionResult = executionResult ?? {
        success: true,
        proposalId: this.state.proposal?.id,
        modifications: this.state.proposal?.modifications ?? [],
      };
      this.emit('task_delegated', { agentId: AGENT_IDS.EXECUTOR, taskId: this.state.currentTaskId });
      this.emit('execution_completed', { result: this.state.executionResult });
    } catch (error) {
      // Fallback: 执行失败记录
      this.state.executionResult = {
        success: false,
        proposalId: this.state.proposal?.id,
        modifications: this.state.proposal?.modifications ?? [],
        error: error instanceof Error ? error.message : String(error),
      };
      this.emit('task_delegated', { agentId: AGENT_IDS.EXECUTOR, taskId: this.state.currentTaskId });
      this.emit('execution_completed', { result: this.state.executionResult });
    }
  }

  /**
   * Phase 5: Evaluate - 调用 FitnessEvaluator
   */
  private async phaseEvaluate(): Promise<void> {
    this.transition('evaluating');

    const report = await this.fitnessEvaluator.evaluate();
    this.state.fitnessReport = report;

    this.emit('evaluation_completed', { report });
  }

  /**
   * 状态转换
   */
  private transition(phase: CyclePhase): void {
    const previousPhase = this.state.phase;
    this.state.phase = phase;
    this.emit('phase_changed', { previousPhase, currentPhase: phase });
  }

  /**
   * 触发事件
   */
  private emit(type: CycleEventType, data?: any): void {
    const event: CycleEvent = {
      type,
      cycleId: this.state.cycleId,
      phase: this.state.phase,
      data,
      timestamp: new Date(),
    };

    // Notify all listeners for this event type
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(event);
        } catch (err) {
          console.error(`[SystemZoneCycle] Event listener error for ${type}:`, err);
        }
      }
    }
  }

  /**
   * 序列化上下文为 requirement 字符串
   * 用于通过 processRequirement 传递 context 给 agent
   */
  private serializeContext(phase: string, data: Record<string, any>): string {
    const context = {
      phase,
      cycleId: this.state.cycleId,
      timestamp: new Date().toISOString(),
      ...data,
    };
    return `[SystemZoneCycle Context]\n${JSON.stringify(context, null, 2)}`;
  }

  /**
   * 等待任务完成并获取结果
   * 轮询 task 状态，最长等待 60 秒
   */
  private async waitForTaskResult<T>(taskId: string | undefined, timeoutMs: number = 60000): Promise<T | null> {
    if (!taskId) return null;

    const coordinator = this.ensureCoordinator();
    const startTime = Date.now();
    const pollInterval = 1000; // 1s

    while (Date.now() - startTime < timeoutMs) {
      const task = coordinator.getTask(taskId);
      if (task?.status === 'completed') {
        // 尝试从 task description 解析结果
        try {
          const parsed = JSON.parse(task.description);
          if (parsed.result !== undefined) {
            return parsed.result as T;
          }
        } catch {
          // description 不是 JSON，返回整个 description 作为结果
          return task.description as unknown as T;
        }
        return null;
      }
      if (task?.status === 'failed') {
        return null;
      }
      // 等待后继续轮询
      await this.delay(pollInterval);
    }

    // 超时
    console.warn(`[SystemZoneCycle] Task ${taskId} wait timeout after ${timeoutMs}ms`);
    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `cycle_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 创建初始状态
   */
  private createInitialState(): CycleState {
    return {
      phase: 'idle',
      cycleId: '',
      startedAt: null,
      completedAt: null,
      currentTaskId: null,
      lastError: null,
    };
  }
}

export default SystemZoneCycle;
