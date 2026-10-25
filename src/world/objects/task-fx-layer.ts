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
 * @since v3.17（task_038）。
 */

import Phaser from 'phaser';

import { MOVE_RIPPLE_STYLE, TASK_FX_STYLE, type MoveRippleStyle, type TaskFxBoard, type TaskFxStyle, type TaskMarkerKind } from './task-fx';
import type { UnitRegistry } from './unit-registry';

export interface TaskFxLayerOptions {
  /** 样式覆盖口（变体钩子）；缺省 TASK_FX_STYLE。 */
  readonly style?: TaskFxStyle;
}

interface TaskFxNode {
  readonly container: Phaser.GameObjects.Container;
  readonly graphic: Phaser.GameObjects.Graphics;
  kind: TaskMarkerKind;
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
  private timer: Phaser.Time.TimerEvent | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, registry: UnitRegistry, board: TaskFxBoard, options: TaskFxLayerOptions = {}) {
    this.scene = scene;
    this.registry = registry;
    this.board = board;
    this.style = options.style ?? TASK_FX_STYLE;
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
  }

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

    // ✓ / ! 共用底衬圆：压住任何底色，浮标在草地/暗板上都可读。
    graphic.fillStyle(style.marker.backdropColor, style.marker.backdropAlpha);
    graphic.fillCircle(0, 0, style.marker.radius);

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

    if (needsSync) this.sync();
  }
}
