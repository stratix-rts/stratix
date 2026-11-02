/**
 * 文件职责：**把地面层画到战场上**（task_078）—— 深色格网 + 横向扫描光带 + 四角坐标刻度 + 边缘渐晕。
 *   方案来源：docs/DEMO-PLAN.md §5「地面（05）」。
 * 输入：Phaser 场景 + 战场边界（Bounds）+ 样式常量（色值取自 ../theme 的 WORLD_PALETTE）。
 * 输出：一组静态地面显示对象 + 一条扫描光带 tween（12s 一轮，循环点无跳变）。
 * 禁止事项：
 *   1. 持有业务状态 —— 地面是静态装饰层，不认识任务、区域、单位；
 *   2. import hud / app / vue —— 铁律：world 不认识 hud（色值走 world/theme 门面）；
 *   3. 逐帧重建格网 —— 格网是静态的，画一次就够（perf：静态层不做每帧重绘）；
 *   4. 遗留未清理的显示对象 / tween —— destroy() 统一收（perf：资源必须可清理）。
 *
 * ★ 深度口径（render order）：战场底板 < 格网 < 扫描光带 < 区域底色 < 建筑 < 渐晕 < 单位(0) < 任务浮标(4~5)。
 *   渐晕压在建筑之上、单位之下 —— 边缘的地面要素沉下去，但单位始终清晰可读。
 *
 * @since v3.3（task_078）。
 */

import Phaser from 'phaser';

import type { Bounds } from '../../core/types';
import { DEFAULT_WORLD_BOUNDS } from '../camera/camera-math';
import { AMBIENCE_METRICS, WORLD_PALETTE } from '../theme';

import { warmColor } from './ambience-layout';
import {
  CORNER_TICK_SIZE,
  GROUND_GRID_STEP,
  SCAN_BAND_ALPHA,
  SCAN_BAND_PERIOD_MS,
  SCAN_BAND_WIDTH,
  VIGNETTE_DEPTH,
  cornerLabels,
  cornerTickSegments,
  gridSegments,
  scanBandX,
} from './ground-layout';

/** 地面各层的深度（场景装配时按这套数字对齐渲染次序）。 */
export const GROUND_DEPTH = Object.freeze({
  /** 战场底板（场景里那块底衬矩形）。 */
  bounds: -6,
  /** 地面渐变（底板之上、格网之下）。 */
  surface: -5.5,
  /** 格网。 */
  grid: -5,
  /** 扫描光带。 */
  band: -4,
  /** 边缘渐晕。 */
  vignette: -1,
});

/** 地面层样式（可调参数集中一处，改观感只动这里）。 */
export interface GroundStyle {
  /** 格网线色（调色板 grid）。 */
  readonly gridColor: number;
  /** 格网线宽。 */
  readonly gridLineWidth: number;
  /** 地面渐变色（白压一层，做「深夜蓝渐变」的柔光）。 */
  readonly surfaceColor: number;
  /** 地面渐变最浓处的透明度（上缘）。 */
  readonly surfaceAlpha: number;
  /** 四角刻度线色（装饰色）。 */
  readonly tickColor: number;
  /** 四角坐标文字色。 */
  readonly labelColor: string;
  /** 扫描光带颜色（白）。 */
  readonly bandColor: number;
  /** 边缘渐晕颜色（黑）。 */
  readonly vignetteColor: number;
  /** 渐晕最深处的透明度。 */
  readonly vignetteAlpha: number;
}

/** 默认样式：色值全部取自调色板（唯一事实源 core/theme/visual-spec.ts）。 */
export const GROUND_STYLE: GroundStyle = Object.freeze({
  gridColor: WORLD_PALETTE.grid,
  gridLineWidth: 1,
  surfaceColor: 0xffffff,
  surfaceAlpha: 0.05,
  tickColor: WORLD_PALETTE.accent,
  labelColor: '#6b7a99',
  bandColor: 0xffffff,
  vignetteColor: 0x000000,
  vignetteAlpha: 0.55,
});

export interface GroundLayerOptions {
  readonly style?: GroundStyle;
  /** 战场边界；缺省用 core 的 WORLD_BOUNDS。 */
  readonly bounds?: Bounds;
}

/**
 * 地面层：格网（静态）+ 扫描光带（12s 一轮）+ 四角刻度与坐标 + 边缘渐晕。
 */
export class GroundLayer {
  private readonly scene: Phaser.Scene;
  private readonly bounds: Bounds;
  private readonly style: GroundStyle;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private bandTween: Phaser.Tweens.Tween | null = null;
  private destroyed = false;
  /** 格网图形（入夜变暖时重画它 —— 见 setWarmth）。 */
  private gridGraphics: Phaser.GameObjects.Graphics | null = null;
  /** 暖度（0 = 常态，1 = 入夜变暖；@since v3.3，task_079 的氛围彩蛋）。 */
  private warmth = 0;

  constructor(scene: Phaser.Scene, options: GroundLayerOptions = {}) {
    this.scene = scene;
    this.bounds = options.bounds ?? DEFAULT_WORLD_BOUNDS;
    this.style = options.style ?? GROUND_STYLE;

    this.drawSurface();
    this.drawGrid();
    this.drawScanBand();
    this.drawCornerTicks();
    this.drawVignette();
  }

  /**
   * 设置格网暖度（@since v3.3，task_079 的氛围彩蛋：真实时间 19-24 点背景网格微微变暖）。
   *
   * why 只改格网：规格只说「背景网格微微变暖」—— 底板 / 渐晕 / 光带保持原样，
   *   暖意只出现在最该出现的地方（网格线），且只重画这一层（perf：不重画整层地面）。
   *
   * @param level 0 = 常态；1 = 完全变暖（中间值按比例混合，可做渐变）。
   */
  setWarmth(level: number): void {
    const next = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    if (next === this.warmth) return;
    this.warmth = next;
    this.paintGrid();
  }

  /** 释放显示对象与 tween（场景 shutdown 时调用；perf：资源必须可清理）。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.bandTween?.remove();
    this.bandTween = null;
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
    this.gridGraphics = null;
  }

  // ==========================================================================
  // 内部：各层绘制
  // ==========================================================================

  /**
   * 地面渐变：自上而下淡出的柔光（DEMO-PLAN §1「深夜蓝渐变」）。
   * why 用白压一层而不是另抄一个蓝：调色板是唯一事实源，白色低透明度叠加即可得到
   *   「上亮下暗」的通透感，不必在色板外新造一个色值。
   * 与渐晕同理，fillGradientStyle 是 WebGL 专有 —— 先落一次近乎透明的 fillStyle 兜底。
   */
  private drawSurface(): void {
    const { bounds } = this;
    const color = this.style.surfaceColor;
    const alpha = this.style.surfaceAlpha;
    const graphics = this.scene.add.graphics();
    graphics.setDepth(GROUND_DEPTH.surface);
    graphics.fillStyle(color, 0.0001);
    graphics.fillGradientStyle(color, color, color, color, alpha, alpha, 0, 0);
    graphics.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.objects.push(graphics);
  }

  /** 深色格网：横纵每 GROUND_GRID_STEP 一条，一次画完（静态层不重绘）。 */
  private drawGrid(): void {
    const graphics = this.scene.add.graphics();
    graphics.setDepth(GROUND_DEPTH.grid);
    this.gridGraphics = graphics;
    this.objects.push(graphics);
    this.paintGrid();
  }

  /**
   * 重画格网（按当前暖度着色）。
   * why 单独抽出来：暖度变化时只需重画这一层，不必重建整个地面层（perf）。
   */
  private paintGrid(): void {
    const graphics = this.gridGraphics;
    if (!graphics) return;
    graphics.clear();
    graphics.lineStyle(this.style.gridLineWidth, this.currentGridColor(), 1);
    for (const segment of gridSegments(this.bounds, GROUND_GRID_STEP)) {
      graphics.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
    }
  }

  /** 当前格网色：入夜（暖度 > 0）时基色向暖色混合 —— 见 ambience-layout 的 warmColor。 */
  private currentGridColor(): number {
    return warmColor(
      this.style.gridColor,
      WORLD_PALETTE.progress,
      this.warmth,
      AMBIENCE_METRICS.warmMix
    );
  }

  /**
   * 横向扫描光带：宽 120px 的 8% 白带，12s 扫过全场。
   * 位置由纯函数 scanBandX(elapsed) 给出（objects/ground-layout.ts）—— 相位回绕发生在
   * 光带完全出界之后，故循环点不跳变。
   * 用 counter tween 驱动而不是直接补间 x：counter 的 0→1 是单调的，
   * 位置换算只留一份实现（渲染层与单测共用同一个函数）。
   */
  private drawScanBand(): void {
    const { bounds } = this;
    const band = this.scene.add.rectangle(
      bounds.x - SCAN_BAND_WIDTH,
      bounds.y,
      SCAN_BAND_WIDTH,
      bounds.height,
      this.style.bandColor,
      SCAN_BAND_ALPHA
    );
    band.setDepth(GROUND_DEPTH.band);

    // 光带只在战场矩形内可见：用边界矩形做几何遮罩（出界部分不画）。
    const maskShape = this.scene.add.graphics();
    maskShape.fillStyle(0xffffff, 1);
    maskShape.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    maskShape.setVisible(false);
    band.setMask(maskShape.createGeometryMask());

    this.bandTween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: SCAN_BAND_PERIOD_MS,
      ease: 'Linear',
      repeat: -1,
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        const progress = tween.getValue() ?? 0;
        band.x = scanBandX(progress * SCAN_BAND_PERIOD_MS, bounds, SCAN_BAND_WIDTH);
      },
    });

    this.objects.push(band, maskShape);
  }

  /** 四角坐标刻度：L 形角标 + 坐标数字（战场原点左上）。 */
  private drawCornerTicks(): void {
    const graphics = this.scene.add.graphics();
    graphics.setDepth(GROUND_DEPTH.grid);
    graphics.lineStyle(2, this.style.tickColor, 0.75);
    for (const segment of cornerTickSegments(this.bounds, CORNER_TICK_SIZE)) {
      graphics.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
    }
    this.objects.push(graphics);

    for (const label of cornerLabels(this.bounds)) {
      const text = this.scene.add.text(label.point.x, label.point.y, label.text, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: this.style.labelColor,
      });
      text.setOrigin(label.origin, label.origin);
      text.setDepth(GROUND_DEPTH.grid);
      this.objects.push(text);
    }
  }

  /**
   * 边缘渐晕：四条自边缘向内淡出的黑色渐变带。
   * why 渐变用 Graphics.fillGradientStyle：它是 WebGL 专有特性，Canvas 渲染器会忽略 ——
   *   故先落一次近乎透明的 fillStyle 作兜底（Canvas 下等于没有渐晕，而不是一条白带）。
   */
  private drawVignette(): void {
    const { bounds } = this;
    const depth = VIGNETTE_DEPTH;
    const color = this.style.vignetteColor;
    const alpha = this.style.vignetteAlpha;
    const graphics = this.scene.add.graphics();
    graphics.setDepth(GROUND_DEPTH.vignette);

    // 上边（上深下浅）
    graphics.fillStyle(color, 0.0001);
    graphics.fillGradientStyle(color, color, color, color, alpha, alpha, 0, 0);
    graphics.fillRect(bounds.x, bounds.y, bounds.width, depth);
    // 下边（下深上浅）
    graphics.fillStyle(color, 0.0001);
    graphics.fillGradientStyle(color, color, color, color, 0, 0, alpha, alpha);
    graphics.fillRect(bounds.x, bounds.y + bounds.height - depth, bounds.width, depth);
    // 左边（左深右浅）
    graphics.fillStyle(color, 0.0001);
    graphics.fillGradientStyle(color, color, color, color, alpha, 0, alpha, 0);
    graphics.fillRect(bounds.x, bounds.y, depth, bounds.height);
    // 右边（右深左浅）
    graphics.fillStyle(color, 0.0001);
    graphics.fillGradientStyle(color, color, color, color, 0, alpha, 0, alpha);
    graphics.fillRect(bounds.x + bounds.width - depth, bounds.y, depth, bounds.height);

    this.objects.push(graphics);
  }
}
