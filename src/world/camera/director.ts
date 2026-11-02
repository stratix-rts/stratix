/**
 * 文件职责：**导演模式的镜头编排器** —— 订阅任务事件后自动接管镜头
 *   （缓动到事件点 → 停留 → 回全景），静默太久则缓慢巡视（漂移 pan）。
 *   方案来源：docs/DEMO-PLAN.md §7「导演模式（08）」。
 * 输入：导演宿主（DirectorHost：视口 / 边界 / 时钟 / 镜头动作）+ 任务事件（开工 / 完成 / 报错）。
 * 输出：对宿主的镜头动作调用（tweenTo / place / schedule）与一次手动让位回调。
 * 禁止事项：
 *   1. import phaser —— 本文件刻意零渲染依赖：宿主把 Phaser 能力（补间 / 延时）注入进来，
 *      于是整套编排在 node 环境下可单测（与 camera/camera-controller 同一条纪律）；
 *   2. 自己实现优先级 / 静默 / 巡视路径 —— 规则住在 ./director-policy，这里只负责编排时序；
 *   3. 直接 import core/bus —— 事件的订阅在 bridge（world 只有那一个口子），本文件只被喂；
 *   4. 持有业务状态 —— 导演不关心「谁做了什么」，只关心「镜头看哪儿」。
 *
 * ★ 手动优先（DEMO-PLAN §7「与手动操作冲突时手动优先并自动退出导演模式」）：
 *   用户一碰镜头（拖拽 / 滚轮 / 双击跟随 / ESC），宿主就调 releaseByManual() ——
 *   导演立刻停手（连同在飞的补间一起撤掉，否则会和手动操作抢镜头），并回调宿主一次，
 *   由宿主把「导演已关」发回 core，HUD 顶栏的开关随之熄灭。
 */

import type { Bounds, Point } from '../../core/types';
import { DIRECTOR_METRICS } from '../theme';

import type { CameraPose, Viewport } from './camera-math';
import { overviewPose } from './camera-nav';
import {
  isSilentSince,
  patrolPose,
  resolveFocus,
  type DirectorEventKind,
  type DirectorFocusSlot,
} from './director-policy';

/** 导演的编排相位（纯展示用，便于调试与单测断言）。 */
export type DirectorPhase =
  /** 未开启。 */
  | 'off'
  /** 开启中，等事件。 */
  | 'idle'
  /** 正缓动到事件点 / 停留在事件点。 */
  | 'focus'
  /** 停留结束，正在回全景。 */
  | 'returning'
  /** 静默巡视（漂移 pan）。 */
  | 'patrol';

/**
 * 宿主契约：导演需要世界层提供的能力（把 Phaser 挡在门外）。
 *
 * why 用宿主接口而不是直接拿相机：导演要的是「把镜头缓动到某处」「延时做某事」，
 *   场景怎么实现（Phaser 补间 / 场景时钟）是场景的事 —— 换掉渲染引擎时导演一行不用改。
 */
export interface DirectorHost {
  /** 当前视口尺寸（世界坐标换算的基准）。 */
  readonly viewport: () => Viewport;
  /** 世界边界（镜头钳制的依据）。 */
  readonly bounds: Bounds;
  /** 场景时钟（ms，单调）。 */
  readonly now: () => number;
  /** 缓动镜头到位姿（导演的移动都走它，保证每一帧都过钳制）。 */
  tweenTo(pose: CameraPose, durationMs: number): void;
  /** 直接落位（巡视漂移用：连续移动，不走补间）。 */
  place(pose: CameraPose): void;
  /** 延时回调；返回取消闭包（导演停手时必须把在飞的延时撤掉）。 */
  schedule(ms: number, fn: () => void): () => void;
  /** 撤销在飞的镜头补间（手动介入时必须撤 —— 否则补间会和手动操作抢镜头）。 */
  cancelTween(): void;
  /** 手动介入 → 通知外部（world 发 camera.director=false 事件，core 据此熄灭 HUD 开关）。 */
  onManualRelease(): void;
}

/**
 * 导演控制器：把「事件 → 镜头」的编排按时间轴串起来。
 *
 * 时序（DEMO-PLAN §7）：
 *   事件到达 → 600ms 缓动到事件点（zoom 1.2x）→ 停留 3s → 600ms 回全景 → 静默；
 *   静默超过 8s → 缓慢巡视（漂移 pan）；再有事件 → 打断巡视，重新聚焦。
 */
export class DirectorController {
  private readonly host: DirectorHost;
  private enabled = false;
  private phase: DirectorPhase = 'off';
  /** 当前正在跟随的事件（null = 没在跟随任何事件）。 */
  private focus: DirectorFocusSlot | null = null;
  /** 最近一次导演事件的时刻（静默判定用）。 */
  private lastEventAt: number | null = null;
  /** 巡视起点时刻（漂移相位用）。 */
  private patrolStartedAt: number | null = null;
  /** 在飞的延时回调的取消闭包（停手时必须撤掉）。 */
  private cancelPending: (() => void) | null = null;

  constructor(host: DirectorHost) {
    this.host = host;
  }

  /** 导演是否开启。 */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 当前编排相位（调试 / 单测用）。 */
  get currentPhase(): DirectorPhase {
    return this.phase;
  }

  /** 当前跟随的事件（null = 没在跟随）。 */
  get currentFocus(): DirectorFocusSlot | null {
    return this.focus;
  }

  /**
   * 外部开关（core → world 的 camera.director 事件转发进来）。
   *
   * 幂等：重复设置同一个值不做事（事件在总线上可能回环一次 —— core 发出的事件
   * 也会回到 world 的订阅，不幂等就会出现「开→关→开」的抖动）。
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.phase = 'idle';
      this.focus = null;
      // 刚开启时把「静默起点」定在当下：不然开启瞬间就被判成静默、镜头立刻开始漂。
      this.lastEventAt = this.host.now();
      this.patrolStartedAt = null;
      return;
    }
    this.stop();
  }

  /**
   * 收到任务事件（开工 / 完成 / 报错）。
   *
   * @param kind 事件种类（决定优先级）。
   * @param target 事件点（世界坐标）；null = 找不到对应单位 —— 没有点可看就不动镜头
   *   （报错的红色提示由 HUD 屏幕空间的红光晕承担，见 task_086）。
   * @returns 本次事件是否抢下了镜头（false = 被更高优先级的事件压住 / 没开导演）。
   */
  receive(kind: DirectorEventKind, target: Point | null): boolean {
    if (!this.enabled) return false;
    const at = this.host.now();
    this.lastEventAt = at;
    this.patrolStartedAt = null;

    if (target === null) {
      return false;
    }

    const resolved = resolveFocus(this.focus, { kind, target, at });
    if (resolved === null) return false;
    this.focus = resolved;
    this.startFocus(resolved);
    return true;
  }

  /**
   * 每帧调用（场景 update）：静默够久就进入缓慢巡视。
   *
   * why 巡视用「直接落位」而不是补间：漂移是连续的慢速运动，逐帧按路径算位置最自然，
   *   补间反而会在路径拐点处顿一下。
   */
  update(): void {
    if (!this.enabled) return;
    if (this.phase === 'focus' || this.phase === 'returning') return;
    const now = this.host.now();
    if (!isSilentSince(this.lastEventAt, now)) return;
    if (this.phase !== 'patrol') {
      this.phase = 'patrol';
      this.patrolStartedAt = now;
    }
    const elapsed = now - (this.patrolStartedAt ?? now);
    this.host.place(patrolPose(this.host.bounds, this.host.viewport(), DIRECTOR_METRICS.patrolZoom, elapsed));
  }

  /**
   * 手动介入（用户碰了镜头）：导演立刻让位并通知外部。
   *
   * why 要撤销在飞的补间：补间还在跑的话，它会继续把镜头往事件点拉 ——
   *   用户的拖拽与它打架，画面像被拽着走。
   */
  releaseByManual(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.stop();
    this.host.onManualRelease();
  }

  /** 场景 shutdown 时调用（perf：资源必须可清理）。 */
  destroy(): void {
    this.enabled = false;
    this.stop();
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  /** 聚焦一段新事件：缓动到事件点 → 停留 → 回全景。 */
  private startFocus(slot: DirectorFocusSlot): void {
    this.cancelPending?.();
    this.cancelPending = null;
    this.phase = 'focus';

    const moveMs = DIRECTOR_METRICS.moveDurationMs;
    this.host.tweenTo({ center: slot.target, zoom: DIRECTOR_METRICS.focusZoom }, moveMs);
    // 报错的红色提示**不在战场侧**画了（@since v3.3，task_086）：红光晕迁到 HUD 屏幕空间，
    //   由组合根订阅 core 总线的 task.failed 后驱动（并受「导演模式开启」约束）。

    this.cancelPending = this.host.schedule(moveMs + DIRECTOR_METRICS.holdMs, () => {
      this.cancelPending = null;
      if (!this.enabled) return;
      this.phase = 'returning';
      this.host.tweenTo(overviewPose(this.host.viewport(), this.host.bounds), moveMs);
      this.cancelPending = this.host.schedule(moveMs, () => {
        this.cancelPending = null;
        if (!this.enabled) return;
        this.phase = 'idle';
        this.focus = null;
      });
    });
  }

  /** 停手：撤掉在飞的延时与补间、清空焦点。 */
  private stop(): void {
    this.cancelPending?.();
    this.cancelPending = null;
    this.host.cancelTween();
    this.phase = 'off';
    this.focus = null;
    this.patrolStartedAt = null;
  }
}
