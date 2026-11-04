/**
 * 文件职责：**单位动画八态的纯逻辑层**（task_075 / DEMO-PLAN §2「单位动画八态」）——
 *   把「此刻这个单位该是什么样子」算成一份**姿态**（pose），由渲染层
 *   （objects/unit-layer.ts）兑现成 Phaser 显示对象。
 *   规格八态：待机三件套（悬浮 bob / 眨眼 / 天线摆）/ 工作态（前倾 + 微颤 + 头顶进度弧 +
 *   squash-stretch）/ 卡住态（灰度 + ❗ 弹跳 + 抖动）/ 完成态（squash → 跳 20px → 星尘粒子）/
 *   摸鱼态（z→Z→Z 上升淡出）/ 选中（脚下旋转虚线环）/ hover（放大 + 喷口微光）/
 *   点击（白圈涟漪 + squash）。
 * 输入：业务态镜像（status / online / 有无任务 / 是否选中 / 是否 hover）+ 场景时钟（ms）。
 * 输出：UnitAnimationPose（只读姿态数据）+ UnitAnimationController（**每单位一个**的控制器）。
 * 禁止事项：
 *   1. import phaser —— 本文件零渲染引擎依赖（node 单测直接 import，与 unit-presence.ts 同纪律）；
 *   2. import hud / app / vue / legacy(stratix-rts) —— 铁律：world 只认识 core/types；
 *   3. 持第二份业务真相 —— 业务态由 core 广播，这里只做「态 → 姿态」的纯映射；
 *   4. 写死尺寸 / 时长 / 色值字面量 —— 尺寸时长取自唯一事实源
 *      （core/theme/visual-spec.ts 的 UNIT_ANIMATION_METRICS），色值由渲染层从调色板取；
 *   5. 在 import 期读时钟 / 随机 —— 相位由单位 id 哈希**确定性**派生（可重现、单元可测）。
 *
 * ============ 为什么「相位」是派生的而不是随机的 ============
 * 规格要求「动画相位随机错开，禁止全屏整齐划一」。若用 Math.random()，每次重建单位相位就变、
 * 单测无法断言；故相位由 **单位 id 哈希** 派生（FNV-1a + 末置雪崩，同 unit-presence.ts 的
 * breathPhaseFor 口径）：同一个 id 永远同相位 → 可重现；不同 id 的相位均匀散开 → 不整齐划一。
 * 眨眼间隔同理：延迟 = 3-6s 区间内按 (id, 第几次眨眼) 哈希取值，各单位各跳各的。
 *
 * ============ 八态的建模：五基态 + 三叠加 ============
 * 前五态（待机/工作/卡住/完成/摸鱼）是**互斥的基态**（body 姿态互斥：前倾 vs 抖动 vs 跳跃）；
 * 后三态（选中/hover/点击）是**叠加层**（脚下环 / 放大微光 / 涟漪），可与任一基态共存
 * —— 生产态里「一个正在工作的单位被选中」是常态，不是二选一。
 * dev 逐态验收时强制态会把叠加层也一并裁决（强制「待机」= 干净的待机，不带选中环），
 * 见 setForcedState 的注释。
 *
 * @since v3.3（task_075）。
 */

import type { UnitStatus } from '../../core/types';
import { UNIT_ANIMATION_METRICS, VISUAL_METRICS } from '../theme';

/** 动画度量（唯一事实源 = core/theme/visual-spec.ts）。 */
const M = UNIT_ANIMATION_METRICS;

/** 五个互斥的基态。 */
export type UnitAnimationBase = 'idle' | 'working' | 'stuck' | 'completed' | 'slacking';

/** 八个可验收的动画状态（DEMO-PLAN §2 的八条）。 */
export type UnitAnimationState = UnitAnimationBase | 'selected' | 'hover' | 'clicked';

/** 八态词表（dev 逐态按钮按此顺序排）。 */
export const UNIT_ANIMATION_STATES: readonly UnitAnimationState[] = Object.freeze([
  'idle',
  'working',
  'stuck',
  'completed',
  'slacking',
  'selected',
  'hover',
  'clicked',
]);

/** 强制态 → 基态的映射（叠加态强制时落到「待机」基态：干净的待机，不带前倾/抖动）。 */
const BASE_OF: Readonly<Record<UnitAnimationState, UnitAnimationBase>> = Object.freeze({
  idle: 'idle',
  working: 'working',
  stuck: 'stuck',
  completed: 'completed',
  slacking: 'slacking',
  selected: 'idle',
  hover: 'idle',
  clicked: 'idle',
});

/**
 * 任务生命周期相位（@since v3.8，task_141）—— **角色任务**（core/task 的 CharacterTask）的相位，
 * 驱动单位的动画基态。
 *
 * why 与 UnitStatus 分开：status 是契约冻结的忙闲（idle/busy/offline/error），
 *   词表里**没有**「刚干完」「卡住了」这两种业务语义；而八态动画需要它们
 *   （完成 = 庆祝、失败 = 卡住）。故任务相位另起一个四态词表，由事件流驱动。
 * - 'none'      = 没有在办任务（静息；基态按 075 的老派生走）
 * - 'running'   = 任务在跑 → 工作态
 * - 'completed' = 任务刚完成 → 收工站直（庆祝演出是正交瞬态，基态回待机）
 * - 'failed'    = 任务失败 → 卡住态（❗ + 灰度 + 抖动）
 *
 * 相位板的实现见 appearance/task-animation.ts（纯逻辑，单测在那）。
 */
export type UnitTaskPhase = 'none' | 'running' | 'completed' | 'failed';

/**
 * 姿态计算需要的业务态镜像（只读）。
 * why 不直接吃 UnitView：渲染层每个 tick 都拿得到 UnitObject，但**表现层不该重新解析业务语义** ——
 * 这里收窄成四个布尔/枚举，便于单测穷举。
 */
export interface UnitAnimationContext {
  /** 业务态（idle / busy / offline / error）。 */
  readonly status: UnitStatus;
  /** 是否在线（离线 = 生命感全停，静止灰显）。 */
  readonly online: boolean;
  /** 是否带着任务（无任务空闲 = 摸鱼态）。 */
  readonly hasMission: boolean;
  /** 是否被选中。 */
  readonly selected: boolean;
  /** 是否被 hover。 */
  readonly hovered: boolean;
  /**
   * 任务生命周期相位（@since v3.8，task_141）：缺省 = 'none'（无任务相位信息）。
   *
   * why 可选而非必填：契约增补不许破既有构造点（单测夹具 / 老调用方）——
   * 缺省即 075 的老行为（busy→working / error→stuck / 无任务→摸鱼）。
   */
  readonly taskPhase?: UnitTaskPhase;
}

/** 摸鱼态冒出的一个 z（序号 / 透明度 / 抬升量 / 放大倍率）。 */
export interface UnitZzz {
  /** 第几个 z（0/1/2）。 */
  readonly index: number;
  /** 透明度 0..1。 */
  readonly alpha: number;
  /** 抬升量（px，负 = 向上）。 */
  readonly offsetY: number;
  /** 放大倍率（越往上越大一点）。 */
  readonly scale: number;
}

/**
 * 一帧的姿态快照（渲染层唯一的输入）。
 * 所有位移单位 = 世界坐标 px；所有角度 = 度；所有缩放 = 相对倍率（1 = 不变形）。
 */
export interface UnitAnimationPose {
  /** 基态（五态之一）。 */
  readonly base: UnitAnimationBase;
  /** 选中叠加生效中。 */
  readonly selected: boolean;
  /** hover 叠加生效中。 */
  readonly hovered: boolean;
  /** 悬浮位移（px，负 = 向上；待机三件套之一）。 */
  readonly bobOffsetY: number;
  /** 身体前倾角（度；工作态）。 */
  readonly leanDeg: number;
  /** 高频微颤水平位移（px；工作态）。 */
  readonly tremorOffsetX: number;
  /** 卡住态身体抖动水平位移（px）。 */
  readonly shakeOffsetX: number;
  /** 垂直缩放倍率（squash-stretch / 跳跃前的压缩 / 点击 squash）。 */
  readonly scaleY: number;
  /** 水平缩放倍率（与 scaleY 反向补偿，保体积观感）。 */
  readonly scaleX: number;
  /** 跳跃抬升（px，负 = 向上；完成态）。 */
  readonly jumpOffsetY: number;
  /** 眼睛闭合度 0..1（1 = 压成横线；待机三件套之一）。 */
  readonly eyeClose: number;
  /** 天线摆角（度；待机三件套之一）。 */
  readonly antennaDeg: number;
  /** 头顶进度弧进度 0..1（null = 不画；工作态）。 */
  readonly progressArc: number | null;
  /** 头顶 ❗ 弹跳位移（px，负 = 向上；null = 不画；卡住态）。 */
  readonly alertOffsetY: number | null;
  /** 摸鱼态冒出的 z 序列（空数组 = 不冒）。 */
  readonly zzz: readonly UnitZzz[];
  /** 选中环旋转角（度）。 */
  readonly selectionRingDeg: number;
  /** hover 缩放倍率（1 = 不放大）。 */
  readonly hoverScale: number;
  /** 底盘喷口微光强度 0..1。 */
  readonly thrusterGlow: number;
  /** 点击涟漪进度 0..1（null = 无）。 */
  readonly clickRipple: number | null;
  /** 完成态星尘进度 0..1（null = 无）。 */
  readonly dustProgress: number | null;
  /** 灰度化程度 0..1（0 = 原色；卡住态 50%）。 */
  readonly grayscale: number;
}

/**
 * **每单位一个**的动画控制器。
 *
 * 它持三样东西：
 *   1. **相位**（按 id 哈希派生）—— 让同屏单位不整齐划一；
 *   2. **瞬态触发时刻**（点击 / 完成）—— 决定瞬态动画从哪一帧开始；
 *   3. **强制态**（dev 逐态验收用）—— 生产恒为 null（走业务态自动派生）。
 *
 * why 控制器挂在单位上而不是全局单例：瞬态（点击涟漪 / 完成跳跃）是**每单位**的，
 *   放进全局单例就得分不清是谁点的。
 */
export class UnitAnimationController {
  /** 单位 id（相位派生用）。 */
  readonly unitId: string;
  /** 相位（弧度，[0, 2π)）：按单位 id 确定性派生。 */
  readonly phase: number;

  /** 强制态（dev 逐态验收用）；null = 跟随业务态自动派生。 */
  private forcedState: UnitAnimationState | null = null;
  /** 点击涟漪的起始时刻（ms）。 */
  private clickAtMs = Number.NEGATIVE_INFINITY;
  /** 完成动画的起始时刻（ms）。 */
  private completedAtMs = Number.NEGATIVE_INFINITY;
  /** 眨眼计数（第几次眨眼，用于哈希取间隔）。 */
  private blinkIndex = 0;
  /** 下一次眨眼的起始时刻（ms；首次 pose 时按当前时钟起算）。 */
  private nextBlinkAtMs = 0;
  /** 眨眼时间基准是否已锚定（锚在「第一次被渲染」的时刻）。 */
  private blinkEpochSet = false;

  constructor(unitId: string) {
    this.unitId = unitId;
    this.phase = hashUnit01(unitId, 0x51a7e) * Math.PI * 2;
  }

  /** 当前强制态（null = 自动）。 */
  get forced(): UnitAnimationState | null {
    return this.forcedState;
  }

  /**
   * 强制一个状态（dev 逐态验收用；传 null 回到业务态自动派生）。
   *
   * why 强制态连叠加层一起裁决：验收「待机」要看到**干净的**待机（没有选中环、没有 hover 放大）；
   * 反过来强制「选中」要看到虚线环 —— 所以强制态是整套切换，不是只换基态。
   * 传 'clicked' / 'completed' 时同时把瞬态动画重新起拍（否则按下按钮后动画已经放完了）。
   */
  setForcedState(state: UnitAnimationState | null, nowMs = 0): void {
    this.forcedState = state;
    if (state === 'clicked') this.clickAtMs = nowMs;
    if (state === 'completed') this.completedAtMs = nowMs;
  }

  /** 点击涟漪起拍（生产：点击命中单位时调用）。 */
  triggerClick(nowMs: number): void {
    this.clickAtMs = nowMs;
  }

  /** 完成动画起拍（生产：任务完成落到该单位时调用）。 */
  triggerCompleted(nowMs: number): void {
    this.completedAtMs = nowMs;
  }

  /**
   * 算某一时刻的姿态。
   *
   * @param ctx 业务态镜像
   * @param nowMs 场景时钟（ms）
   */
  pose(ctx: UnitAnimationContext, nowMs: number): UnitAnimationPose {
    const forced = this.forcedState;
    const base: UnitAnimationBase = forced ? BASE_OF[forced] : resolveBase(ctx);
    const selected = forced ? forced === 'selected' : ctx.selected;
    const hovered = forced ? forced === 'hover' : ctx.hovered;
    const alive = ctx.online;

    // 强制态下的瞬态重放：点击涟漪 / 完成动画都是一次性演出，dev 逐态验收要能一直看见，
    // 故强制态下到点自动重起（生产态不重放 —— 一次性演出就该演一次）。
    if (forced === 'clicked' && nowMs - this.clickAtMs >= M.click.rippleMs) this.clickAtMs = nowMs;
    if (forced === 'completed' && nowMs - this.completedAtMs >= completedDurationMs()) {
      this.completedAtMs = nowMs;
    }

    const eyeClose = alive ? this.eyeCloseAt(nowMs) : 0;
    const antennaDeg = alive
      ? M.antenna.amplitudeDeg * Math.sin((2 * Math.PI * nowMs) / M.antenna.periodMs + this.phase + 1.1)
      : 0;

    // —— 基态分派 ——
    let bobOffsetY = 0;
    let leanDeg = 0;
    let tremorOffsetX = 0;
    let shakeOffsetX = 0;
    let scaleY = 1;
    let jumpOffsetY = 0;
    let progressArc: number | null = null;
    let alertOffsetY: number | null = null;
    let zzz: readonly UnitZzz[] = [];
    let grayscale = 0;
    let dustProgress: number | null = null;

    if (base === 'working') {
      leanDeg = M.working.leanDeg;
      tremorOffsetX = M.working.tremorAmplitudePx *
        Math.sin(2 * Math.PI * M.working.tremorHz * (nowMs / 1000) + this.phase);
      // 进度弧 0→360° 循环；起点按相位错开 → 同屏多个工作单位不同步转圈。
      progressArc = (nowMs / M.working.arcPeriodMs + this.phase / (2 * Math.PI)) % 1;
      scaleY = workingSquashScaleY(nowMs);
    } else if (base === 'stuck') {
      grayscale = M.stuck.grayscale;
      const cycle = ((nowMs % M.stuck.alertBouncePeriodMs) + M.stuck.alertBouncePeriodMs) % M.stuck.alertBouncePeriodMs;
      if (cycle < M.stuck.alertBounceMs) {
        // 每 2s 弹跳一次：前 400ms 走一个「弹起—落下」的半正弦，其余时间静止。
        const u = cycle / M.stuck.alertBounceMs;
        alertOffsetY = -M.stuck.alertBounceHeightPx * Math.sin(Math.PI * u);
        // 身体与 ❗ 同步抖一下。
        shakeOffsetX = M.stuck.shakeAmplitudePx * Math.sin(2 * Math.PI * M.stuck.shakeHz * (cycle / 1000));
      } else {
        alertOffsetY = 0;
        shakeOffsetX = 0;
      }
    } else if (base === 'slacking') {
      zzz = zzzSequence(nowMs);
    }

    // —— 完成态演出（一次性瞬态，与基态正交）——
    // why 正交：生产里「任务完成」这个瞬间，单位可能正在工作（收尾）也可能已回到待机 ——
    //   完成演出是叠加在当时的基态之上的（跳一下 + 落地星尘），不是把基态改掉。
    let completedT = nowMs - this.completedAtMs;
    if (forced === 'completed' && completedT >= completedDurationMs()) {
      // 强制态：演出放完自动重起（dev 逐态验收要能一直看见）。
      this.completedAtMs = nowMs;
      completedT = 0;
    }
    if (completedT >= 0 && completedT < completedDurationMs()) {
      if (completedT < M.completed.squashMs) {
        // 第一拍：压扁（squash）。
        const u = completedT / M.completed.squashMs;
        scaleY *= 1 + (M.working.squashMinScaleY - 1) * easeOutCubic(u);
      } else if (completedT < M.completed.squashMs + M.completed.jumpMs) {
        // 第二拍：原地起跳（20px，抛物线），同时把压扁弹回。
        const u = (completedT - M.completed.squashMs) / M.completed.jumpMs;
        scaleY *= M.working.squashMinScaleY + (1 - M.working.squashMinScaleY) * easeOutCubic(u);
        jumpOffsetY = -M.completed.jumpHeightPx * Math.sin(Math.PI * u);
      } else {
        // 第三拍：落地，脚下爆星尘。
        dustProgress = (completedT - M.completed.squashMs - M.completed.jumpMs) / M.completed.dustMs;
      }
    }

    // 待机基态（含叠加态落到 idle 的情形）：悬浮 bob。
    if (base === 'idle' && alive) {
      bobOffsetY = -M.bob.amplitudePx * Math.sin((2 * Math.PI * nowMs) / M.bob.periodMs + this.phase);
    }

    // —— 叠加层 ——
    const selectionRingDeg = ((nowMs / M.selection.ringPeriodMs) * 360 + (this.phase * 180) / Math.PI) % 360;
    const hoverScale = hovered ? VISUAL_METRICS.hoverScale : 1;
    const thrusterGlow = hovered ? 1 : 0;

    let clickRipple: number | null = null;
    if (nowMs - this.clickAtMs < M.click.rippleMs) {
      const u = (nowMs - this.clickAtMs) / M.click.rippleMs;
      clickRipple = u;
      // 涟漪的同时 squash 一下。
      scaleY *= M.click.squashScaleY + (1 - M.click.squashScaleY) * easeOutCubic(u);
    }

    // 水平缩放做反向补偿：压扁时略宽、拉伸时略窄（保体积观感）。
    const scaleX = 1 + (1 - scaleY) * 0.5;

    return {
      base,
      selected,
      hovered,
      bobOffsetY,
      leanDeg,
      tremorOffsetX,
      shakeOffsetX,
      scaleY,
      scaleX,
      jumpOffsetY,
      eyeClose,
      antennaDeg,
      progressArc,
      alertOffsetY,
      zzz,
      selectionRingDeg,
      hoverScale,
      thrusterGlow,
      clickRipple,
      dustProgress,
      grayscale,
    };
  }

  /** 当前这一拍的眨眼闭合度 0..1（120ms 窗口：闭眼 → 睁开）。 */
  private eyeCloseAt(nowMs: number): number {
    if (!this.blinkEpochSet) {
      // 首次被渲染的时刻作为时间基准：单位「活了多久」从此刻算起，
      // 各单位的诞生时刻本就不齐 → 第一次眨眼自然错开。
      this.blinkEpochSet = true;
      this.nextBlinkAtMs = nowMs + this.blinkDelay(0);
    }
    // 把过期的眨眼窗口推进掉（窗口是「下一次眨眼的起点」，过窗即排下一次）。
    while (nowMs >= this.nextBlinkAtMs + M.blink.closedMs) {
      this.blinkIndex += 1;
      this.nextBlinkAtMs += M.blink.closedMs + this.blinkDelay(this.blinkIndex);
    }
    const t = nowMs - this.nextBlinkAtMs;
    if (t < 0 || t >= M.blink.closedMs) return 0;
    const u = t / M.blink.closedMs;
    // 前 25% 闭眼、中段保持、后 25% 睁开 —— 整段 120ms 内完成一次眨眼。
    if (u < 0.25) return u / 0.25;
    if (u < 0.75) return 1;
    return 1 - (u - 0.75) / 0.25;
  }

  /** 第 index 次眨眼与下一次眨眼的间隔（3-6s，按 id + 序号哈希取值）。 */
  private blinkDelay(index: number): number {
    const r = hashUnit01(this.unitId, 0x1000 + index * 2 + 1);
    return M.blink.minIntervalMs + r * (M.blink.maxIntervalMs - M.blink.minIntervalMs);
  }
}

// ============================================================================
// 内部工具
// ============================================================================

/**
 * 基态派生（生产路径）：业务态 + 任务相位 → 动画基态。
 *
 * 优先级（@since v3.8，task_141 补任务相位）：
 * 1. offline → 待机基态 + 生命感全停（离线是全局强信号，盖过任务相位 —— 灰显由渲染层叠加）；
 * 2. 任务相位 'failed' → 卡住态（❗ + 灰度 + 抖动）；
 * 3. status 'error' → 卡住态（agent-link 的远端真相，同 075 口径）；
 * 4. 任务相位 'running' **或** status 'busy' → 工作态（前倾 + 微颤 + 头顶进度弧）；
 * 5. 任务相位 'completed' → 待机基态（收工站直；庆祝演出是正交瞬态，见 pose 的完成段）；
 * 6. idle 且**无任务** → 摸鱼态（规格「摸鱼态（无任务空闲）」，DEMO-PLAN §2）；
 * 7. idle 且有任务 → 待机态。
 *
 * why 第 4 条要「相位 或 busy」两个信号：相位是**事件流**（task.started 来了才有），
 * busy 是**状态快照**（读档恢复时事件早没了，但状态里还写着它在跑）——
 * 两个都成立才敢判「它在干活」。
 */
function resolveBase(ctx: UnitAnimationContext): UnitAnimationBase {
  if (ctx.status === 'offline') return 'idle';
  const phase = ctx.taskPhase ?? 'none';
  if (phase === 'failed') return 'stuck';
  if (ctx.status === 'error') return 'stuck';
  if (phase === 'running' || ctx.status === 'busy') return 'working';
  if (phase === 'completed') return 'idle';
  if (!ctx.hasMission) return 'slacking';
  return 'idle';
}

/**
 * 工作态的 squash-stretch（每 1.5s 一次，scaleY 0.9→1.05→1.0）。
 *
 * why 分三段而不是直接取正弦：规格钦定的是「0.9→1.05→1.0」这条**轨迹**，
 * 正弦只会路过 1.05 附近、回不到 0.9。三段各占周期的一部分：
 *   ① 1.0→0.9（100ms，落地式的下压）② 0.9→1.05（275ms，弹起拉伸）③ 1.05→1.0（余下时间回落）
 * 段与段之间数值连续（不会出现一帧内的跳变），三个规格锚点全部命中。
 */
function workingSquashScaleY(nowMs: number): number {
  const period = M.working.squashPeriodMs;
  const u = ((nowMs % period) + period) % period;
  const holdMs = period * 0.15;
  const stretchMs = period * 0.35;
  const min = M.working.squashMinScaleY;
  const max = M.working.squashMaxScaleY;
  if (u < holdMs) return 1 + (min - 1) * easeOutCubic(u / holdMs);
  if (u < holdMs + stretchMs) return min + (max - min) * easeOutCubic((u - holdMs) / stretchMs);
  const restMs = period - holdMs - stretchMs;
  if (restMs <= 0) return 1;
  return max + (1 - max) * easeOutCubic((u - holdMs - stretchMs) / restMs);
}

/** 摸鱼态的 z→Z→Z 序列（依次上升淡出，循环）。 */
function zzzSequence(nowMs: number): readonly UnitZzz[] {
  const period = M.slacking.periodMs;
  const cycle = ((nowMs % period) + period) % period;
  const out: UnitZzz[] = [];
  for (let index = 0; index < 3; index += 1) {
    const start = index * M.slacking.stepMs;
    const t = cycle - start;
    if (t < 0 || t >= M.slacking.lifeMs) continue;
    const u = t / M.slacking.lifeMs;
    // 起手一小段淡入、整程淡出（规格「上升淡出」；淡入只是避免「啪」地冒出来）。
    const alpha = Math.min(1, u / 0.15) * (1 - u);
    out.push({
      index,
      alpha,
      offsetY: -M.slacking.risePx * u,
      scale: 0.75 + 0.45 * u,
    });
  }
  return out;
}

/** 完成态演出的总时长（压缩 + 起跳 + 星尘）：用于强制态下的自动重放。 */
function completedDurationMs(): number {
  return M.completed.squashMs + M.completed.jumpMs + M.completed.dustMs;
}

/** 缓出三次方。 */
function easeOutCubic(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return 1 - (1 - x) ** 3;
}

/**
 * 单位 id + 盐 → [0, 1) 的确定性哈希值。
 *
 * why 不用 Math.random()：相位要「可重现」（节点重建不换相位、单测可断言），
 * 又要「不同 id 散开」（同前缀 id 族用裸 FNV 会塌缩在窄区间，故加末置雪崩混合，
 * 同 unit-presence.breathPhaseFor 的口径）。
 */
function hashUnit01(unitId: string, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < unitId.length; i += 1) {
    hash ^= unitId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}
