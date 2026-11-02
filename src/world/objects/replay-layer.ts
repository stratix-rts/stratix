/**
 * 文件职责：**当日回放的战场表现层**（task_082 / DEMO-PLAN.md §9）—— 把回放相位画成
 *   战场上的「回放化身」：开工 = 呼吸圆环 / 干活 = 旋转缺口弧 / 完成 = 绿 ✓ / 出错 = 红 !，
 *   头顶一行短句（角色干了什么）。
 * 输入：ReplayAvatar（objects/replay-board 的裁决结果）+ 化身落位（世界坐标）。
 * 输出：每个角色一个 Container（Graphics + Text）+ **全场一个**动画定时器。
 * 禁止事项：
 *   1. 持有相位真相 —— 裁决在 ReplayBoard，本层只画结果（同 task-fx-layer 的纪律）；
 *   2. import hud / app —— 铁律：world 只认识 core/types；
 *   3. 每个化身各开一个定时器 —— 全场一个 tick（perf 硬约束，同 unit-layer 的走路动画）；
 *   4. 场景 shutdown 后继续操作显示对象 —— destroyed 置位后一律早退；
 *   5. 引入图片 / 字体资产 —— 全部用 Graphics 画（零资产）。
 *
 * @since v3.3（task_082）。
 */

import Phaser from 'phaser';

import type { Point } from '../../core/types';
import { WORLD_PALETTE } from '../theme';

import type { ReplayAvatar, ReplayPhase } from './replay-board';

/** 回放化身的渲染深度（单位 0 / 建筑 -2 / 任务浮标 5 —— 回放化身夹在中间）。 */
export const REPLAY_AVATAR_DEPTH = 4;

/** 单个化身标记的半径（px）。 */
const MARKER_RADIUS = 16;
/** 短句行最大字数（太长会把战场糊住）。 */
const MAX_LABEL_CHARS = 18;
/** 全场动画 tick 间隔（ms）—— 30fps 足够（旋转弧与呼吸环都不需要更细）。 */
const TICK_MS = 33;

interface ReplayNode {
  readonly container: Phaser.GameObjects.Container;
  readonly graphic: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  phase: ReplayPhase;
  /** 每个化身的动画相位（避免所有环同步呼吸 —— 看着假）。 */
  readonly offset: number;
}

/**
 * 回放化身的 Phaser 显示层。
 */
export class ReplayLayer {
  private readonly nodes = new Map<string, ReplayNode>();
  private readonly scene: Phaser.Scene;
  private timer: Phaser.Time.TimerEvent | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.ensureTimer();
  }

  /** 全场一个 tick（perf：不给每个化身开定时器）。 */
  private ensureTimer(): void {
    if (this.timer || this.destroyed) return;
    this.timer = this.scene.time.addEvent({
      delay: TICK_MS,
      loop: true,
      callback: () => this.tick(),
    });
  }

  /**
   * 落一个化身（同一角色重复落 = 换相位 + 换位置，不新建节点）。
   */
  upsert(avatar: ReplayAvatar, position: Point): void {
    if (this.destroyed) return;
    let node = this.nodes.get(avatar.characterId);
    if (!node) {
      const graphic = this.scene.add.graphics();
      const label = this.scene.add.text(0, -MARKER_RADIUS - 14, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#d7deea',
        align: 'center',
      });
      label.setOrigin(0.5, 1);
      const container = this.scene.add.container(position.x, position.y, [graphic, label]);
      container.setDepth(REPLAY_AVATAR_DEPTH);
      node = {
        container,
        graphic,
        label,
        phase: avatar.phase,
        offset: (avatar.slotIndex % 7) * 0.9,
      };
      this.nodes.set(avatar.characterId, node);
    } else {
      node.phase = avatar.phase;
    }
    node.container.setPosition(position.x, position.y);
    node.label.setText(truncateLabel(avatar.label));
    this.draw(node, 0);
  }

  /** 收掉某个化身（单位离场 / 清场）。 */
  remove(characterId: string): void {
    const node = this.nodes.get(characterId);
    if (!node) return;
    node.container.destroy();
    this.nodes.delete(characterId);
  }

  /** 清场（拖动回放的 reset 拍用）。 */
  clear(): void {
    for (const node of this.nodes.values()) node.container.destroy();
    this.nodes.clear();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) {
      this.timer.remove(false);
      this.timer = null;
    }
    this.clear();
  }

  /** 动画推进（呼吸 / 旋转）。 */
  private tick(): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    for (const node of this.nodes.values()) this.draw(node, now);
  }

  /**
   * 画一个化身（相位 → 形状）。
   * why 形状各不相同：回放里观众要一眼分出"开工了 / 在干活 / 干完了 / 卡住了"——
   * 光靠颜色不够（色弱观众 / 投影偏色），形状是第二重编码。
   */
  private draw(node: ReplayNode, nowMs: number): void {
    const graphic = node.graphic;
    graphic.clear();
    const phase = node.phase;

    if (phase === 'done') {
      // 完成：绿底衬圆 + ✓（驻留 —— 成就陈列）。
      graphic.fillStyle(WORLD_PALETTE.success, 0.18);
      graphic.fillCircle(0, 0, MARKER_RADIUS);
      graphic.lineStyle(2, WORLD_PALETTE.success, 1);
      graphic.strokeCircle(0, 0, MARKER_RADIUS);
      graphic.lineBetween(-6, 0, -1.5, 5);
      graphic.lineBetween(-1.5, 5, 7, -6);
      return;
    }

    if (phase === 'error') {
      // 出错：红底衬圆 + !（驻留 —— 卡住的事要一直看得见）。
      graphic.fillStyle(WORLD_PALETTE.danger, 0.18);
      graphic.fillCircle(0, 0, MARKER_RADIUS);
      graphic.lineStyle(2, WORLD_PALETTE.danger, 1);
      graphic.strokeCircle(0, 0, MARKER_RADIUS);
      graphic.lineBetween(0, -7, 0, 2);
      graphic.fillStyle(WORLD_PALETTE.danger, 1);
      graphic.fillCircle(0, 7, 1.8);
      return;
    }

    if (phase === 'spawn') {
      // 开工：呼吸圆环（半径与透明度随时间起伏）。
      const wave = (Math.sin(nowMs / 320 + node.offset) + 1) / 2;
      const radius = MARKER_RADIUS * (0.7 + wave * 0.25);
      graphic.lineStyle(2, WORLD_PALETTE.unit, 0.85);
      graphic.strokeCircle(0, 0, radius);
      graphic.fillStyle(WORLD_PALETTE.unit, 0.12 + wave * 0.1);
      graphic.fillCircle(0, 0, radius * 0.5);
      return;
    }

    // 干活：旋转缺口弧（进度感 —— 一眼看出"正在推进"）。
    const start = (nowMs / 260 + node.offset) % (Math.PI * 2);
    graphic.lineStyle(3, WORLD_PALETTE.progress, 0.95);
    graphic.beginPath();
    graphic.arc(0, 0, MARKER_RADIUS, start, start + Math.PI * 1.35, false);
    graphic.strokePath();
    graphic.lineStyle(1, WORLD_PALETTE.progress, 0.35);
    graphic.strokeCircle(0, 0, MARKER_RADIUS);
  }
}

/** 短句截断（战场上的字太长会糊住单位）。 */
function truncateLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length <= MAX_LABEL_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_LABEL_CHARS - 1)}…`;
}
