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
 * 颜色口径（@since v3.3，task_110）：色值改为取自**唯一事实源** core/theme/visual-spec.ts
 *   （world 门面 = ../theme 的 WORLD_PALETTE）—— 不再镜像 hud 的同名 token：
 *   done=success、failed=danger、环=progress、awaiting=progress（调色板无独立「待审批」色，
 *   归入进度琥珀；与 unit-layer 的 busy 态同源，两处不再各抄一份）。
 *
 * ============ 审批门挂起浮标（@since v3.25，task_049）============
 * task.awaiting_approval → awaiting（黄色 ?，驻留到下一次状态变化）：plan-first 任务的计划
 * 轮结束、等用户裁决。与 failed 的 ! 同一驻留语义（不自动过期 —— 门开着就该一直问）；
 * 批准（task.approved → started 相位）盖回工作环，驳回（task.failed）换成 !。
 * why 单位此刻不 busy（挂起不算忙）：busy 派生永远画环的裁决不会盖住 ? —— 状态与表现天然对齐。
 *
 * @since v3.17（task_038）；v3.25（task_049）追加 awaiting 浮标（审批门）；
 * v3.3（task_077）追加「交互特效的纯裁决」段（框选波浪 / 指令流线 / 翻卡 / 插旗 / 集火）。
 */

import type { CharacterTask, Point, UnitStatus } from '../../core/types';
import type { SpriteFxKind } from '../appearance/fx-atlas';
import { INTERACTION_FX_METRICS, WORLD_PALETTE } from '../theme';

// ============================================================================
// 样式常量（变体钩子：全部可调参数集中一处）
// ============================================================================

/** 进度环变体的参数。 */
export interface TaskFxRingStyle {
  /** 环半径（世界坐标 px）。 */
  readonly radius: number;
  readonly lineWidth: number;
  /** 环的颜色（busy 态色，与 unit-layer 的 COLOR_BY_STATUS.busy 同源 = 调色板 progress）。 */
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
  /** ✓ 浮标：完成色（调色板 success）+ 存活时长（淡出总时长）。 */
  readonly done: { readonly color: number; readonly ttlMs: number };
  /** ! 浮标：失败色（调色板 danger）。驻留时长不设 —— 由下一次状态变化裁决。 */
  readonly failed: { readonly color: number };
  /** ? 浮标（@since v3.25，task_049）：待审批色（调色板 progress）。驻留到下一次状态变化。 */
  readonly awaiting: { readonly color: number };
  readonly marker: TaskFxMarkerStyle;
  /** 动画步进间隔（ms；30fps 足够环旋转与淡出平滑）。 */
  readonly tickMs: number;
}

/** 默认样式（ring 变体）。改观感只动这里，不动绘制器。 */
export const TASK_FX_STYLE: TaskFxStyle = {
  variant: 'ring',
  ring: { radius: 9, lineWidth: 2.5, color: WORLD_PALETTE.progress, arcDegrees: 270, rotationDegPerSec: 220 },
  done: { color: WORLD_PALETTE.success, ttlMs: 1500 },
  failed: { color: WORLD_PALETTE.danger },
  awaiting: { color: WORLD_PALETTE.progress },
  marker: { radius: 11, backdropColor: WORLD_PALETTE.background, backdropAlpha: 0.6, yAboveUnit: 44 },
  tickMs: 33,
};

// ============================================================================
// 右击移动的目标点涟漪样式（@since v3.21，task_045）
// ============================================================================

/**
 * 目标点涟漪的可调参数（常量可调，同 TASK_FX_STYLE 先例）。
 * 血缘（v2 考古）：ParticleEffects.agentArrivalRipple —— 半径 10→50、alpha 0.7→0、
 * 600ms Power2.easeOut、2px 描边 + 10% 充填；v3 颜色取绿（调色板 success，与 done ✓
 * 同族「去了/成了」的正反馈色；v2 用的是主题主色，这里按 task_045 规格改绿）。
 */
export interface MoveRippleStyle {
  /** 涟漪色（调色板 success）。 */
  readonly color: number;
  readonly radiusFrom: number;
  readonly radiusTo: number;
  readonly lineWidth: number;
  readonly alphaFrom: number;
  readonly durationMs: number;
}

/** 默认涟漪样式（v2 口径原样，只换色）。 */
export const MOVE_RIPPLE_STYLE: MoveRippleStyle = {
  color: WORLD_PALETTE.success,
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

// ============================================================================
// 精灵特效的触点映射（@since v3.3，task_161）
// ============================================================================

/**
 * 任务相位 → 精灵特效 kind（**触点映射的唯一裁决处**）。
 *
 * why 映射要单独裁决：触点散在场景各处（任务事件 / 单位上下场 / 指令 / 升级），
 *   若各处各自写死"完成就 celebrate"，改一次演出要改 N 处 —— 抽成一张表，
 *   单测也能对着这张表逐条断言（task_161 requirement 6）。
 *
 * @param phase 任务生命周期相位。
 * @returns 该相位该播的特效；不该播特效时返回 null。
 */
export function fxKindForTaskPhase(phase: TaskFxPhase): SpriteFxKind | null {
  switch (phase) {
    // 完成 = 庆祝（彩带）；失败 = 报错冲击；开工 / 挂起不上特效（头顶浮标已经在说这件事）。
    case 'completed':
      return 'celebrate';
    case 'failed':
      return 'error';
    case 'started':
    case 'awaiting_approval':
      return null;
  }
}

// ============================================================================
// 交互特效的纯裁决（@since v3.3，task_077 / DEMO-PLAN §4「点击与指令特效」）
// ============================================================================
// 框选 / 指令 / 翻卡 / 插旗 / 集火五件事的**纯算术**都在这一段：波浪位次、虚线几何、
// 渐变色、翻卡变换、旗面弹性、脉冲半径。绘制在 objects/task-fx-layer.ts。
// why 纯逻辑单独一段而不塞进绘制器：这些是"算出来的规格"（每 40ms 一个、800ms 淡出、
//   Back.Out 弹性），node 单测能穷举断言；绘制器只负责把算出来的值画到屏幕上。

/**
 * 交互特效的样式（颜色口径 = 调色板门面；尺寸口径 = 唯一事实源）。
 * why 单独一张样式表：交互特效散在五处（框选 / 流线 / 翻卡 / 插旗 / 集火），
 *   改观感只动这里 —— 与 TASK_FX_STYLE 同一纪律。
 */
export interface InteractionFxStyle {
  /** 流线起点色（青 = 我方单位主色）。 */
  readonly flowStartColor: number;
  /** 流线终点色（目标色；缺省 = 装饰紫）。 */
  readonly flowEndColor: number;
  /** 流线描边粗细（px）。 */
  readonly flowLineWidthPx: number;
  /** 翻卡背面色（中性灰 —— 灰不是语义色，故不进调色板）。 */
  readonly cardBackColor: number;
  /** 翻卡正面色（亮 = 被认领；用我方主色）。 */
  readonly cardFrontColor: number;
  /** 翻卡正面图标色（深色，压在亮面上）。 */
  readonly cardIconColor: number;
  /** 卡片宽 / 高（世界坐标 px）。 */
  readonly cardWidthPx: number;
  readonly cardHeightPx: number;
  /** 旗杆色（中性灰）/ 旗面色（完成 = 翠绿）。 */
  readonly flagPoleColor: number;
  readonly flagClothColor: number;
  /** 集火脉冲色（卡住 = 绯红）。 */
  readonly focusPulseColor: number;
}

/** 默认交互特效样式。 */
export const INTERACTION_FX_STYLE: InteractionFxStyle = Object.freeze({
  flowStartColor: WORLD_PALETTE.unit,
  flowEndColor: WORLD_PALETTE.accent,
  flowLineWidthPx: 2,
  cardBackColor: 0x5c6470,
  cardFrontColor: WORLD_PALETTE.unit,
  cardIconColor: WORLD_PALETTE.background,
  cardWidthPx: 46,
  cardHeightPx: 58,
  flagPoleColor: 0x9ca3af,
  flagClothColor: WORLD_PALETTE.success,
  focusPulseColor: WORLD_PALETTE.danger,
});

/**
 * 指令 / 集火时冒的气泡文案。
 * why 现在就写死：气泡系统（task_076，world/speech-templates.ts）尚未合入，
 *   本任务按规格只**发事件**（unit.bubble）不自己渲染气泡 —— 文案暂放这里，
 *   task_076 合入后由句库接管（接线注释见 objects/task-fx-layer.ts 的 bubble 钩子）。
 */
export const INTERACTION_BUBBLE_TEXT = Object.freeze({
  /** 普通指令：单位统一回一句「收到」。 */
  command: '收到',
  /** 集火支援：选中群同时冒「来了来了」。 */
  focus: '来了来了',
});

/** 波浪式弹选择环的一个位次。 */
export interface SelectionWaveSlot {
  readonly unitId: string;
  /** 相对起拍的延迟（ms）。 */
  readonly delayMs: number;
}

/**
 * 命中单位的波浪位次：每 intervalMs 一个（DEMO-PLAN §4「每 40ms 一个」）。
 * why 返回"位次 + 延迟"而不是直接给回调：绘制层要按延迟逐个起拍，
 *   而"哪几个单位、隔多久"这件事是纯算术 —— 单测直接断言这张表。
 */
export function selectionWaveSchedule(
  unitIds: readonly string[],
  intervalMs: number = INTERACTION_FX_METRICS.selectionWave.intervalMs
): readonly SelectionWaveSlot[] {
  const slots: SelectionWaveSlot[] = [];
  unitIds.forEach((unitId, index) => {
    slots.push({ unitId, delayMs: index * intervalMs });
  });
  return slots;
}

/** 流动虚线的一段（世界坐标）。 */
export interface FlowDashSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** 该段中点在整条线上的位置（0..1）—— 取渐变色用。 */
  readonly t: number;
}

/**
 * 把一条直线切成流动虚线：offsetPx 越大，虚线越朝目标方向推进（"流动"的算术）。
 * why 在纯函数里切段：渐变要**逐段**取色（青→目标色），段的位置与顺序是规格的一部分，
 *   单测能断言"第 k 段落在哪、颜色参数 t 是多少"。
 */
export function flowDashSegments(
  from: Point,
  to: Point,
  offsetPx: number,
  dashLengthPx: number = INTERACTION_FX_METRICS.command.dashLengthPx,
  gapPx: number = INTERACTION_FX_METRICS.command.dashGapPx
): readonly FlowDashSegment[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1 || dashLengthPx <= 0) return [];
  const ux = dx / length;
  const uy = dy / length;
  const period = dashLengthPx + Math.max(gapPx, 0);
  if (period <= 0) return [];

  const segments: FlowDashSegment[] = [];
  // 首段起点随 offset 前移（offset 增大 = 虚线朝目标方向流动）。
  let start = -(((offsetPx % period) + period) % period);
  while (start < length) {
    const segStart = Math.max(start, 0);
    const segEnd = Math.min(start + dashLengthPx, length);
    if (segEnd - segStart > 0.5) {
      const mid = (segStart + segEnd) / 2;
      segments.push({
        x1: from.x + ux * segStart,
        y1: from.y + uy * segStart,
        x2: from.x + ux * segEnd,
        y2: from.y + uy * segEnd,
        t: mid / length,
      });
    }
    start += period;
  }
  return segments;
}

/** 两色线性混合（t=0 取 a，t=1 取 b）—— 流线渐变取色。 */
export function mixColorT(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const channel = (shift: number): number => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * k);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * 3D 翻卡的横向缩放：|cos(π·p)| —— 1 → 0（侧棱）→ 1。
 * why 取绝对值不做镜像：镜像会把正面图标也翻过来（图标变成反的），2D 假 3D 不做镜像，
 *   只靠"侧棱 → 换面"读出翻卡动作。
 */
export function cardFlipScaleX(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.abs(Math.cos(Math.PI * p));
}

/** 翻卡过半后露正面（背面灰 → 正面亮色 + 图标）。 */
export function cardFlipShowsFront(progress: number): boolean {
  return Math.min(1, Math.max(0, progress)) >= 0.5;
}

/** Back.Out 缓动（入场弹性：先冲过头再回落）。 */
export function easeBackOut(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  // 两端取精确值：公式在 x=0 处会因浮点误差返回 -2.2e-16（旗面起手会有一帧负缩放）。
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/** 旗面展开比例（Back.Out 弹性展开）。 */
export function flagClothScale(progress: number): number {
  return easeBackOut(progress);
}

/** 旗杆升起比例（平滑上升，不回弹 —— 杆是硬的，弹的是旗面）。 */
export function flagPoleProgress(progress: number): number {
  const x = Math.min(1, Math.max(0, progress));
  return 1 - (1 - x) ** 3;
}

/** 集火脉冲环半径（进度 0→1）。 */
export function footPulseRadius(progress: number, fromPx: number, toPx: number): number {
  const x = Math.min(1, Math.max(0, progress));
  return fromPx + (toPx - fromPx) * x;
}

/** 集火脉冲环透明度（线性淡出）。 */
export function footPulseAlpha(progress: number): number {
  const x = Math.min(1, Math.max(0, progress));
  return 1 - x;
}

/**
 * 流线整体透明度：前段保持不透明，尾段（fadeRatio）线性淡出。
 * why 不是从头就淡：规格是「800ms 后淡出」—— 先让虚线跑完，最后一段才化掉。
 */
export function flowFadeAlpha(progress: number, fadeRatio: number): number {
  const x = Math.min(1, Math.max(0, progress));
  const start = 1 - Math.min(1, Math.max(0, fadeRatio));
  if (x <= start) return 1;
  return 1 - (x - start) / Math.max(1e-6, 1 - start);
}
