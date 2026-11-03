/**
 * 文件职责：**导演取景框（L3）的战场渲染层** —— 导演模式开启时，中屏四角出现取景框标识。
 *   方案来源：docs/hud-redesign-proposal.html §2.5 A6（「🎬 导演开启后中屏出现取景框并标注
 *   『🎬 导演』」）与 G1（新增取景框作为导演接管的画面回显）。
 * 输入：导演模式开关（core → world 的 camera.director 事件 → 场景 → 本层）+ 视口尺寸。
 * 输出：屏幕空间绘制的四角括号（琥珀色）+「🎬 导演」标注。
 * 禁止事项：
 *   1. import hud —— 铁律：world 只认识 core 与 core/bus；
 *   2. 订阅总线 —— 事件由场景经桥接层递进来（world 侧进出 core 只有桥这一个口子）；
 *   3. 自己判断导演模式开没开 —— 真相在 core（WorldState.directorEnabled），本层只画；
 *   4. 每帧重画括号 —— 呼吸交给补间（一次 tween 跑到底），本层只在视口变化时重画几何。
 *
 * ★ 为什么画在屏幕空间（scrollFactor = 0）：
 *   取景框框的是「中屏」这个**画面区域**，不是地图上的某块地 —— 镜头推拉时它必须纹丝不动，
 *   否则观众看到的是一个跟着地图跑的框，读不出「取景器」的意思（同 task_086 把扫描光带
 *   迁到 HUD 屏幕空间的同一判断）。
 */

import Phaser from 'phaser';

import type { ViewportSize } from '../../core/types';
import { DIRECTOR_FRAME_METRICS, hexToRgba, VISUAL_PALETTE, WORLD_PALETTE } from '../theme';

import {
  DirectorFrameBoard,
  directorFrameSegments,
  stageRect,
  type FrameSegment,
} from './director-frame';

/** 屏幕空间层的深度：压在引导弧线（200）之上 —— 取景框是最后一道提示。 */
export const DIRECTOR_FRAME_DEPTH = 210;

export class DirectorFrameLayer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  /** 开关状态的唯一真相（规则见 director-frame.ts）。 */
  private readonly board = new DirectorFrameBoard();
  /** 呼吸补间（括号与标注共用一个 alpha 补间）。 */
  private breathTween: Phaser.Tweens.Tween | null = null;
  /** 上次绘制时的中屏矩形（视口变了才重画几何）。 */
  private lastRect: { x: number; y: number; width: number; height: number } | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setScrollFactor(0).setDepth(DIRECTOR_FRAME_DEPTH).setVisible(false);
    this.label = scene.add
      .text(0, 0, DIRECTOR_FRAME_METRICS.label, {
        fontFamily: 'monospace',
        fontSize: `${DIRECTOR_FRAME_METRICS.labelFontPx}px`,
        // 色值只此一份（纪律）：标注与括号同色（进度/施工琥珀），从唯一事实源取，不写字面量。
        color: hexToRgba(VISUAL_PALETTE.progress, 1),
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(DIRECTOR_FRAME_DEPTH)
      .setVisible(false);
  }

  /** 当前是否显示取景框（观察口）。 */
  get visible(): boolean {
    return this.board.visible;
  }

  /**
   * 开关取景框（导演模式开启 / 关闭）。
   * 开启 = 出框 + 起呼吸；关闭 = 收框 + 停呼吸（补间必须撤，否则它在隐藏的图层上白跑）。
   */
  setEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    if (!this.board.setEnabled(enabled)) return;
    if (!enabled) {
      this.breathTween?.remove();
      this.breathTween = null;
      this.graphics.setVisible(false).setAlpha(1);
      this.label.setVisible(false).setAlpha(1);
      return;
    }
    this.graphics.setVisible(true);
    this.label.setVisible(true);
    this.startBreath();
  }

  /**
   * 视口变化时重画几何（窗口 resize / 场景重建）。
   * why 不每帧画：括号的形状只跟中屏矩形有关，呼吸由补间负责（perf）。
   */
  sync(viewport: ViewportSize): void {
    if (this.destroyed || !this.board.visible) return;
    const rect = stageRect(viewport);
    if (this.lastRect && sameRect(this.lastRect, rect)) return;
    this.lastRect = rect;
    this.drawBrackets(directorFrameSegments(rect, DIRECTOR_FRAME_METRICS.cornerSizePx));
    this.label.setPosition(rect.x + rect.width / 2, rect.y + DIRECTOR_FRAME_METRICS.labelInsetPx);
  }

  /** 呼吸：括号与标注一起一亮一暗（提示「它一直亮着」，不是闪一下）。 */
  private startBreath(): void {
    this.breathTween?.remove();
    this.breathTween = null;
    const { maxAlpha, minAlpha, breathHalfPeriodMs } = DIRECTOR_FRAME_METRICS;
    this.graphics.setAlpha(maxAlpha);
    this.label.setAlpha(maxAlpha);
    // 补间只写 alpha（合成属性，不触发布局重排 —— perf 铁律）。
    this.breathTween = this.graphics.scene.tweens.add({
      targets: this.graphics,
      alpha: { from: maxAlpha, to: minAlpha },
      duration: breathHalfPeriodMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        // 标注跟随括号的透明度（两者同属一个「提示」，亮度必须一致）。
        this.label.setAlpha(this.graphics.alpha);
      },
    });
  }

  /** 画四角的括号线段。 */
  private drawBrackets(segments: readonly FrameSegment[]): void {
    this.graphics.clear();
    this.graphics.lineStyle(DIRECTOR_FRAME_METRICS.strokeWidthPx, WORLD_PALETTE.progress, 1);
    for (const segment of segments) {
      this.graphics.lineBetween(segment.from.x, segment.from.y, segment.to.x, segment.to.y);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.breathTween?.remove();
    this.breathTween = null;
    this.graphics.destroy();
    this.label.destroy();
  }
}

/** 两个矩形是否一致（视口没变就不重画几何）。 */
function sameRect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
