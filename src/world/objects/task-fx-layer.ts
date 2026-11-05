/**
 * 文件职责：把 TaskFxBoard 的表现态**画到战场上**（task_038）—— 单位头顶的三种浮标：
 *   working = 旋转缺口环（ring 变体，弧参数与角速度在 TASK_FX_STYLE.ring）；
 *   done = 绿色 ✓ + 半透明底衬圆，按 sinceMs 在 done.ttlMs 内线性淡出后移除；
 *   failed = 红色 ! + 底衬圆，驻留到板子换相或单位离场（不自动过期）。
 * 输入：Phaser 场景 + UnitRegistry（单位与 busy 派生真相）+ TaskFxBoard（瞬态表现真相）+ 样式。
 * 输出：与"有可见表现"的单位一一对应的 Container/Graphics 节点 + 一个全场共用的动画定时器。
 * 禁止事项：
 *   1. 持有任务相位真相 —— 裁决在 TaskFxBoard.visibleMarker，本层只把结果画出来；
 *   2. import hud / app / vue —— 铁律：world 不认识 hud（样式色值镜像 token，见 task-fx.ts 头注）；
 *   3. 每个单位各开一个定时器 —— 全场一个 tick（同 unit-layer 的走路动画纪律，perf 硬约束）；
 *   4. 场景 shutdown 后继续操作显示对象 —— destroyed 置位后一律早退（同 unit-layer）。
 *
 * 变体钩子：绘制分支按 style.variant 走 switch（当前只有 'ring'）；后续 'bubble'
 * （工具气泡 + 身体动画加速）变体在此加一个分支即可，状态板零改动。
 *
 * ============ 交互特效（@since v3.3，task_077 / DEMO-PLAN §4）============
 * 本层同时是「点击与指令特效」的绘制方（纯算术在 objects/task-fx.ts 的交互特效段）：
 *   - commandFlow：单位脚下 → 目标点的流动虚线（青→目标色渐变，800ms 后淡出）；
 *   - doubleRipple：目标点双重涟漪（两圈先后 300ms 扩散）；
 *   - flipCard：任务被认领时的 3D 翻卡（背面灰 → 正面亮色 + 图标）；
 *   - raiseFlag：任务完成插旗（旗杆升起 0.5s + 旗面 Back.Out 弹性展开，**驻留**）；
 *   - footPulse：集火支援时选中群脚下的位移脉冲。
 * why 气泡不在这层画：气泡系统（task_076，world/speech-templates.ts）尚未合入，
 *   本任务按规格只**发事件**（unit.bubble，见 bridge/bus-adapter）不自己渲染 ——
 *   接线注释见下方 bubble 钩子。
 *
 * ============ 精灵特效（@since v3.3，task_161）============
 * 本层同时是「sheet 动画特效」（sprite FX）的播放口 —— 只走 Phaser 纹理帧动画，
 *   运行时零新增依赖（task_161 requirement 4）：
 *   - 播什么：调用方给**语义 kind**（celebrate / levelUp / error / spawn / despawn / command）；
 *   - 播多久 / 何时收：objects/sprite-fx-layer.ts 的实例池裁决（并发上限 ≤4、到期回收、离屏即停）；
 *   - 何时推进回收：搭本层已有的**全场一个 tick**（不给每条特效各开定时器，perf 硬约束）。
 *
 * @since v3.17（task_038）；v3.3（task_077）追加交互特效绘制；v3.3（task_161）追加精灵特效播放口。
 */

import Phaser from 'phaser';

import type { Point } from '../../core/types';
import type { SpriteFxKind, SpriteFxSource } from '../appearance/fx-atlas';
import { INTERACTION_FX_METRICS } from '../theme';

import { SpriteFxLayer } from './sprite-fx-layer';
import {
  INTERACTION_FX_STYLE,
  MOVE_RIPPLE_STYLE,
  TASK_FX_STYLE,
  cardFlipScaleX,
  cardFlipShowsFront,
  flowDashSegments,
  flowFadeAlpha,
  flagClothScale,
  flagPoleProgress,
  footPulseAlpha,
  footPulseRadius,
  mixColorT,
  type InteractionFxStyle,
  type MoveRippleStyle,
  type TaskFxBoard,
  type TaskFxStyle,
  type TaskMarkerKind,
} from './task-fx';
import type { UnitRegistry } from './unit-registry';

/** 交互特效的渲染深度（单位 depth 0 / 建筑 -2 / 任务浮标 5）。 */
export const COMMAND_FX_DEPTH = Object.freeze({
  /** 脚下脉冲环（压在单位之下一点，读作"地面的圈"）。 */
  pulse: 1,
  /** 流动虚线 / 翻卡 / 旗子（世界层对象，压在单位之上）。 */
  world: 2,
});

export interface TaskFxLayerOptions {
  /** 样式覆盖口（变体钩子）；缺省 TASK_FX_STYLE。 */
  readonly style?: TaskFxStyle;
  /** 交互特效样式（task_077）；缺省 INTERACTION_FX_STYLE。 */
  readonly interactionStyle?: InteractionFxStyle;
  /**
   * 精灵特效源（@since v3.3，task_161）：sheet 动画的运行时参数表。
   * 缺省 = 不播精灵特效（素材没加载 / 老调用方零影响）。
   */
  readonly spriteFxSources?: readonly SpriteFxSource[];
}

interface TaskFxNode {
  readonly container: Phaser.GameObjects.Container;
  readonly graphic: Phaser.GameObjects.Graphics;
  kind: TaskMarkerKind;
}

/** 一面旗（task_077）：显示节点 + 动画状态 + 飘动相位。 */
interface FlagNode {
  readonly container: Phaser.GameObjects.Container;
  readonly graphic: Phaser.GameObjects.Graphics;
  /** 旗杆升起比例（0→1）/ 旗面展开比例（0→1）。 */
  readonly state: { pole: number; cloth: number };
  /** 飘动相位（按 key 派生，避免所有旗同步飘）。 */
  readonly phase: number;
}

/** 指令流线的可调口（task_077）：终点色默认取样式表的目标色。 */
export interface CommandFlowOptions {
  /** 终点色（渐变的另一端；缺省 = 样式的目标色）。 */
  readonly endColor?: number;
}

/**
 * 任务表现的 Phaser 显示层：sync() 对账节点（增删/换相位/跟位），tick() 推进旋转与淡出。
 * 节点深度压在单位之上（depth 5），位置 = 单位位置 + 头顶偏移。
 */
export class TaskFxLayer {
  private readonly nodes = new Map<string, TaskFxNode>();
  private readonly scene: Phaser.Scene;
  private readonly registry: UnitRegistry;
  private readonly board: TaskFxBoard;
  private readonly style: TaskFxStyle;
  /** 交互特效样式（task_077）。 */
  private readonly interactionStyle: InteractionFxStyle;
  /** 已插下的旗子（task_077）：key → 显示节点（插过的旗不重复插，场景 shutdown 时一并回收）。 */
  private readonly flags = new Map<string, FlagNode>();
  /**
   * 精灵特效层（@since v3.3，task_161）：sheet 动画（庆祝 / 报错 / 上场 / 下场 / 指令 / 升级）。
   * why 挂在本层而不是另起一个层：战场表现都归这一层管（不另起炉灶，task_161 requirement 2），
   *   而且回收能搭本层已有的**全场一个 tick**（不给每条特效各开定时器，perf 硬约束）。
   */
  private readonly spriteFx: SpriteFxLayer;
  private timer: Phaser.Time.TimerEvent | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, registry: UnitRegistry, board: TaskFxBoard, options: TaskFxLayerOptions = {}) {
    this.scene = scene;
    this.registry = registry;
    this.board = board;
    this.style = options.style ?? TASK_FX_STYLE;
    this.interactionStyle = options.interactionStyle ?? INTERACTION_FX_STYLE;
    this.spriteFx = new SpriteFxLayer(scene, options.spriteFxSources ?? []);
    this.ensureTimer();
  }

  /**
   * 对账显示对象：有可见表现 → 建节点/换绘制/跟随单位位置；没有 → 销节点。
   * 调用时机：场景 syncUnits（状态广播）与 syncTaskEvent（任务事件）之后。
   */
  sync(): void {
    if (this.destroyed) return;
    const live = new Set<string>();

    for (const object of this.registry.list()) {
      const kind = this.board.visibleMarker(object.id, object.status);
      if (!kind) continue;
      live.add(object.id);

      let node = this.nodes.get(object.id);
      if (!node) {
        node = this.createNode(kind);
        this.nodes.set(object.id, node);
      } else if (node.kind !== kind) {
        node.kind = kind;
        node.container.setAlpha(1);
        this.drawMarker(node, kind);
      }
      node.container.setPosition(object.position.x, object.position.y - this.style.marker.yAboveUnit);
    }

    for (const id of Array.from(this.nodes.keys())) {
      if (!live.has(id)) this.removeNode(id);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) {
      this.timer.remove(false);
      this.timer = null;
    }
    for (const node of this.nodes.values()) {
      node.container.destroy();
    }
    this.nodes.clear();
    // 旗子（task_077）：驻留型显示对象，场景 shutdown 时一并回收（资源必须可清理）。
    for (const flag of this.flags.values()) {
      flag.container.destroy();
    }
    this.flags.clear();
    // 精灵特效（task_161）：显示对象与实例账本一并回收（资源必须可清理）。
    this.spriteFx.destroy();
  }

  // ==========================================================================
  // 精灵特效（@since v3.3，task_161）
  // ==========================================================================

  /**
   * 播一条精灵特效（sheet 动画）。
   *
   * @param kind 语义 kind（celebrate / levelUp / error / spawn / despawn / command）。
   * @param x 挂载点 x（世界坐标）。
   * @param y 挂载点 y（世界坐标）。
   * @returns 是否真的播了（素材没加载 / 种类未知 → false）。
   */
  playFx(kind: SpriteFxKind, x: number, y: number): boolean {
    if (this.destroyed) return false;
    return this.spriteFx.play(kind, x, y);
  }

  /** 当前在播的精灵特效实例数（dev 观测用）。 */
  get activeFxCount(): number {
    return this.spriteFx.activeCount;
  }

  // ==========================================================================
  // 交互特效（@since v3.3，task_077 / DEMO-PLAN §4「点击与指令特效」）
  // ==========================================================================

  /**
   * 下达指令的流动虚线：单位脚下 → 目标点，逐段取渐变色（青→目标色），800ms 后淡出。
   *
   * why 逐段画而不是画一条带渐变的线：Phaser 的 Graphics 描边没有渐变，
   *   切成短段逐段取色才是真正的渐变（且"流动"只需推进每段的位置）。
   */
  commandFlow(from: Point, to: Point, options: CommandFlowOptions = {}): void {
    if (this.destroyed) return;
    const metrics = INTERACTION_FX_METRICS.command;
    const endColor = options.endColor ?? this.interactionStyle.flowEndColor;
    const graphics = this.scene.add.graphics();
    graphics.setDepth(COMMAND_FX_DEPTH.world);
    const state = { offset: 0, progress: 0 };

    this.scene.tweens.add({
      targets: state,
      // 虚线流动：整段时长内推进 dashLength + gap 的若干倍（看起来是连续流动）。
      offset: metrics.flowSpeedPxPerSec * (metrics.flowDurationMs / 1000),
      progress: 1,
      duration: metrics.flowDurationMs,
      ease: 'Linear',
      onUpdate: () => {
        const alpha = flowFadeAlpha(state.progress, metrics.flowFadeMs / metrics.flowDurationMs);
        graphics.clear();
        for (const segment of flowDashSegments(from, to, state.offset, metrics.dashLengthPx, metrics.dashGapPx)) {
          const color = mixColorT(this.interactionStyle.flowStartColor, endColor, segment.t);
          graphics.lineStyle(this.interactionStyle.flowLineWidthPx, color, alpha);
          graphics.beginPath();
          graphics.moveTo(segment.x1, segment.y1);
          graphics.lineTo(segment.x2, segment.y2);
          graphics.strokePath();
        }
      },
      onComplete: () => {
        graphics.destroy();
      },
    });
  }

  /**
   * 目标点双重涟漪：两圈先后 300ms 扩散（DEMO-PLAN §4）。
   * why 两圈而不是一圈加粗：一圈是"到了"，两圈是"落定了" —— 层次感是廉价的关键帧。
   */
  doubleRipple(x: number, y: number, style: MoveRippleStyle = MOVE_RIPPLE_STYLE): void {
    if (this.destroyed) return;
    this.ripple(x, y, style);
    this.scene.time.delayedCall(INTERACTION_FX_METRICS.command.rippleGapMs, () => {
      if (this.destroyed) return;
      this.ripple(x, y, style);
    });
  }

  /**
   * 任务被认领时的 3D 翻卡：背面灰 → 正面亮色 + 图标（DEMO-PLAN §4）。
   * 一次性演出：翻面 → 停留 → 淡出（认领的"啪"一下，看完不留残影）。
   */
  flipCard(x: number, y: number): void {
    if (this.destroyed) return;
    const metrics = INTERACTION_FX_METRICS.cardFlip;
    const graphics = this.scene.add.graphics();
    const container = this.scene.add.container(x, y, [graphics]);
    container.setDepth(COMMAND_FX_DEPTH.world);
    const state = { progress: 0 };

    const draw = (): void => {
      const front = cardFlipShowsFront(state.progress);
      graphics.clear();
      // 卡片本体（本地坐标：中心为锚）。
      const width = this.interactionStyle.cardWidthPx;
      const height = this.interactionStyle.cardHeightPx;
      graphics.fillStyle(
        front ? this.interactionStyle.cardFrontColor : this.interactionStyle.cardBackColor,
        1
      );
      graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 6);
      if (front) {
        // 正面图标：一把小锤（"有人开工了"）—— 用图形画，不用 emoji（emoji 不受颜色控制）。
        graphics.fillStyle(this.interactionStyle.cardIconColor, 1);
        graphics.fillRoundedRect(-7, -12, 14, 5, 2); // 锤头
        graphics.fillRoundedRect(-1.6, -8, 3.2, 15, 1.4); // 锤柄
      } else {
        // 背面：一条暗色横线（未认领的"空卡"感）。
        graphics.fillStyle(this.interactionStyle.cardIconColor, 0.35);
        graphics.fillRoundedRect(-width / 4, -2, width / 2, 3, 1.5);
      }
    };

    draw();
    this.scene.tweens.add({
      targets: state,
      progress: 1,
      duration: metrics.durationMs,
      ease: 'Cubic.easeInOut',
      onUpdate: () => {
        // 3D 假翻转：横向缩放 |cos(πp)|（1 → 侧棱 → 1），过半换面。
        container.setScale(cardFlipScaleX(state.progress), 1);
        draw();
      },
      onComplete: () => {
        // 停留一会儿再淡出（翻完立刻消失会像闪屏）。
        this.scene.tweens.add({
          targets: container,
          alpha: 0,
          delay: metrics.holdMs,
          duration: 250,
          ease: 'Cubic.In',
          onComplete: () => {
            container.destroy();
          },
        });
      },
    });
  }

  /**
   * 任务完成插旗：旗杆升起 0.5s + 旗面 Back.Out 弹性展开（DEMO-PLAN §4）。
   *
   * why 旗子**驻留**（不像翻卡那样淡出）：完成的旗是战场的成就陈列 ——
   *   一片区域做完，旗子还立在那儿，直播时一眼看得见"干掉了多少"。
   */
  raiseFlag(key: string, x: number, y: number): void {
    if (this.destroyed) return;
    if (this.flags.has(key)) return; // 幂等：同一条任务不重复插旗
    const metrics = INTERACTION_FX_METRICS.flag;
    const graphic = this.scene.add.graphics();
    const container = this.scene.add.container(x, y, [graphic]);
    container.setDepth(COMMAND_FX_DEPTH.world);
    const node: FlagNode = {
      container,
      graphic,
      state: { pole: 0, cloth: 0 },
      phase: (key.length % 7) * 0.9,
    };
    this.flags.set(key, node);

    this.drawFlag(node, 0);
    // 两段：先升杆（平滑），杆到位后再展旗（Back.Out —— 曲线在纯逻辑层 easeBackOut）。
    this.scene.tweens.add({
      targets: node.state,
      pole: 1,
      duration: metrics.poleDurationMs,
      ease: 'Linear',
      onUpdate: () => this.drawFlag(node, this.scene.time.now),
      onComplete: () => {
        this.scene.tweens.add({
          targets: node.state,
          cloth: 1,
          duration: metrics.clothDurationMs,
          ease: 'Linear',
          onUpdate: () => this.drawFlag(node, this.scene.time.now),
        });
      },
    });
  }

  /**
   * 收掉某类旗子（@since v3.3，task_082：当日回放清场用）。
   *
   * why 需要它：回放拖回早的时刻时，「后来插下的旗子」必须跟着收掉 ——
   *   画面要回到**那一刻**的样子（不是那一刻 + 后来）。旗子默认驻留（task_077 的口径），
   *   所以清场得显式点名收（按 key 前缀 —— 回放的旗 key 都带 `replay:` 前缀）。
   */
  clearFlagsWithPrefix(prefix: string): void {
    if (this.destroyed) return;
    for (const [key, flag] of [...this.flags]) {
      if (!key.startsWith(prefix)) continue;
      flag.container.destroy();
      this.flags.delete(key);
    }
  }

  /**
   * 画一面旗（task_077）：杆 + 展开的旗面 + 轻微飘动。
   * why 飘动在这里现算而不是逐帧回调：旗子**驻留**（不像翻卡那样一次性），
   *   驻留物要一直有生气 —— 复用本层已有的全场 tick 重画，不给每面旗各开一个定时器。
   */
  private drawFlag(node: FlagNode, nowMs: number): void {
    const metrics = INTERACTION_FX_METRICS.flag;
    const poleHeight = metrics.poleHeightPx * flagPoleProgress(node.state.pole);
    const clothScale = flagClothScale(node.state.cloth);
    const graphic = node.graphic;
    graphic.clear();
    // 旗杆：从地面升到顶端。
    graphic.lineStyle(2, this.interactionStyle.flagPoleColor, 1);
    graphic.lineBetween(0, 0, 0, -poleHeight);
    if (clothScale > 0.01 && poleHeight > 1) {
      // 旗面：从杆顶往右展开（Back.Out 弹性 —— 先冲过头再回落），外缘轻微飘动。
      const width = metrics.clothWidthPx * clothScale;
      const height = metrics.clothHeightPx * clothScale;
      const top = -poleHeight;
      const wave = Math.sin(nowMs / 260 + node.phase) * height * 0.18;
      graphic.fillStyle(this.interactionStyle.flagClothColor, 1);
      graphic.beginPath();
      graphic.moveTo(0, top);
      graphic.lineTo(width, top + height * 0.35 + wave);
      graphic.lineTo(width, top + height + wave);
      graphic.lineTo(0, top + height);
      graphic.closePath();
      graphic.fillPath();
    }
  }

  /**
   * 集火支援的脚下位移脉冲（DEMO-PLAN §4）：选中群脚下同时扩一圈。
   * why 画在脚下而不是头顶：脉冲是"我冲过去了"的地面反馈。
   */
  footPulse(x: number, y: number): void {
    if (this.destroyed) return;
    const metrics = INTERACTION_FX_METRICS.focusFire;
    const graphics = this.scene.add.graphics();
    graphics.setDepth(COMMAND_FX_DEPTH.pulse);
    const state = { progress: 0 };

    this.scene.tweens.add({
      targets: state,
      progress: 1,
      duration: metrics.pulseDurationMs,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        const radius = footPulseRadius(state.progress, metrics.pulseFromPx, metrics.pulseToPx);
        const alpha = footPulseAlpha(state.progress);
        graphics.clear();
        graphics.lineStyle(2, this.interactionStyle.focusPulseColor, alpha);
        graphics.strokeCircle(x, y, radius);
        graphics.fillStyle(this.interactionStyle.focusPulseColor, alpha * 0.12);
        graphics.fillCircle(x, y, radius);
      },
      onComplete: () => {
        graphics.destroy();
      },
    });
  }

  /**
   * 气泡钩子（@since v3.3，task_077 接线位）：气泡系统（task_076）尚未合入，
   * 故本层**不画**气泡，只在场景侧发 unit.bubble 事件（见 bridge/bus-adapter 的
   * unitBubble 出口）。task_076 合入后，由它的气泡层订阅同一事件即可接上，
   * 本层零改动 —— 世界层内部不许互相直接调用（总线铁律）。
   */

  /**
   * 右击移动的目标点涟漪（@since v3.21，task_045）：一次性短动画（涨圈 + 淡出后自毁），
   * 参数血缘 v2 ParticleEffects.agentArrivalRipple（见 MOVE_RIPPLE_STYLE 注释）。
   * why 不进 nodes 对账：涟漪没有生命周期真相，画完即走 —— 与浮标（跟随单位、有换相
   *   语义）不同源；场景 shutdown 时 Phaser 会随场景清掉残影 tween 与 graphics。
   */
  ripple(x: number, y: number, style: MoveRippleStyle = MOVE_RIPPLE_STYLE): void {
    if (this.destroyed) return;
    const graphics = this.scene.add.graphics();
    graphics.setDepth(4); // 浮标之下、单位之上：目标点在空地，不遮头顶浮标
    const state = { radius: style.radiusFrom, alpha: style.alphaFrom };
    this.scene.tweens.add({
      targets: state,
      radius: style.radiusTo,
      alpha: 0,
      duration: style.durationMs,
      ease: 'Power2.easeOut',
      onUpdate: () => {
        const alpha = Math.max(0, state.alpha);
        graphics.clear();
        graphics.lineStyle(style.lineWidth, style.color, alpha);
        graphics.strokeCircle(x, y, state.radius);
        graphics.fillStyle(style.color, alpha * 0.1);
        graphics.fillCircle(x, y, state.radius);
      },
      onComplete: () => {
        graphics.destroy();
      },
    });
  }

  // ==========================================================================
  // 内部：节点与绘制
  // ==========================================================================

  private createNode(kind: TaskMarkerKind): TaskFxNode {
    const graphic = this.scene.add.graphics();
    const container = this.scene.add.container(0, 0, [graphic]);
    container.setName('task-fx');
    container.setDepth(5);
    const node: TaskFxNode = { container, graphic, kind };
    this.drawMarker(node, kind);
    return node;
  }

  private removeNode(id: string): void {
    this.nodes.get(id)?.container.destroy();
    this.nodes.delete(id);
  }

  /** 按表现种类重画一枚浮标（换相复用同一节点，不销毁重建 —— perf）。 */
  private drawMarker(node: TaskFxNode, kind: TaskMarkerKind): void {
    const graphic = node.graphic;
    graphic.clear();
    const style = this.style;

    if (kind === 'working') {
      graphic.angle = 0; // 从 ✓/! 换回环时角度残留会让环跳一下
      graphic.lineStyle(style.ring.lineWidth, style.ring.color, 1);
      graphic.beginPath();
      graphic.arc(0, 0, style.ring.radius, 0, Phaser.Math.DegToRad(style.ring.arcDegrees), false);
      graphic.strokePath();
      return;
    }

    // ✓ / ! / ?（task_049）共用底衬圆：压住任何底色，浮标在草地/暗板上都可读。
    graphic.fillStyle(style.marker.backdropColor, style.marker.backdropAlpha);
    graphic.fillCircle(0, 0, style.marker.radius);

    if (kind === 'awaiting') {
      // 待审批 ?（task_049）：hook 曲线 + 点 —— 问号挂在头顶，「这个角色在等你裁决」。
      // 曲线三笔（Phaser graphics 没有 text 原生曲率，手绘 hook 比贴字纹理省一张纹理）。
      const size = style.marker.radius;
      graphic.lineStyle(2.5, style.awaiting.color, 1);
      graphic.beginPath();
      graphic.moveTo(-size * 0.05, -size * 0.5);
      graphic.lineTo(size * 0.4, -size * 0.5);
      graphic.lineTo(size * 0.4, -size * 0.1);
      graphic.lineTo(-size * 0.05, size * 0.15);
      graphic.strokePath();
      graphic.fillStyle(style.awaiting.color, 1);
      graphic.fillCircle(-size * 0.05, size * 0.55, 2);
      return;
    }

    if (kind === 'done') {
      // 对勾两笔：短撇 + 长捺，勾在底衬圆心附近。
      const size = style.marker.radius;
      graphic.lineStyle(2.5, style.done.color, 1);
      graphic.beginPath();
      graphic.moveTo(-size * 0.5, size * 0.05);
      graphic.lineTo(-size * 0.08, size * 0.5);
      graphic.lineTo(size * 0.55, -size * 0.45);
      graphic.strokePath();
      return;
    }

    // failed：感叹号 = 竖杠 + 底部圆点。
    const width = 4;
    graphic.fillStyle(style.failed.color, 1);
    graphic.fillRoundedRect(-width / 2, -style.marker.radius * 0.7, width, style.marker.radius, width / 2);
    graphic.fillCircle(0, style.marker.radius * 0.5, width / 2);
  }

  // ==========================================================================
  // 内部：动画定时器（全场一个）
  // ==========================================================================

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = this.scene.time.addEvent({
      delay: this.style.tickMs,
      loop: true,
      callback: () => this.tick(),
    });
  }

  /** 步进：working 旋转、done 淡出；过期/离场的节点交给 sync 收（markerFor 惰性剔除）。 */
  private tick(): void {
    if (this.destroyed) return;
    const now = this.board.clock();
    const rotationStep = (this.style.ring.rotationDegPerSec * this.style.tickMs) / 1000;
    let needsSync = false;

    for (const [id, node] of this.nodes) {
      const marker = this.board.markerFor(id);
      if (!marker) {
        needsSync = true;
        continue;
      }
      if (marker.kind === 'working') {
        node.graphic.angle = (node.graphic.angle + rotationStep) % 360;
      } else if (marker.kind === 'done') {
        const progress = (now - marker.sinceMs) / this.board.doneTtlMs;
        node.container.setAlpha(Math.max(0, Math.min(1, 1 - progress)));
      }
    }

    // 旗面飘动（task_077）：驻留物靠这个 tick 保持生气（不给每面旗单开定时器）。
    if (this.flags.size > 0) {
      const sceneNow = this.scene.time.now;
      for (const node of this.flags.values()) {
        this.drawFlag(node, sceneNow);
      }
    }

    // 精灵特效回收（task_161）：到期（播完）与离屏的实例就地销毁。
    // why 搭本层的 tick：全场一个定时器的纪律 —— 特效再热闹也不各开一个（perf 硬约束）。
    this.spriteFx.tick(this.scene.time.now);

    if (needsSync) this.sync();
  }
}
