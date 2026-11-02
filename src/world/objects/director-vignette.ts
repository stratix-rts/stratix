/**
 * 文件职责：**报错红色渐晕层**（@since v3.3，task_081）—— 屏幕边缘的红色呼吸光。
 *   方案来源：docs/DEMO-PLAN.md §7「报错事件附加红色 vignette 脉冲（边缘红光呼吸 2 次）」。
 * 输入：Phaser 场景（承载显示对象与补间）；脉冲次数 / 时长取自 DIRECTOR_METRICS。
 * 输出：覆盖全屏的四条边缘渐变（红色），被 pulse() 触发时呼吸若干次后归零。
 * 禁止事项：
 *   1. 持有业务状态 —— 这一层只管「亮一下红光」，不知道有没有出错、错在谁身上；
 *   2. import hud / app —— 铁律（色值走 world/theme 门面）；
 *   3. 复用地面层的黑渐晕 —— 那是**世界坐标**里的静态装饰；这一层是**屏幕坐标**的瞬态提示，
 *   两者坐标空间与生命周期都不同，混在一起会把「报错红光」画到地图上去；
 *   4. 留下未清理的补间 / 显示对象 —— destroy() 统一收（perf：资源必须可清理）。
 *
 * ★ 为什么用 Graphics 渐变而不是一张贴图：渐晕是「边缘浓、中心淡」的柔光，
 *   Graphics.fillGradientStyle 正好能画（WebGL 专有特性，Canvas 渲染器会忽略 ——
 *   故先落一次近乎透明的 fillStyle 兜底，Canvas 下等于没有红光，而不是一条白带）。
 */

import Phaser from 'phaser';

import { DIRECTOR_METRICS, WORLD_PALETTE } from '../theme';

/** 渐晕层的深度：压在单位 / 任务浮标之上（它是「盖在画面上的提示」）。 */
export const DIRECTOR_VIGNETTE_DEPTH = 900;

/** 渐晕层样式（可调参数集中一处，改观感只动这里）。 */
export interface DirectorVignetteStyle {
  /** 边缘红光颜色（调色板 danger）。 */
  readonly color: number;
  /** 最高透明度（呼吸的峰值）。 */
  readonly alpha: number;
  /** 自屏幕边缘向内的厚度（屏幕 px）。 */
  readonly depthPx: number;
}

/** 默认样式：色值与数值全部取自唯一事实源（core/theme/visual-spec.ts）。 */
export const DIRECTOR_VIGNETTE_STYLE: DirectorVignetteStyle = Object.freeze({
  color: WORLD_PALETTE.danger,
  alpha: DIRECTOR_METRICS.vignetteAlpha,
  depthPx: DIRECTOR_METRICS.vignetteDepthPx,
});

export interface DirectorVignetteOptions {
  readonly style?: DirectorVignetteStyle;
}

/**
 * 红色渐晕层：报错时的屏幕边缘红光（呼吸 2 次）。
 *
 * 坐标口径：**屏幕坐标**（scrollFactor = 0）—— 它提示的是「屏幕这边出事了」，
 * 不是「地图这块地方出事了」，故不随镜头移动。
 */
export class DirectorVignette {
  private readonly scene: Phaser.Scene;
  private readonly style: DirectorVignetteStyle;
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private tween: Phaser.Tweens.Tween | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, options: DirectorVignetteOptions = {}) {
    this.scene = scene;
    this.style = options.style ?? DIRECTOR_VIGNETTE_STYLE;
    this.redraw();
  }

  /**
   * 红色渐晕脉冲（呼吸 N 次；缺省取 DIRECTOR_METRICS.vignettePulses = 2）。
   *
   * why 用 counter + yoyo 而不是直接补间 alpha：yoyo 让「亮起→熄灭」自动成对，
   *   repeat = 次数 - 1，一次补间就够 —— 不用自己维护第二段补间（少一处状态）。
   */
  pulse(times: number = DIRECTOR_METRICS.vignettePulses): void {
    if (this.destroyed) return;
    const graphics = this.graphics;
    if (!graphics) return;
    this.tween?.remove();
    this.tween = null;
    const count = Math.max(1, Math.floor(Number.isFinite(times) ? times : 1));
    graphics.setAlpha(0);
    this.tween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: DIRECTOR_METRICS.vignettePulseMs,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: count - 1,
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        graphics.setAlpha(this.style.alpha * (tween.getValue() ?? 0));
      },
      onComplete: () => {
        graphics.setAlpha(0);
        this.tween = null;
      },
    });
  }

  /** 视口尺寸变化后重画（屏幕坐标的图形不随 resize 自适应）。 */
  resize(): void {
    this.redraw();
  }

  /** 释放显示对象与补间（场景 shutdown 时调用；perf：资源必须可清理）。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.tween?.remove();
    this.tween = null;
    this.graphics?.destroy();
    this.graphics = null;
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  /** 重画四条边缘渐变（屏幕坐标）。 */
  private redraw(): void {
    if (this.destroyed) return;
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const depth = this.style.depthPx;
    const color = this.style.color;
    const alpha = this.style.alpha;

    const graphics = this.graphics ?? this.scene.add.graphics();
    if (!this.graphics) {
      graphics.setDepth(DIRECTOR_VIGNETTE_DEPTH);
      // 屏幕坐标：红光提示的是「屏幕这边」，不跟着镜头跑。
      graphics.setScrollFactor(0);
      this.graphics = graphics;
    }
    graphics.clear();

    // 上边（上浓下淡）
    graphics.fillStyle(color, 0.0001);
    graphics.fillGradientStyle(color, color, color, color, alpha, alpha, 0, 0);
    graphics.fillRect(0, 0, width, depth);
    // 下边（下浓上淡）
    graphics.fillStyle(color, 0.0001);
    graphics.fillGradientStyle(color, color, color, color, 0, 0, alpha, alpha);
    graphics.fillRect(0, height - depth, width, depth);
    // 左边（左浓右淡）
    graphics.fillStyle(color, 0.0001);
    graphics.fillGradientStyle(color, color, color, color, alpha, 0, alpha, 0);
    graphics.fillRect(0, 0, depth, height);
    // 右边（右浓左淡）
    graphics.fillStyle(color, 0.0001);
    graphics.fillGradientStyle(color, color, color, color, 0, alpha, 0, alpha);
    graphics.fillRect(width - depth, 0, depth, height);
  }
}
