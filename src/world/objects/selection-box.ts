/**
 * 文件职责：框选矩形的显示对象 —— 拖拽过程中把已选区域可视化，松手时收缩闪烁一次后消失。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/objects SelectionBox」；
 *   视觉规格：docs/DEMO-PLAN.md §4「点击与指令特效 · 框选」
 *   （青色半透明填充 + 2px 霓虹边框 + 四角亮块；松手边框收缩闪烁一次消失）。
 * 输入：Phaser 场景 + 世界坐标 Bounds（拖拽起止点归一化后的矩形）。
 * 输出：屏幕上的一块半透明矩形；show / release / hide 控制可见性与收尾动画。
 * 禁止事项：
 *   1. import hud / vue / legacy —— 铁律：world 不认识 hud；
 *   2. 在这里算命中结果 —— 命中判定属于 UnitRegistry，本文件只负责"画出来"；
 *   3. 常驻显示 —— 框选矩形只在拖拽期间存在，平时必须隐藏，避免与选择环视觉打架；
 *   4. 自己抄一份色值 / 时长 —— 色值取调色板门面（world/theme），时长尺寸取唯一事实源
 *      （core/theme/visual-spec.ts 的 INTERACTION_FX_METRICS）。
 *
 * ============ 为什么从 Rectangle 换成 Container + Graphics ============
 * 旧实现是一枚 Phaser Rectangle（填充 + 描边），只能整体换色 / 换尺寸，做不出
 * 「四角亮块」与「松手收缩闪烁」。故改为：Container 装一枚 Graphics（本地坐标绘制，
 * 容器原点 = 矩形左上角），收缩靠容器 scale、闪烁靠重绘边框色 —— 两者互不干扰。
 */

import Phaser from 'phaser';

import type { Bounds } from '../../core/types';
import { INTERACTION_FX_METRICS, WORLD_PALETTE } from '../theme';

const M = INTERACTION_FX_METRICS.selectionBox;

/**
 * 框选框的渲染深度：压在单位（depth 0）之上、任务浮标（depth 5）之下 ——
 * 框要盖住被框住的单位（像 RTS 那样），但别盖住头顶浮标。
 */
export const SELECTION_BOX_DEPTH = 3;

/** 霓虹闪一下时的边框色（白 —— 闪是"更亮"，不是"换语义色"）。 */
const FLASH_COLOR = 0xffffff;

/**
 * 框选矩形的显示对象：只在拖拽期间显示已选区域，平时保持隐藏。
 * 只负责"画出来"，命中结果由 UnitRegistry 给出。
 */
export class SelectionBox {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;
  private readonly graphic: Phaser.GameObjects.Graphics;
  /** 当前矩形（世界坐标）；重绘时用。 */
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  /** 边框是否处于"霓虹闪"状态（松手收缩期间为 true）。 */
  private flashing = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.graphic = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.graphic]);
    this.container.setVisible(false);
    this.container.setDepth(SELECTION_BOX_DEPTH);
  }

  /** 拖拽中：显示矩形（青色半透明填充 + 2px 霓虹边框 + 四角亮块）。 */
  show(bounds: Bounds): void {
    this.bounds = bounds;
    this.flashing = false;
    this.container.setPosition(bounds.x, bounds.y);
    this.container.setScale(1);
    this.container.setAlpha(1);
    this.draw();
    this.container.setVisible(true);
  }

  /**
   * 松手：边框收缩 + 霓虹闪一次，然后淡出消失。
   * why 单独一个方法而不是复用 hide()：规格钦定的是「松手——边框收缩闪烁一次消失」，
   *   瞬时收尾动作本身就是演出的一部分（眼睛要看得到"啪"地一下收掉）。
   */
  release(): void {
    if (!this.container.visible) return;
    this.flashing = true;
    this.draw();
    this.scene.tweens.add({
      targets: this.container,
      scaleX: M.releaseShrinkRatio,
      scaleY: M.releaseShrinkRatio,
      duration: M.releaseFlashMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        // 收缩完再淡出：先"啪"地收一下，再化掉 —— 两段分开才看得出是两步。
        this.scene.tweens.add({
          targets: this.container,
          alpha: 0,
          duration: M.releaseFadeMs,
          ease: 'Cubic.In',
          onComplete: () => {
            this.container.setVisible(false);
            this.container.setAlpha(1);
            this.container.setScale(1);
            this.flashing = false;
          },
        });
      },
    });
  }

  /** 立即隐藏（不做收尾动画；场景 shutdown 等场景用）。 */
  hide(): void {
    this.container.setVisible(false);
    this.container.setAlpha(1);
    this.container.setScale(1);
    this.flashing = false;
  }

  destroy(): void {
    this.container.destroy();
  }

  /**
   * 画矩形（本地坐标：原点 = 左上角）。
   * why 四角亮块单独画：规格里的"四角亮块"是 RTS 惯用的角标 —— 只画边框时
   *   大矩形拖到屏幕边缘容易看丢四角，四个亮角是"我框住了这块"的定位锚。
   */
  private draw(): void {
    const width = Math.max(this.bounds.width, 0);
    const height = Math.max(this.bounds.height, 0);
    const stroke = this.flashing ? FLASH_COLOR : WORLD_PALETTE.unit;

    this.graphic.clear();
    // 填充：青色半透明（规格钦定）。
    this.graphic.fillStyle(WORLD_PALETTE.unit, M.fillAlpha);
    this.graphic.fillRect(0, 0, width, height);
    // 边框：2px 霓虹（规格钦定）。
    this.graphic.lineStyle(M.strokeWidthPx, stroke, 1);
    this.graphic.strokeRect(0, 0, width, height);
    // 四角亮块：压在边框角上，白色高亮。
    this.graphic.fillStyle(FLASH_COLOR, M.cornerAlpha);
    const size = M.cornerSizePx;
    this.graphic.fillRect(0, 0, size, size);
    this.graphic.fillRect(width - size, 0, size, size);
    this.graphic.fillRect(0, height - size, size, size);
    this.graphic.fillRect(width - size, height - size, size, size);
  }
}
