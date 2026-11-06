/**
 * 文件职责：多 agent 流水线**编排器**（task_051）—— 把 PipelineSpec 跑成串行站链：
 *   逐站解析承接人（kind/characterId → 在档角色，无则跳站记 skipped）→ 渲染模板 →
 *   task.assign 指定 targetCharacterId 直达该角色 FIFO → 听该站收尾 → 渲染下一站；
 *   任一站 failed / cancelled → 后续全 skipped + 整线终态 failed；全线走完 → completed。
 * 输入：task manager（建任务，与普通任务共用同一份状态与 FIFO）、core/bus 订阅、
 *   task-service 的 onTaskSettled 回流（组合根接线，全文输出来源）、持久化回调注入件。
 * 输出：PipelineService（runPipeline 端口 + handleTaskSettled 回流口 + feed 实时读数口）。
 * 禁止事项：
 *   1. core 零 IO 铁律的 app 侧对偶：本文件不做 transport / IPC —— 执行在 task-service，
 *      落库经注入回调（persistPipeline / stampTask），组合根换成任何后端都不改这里；
 *   2. 编排态进 WorldState —— ★pipeline 是编排模式不是新实体（core/task/pipeline.ts
 *      架构注）：站序游标 / 各站相位 / 前序全文是本服务的运行期私产（内存 + pipelines 表
 *      + character_tasks.pipeline_id 列），WorldState.tasks 仍是单任务相位的唯一真相；
 *   3. 直接 emit task.* 事件 —— 建任务只经 taskManager.assignTask（状态机发事件，
 *      本服务只听不伪造）；唯一自 发的事件是 pipeline.completed / pipeline.failed 整线
 *      终态（app 发事件与 exp.gained / level.up 同一先例）；
 *   4. exp 双计 —— ★各站照常按**单任务**发 exp（task-service 的 settle 链路），
 *      流水线不额外发 exp.gained（站不是新的经验来源，整线也没有加成 —— 文件头注明）。
 *
 * 收尾信号的两条路（并发安全设计）：
 *   ① 主路 handleTaskSettled：task-service 收尾时回调（record.output 是全文）—— 组合根
 *      把它接进 onTaskSettled。全文优先走这条路（下一站 {{prev_output}} 要全文）。
 *   ② 兜底路 bus task.completed/failed：本服务自订阅总线，微任务延迟结算（事件里的
 *      output 只是摘要）。延迟一拍的原因：manager.completeTask 同步发事件后、settle
 *      回调在同一同步栈里到达 —— 主路先到（全文赢），微任务到时该站已终态、幂等闸直过。
 *      组合根没接主路时（非 Electron dev / 测试）兜底路保命，流水线不会挂着不动。
 *   ③ task.cancelled 无 settle 回流（047 口径：取消没有可回的结果）—— 总线事件同步处理，
 *      整线 failed（原因注明是取消）。同站幂等闸防多路重入。
 *
 * 并发安全：同 characterId 的站任务与普通任务共用同一 FIFO（task-service 每角色并发 1），
 *   编排器不抢队不加塞 —— 「天然排队」；多条流水线可并行跑，互不感知，只在角色队列处汇合。
 *
 * 编排态持久化：每次相位迁移 persistPipeline 一次（pipelines 表，steps JSON 序列化）；
 *   站任务入列时 stampTask 把 pipeline_id 落进 character_tasks（DAO 的 CASE 守卫保证
 *   后续相位快照（不带 pipelineId）不会把它抹掉 —— 见 task-record-dao 文件头）。
 *
 * @since v3.27（task_051）。
 */

import { emitWorldEvent, onWorldEvent, type Unsubscribe } from '../../core/bus';
import type { TaskManager } from '../../core/task';
import {
  renderPipelineStepPrompt,
  resolvePipelineStepCharacter,
  validatePipelineIssue,
  validatePipelineSpec,
  type PipelineSpec,
} from '../../core/task';
import type { CharacterView, WorldEvent, WorldState } from '../../core/types';

import type { TaskPersistRecord } from './task-service';
import { taskEventToRecord } from './task-service';

/** 一站的实时相位（卡片读数词汇；failed 覆盖取消 —— 取消站在卡片上是 ✗，原因注明取消）。 */
export type PipelineStepPhase =
  | 'pending'    // 未到站
  | 'queued'     // 已入列排队
  | 'running'    // 在办（含挂起审批 —— 站还在流程里，卡片口径「在办」）
  | 'completed'  // ✓
  | 'failed'     // ✗（含 cancelled）
  | 'skipped';   // 承接人不在档 / 前站断链 → 跳站

/** 整线终态（pipelines 表 status 列词表；running = 跑站中）。 */
export type PipelineRunStatus = 'running' | 'completed' | 'failed';

/** 面板实时读数的单站形状（hud 侧 PipelineStepCardInput 同构 —— 结构一致即可注入，不跨层 import）。 */
export interface PipelineStepView {
  readonly index: number;
  readonly characterId: string | null;
  readonly characterName: string | null;
  readonly phase: PipelineStepPhase;
  readonly prompt: string;
  readonly taskId: string | null;
}

/** 面板实时读数的整线形状（hud 侧 PipelineCardInput 同构）。 */
export interface PipelineRunView {
  readonly id: string;
  readonly name: string;
  readonly issue: string;
  readonly status: PipelineRunStatus;
  readonly steps: readonly PipelineStepView[];
}

/** 面板注入的实时读数口（agent-panel deps.pipelines；main-screen 透传）。 */
export interface PipelineFeedPort {
  subscribe(listener: () => void): () => void;
  snapshot(): readonly PipelineRunView[] | null;
}

/** pipelines 表行形状（DAO 的 PersistedPipelineRecord 同构，翻译在持久化注入件）。 */
export interface PipelinePersistRecord {
  readonly id: string;
  readonly name: string;
  readonly issue: string;
  readonly status: PipelineRunStatus;
  /** 站态 JSON（[{characterId,taskId,phase,prompt}] —— 落库层的序列化形状，读的人能对账）。 */
  readonly steps: string;
  readonly createdAt: number;
  readonly finishedAt: number | null;
}

export interface PipelineService {
  /** runtime 端口（HudCommand pipeline.start 的落点）：跑一条流水线，返回流水线 id。 */
  runPipeline(spec: PipelineSpec, issue: string): string | null;
  /**
   * task-service 的 settle 回流口（组合根接进 onTaskSettled）：completed 带**全文** output
   * （下一站 {{prev_output}} 的源）、failed 带原因。非本编排器的任务直过（幂等匹配）。
   */
  handleTaskSettled(record: TaskPersistRecord): void;
  /** 面板实时读数口（注入 agent-panel；不落 WorldState —— 见文件头禁止事项 2）。 */
  readonly feed: PipelineFeedPort;
  /** 订阅总线（相位实时更新 + 收尾兜底路）；返回 stop。start 一次即可，重复 start 是 no-op。 */
  start(): () => void;
}

export interface PipelineServiceDeps {
  /** 世界态快照（承接人解析要读 characters；tasks 不用 —— 单任务相位真相走事件）。 */
  readonly getState: () => Pick<WorldState, 'characters'>;
  /** 建 task 的唯一口子（与普通任务共用 FIFO 的保证就在这里）。 */
  readonly taskManager: TaskManager;
  /** pipelines 表落库回调（缺省不落 —— 单测/非 Electron 降级，编排照跑）。 */
  readonly persistPipeline?: (record: PipelinePersistRecord) => void;
  /** 站任务 pipeline_id 落列回调（character_tasks；缺省不落）。 */
  readonly stampTask?: (record: TaskPersistRecord, pipelineId: string) => void;
  readonly createId?: (prefix: string) => string;
  readonly now?: () => number;
  readonly logger?: (line: string) => void;
  /** feed 内存窗口上限（防面板读数无限增长；超窗先丢最旧终态，绝不丢 running）。 */
  readonly maxRuns?: number;
}

/** 一站的执行期编排态（service 私产，不进 WorldState）。 */
interface StepRuntime {
  readonly spec: PipelineSpec['steps'][number];
  characterId: string | null;
  characterName: string | null;
  taskId: string | null;
  phase: PipelineStepPhase;
  /** 本站派出的 prompt 全文（卡片回显 + steps JSON 落库）。 */
  prompt: string;
}

/** 一条流水线的执行期编排态。 */
interface RunRuntime {
  readonly id: string;
  readonly name: string;
  readonly issue: string;
  status: PipelineRunStatus;
  readonly steps: StepRuntime[];
  /** 下一站要渲染的游标（0..steps.length）。 */
  cursor: number;
  /** 上一 completed 站的输出全文（{{prev_output}} 源；跳过站不更新它）。 */
  prevOutput: string;
  readonly createdAt: number;
  finishedAt: number | null;
}

const DEFAULT_MAX_RUNS = 20;

export function createPipelineService(deps: PipelineServiceDeps): PipelineService {
  const logger = deps.logger ?? ((line) => console.warn(line));
  const now = deps.now ?? ((): number => Date.now());
  const createId = deps.createId ?? ((prefix: string): string => `${prefix}_${now()}_${Math.random().toString(36).slice(2, 8)}`);
  const maxRuns = deps.maxRuns ?? DEFAULT_MAX_RUNS;

  const runs: RunRuntime[] = [];
  const runsById = new Map<string, RunRuntime>();
  /** 在途站任务 → (run, 站下标)：收尾三路信号的匹配索引。 */
  const runsByTaskId = new Map<string, { run: RunRuntime; index: number }>();
  const feedListeners = new Set<() => void>();
  let busStop: Unsubscribe | null = null;

  // ---- 读数口 ----

  const toStepView = (step: StepRuntime, index: number): PipelineStepView => ({
    index,
    characterId: step.characterId,
    characterName: step.characterName,
    phase: step.phase,
    prompt: step.prompt,
    taskId: step.taskId,
  });

  const toRunView = (run: RunRuntime): PipelineRunView => ({
    id: run.id,
    name: run.name,
    issue: run.issue,
    status: run.status,
    steps: run.steps.map(toStepView),
  });

  const notify = (): void => {
    feedListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        logger(`[pipeline-service] 读数回调抛错：${error instanceof Error ? error.message : String(error)}`);
      }
    });
  };

  const feed: PipelineFeedPort = {
    subscribe: (listener) => {
      feedListeners.add(listener);
      return () => {
        feedListeners.delete(listener);
      };
    },
    snapshot: () => (runs.length > 0 ? runs.map(toRunView) : null),
  };

  // ---- 落库 ----

  const serializeSteps = (run: RunRuntime): string =>
    JSON.stringify(
      run.steps.map((step) => ({
        characterId: step.characterId,
        taskId: step.taskId,
        phase: step.phase,
        prompt: step.prompt,
      }))
    );

  const persist = (run: RunRuntime): void => {
    if (!deps.persistPipeline) return;
    const record: PipelinePersistRecord = {
      id: run.id,
      name: run.name,
      issue: run.issue,
      status: run.status,
      steps: serializeSteps(run),
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
    };
    try {
      deps.persistPipeline(record);
    } catch (error) {
      logger(
        `[pipeline-service] 流水线落库抛错（${run.id}）：${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  // ---- 终态 ----

  const finishRun = (run: RunRuntime, status: 'completed' | 'failed', reason?: string): void => {
    if (run.status !== 'running') return;
    run.status = status;
    run.finishedAt = now();
    // 断链：未到站的 pending 全部 skipped（历史可见，看得见哪几站没跑）。
    if (status === 'failed') {
      for (const step of run.steps) {
        if (step.phase === 'pending') step.phase = 'skipped';
      }
    }
    persist(run);
    notify();
    emitWorldEvent(
      status === 'completed'
        ? { type: 'pipeline.completed', pipelineId: run.id, pipelineName: run.name }
        : {
            type: 'pipeline.failed',
            pipelineId: run.id,
            pipelineName: run.name,
            reason: reason ?? '流水线中断',
          }
    );
    pruneFinished();
  };

  /** feed 内存窗口：超窗先丢最旧终态；一条 running 都没有时 runs 为空即读数 null。 */
  const pruneFinished = (): void => {
    while (runs.length > maxRuns) {
      const oldestFinished = runs.find((run) => run.status !== 'running');
      if (!oldestFinished) break; // 全在跑（maxRuns ≥ 站上限场景）：宁可超窗也不丢在跑的线
      runs.splice(runs.indexOf(oldestFinished), 1);
      runsById.delete(oldestFinished.id);
    }
  };

  // ---- 跑站 ----

  /** 游标推进：跳过已判跳的站 → 解析/渲染/派发下一站 → 在途站返回等收尾。 */
  const advance = (run: RunRuntime): void => {
    while (run.status === 'running' && run.cursor < run.steps.length) {
      const step = run.steps[run.cursor];
      if (step.phase !== 'pending') {
        run.cursor += 1;
        continue;
      }
      const characters: readonly CharacterView[] = deps.getState().characters;
      const target = resolvePipelineStepCharacter(step.spec, characters);
      if (!target) {
        // 跳站：kind 解析不到在档角色 / 显式 characterId 不在档 —— 记 skipped 继续，
        // 不算断链（缺人不缺流程；读的人从站序里看得见哪站没跑）。
        step.phase = 'skipped';
        run.cursor += 1;
        continue;
      }
      const prompt = renderPipelineStepPrompt(step.spec.promptTemplate, {
        task: run.issue,
        prevOutput: run.prevOutput,
      });
      // 指定 targetCharacterId 直达目标队列（050 面）：同 characterId 与普通任务共用 FIFO，
      // 在忙自然排队 —— 编排器不抢队。
      const task = deps.taskManager.assignTask({
        characterId: target.id,
        prompt,
        targetCharacterId: target.id,
      });
      if (!task) {
        // 派发被拒（prompt 超限 / 任务数满 / 档案竞态消失）：断链看得见，core 已发 Notice。
        step.phase = 'failed';
        finishRun(run, 'failed', `第 ${run.cursor + 1} 站派发被拒（详见系统通知）`);
        return;
      }
      step.characterId = target.id;
      step.characterName = target.name;
      step.taskId = task.id;
      step.prompt = task.prompt;
      step.phase = 'queued';
      runsByTaskId.set(task.id, { run, index: run.cursor });
      // pipeline_id 落列：queued 快照先到（task-service 同步落）也无妨 —— DAO 的 CASE 守卫
      // 保证后续不带 pipelineId 的相位快照不会抹掉它（见文件头「编排态持久化」）。
      if (deps.stampTask) {
        try {
          // 记录不带 pipelineId（那是持久化注入件拼的，本层不认识 DAO 行形状 —— 见依赖注释）。
          deps.stampTask(taskEventToRecord(task), run.id);
        } catch (error) {
          logger(
            `[pipeline-service] 站任务落 pipeline_id 抛错（${task.id}）：${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      persist(run);
      notify();
      return; // 等这一站收尾（事件驱动续跑，不轮询）
    }
    if (run.status === 'running' && run.cursor >= run.steps.length) {
      finishRun(run, 'completed');
    }
  };

  /**
   * 收站（幂等）：completed 记全文并推进；failed 断链。step.phase 的终态即幂等闸
   * （queued/running 之外的相位直过 —— 三路信号同帧到达只有第一路生效）。
   */
  const settleStep = (
    run: RunRuntime,
    index: number,
    outcome: { status: 'completed' | 'failed' | 'cancelled'; output: string }
  ): void => {
    if (run.status !== 'running') return;
    const step = run.steps[index];
    if (!step || (step.phase !== 'queued' && step.phase !== 'running')) return;
    runsByTaskId.delete(step.taskId ?? '');
    if (outcome.status === 'completed') {
      step.phase = 'completed';
      run.prevOutput = outcome.output; // 全文（主路）或摘要（兜底路）—— 见文件头两路说明
      run.cursor = index + 1;
      persist(run);
      notify();
      advance(run);
      return;
    }
    step.phase = 'failed';
    finishRun(
      run,
      'failed',
      outcome.status === 'cancelled'
        ? `第 ${index + 1} 站任务在排队时被取消`
        : `第 ${index + 1} 站失败：${outcome.output || '原因未知'}`
    );
  };

  /** 总线兜底 / 相位实时更新口。 */
  const handleWorldEvent = (event: WorldEvent): void => {
    if (!event.type.startsWith('task.')) return;
    const match =
      event.type === 'task.queued' ||
      event.type === 'task.started' ||
      event.type === 'task.completed' ||
      event.type === 'task.failed' ||
      event.type === 'task.cancelled' ||
      event.type === 'task.awaiting_approval' ||
      event.type === 'task.approved'
        ? runsByTaskId.get(event.task.id)
        : undefined;
    if (!match) return;
    switch (event.type) {
      case 'task.queued':
        if (match.run.steps[match.index].phase === 'pending') match.run.steps[match.index].phase = 'queued';
        notify();
        return;
      case 'task.started':
      case 'task.approved':
      case 'task.awaiting_approval':
        // 挂起也在「在办」口径里（卡片相位词汇见 PipelineStepPhase）。
        match.run.steps[match.index].phase = 'running';
        notify();
        return;
      case 'task.cancelled':
        // 047 口径：取消无 settle 回流 —— 总线事件同步断链。
        settleStep(match.run, match.index, { status: 'cancelled', output: '' });
        return;
      case 'task.completed':
      case 'task.failed': {
        // 兜底路（微任务延迟一拍）：主路 settle 若已到，这里幂等直过；没到（组合根没接
        // 主路 / settle 链路坏了）用摘要保命 —— 流水线不挂死。
        const run = match.run;
        const index = match.index;
        const status = event.type === 'task.completed' ? 'completed' : 'failed';
        const output = event.task.output;
        queueMicrotask(() => settleStep(run, index, { status, output }));
        return;
      }
      default:
        return;
    }
  };

  return {
    feed,

    start(): () => void {
      if (busStop) return busStop;
      busStop = onWorldEvent(handleWorldEvent);
      return busStop;
    },

    runPipeline(spec: PipelineSpec, issue: string): string | null {
      const specCheck = validatePipelineSpec(spec);
      const issueCheck = validatePipelineIssue(issue);
      const id = createId('pipeline');
      const run: RunRuntime = {
        id,
        name: (spec?.name ?? '').trim() || '流水线',
        issue: issue?.trim() ?? '',
        status: 'running',
        steps: (spec?.steps ?? []).map((step) => ({
          spec: step,
          characterId: null,
          characterName: null,
          taskId: null,
          phase: 'pending' as PipelineStepPhase,
          prompt: '',
        })),
        cursor: 0,
        prevOutput: '',
        createdAt: now(),
        finishedAt: null,
      };
      runs.unshift(run);
      runsById.set(id, run);
      if (!specCheck.ok || !issueCheck.ok) {
        // 坏形状也落一条 failed 线（看得见，不静默丢）；UI 侧表单已先验过，这里兜底。
        const rejectReason = !specCheck.ok
          ? specCheck.reason
          : !issueCheck.ok
            ? issueCheck.reason
            : '规格被拒';
        logger(`[pipeline-service] 流水线规格被拒（${id}）：${rejectReason}`);
        finishRun(run, 'failed', rejectReason);
        return id;
      }
      persist(run);
      notify();
      advance(run);
      return id;
    },

    handleTaskSettled(record: TaskPersistRecord): void {
      const match = runsByTaskId.get(record.id);
      if (!match) return;
      settleStep(match.run, match.index, {
        status: record.status === 'completed' ? 'completed' : 'failed',
        output: record.output,
      });
    },
  };
}
