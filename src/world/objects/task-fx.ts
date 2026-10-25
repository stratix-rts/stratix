/**
 * 文件职责：**任务生命周期 → 战场单位表现的纯映射层**（task_038）—— 三件事，全部零 Phaser：
 *   ① 表现状态板 TaskFxBoard：task.started → working（进度环）、task.completed → done
 *     （绿色 ✓，1.5s 淡出）、task.failed → failed（红色 !，驻留到下一次状态变化）；
 *   ② 表现裁决 visibleMarker：busy 派生（core/task 的 syncUnitWorkingStatus）与事件板合并成
 *     "此刻这个单位头顶画什么"的唯一答案 —— busy 状态永远画环（读档恢复也成立，不依赖事件重放）；
 *   ③ 事件落地 applyTaskFxEvent：task 事件带的是 characterId，战场认的是单位 —— 按 characterId
 *     反查单位集合并落板（场景把 registry.list() 递进来，本函数不认识 registry 类型）。
 * 输入：core/types 的 CharacterTask / UnitStatus（只读）+ 注入时钟。
 * 输出：TaskFxBoard（状态板）+ visibleMarker 裁决 + applyTaskFxEvent 落地器 + TASK_FX_STYLE 样式常量。
 * 禁止事项：
 *   1. import phaser —— 本文件是纯逻辑，画出来是 objects/task-fx-layer.ts 的事（node 单测直接 import 本文件）；
 *   2. import hud / app / vue / legacy —— 铁律：world 只认识 core/types；
 *   3. 持有第二份任务真相 —— 相位真相在 core/task 的 WorldState.tasks；本板只存"头顶浮标"
 *     这类**瞬态表现**（done 的 1.5s 生命周期在状态里没有对应物，落库无意义）；
 *   4. 在这里做业务判定（任务该不该失败、要不要重试）—— 那是 core/task 与 app 层 task-service 的事。
 *
 * ============ 变体钩子（规格①：做 2 个变体，用户验收时挑）============
 * TASK_FX_STYLE 是唯一样式源：ring 变体（默认，头顶旋转进度环）的全部参数集中在此。
 * 后续换「工具气泡 + 身体动画加速」变体时：扩 TaskFxStyle.variant 词表 + 在 task-fx-layer.ts
 * 增一个绘制分支，本文件的状态板与裁决逻辑零改动。
 *
 * 颜色口径：Phaser 侧没有 CSS token，色值按 16 进制**镜像** hud/theme/tokens-default.css 的
 * 同名 token（done=srf-success #6fcf97、failed=srf-danger #e06c75、环=unit-layer 的 busy 态
 * 0xf5a524、awaiting=srf-warn #f0c674），换肤时两处同步改（同 world/theme.ts 的镜像纪律）。
 *
 * ============ 审批门挂起浮标（@since v3.25，task_049）============
 * task.awaiting_approval → awaiting（黄色 ?，驻留到下一次状态变化）：plan-first 任务的计划
 * 轮结束、等用户裁决。与 failed 的 ! 同一驻留语义（不自动过期 —— 门开着就该一直问）；
 * 批准（task.approved → started 相位）盖回工作环，驳回（task.failed）换成 !。
 * why 单位此刻不 busy（挂起不算忙）：busy 派生永远画环的裁决不会盖住 ? —— 状态与表现天然对齐。
 *
 * @since v3.17（task_038）；v3.25（task_049）追加 awaiting 浮标（审批门）。
 */

import type { CharacterTask, UnitStatus } from '../../core/types';

// ============================================================================
// 样式常量（变体钩子：全部可调参数集中一处）
// ============================================================================

/** 进度环变体的参数。 */
export interface TaskFxRingStyle {
  /** 环半径（世界坐标 px）。 */
  readonly radius: number;
  readonly lineWidth: number;
  /** 环的颜色（busy 态色，镜像 unit-layer 的 COLOR_BY_STATUS.busy）。 */
  readonly color: number;
  /** 弧的跨度（度）：<360 就是"旋转缺口环"，=360 是整环。 */
  readonly arcDegrees: number;
  /** 旋转角速度（度/秒）。 */
  readonly rotationDegPerSec: number;
}

/** 浮标（✓ / !）的公共参数。 */
export interface TaskFxMarkerStyle {
  /** 底衬圆半径（给 ✓/! 提供对比度，压在任意底色上都可读）。 */
  readonly radius: number;
  readonly backdropColor: number;
  readonly backdropAlpha: number;
  /** 浮标中心相对单位中心的世界坐标 y 偏移（负数 = 头顶）。 */
  readonly yAboveUnit: number;
}

/** 一套完整的工作表现样式（variant 词表即变体清单）。 */
export interface TaskFxStyle {
  /** 当前变体名。'ring' = 头顶进度环（默认）；'bubble'（工具气泡）是预留位，未实现。 */
  readonly variant: 'ring';
  readonly ring: TaskFxRingStyle;
  /** ✓ 浮标：完成色（镜像 srf-success）+ 存活时长（淡出总时长）。 */
  readonly done: { readonly color: number; readonly ttlMs: number };
  /** ! 浮标：失败色（镜像 srf-danger）。驻留时长不设 —— 由下一次状态变化裁决。 */
  readonly failed: { readonly color: number };
  /** ? 浮标（@since v3.25，task_049）：待审批色（镜像 srf-warn）。驻留到下一次状态变化。 */
  readonly awaiting: { readonly color: number };
  readonly marker: TaskFxMarkerStyle;
  /** 动画步进间隔（ms；30fps 足够环旋转与淡出平滑）。 */
  readonly tickMs: number;
}

/** 默认样式（ring 变体）。改观感只动这里，不动绘制器。 */
export const TASK_FX_STYLE: TaskFxStyle = {
  variant: 'ring',
  ring: { radius: 9, lineWidth: 2.5, color: 0xf5a524, arcDegrees: 270, rotationDegPerSec: 220 },
  done: { color: 0x6fcf97, ttlMs: 1500 },
  failed: { color: 0xe06c75 },
  awaiting: { color: 0xf0c674 },
  marker: { radius: 11, backdropColor: 0x0f131b, backdropAlpha: 0.6, yAboveUnit: 44 },
  tickMs: 33,
};

// ============================================================================
// 右击移动的目标点涟漪样式（@since v3.21，task_045）
// ============================================================================

/**
 * 目标点涟漪的可调参数（常量可调，同 TASK_FX_STYLE 先例）。
 * 血缘（v2 考古）：ParticleEffects.agentArrivalRipple —— 半径 10→50、alpha 0.7→0、
 * 600ms Power2.easeOut、2px 描边 + 10% 充填；v3 颜色取绿（srf-success 镜像，与 done ✓
 * 同族「去了/成了」的正反馈色；v2 用的是主题主色，这里按 task_045 规格改绿）。
 */
export interface MoveRippleStyle {
  /** 涟漪色（镜像 srf-success #6fcf97）。 */
  readonly color: number;
  readonly radiusFrom: number;
  readonly radiusTo: number;
  readonly lineWidth: number;
  readonly alphaFrom: number;
  readonly durationMs: number;
}

/** 默认涟漪样式（v2 口径原样，只换色）。 */
export const MOVE_RIPPLE_STYLE: MoveRippleStyle = {
  color: 0x6fcf97,
  radiusFrom: 10,
  radiusTo: 50,
  lineWidth: 2,
  alphaFrom: 0.7,
  durationMs: 600,
};

// ============================================================================
// 状态板
// ============================================================================

/**
 * 桥接层关注的任务生命周期相位（task.queued 不进战场表现 —— 还没轮到它动）。
 * @since v3.25（task_049）增 awaiting_approval：挂起画 ?（task.approved 由桥接层折算成
 * started 相位 —— 批准就是同一段执行的续段，表现上回到工作环）。
 */
export type TaskFxPhase = 'started' | 'completed' | 'failed' | 'awaiting_approval';

/** 单位头顶的表现种类。 */
export type TaskMarkerKind = 'working' | 'done' | 'failed' | 'awaiting';

/** 一枚浮标的表现态：种类 + 落板时刻（done 用它算淡出进度）。 */
export interface TaskMarker {
  readonly kind: TaskMarkerKind;
  readonly sinceMs: number;
}

export interface TaskFxBoardOptions {
  /** 时钟注入（默认 Date.now）：单测确定性推进 done 的淡出窗口。 */
  readonly now?: () => number;
  /** ✓ 浮标存活时长；默认 TASK_FX_STYLE.done.ttlMs（1500ms）。 */
  readonly doneTtlMs?: number;
}

/**
 * 任务表现的瞬态状态板：unitId → 当前浮标。
 * 相位真相在 core（WorldState.tasks），本板只承载"事件瞬间"的表现语义：
 * done 的 1.5s 淡出、failed 的"驻留到下一次状态变化"在 core 状态里都没有对应物。
 */
export class TaskFxBoard {
  private readonly markers = new Map<string, TaskMarker>();
  private readonly nowFn: () => number;
  readonly doneTtlMs: number;

  constructor(options: TaskFxBoardOptions = {}) {
    this.nowFn = options.now ?? ((): number => Date.now());
    this.doneTtlMs = options.doneTtlMs ?? TASK_FX_STYLE.done.ttlMs;
  }

  /** 板上的时钟（渲染层用同一份算淡出，别再注入第二个时钟）。 */
  get clock(): () => number {
    return this.nowFn;
  }

  /** task.started 的落点：working 环（顶掉之前的 ✓/!）。 */
  setWorking(unitId: string): boolean {
    return this.set(unitId, 'working');
  }

  /** task.completed 的落点：✓ 浮标（顶掉之前的环/!，重新计 1.5s）。 */
  setDone(unitId: string): boolean {
    return this.set(unitId, 'done');
  }

  /** task.failed 的落点：! 浮标（驻留到下一次 set/clear，不自动过期）。 */
  setFailed(unitId: string): boolean {
    return this.set(unitId, 'failed');
  }

  /**
   * task.awaiting_approval 的落点（task_049）：? 浮标（驻留到下一次 set/clear ——
   * 与 failed 的 ! 同一驻留语义：裁决没来，问号就不撤）。
   */
  setAwaiting(unitId: string): boolean {
    return this.set(unitId, 'awaiting');
  }

  /** 单位离开战场 / 表现需要收掉时清一枚。 */
  clear(unitId: string): boolean {
    return this.markers.delete(unitId);
  }

  clearAll(): void {
    this.markers.clear();
  }

  /**
   * 查一枚浮标。done 过期即惰性剔除（不需要外部定时器来清垃圾）。
   * 返回的是**板上快照**；要不要画还受单位 busy 派生影响，见 visibleMarker。
   */
  markerFor(unitId: string): TaskMarker | null {
    const marker = this.markers.get(unitId);
    if (!marker) return null;
    if (marker.kind === 'done' && this.nowFn() - marker.sinceMs >= this.doneTtlMs) {
      this.markers.delete(unitId);
      return null;
    }
    return marker;
  }

  /**
   * 表现裁决（渲染层的唯一读口）：
   *   - 单位 busy（core/task 派生）→ 永远画 working 环 —— 环的真相是**状态**不是事件，
   *     读档恢复（有 running 任务、没经历过 started 事件）也能画上；
   *   - 非 busy → 画事件板上的 ✓/!；板上的 working 在无 busy 支撑时视为陈迹不画
   *     （防御事件乱序：环始终跟着状态走，事件只是补 done/! 这类瞬态）。
   */
  visibleMarker(unitId: string, status: UnitStatus): TaskMarkerKind | null {
    if (status === 'busy') return 'working';
    const marker = this.markerFor(unitId);
    if (!marker || marker.kind === 'working') return null;
    return marker.kind; // done / failed / awaiting（task_049：? 与 !/✓ 同列事件浮标）
  }

  /** 同相位重复事件：刷新落板时刻（done 重计淡出窗），但不算实质变化。 */
  private set(unitId: string, kind: TaskMarkerKind): boolean {
    const existing = this.markers.get(unitId);
    this.markers.set(unitId, { kind, sinceMs: this.nowFn() });
    return !existing || existing.kind !== kind;
  }
}

// ============================================================================
// 事件落地（characterId → 单位）
// ============================================================================

/** 落地器需要的单位最小形状（UnitObject 满足；单测用字面量桩）。 */
export interface TaskFxUnitRef {
  readonly id: string;
  readonly characterId: string | null;
}

/**
 * 把一条任务生命周期事件落到状态板：按 task.characterId 反查单位集合，命中全部落板。
 * 返回命中的单位 id（场景/测试据此知道这次动到了谁；角色没上战场 → 空数组，静默跳过）。
 * why 纯函数而不写在场景里：场景 import phaser 后 node 测不了 —— "事件 → 表现"的映射
 *   是本任务的核心行为，必须可穷举测试（见 __tests__/task-fx.test.ts 的桩场景用例）。
 */
export function applyTaskFxEvent(
  board: TaskFxBoard,
  units: readonly TaskFxUnitRef[],
  task: CharacterTask,
  phase: TaskFxPhase
): readonly string[] {
  const hitUnitIds: string[] = [];
  for (const unit of units) {
    if (unit.characterId !== task.characterId) continue;
    hitUnitIds.push(unit.id);
    if (phase === 'started') board.setWorking(unit.id);
    else if (phase === 'completed') board.setDone(unit.id);
    else if (phase === 'awaiting_approval') board.setAwaiting(unit.id);
    else board.setFailed(unit.id);
  }
  return hitUnitIds;
}
