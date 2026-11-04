/**
 * 文件职责：**任务生命周期 → 单位动画相位**的纯逻辑层（@since v3.8，task_141）——
 *   把「这条角色任务现在处在哪个相位」记成**每单位一个**的相位镜像，
 *   供 appearance/unit-animation.ts 的基态派生（resolveBase）消费。
 *
 * ============ 为什么这块是「镜像」而不是「真相」 ============
 * 相位的**真相**在 core（WorldState.tasks + task.* 总线事件）；本板只承载
 * 「事件瞬间发生过的表演语义」—— 与 objects/task-fx.ts 的 TaskFxBoard 同构：
 *   - 'completed' 是**瞬态**（庆祝演出约 1.2s，演完回静息）—— core 状态里没有对应物；
 *   - 'failed' 是**驻留**（❗ 一直挂着，直到这个单位的下一条任务事件覆盖它）；
 *   - 'running' 跟随事件（task.started / task.approved 折算成 started）。
 * 本板**不判定**任务该不该失败、要不要重试 —— 那是 core/task 与 app 层 task-service 的事。
 *
 * ============ 事件来源（既有数据流，不发明新协议） ============
 * **两路，都走既有数据流**（哪一路先到都成立，互为兜底）：
 *   ① 事件路：core/task 发在 world 通道上的 task.started / task.completed / task.failed
 *      → world/bridge/bus-adapter 转给场景的 syncTaskEvent → 场景按 task.characterId
 *      反查战场单位（复用 objects/task-fx.ts 的 applyTaskFxEvent 命中集合）
 *      → 场景把相位写进单位层 → 单位层每 tick 取相位喂给动画控制器。
 *   ② 快照路：state 通道上的 WorldState.tasks（**与任务面板同源**的那份清单）
 *      → world/bridge/bus-adapter 转给场景的 syncTasks → 场景用 taskPhaseView 派生相位。
 *      why 需要这一路：真相持有者（gateway / service 进程）里的 core 才发 task.* 事件，
 *      视图壳（远程模式）只拿到全量快照 —— 快照路保证「派了活儿的单位真的会动」。
 *      快照路只演**跳变**（running → completed），不补演客户端不在场时的庆祝。
 * 全程不新增总线事件类型、不新增字段到 core 契约。
 *
 * 禁止事项：
 *   1. import phaser —— 本文件零渲染引擎依赖（node 单测直接 import）；
 *   2. import hud / app / vue / legacy(stratix-rts) —— 铁律：world 只认识 core/types；
 *   3. 持第二份任务真相 —— 本板只存「演过什么」，不存「任务是什么」；
 *   4. 无上限增长 —— 键是单位 id（数量有界），单位离场即清（见 UnitLayer.sync）。
 *
 * @since v3.8（task_141）。
 */

import type { CharacterTask } from '../../core/types';
import { UNIT_ANIMATION_METRICS } from '../theme';

import type { UnitTaskPhase } from './unit-animation';

/**
 * 庆祝演出的总时长（压缩 + 起跳 + 星尘）—— 与动画度量同源（core/theme/visual-spec.ts）。
 * why 相位窗口对齐演出时长：演完就回静息，不多挂一帧（也不少挂 —— 演出被砍一半最难看）。
 */
export const TASK_ANIMATION_METRICS = Object.freeze({
  /** 'completed' 相位的驻留时长（ms）：恰好演完一整轮庆祝。 */
  completedTtlMs:
    UNIT_ANIMATION_METRICS.completed.squashMs +
    UNIT_ANIMATION_METRICS.completed.jumpMs +
    UNIT_ANIMATION_METRICS.completed.dustMs,
});

/**
 * 相位落板的结果 —— 上层据此决定要不要起演（庆祝）。
 * - 'unchanged'      = 相位没变（快照反复来也是它）
 * - 'seeded'         = 首次落板（此前无相位）：**不产生演出**（客户端不在场不补演）
 * - 'entered-running'= 切入工作态
 * - 'entered-completed' = 切入完成态（**这里起庆祝**）
 * - 'entered-failed' = 切入卡住态
 * - 'cleared'        = 相位被撤掉（任务撤单 / 挂起不算忙）
 */
export type TaskPhaseTransition =
  | 'unchanged'
  | 'seeded'
  | 'entered-running'
  | 'entered-completed'
  | 'entered-failed'
  | 'cleared';

/**
 * 任务清单派生的相位视图（相位 + 演的是哪一单）。
 * why 带 taskId：庆祝是**按单**演一次的事 —— 同一单不演第二遍（快照会把这单反复送上来）。
 */
export interface TaskPhaseView {
  readonly phase: UnitTaskPhase;
  /** 派生自哪条任务（无任务时缺省）。 */
  readonly taskId?: string;
}

/**
 * 由任务清单派生某角色的当前相位（**既有数据流**：WorldState.tasks —— 任务面板同源）。
 *
 * 口径与 core 对齐（core/task/manager.ts 的 syncUnitWorkingStatus）：
 *   **只有 running 才算「在干活」**（queued 不算忙，挂起 awaiting_approval 也不算忙）。
 *
 * 取哪一条：角色的任务可能不止一条（队列里排着下一单），故按「最近活动时间」取最新那单 ——
 *   活动时间 = 收尾 > 开工 > 派单（谁更新谁代表当前这活儿）。
 *   why 不能只看 createdAt：新单排队（queued）会把刚跑完的那单挤掉，
 *   收尾的那一刻就看不见「完成了」，庆祝也就丢了。
 *
 * @param tasks 全量任务清单（WorldState.tasks）
 * @param characterId 角色 id（= 单位上的 characterId）
 */
export function taskPhaseView(
  tasks: readonly CharacterTask[],
  characterId: string,
): TaskPhaseView {
  let best: CharacterTask | null = null;
  let bestAt = -1;
  for (const task of tasks) {
    if (task.characterId !== characterId) continue;
    // 在跑的最优先（与 core 的 busy 口径一致）；同一角色只会有单条 running。
    if (task.status === 'running') return { phase: 'running', taskId: task.id };
    const at = taskActivityAt(task);
    if (at > bestAt) {
      bestAt = at;
      best = task;
    }
  }
  if (!best) return { phase: 'none' };
  if (best.status === 'completed') return { phase: 'completed', taskId: best.id };
  if (best.status === 'failed') return { phase: 'failed', taskId: best.id };
  // queued / awaiting_approval / cancelled → 不算忙（core 也不给单位置 busy）。
  return { phase: 'none', taskId: best.id };
}

/** 任务的「最近活动时间」（ms）：收尾 > 开工 > 派单。 */
function taskActivityAt(task: CharacterTask): number {
  return task.endedAt ?? task.startedAt ?? task.createdAt;
}

/** 相位板上的一条记录。 */
interface PhaseEntry {
  readonly phase: UnitTaskPhase;
  /** 落板时刻（ms，Phaser 时钟）：'completed' 的 TTL 从这里起算。 */
  readonly sinceMs: number;
  /** 演的是哪一单（按单去重庆祝用）。 */
  readonly taskId?: string;
}

/**
 * 每单位的任务相位板（unitId → 相位）。
 *
 * why 挂在单位维度而不是角色维度：战场认的是单位（同一角色可能有多个单位），
 *   归属的反查（characterId → unitIds）是场景的事（复用 applyTaskFxEvent 的命中集合）。
 */
export class TaskPhaseBoard {
  /** unitId → 当前相位记录。 */
  private readonly entries = new Map<string, PhaseEntry>();
  /** unitId → 已演过庆祝的那一单：同一单不演第二遍。 */
  private readonly celebrated = new Map<string, string>();

  /**
   * 落板（**唯一写入口**）—— 返回相位迁移结果，上层据此决定要不要起演。
   *
   * @param unitId 单位 id
   * @param phase 目标相位（'none' = 撤相位）
   * @param nowMs 当前时刻（Phaser 时钟，与 phaseFor 同一个钟 —— 两个钟混用会把 TTL 算飞）
   * @param taskId 演的是哪一单（按单去重；缺省 = 不按单去重）
   */
  apply(
    unitId: string,
    phase: UnitTaskPhase,
    nowMs: number,
    taskId?: string,
  ): TaskPhaseTransition {
    const prev = this.entries.get(unitId);

    // 这一单已经演过庆祝 → 不重复落板（快照会把这单反复送上来，不能让它再跳一次）。
    if (phase === 'completed' && taskId !== undefined) {
      if (this.celebrated.get(unitId) === taskId) return 'unchanged';
    }

    if (prev && prev.phase === phase) {
      // 同一相位但换了另一单完成 → 重新起拍（这一单是新的，得再演一次）。
      if (phase === 'completed' && taskId !== undefined && prev.taskId !== taskId) {
        this.entries.set(unitId, { phase, sinceMs: nowMs, taskId });
        this.celebrated.set(unitId, taskId);
        return 'entered-completed';
      }
      // 相位没变：**不刷新 sinceMs** —— 反复来的快照不能把庆祝拖长。
      return 'unchanged';
    }

    if (phase === 'none') {
      this.entries.delete(unitId);
      return prev ? 'cleared' : 'unchanged';
    }

    this.entries.set(unitId, { phase, sinceMs: nowMs, taskId });
    if (phase === 'completed' && taskId !== undefined) this.celebrated.set(unitId, taskId);
    if (!prev) return 'seeded';
    if (phase === 'running') return 'entered-running';
    if (phase === 'completed') return 'entered-completed';
    return 'entered-failed';
  }

  /**
   * 任务开工 → 相位 'running'（工作态）。
   * 返回相位迁移结果（调用方据此决定要不要重画）。
   */
  setRunning(unitId: string, nowMs: number): TaskPhaseTransition {
    return this.apply(unitId, 'running', nowMs);
  }

  /**
   * 任务完成 → 相位 'completed'（收工站直 + 庆祝演出）。
   * 瞬态：TTL 到（默认 TASK_ANIMATION_METRICS.completedTtlMs）自动回 'none'。
   */
  setCompleted(unitId: string, nowMs: number, taskId?: string): TaskPhaseTransition {
    return this.apply(unitId, 'completed', nowMs, taskId);
  }

  /**
   * 任务失败 → 相位 'failed'（卡住态：❗ + 灰度 + 抖动）。
   * 驻留：直到这个单位的下一条任务事件覆盖它（与 task-fx 的 ! 浮标同一驻留语义）。
   */
  setFailed(unitId: string, nowMs: number, taskId?: string): TaskPhaseTransition {
    return this.apply(unitId, 'failed', nowMs, taskId);
  }

  /** 单位离场 / 任务撤掉 → 清相位（不留残迹）。 */
  clear(unitId: string): boolean {
    // 演出记忆与相位同生共死：单位离场后记忆也作废（下一轮同一单 id 也该重新演）。
    this.celebrated.delete(unitId);
    return this.entries.delete(unitId);
  }

  /** 全清（场景销毁）。 */
  clearAll(): void {
    this.entries.clear();
    this.celebrated.clear();
  }

  /**
   * 查某单位此刻的相位（渲染层每 tick 调）。
   *
   * 'completed' 的过期是**惰性剔除**（读到时顺手清）—— 不需要外部定时器来收垃圾，
   * 与 TaskFxBoard.markerFor 的过期口径一致。
   */
  phaseFor(unitId: string, nowMs: number): UnitTaskPhase {
    const entry = this.entries.get(unitId);
    if (!entry) return 'none';
    if (entry.phase === 'completed') {
      if (nowMs - entry.sinceMs >= TASK_ANIMATION_METRICS.completedTtlMs) {
        this.entries.delete(unitId);
        return 'none';
      }
    }
    return entry.phase;
  }

  /** 该单位当前有没有相位记录（快照路判「是不是跳变」用）。 */
  has(unitId: string): boolean {
    return this.entries.has(unitId);
  }

  /** 板上共有多少条相位（自检 / 单测用）。 */
  get size(): number {
    return this.entries.size;
  }
}
