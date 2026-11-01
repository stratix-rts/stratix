/**
 * 文件职责：框选矩形的显示对象 —— 拖拽过程中把已选区域可视化，松手即销毁显示。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/objects SelectionBox」。
 * 输入：Phaser 场景 + 世界坐标 Bounds（拖拽起止点归一化后的矩形）。
 * 输出：屏幕上的一块半透明矩形；show/hide 控制可见性。
 * 禁止事项：
 *   1. import hud / vue / legacy —— 铁律：world 不认识 hud；
 *   2. 在这里算命中结果 —— 命中判定属于 UnitRegistry，本文件只负责"画出来"；
 *   3. 常驻显示 —— 框选矩形只在拖拽期间存在，平时必须隐藏，避免与选择环视觉打架。
 */

import Phaser from 'phaser';

import type { Bounds } from '../../core/types';

const FILL_COLOR = 0xffffff;
const FILL_ALPHA = 0.12;
const STROKE_COLOR = 0xffffff;
const STROKE_ALPHA = 0.75;

/**
 * 框选矩形的显示对象：只在拖拽期间显示已选区域，平时保持隐藏。
 * 只负责"画出来"，命中结果由 UnitRegistry 给出。
 */
export class SelectionBox {
  private readonly rect: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    // origin 设为 (0,0)，位置即左上角，show() 才能直接用 Bounds 的 x/y 当锚点
    this.rect = scene.add
      .rectangle(0, 0, 0, 0, FILL_COLOR, FILL_ALPHA)
      .setOrigin(0, 0)
      .setStrokeStyle(1, STROKE_COLOR, STROKE_ALPHA)
      .setVisible(false);
  }

  show(bounds: Bounds): void {
    this.rect.setPosition(bounds.x, bounds.y);
    this.rect.setSize(Math.max(bounds.width, 0), Math.max(bounds.height, 0));
    this.rect.setVisible(true);
  }

  hide(): void {
    this.rect.setVisible(false);
  }

  destroy(): void {
    this.rect.destroy();
  }
}
