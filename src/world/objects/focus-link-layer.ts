/**
 * 文件职责：**单位联动（Z2b）的战场渲染层** —— 左下事件轨 → 中屏单位的**引导弧线**。
 *   方案来源：docs/hud-redesign-proposal.html §2.2「视线动线（左下 → 中屏）」/ §2.5 Z2 行。
 * 输入：world 通道上的 `focus.unit` 事件（经 bridge → 场景 → 本层）+ 每帧的相机位姿与视口尺寸。
 * 输出：屏幕空间绘制的一条贝塞尔弧线（800ms 淡入，镜头移动实时跟随）。
 * 禁止事项：
 *   1. import hud —— 铁律：world 只认识 core 与 core/bus；
 *   2. 订阅总线 —— 事件由场景经桥接层递进来（world 侧进出 core 只有桥这一个口子）；
 *   3. import 渲染之外的业务状态 —— 焦点裁决在 focus-link.ts 的板子里，本层只画；
 *   4. 逐帧无条件重画 —— 终点没动就不重画（perf：Graphics 重画是本层最贵的一步）。
 *
 * ★ 为什么画在**屏幕空间**（scrollFactor = 0）：
 *   弧线的起点锚在 HUD 事件轨上（一个屏幕位置），终点是单位 —— 若整条线画在世界坐标里，
 *   起点会跟着镜头一起漂，线就从「事件轨」变成了「地图上的某个点」。
 *   屏幕空间绘制 + 每帧把单位的**世界坐标换算成屏幕坐标**（core/camera 的 worldToScreen）
 *   才能做到：镜头一动，线跟着走；起点永远钉在事件轨上。
 */

import Phaser from 'phaser';

import { worldToScreen } from '../../core/camera';
import type { CameraState, Point, ViewportSize } from '../../core/types';
import { FOCUS_LINK_METRICS, WORLD_PALETTE } from '../theme';

import {
  FocusLinkBoard,
  focusLinkArcPoints,
  focusLinkOrigin,
  type FocusLinkOutcome,
} from './focus-link';

/** 屏幕空间层的深度：压在地面渐晕（180）之上、单位层（0-20）之上。 */
export const FOCUS_LINK_DEPTH = 200;

/** 终点位移小于该值（屏幕 px）就不重画 —— 亚像素抖动不值得一次 Graphics 重画。 */
const REDRAW_EPSILON_PX = 0.5;

export class FocusLinkLayer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  /** 焦点状态的唯一真相（规则见 focus-link.ts）。 */
  private readonly board = new FocusLinkBoard();
  /** 淡入补间（弧线出现时的 800ms）；同一时刻只留一个。 */
  private fadeTween: Phaser.Tweens.Tween | null = null;
  /** 上次绘制时的终点（用于跳过无变化的重画）。 */
  private lastTarget: Point | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setScrollFactor(0).setDepth(FOCUS_LINK_DEPTH).setVisible(false);
  }

  /** 当前被锁定的单位 id（null = 无锁定）。 */
  get unitId(): string | null {
    return this.board.unitId;
  }

  /**
   * 点选一个单位：同一个单位 → 取消锁定（弧线收掉）；不同单位 → 改锁（弧线重画 + 重新淡入）。
   * 返回值告诉调用方焦点落到了谁身上（描边高亮由场景据此转交单位层）。
   */
  focus(unitId: string): FocusLinkOutcome {
    if (this.destroyed) return { unitId: this.board.unitId, changed: false, cleared: false };
    const outcome = this.board.focus(unitId);
    if (!outcome.changed) return outcome;
    if (outcome.cleared) {
      this.hideArc();
      return outcome;
    }
    this.showArc();
    return outcome;
  }

  /** 主动解除锁定（失焦：被锁定的单位离场 / 场景收尾）。 */
  clear(): FocusLinkOutcome {
    if (this.destroyed) return { unitId: null, changed: false, cleared: false };
    const outcome = this.board.clear();
    if (outcome.changed) this.hideArc();
    return outcome;
  }

  /**
   * 每帧同步弧线末端：把单位的**当前世界坐标**换算成屏幕坐标再重画。
   *
   * why 每帧都算：镜头在动、单位也在动（移动补间），两者都会改末端位置。
   *   但只在终点真的变了时才重画（perf：Graphics 重画是本层最贵的一步）。
   */
  sync(camera: CameraState, viewport: ViewportSize, unitPosition: Point | null): void {
    if (this.destroyed) return;
    if (this.board.unitId === null) return;
    // 单位不在场（离场 / id 悬空）→ 收掉弧线（表现不许指着一个不存在的单位）。
    if (!unitPosition) {
      this.clear();
      return;
    }
    const target = worldToScreen(unitPosition, camera, viewport);
    if (this.lastTarget && nearlySame(this.lastTarget, target)) return;
    this.lastTarget = target;
    this.drawArc(focusLinkOrigin(viewport), target);
  }

  /** 弧线出现：从全透明淡入到全不透明（800ms）。 */
  private showArc(): void {
    this.fadeTween?.remove();
    this.fadeTween = null;
    this.lastTarget = null;
    this.graphics.setVisible(true).setAlpha(0);
    this.fadeTween = this.graphics.scene.tweens.add({
      targets: this.graphics,
      alpha: 1,
      duration: FOCUS_LINK_METRICS.arcFadeInMs,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.fadeTween = null;
      },
    });
  }

  /** 弧线收掉：撤补间、清画面、隐藏（下次再出现时重新淡入）。 */
  private hideArc(): void {
    this.fadeTween?.remove();
    this.fadeTween = null;
    this.lastTarget = null;
    this.graphics.setAlpha(1).clear().setVisible(false);
  }

  /** 画一条弧线：起点在事件轨，终点在单位（屏幕坐标）。 */
  private drawArc(origin: Point, target: Point): void {
    const points = focusLinkArcPoints(origin, target);
    this.graphics.clear();
    this.graphics.lineStyle(FOCUS_LINK_METRICS.arcStrokePx, WORLD_PALETTE.accent, 1);
    this.graphics.strokePoints(points);
  }

  destroy(): void {
    this.destroyed = true;
    this.fadeTween?.remove();
    this.fadeTween = null;
    this.graphics.destroy();
  }
}

/** 两点是否近到不值得重画（亚像素抖动不算「变了」）。 */
function nearlySame(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < REDRAW_EPSILON_PX && Math.abs(a.y - b.y) < REDRAW_EPSILON_PX;
}
