/**
 * 文件职责：**氛围彩蛋 —— 慢速小云**（task_079）—— 每 30-60s 从地图边缘漂过一朵小云。
 *   方案来源：docs/DEMO-PLAN.md §5 后半「氛围彩蛋（06）」。
 * 输入：Phaser 场景 + 战场边界（Bounds）+ 随机源（可注入，便于测试）。
 * 输出：飘过战场边缘的云（纯代码绘制的多边形，Phaser Graphics 一次性填色）。
 * 禁止事项：
 *   1. 发总线事件 —— 彩蛋是纯装饰：它不改变任何业务状态，world 不许为它发事件
 *      （总线铁律：world 只消费 core 的事实，不生产事实）；
 *   2. import hud / app / vue —— 铁律：world 不认识 hud；
 *   3. 每帧重建云的图形 —— 云的数量恒为 0-1，形状建一次、只移动它（perf）；
 *   4. 留下未清理的 tween / 定时器 / 显示对象 —— destroy() 统一收（perf：资源必须可清理）。
 *
 * ★ 为什么云画在单位**之下**（深度 -0.5）：它是背景气氛，不该盖住单位与任务建筑。
 *
 * @since v3.3（task_079）。
 */

import Phaser from 'phaser';

import type { Bounds } from '../../core/types';
import { DEFAULT_WORLD_BOUNDS } from '../camera/camera-math';
import { AMBIENCE_METRICS } from '../theme';

import { CLOUD_SHAPE_POINTS, cloudSpawn, nextCloudDelayMs } from './ambience-layout';

/** 云层的渲染深度（地面之上、单位之下）。 */
export const CLOUD_DEPTH = -0.5;

export interface CloudLayerOptions {
  /** 战场边界；缺省用 core 的 WORLD_BOUNDS。 */
  readonly bounds?: Bounds;
  /** 随机源（可注入 —— 单测要能确定性地复现出场序列）。 */
  readonly random?: () => number;
  /** 云的绘制色（Phaser 数字色）。 */
  readonly color?: number;
  /** 云的透明度。 */
  readonly alpha?: number;
}

/**
 * 小云层：定时放一朵云横穿战场，走完即销毁并预约下一朵。
 *
 * why 用「预约下一朵」而不是常驻循环的 tween：空场时一个云都没有（perf：不空跑），
 *   且间隔随机（30-60s）这件事由纯函数 nextCloudDelayMs 决定（单测可断言区间）。
 */
export class CloudLayer {
  private readonly scene: Phaser.Scene;
  private readonly bounds: Bounds;
  private readonly random: () => number;
  private readonly color: number;
  private readonly alpha: number;
  /** 当前在场的云（同一时刻最多一朵）。 */
  private cloud: Phaser.GameObjects.Graphics | null = null;
  private cloudTween: Phaser.Tweens.Tween | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, options: CloudLayerOptions = {}) {
    this.scene = scene;
    this.bounds = options.bounds ?? DEFAULT_WORLD_BOUNDS;
    this.random = options.random ?? Math.random;
    this.color = options.color ?? 0xffffff;
    this.alpha = options.alpha ?? AMBIENCE_METRICS.cloudAlpha;
    this.scheduleNext();
  }

  /** 释放云、tween 与定时器（场景 shutdown 时调用；perf：资源必须可清理）。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.timer?.remove(false);
    this.timer = null;
    this.cloudTween?.remove();
    this.cloudTween = null;
    this.cloud?.destroy();
    this.cloud = null;
  }

  /** 预约下一朵云（间隔 30-60s 随机）。 */
  private scheduleNext(): void {
    if (this.destroyed) return;
    this.timer = this.scene.time.addEvent({
      delay: nextCloudDelayMs(this.random),
      callback: () => this.spawn(),
    });
  }

  /** 放一朵云：建图形 → 匀速横穿 → 走完销毁并预约下一朵。 */
  private spawn(): void {
    if (this.destroyed) return;
    const size = AMBIENCE_METRICS.cloudSizePx;
    const plan = cloudSpawn(this.bounds, size.width, AMBIENCE_METRICS.cloudSpeedPxPerSec, this.random);

    const cloud = this.scene.add.graphics();
    cloud.setDepth(CLOUD_DEPTH);
    cloud.fillStyle(this.color, this.alpha);
    cloud.fillPoints(this.shapePoints(size.width, size.height), true);
    cloud.setPosition(plan.startX, plan.y - size.height / 2);
    this.cloud = cloud;

    this.cloudTween = this.scene.tweens.add({
      targets: cloud,
      x: plan.endX,
      duration: plan.travelMs,
      ease: 'Linear',
      onComplete: () => {
        cloud.destroy();
        if (this.cloud === cloud) this.cloud = null;
        this.cloudTween = null;
        this.scheduleNext();
      },
    });
  }

  /** 归一化轮廓 → 世界尺寸的多边形点列（云自身的形状，横向 0-1、纵向 0-1）。 */
  private shapePoints(width: number, height: number): { x: number; y: number }[] {
    return CLOUD_SHAPE_POINTS.map((point) => ({
      x: point.x * width,
      y: point.y * height,
    }));
  }
}
