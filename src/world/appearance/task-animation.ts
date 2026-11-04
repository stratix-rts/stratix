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
 * core/task 发在 world 通道上的 task.started / task.completed / task.failed
 * → world/bridge/bus-adapter 转给场景的 syncTaskEvent → 场景按 task.characterId
 * 反查战场单位（复用 objects/task-fx.ts 的 applyTaskFxEvent 命中集合）
 * → 场景把相位写进单位层 → 单位层每 tick 取相位喂给动画控制器。
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

import type { UnitTaskPhase } from './unit-animation';
import { UNIT_ANIMATION_METRICS } from '../theme';

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
 * 每单位的任务相位板（unitId → 相位）。
 *
 * why 挂在单位维度而不是角色维度：战场认的是单位（同一角色可能有多个单位），
 *   归属的反查（characterId → unitIds）是场景的事（复用 applyTaskFxEvent 的命中集合）。
 */
export class TaskPhaseBoard {
  /** unitId → 当前相位。 */
  private readonly phases = new Map<string, UnitTaskPhase>();
  /** unitId → 相位落板时刻（ms）：'completed' 的 TTL 从这里起算。 */
  private readonly sinceMs = new Map<string, number>();

  /**
   * 任务开工 → 相位 'running'（工作态）。
   * 返回是否有实质变化（调用方据此决定要不要重画）。
   */
  setRunning(unitId: string, nowMs: number): boolean {
    return this.set(unitId, 'running', nowMs);
  }

  /**
   * 任务完成 → 相位 'completed'（收工站直 + 庆祝演出）。
   * 瞬态：TTL 到（默认 TASK_ANIMATION_METRICS.completedTtlMs）自动回 'none'。
   */
  setCompleted(unitId: string, nowMs: number): boolean {
    return this.set(unitId, 'completed', nowMs);
  }

  /**
   * 任务失败 → 相位 'failed'（卡住态：❗ + 灰度 + 抖动）。
   * 驻留：直到这个单位的下一条任务事件覆盖它（与 task-fx 的 ! 浮标同一驻留语义）。
   */
  setFailed(unitId: string, nowMs: number): boolean {
    return this.set(unitId, 'failed', nowMs);
  }

  /** 单位离场 / 任务撤掉 → 清相位（不留残迹）。 */
  clear(unitId: string): boolean {
    this.sinceMs.delete(unitId);
    return this.phases.delete(unitId);
  }

  /** 全清（场景销毁）。 */
  clearAll(): void {
    this.phases.clear();
    this.sinceMs.clear();
  }

  /**
   * 查某单位此刻的相位（渲染层每 tick 调）。
   *
   * 'completed' 的过期是**惰性剔除**（读到时顺手清）—— 不需要外部定时器来收垃圾，
   * 与 TaskFxBoard.markerFor 的过期口径一致。
   */
  phaseFor(unitId: string, nowMs: number): UnitTaskPhase {
    const phase = this.phases.get(unitId);
    if (phase === undefined) return 'none';
    if (phase === 'completed') {
      const since = this.sinceMs.get(unitId) ?? nowMs;
      if (nowMs - since >= TASK_ANIMATION_METRICS.completedTtlMs) {
        this.clear(unitId);
        return 'none';
      }
    }
    return phase;
  }

  /** 板上共有多少条相位（自检 / 单测用）。 */
  get size(): number {
    return this.phases.size;
  }

  /** 落板（返回是否有实质变化）。 */
  private set(unitId: string, phase: UnitTaskPhase, nowMs: number): boolean {
    const existing = this.phases.get(unitId);
    this.phases.set(unitId, phase);
    this.sinceMs.set(unitId, nowMs);
    return existing !== phase;
  }
}
