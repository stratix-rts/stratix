// ============================================
// SystemZoneCycle.ts — System Zone 编排状态机
// observe → strategize → review → execute → evaluate
// ============================================

import { generateId } from '../stratix-project/utils/helpers';
import type { SystemZoneManager } from './SystemZoneManager';
import type { SafetyAssessment, SystemZoneFileModification } from './types';
import type { ModificationPlan } from '../stratix-agent/core/SystemZoneSkillExecutor';
import type { FitnessReport } from './fitness/types';

// ------------------------------------------------
// Types
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
  | 'blocked';

export interface CycleState {
  phase: CyclePhase;
  cycleId: string;
  startedAt: number | null;
  completedAt: number | null;
  currentTaskId: string | null;
  lastError: string | null;
  insights?: any[];
  proposal?: ModificationPlan;
  assessment?: SafetyAssessment;
  executionResult?: any;
  fitnessReport?: FitnessReport;
  baselineFitness?: FitnessReport;
}

export interface CycleEvent {
  type: string;
  cycleId: string;
  data?: any;
  timestamp: number;
}

type CycleEventListener = (event: CycleEvent) => void;

// ------------------------------------------------
// SystemZoneCycle
// ------------------------------------------------

export class SystemZoneCycle {
  private state: CycleState;
  private manager: SystemZoneManager;
  private listeners: Map<string, CycleEventListener[]> = new Map();

  constructor(manager: SystemZoneManager) {
    this.manager = manager;
    this.state = this.createInitialState();
  }

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

  /**
   * 执行完整 cycle
   * 固定流程：observe → strategize → review → execute → evaluate
   */
  async run(input?: { content: string; type?: string; source?: string }): Promise<CycleState> {
    this.state = {
      ...this.createInitialState(),
      cycleId: generateId('cycle'),
      startedAt: Date.now(),
    };

    try {
      // 0. 获取 baseline fitness
      this.state.baselineFitness = await this.captureBaseline();

      // 1. Observing
      this.transition('observing');
      this.state.insights = await this.observe(input);

      // 2. Strategizing
      this.transition('strategizing');
      this.state.proposal = await this.strategize(this.state.insights);

      // 3. Reviewing
      this.transition('reviewing');
      this.state.assessment = await this.review(this.state.proposal.modifications);

      // 3b. 检查审查结果
      if (this.state.assessment.decision === 'rejected') {
        this.state.lastError = `Guardian rejected: ${this.state.assessment.concerns.join(', ')}`;
        this.transition('failed');
        return this.state;
      }

      if (this.state.assessment.riskLevel === 'high') {
        this.transition('blocked');
        this.emit('blocked', {
          proposal: this.state.proposal,
          assessment: this.state.assessment,
        });
        return this.state;
      }

      // 4. Executing
      this.transition('executing');
      this.state.executionResult = await this.execute(this.state.proposal.modifications);

      // 5. Evaluating
      this.transition('evaluating');
      this.state.fitnessReport = await this.evaluate();

      this.state.completedAt = Date.now();
      this.transition('completed');
    } catch (err: any) {
      this.state.lastError = err.message ?? String(err);
      this.transition('failed');
      this.emit('error', { error: this.state.lastError });
    }

    return this.state;
  }

  /**
   * 用户确认后继续（从 blocked 恢复）
   */
  async confirmAndContinue(): Promise<CycleState> {
    if (this.state.phase !== 'blocked') {
      throw new Error('Not in blocked state');
    }

    try {
      this.transition('executing');
      this.state.executionResult = await this.execute(this.state.proposal!.modifications);

      this.transition('evaluating');
      this.state.fitnessReport = await this.evaluate();

      this.state.completedAt = Date.now();
      this.transition('completed');
    } catch (err: any) {
      this.state.lastError = err.message ?? String(err);
      this.transition('failed');
    }

    return this.state;
  }

  /**
   * 用户拒绝后取消
   */
  cancel(): void {
    if (this.state.phase !== 'blocked') {
      throw new Error('Not in blocked state');
    }
    this.state.lastError = 'Cancelled by user';
    this.transition('failed');
    this.emit('cancelled', {});
  }

  getState(): CycleState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return !['idle', 'completed', 'failed', 'blocked'].includes(this.state.phase);
  }

  // ---- Event Emitter ----

  on(event: string, listener: CycleEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  off(event: string, listener: CycleEventListener): void {
    const list = this.listeners.get(event);
    if (list) {
      this.listeners.set(event, list.filter(l => l !== listener));
    }
  }

  // ---- Private: Phase Implementations ----

  private async observe(input?: { content: string; type?: string; source?: string }): Promise<any[]> {
    const agents = this.manager.getAgents();
    const insights: any[] = [];

    // 如果有外部输入，先让 Observer 处理
    if (input?.content) {
      const result = await agents.observer!.executeSkill('observe_input', {
        content: input.content,
        source: input.source ?? 'user',
        type: input.type ?? 'text',
      });
      if (result.success && result.result) {
        insights.push(...(Array.isArray(result.result) ? result.result : [result.result]));
      }
    }

    // 扫描项目获取结构化数据
    const scanResult = await agents.observer!.executeSkill('scan_project', {});
    if (scanResult.success && scanResult.result) {
      insights.push({
        type: 'scan_result',
        content: 'Project scan completed',
        scanResult: scanResult.result,
      });
    }

    return insights;
  }

  private async strategize(insights: any[]): Promise<ModificationPlan> {
    const agents = this.manager.getAgents();

    // 提取 scanResult（如果有）
    const scanInsight = insights.find(i => i.type === 'scan_result');
    const otherInsights = insights.filter(i => i.type !== 'scan_result');

    const result = await agents.strategist!.executeSkill('generate_modifications', {
      insights: otherInsights,
      scanResult: scanInsight?.scanResult,
    });

    if (!result.success) {
      throw new Error(`Strategist failed: ${result.error ?? 'unknown error'}`);
    }

    return result.result as ModificationPlan;
  }

  private async review(modifications: SystemZoneFileModification[]): Promise<SafetyAssessment> {
    const agents = this.manager.getAgents();

    const result = await agents.guardian!.executeSkill('review_modifications', {
      modifications,
    });

    if (!result.success) {
      throw new Error(`Guardian failed: ${result.error ?? 'unknown error'}`);
    }

    return result.result as SafetyAssessment;
  }

  private async execute(modifications: SystemZoneFileModification[]): Promise<any> {
    const agents = this.manager.getAgents();
    const projectPath = process.cwd();
    const results: any[] = [];

    for (const mod of modifications) {
      if (mod.type === 'edit' && mod.diff) {
        // 验证 diff
        const validateResult = await agents.executor!.executeSkill('validate_diff', {
          workDir: projectPath,
          diff: mod.diff,
        });
        if (!validateResult.success || !validateResult.result?.valid) {
          throw new Error(
            `Diff validation failed for ${mod.path}: ${validateResult.result?.errors?.join(', ')}`
          );
        }

        // 应用 diff
        const applyResult = await agents.executor!.executeSkill('apply_diff', {
          workDir: projectPath,
          diff: mod.diff,
        });
        if (!applyResult.success || !applyResult.result?.success) {
          throw new Error(
            `Diff apply failed for ${mod.path}: ${applyResult.result?.errors?.join(', ')}`
          );
        }

        results.push({ path: mod.path, applied: true });
      }
      // create / delete / rename 可以在后续 task 扩展
    }

    return { modifications: results };
  }

  private async evaluate(): Promise<FitnessReport | undefined> {
    // C3: 评估执行后的 fitness，与 baseline 对比
    try {
      const { FitnessEvaluator } = await import('./fitness/FitnessEvaluator');
      const evaluator = new FitnessEvaluator();
      const report = await evaluator.evaluate();

      // 对比 baseline：如果 overall score 下降，触发回滚
      if (this.state.baselineFitness) {
        const baselineScore = this.state.baselineFitness.scores.overall;
        const currentScore = report.scores.overall;

        if (currentScore < baselineScore) {
          // 变差了，自动回滚
          await this.rollbackModifications();
          this.state.lastError = `Fitness degraded: ${baselineScore} → ${currentScore}. Rolled back.`;
        }
      }

      return report;
    } catch {
      // FitnessEvaluator 不可用时静默跳过
      return undefined;
    }
  }

  private async captureBaseline(): Promise<FitnessReport | undefined> {
    // C3: 在 cycle 开始前捕获 baseline
    try {
      const { FitnessEvaluator } = await import('./fitness/FitnessEvaluator');
      const evaluator = new FitnessEvaluator();
      return await evaluator.evaluate();
    } catch {
      return undefined;
    }
  }

  /**
   * 回滚当前 cycle 的所有 modifications
   */
  private async rollbackModifications(): Promise<void> {
    const modifications = this.state.proposal?.modifications;
    if (!modifications) return;

    const agents = this.manager.getAgents();
    const projectPath = process.cwd();

    for (const mod of modifications) {
      if (mod.diff) {
        try {
          await agents.executor!.executeSkill('rollback', {
            workDir: projectPath,
            diff: mod.diff,
          });
        } catch {
          // Best effort: continue rolling back other modifications
        }
      }
    }
  }

  // ---- Private: State Machine ----

  private transition(phase: CyclePhase): void {
    const from = this.state.phase;
    this.state.phase = phase;
    this.emit('phase_changed', { from, to: phase });
  }

  private emit(type: string, data?: any): void {
    const event: CycleEvent = {
      type,
      cycleId: this.state.cycleId,
      data,
      timestamp: Date.now(),
    };
    const list = this.listeners.get(type) ?? [];
    for (const listener of list) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break cycle
      }
    }
  }
}
