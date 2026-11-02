/**
 * 文件职责：**把任务建筑与区域点亮画到战场上**（task_078）—— 三态建筑（地基 / 施工 / 完工）
 *   + 区域点亮过渡（底色 5%→12%，1s）+ 区域名浮字。
 *   方案来源：docs/DEMO-PLAN.md §5「任务建筑三态（05）」+「区域点亮（05）」。
 * 输入：Phaser 场景 + MapBoard 的对账产物（MapSyncResult：区域 / 建筑 / 本次跳变事件）。
 * 输出：与建筑一一对应的显示节点 + 每个区域一块底色矩形 + 点亮时的一次性浮字。
 * 禁止事项：
 *   1. 判定任务相位 —— 相位真相在 core，本层只画 MapBoard 给出的结果；
 *   2. import hud / app / vue —— 铁律：world 不认识 hud（色值走 world/theme 门面）；
 *   3. 每个建筑各开一个常驻定时器 —— 逐窗点亮用「一次性延时链」，
 *      画完即焚（perf：资源必须可清理，节点销毁时定时器一并撤掉）；
 *   4. 重复点亮同一个区域 —— 点亮是**一次性过渡**（MapBoard 只报一次跳变，本层再兜一层已点亮集合）。
 *
 * ★ 三态与 core 的对应（见 objects/task-building.ts 头注）：
 *   地基 = queued / failed / cancelled；施工 = running / awaiting_approval；完工 = completed。
 *
 * @since v3.3（task_078）。
 */

import Phaser from 'phaser';

import { DEFAULT_UNIT_COLOR, VISUAL_PALETTE, WORLD_PALETTE, hexToRgba } from '../theme';

import {
  BUILDING_SIZE,
  type MapBuilding,
  type MapRegion,
  type MapSyncResult,
} from './task-building';

/** 建筑/区域层的深度（渲染次序：区域底色 < 建筑 < 单位(0)）。 */
export const BUILDING_DEPTH = Object.freeze({
  /** 区域底色（未点亮 5% / 点亮 12%）。 */
  region: -3,
  /** 建筑本体。 */
  building: -2,
  /** 区域名浮字。 */
  floatText: 1,
});

/** 窗户数量（2 列 × 3 行）。 */
export const WINDOW_COUNT = 6;

/** 建筑层样式（可调参数集中一处，改观感只动这里）。 */
export interface BuildingStyle {
  /** 地基框色（中性灰：调色板无灰，取 world/theme 的兜底灰）。 */
  readonly foundationColor: number;
  /** 地基框透明度。 */
  readonly foundationAlpha: number;
  /** 脚手架 / 吊臂色（施工 = 进度琥珀）。 */
  readonly scaffoldColor: number;
  /** 吊臂摆动幅度（度，DEMO-PLAN §5：±15°）。 */
  readonly craneSwingDeg: number;
  /** 吊臂一个来回的时长（ms）。 */
  readonly cranePeriodMs: number;
  /** 完工塔身色（我方主色青蓝）。 */
  readonly bodyColor: number;
  /** 完工窗户 / 屋顶灯色（完成 = 翠绿）。 */
  readonly windowColor: number;
  /** 窗户边长（px）。 */
  readonly windowSize: number;
  /** 窗户逐个点亮的间隔（ms，DEMO-PLAN §5：200ms）。 */
  readonly windowIntervalMs: number;
  /** 区域底色（装饰紫）。 */
  readonly regionColor: number;
  /** 区域未点亮时的底色透明度（5%）。 */
  readonly regionAlphaFrom: number;
  /** 区域点亮后的底色透明度（12%）。 */
  readonly regionAlphaTo: number;
  /** 点亮过渡时长（ms，DEMO-PLAN §5：1s）。 */
  readonly regionLightDurationMs: number;
  /** 区域名文字色。 */
  readonly regionNameColor: string;
  /** 区域名副标题文字色（装饰色 = 调色板 accent，色值不在本文件另抄）。 */
  readonly regionCaptionColor: string;
  /** 字体族（含中文回退，避免方框字）。 */
  readonly fontFamily: string;
}

/** 默认样式。 */
export const BUILDING_STYLE: BuildingStyle = Object.freeze({
  foundationColor: DEFAULT_UNIT_COLOR,
  foundationAlpha: 0.9,
  scaffoldColor: WORLD_PALETTE.progress,
  craneSwingDeg: 15,
  cranePeriodMs: 1600,
  bodyColor: WORLD_PALETTE.unit,
  windowColor: WORLD_PALETTE.success,
  windowSize: 8,
  windowIntervalMs: 200,
  regionColor: WORLD_PALETTE.accent,
  regionAlphaFrom: 0.05,
  regionAlphaTo: 0.12,
  regionLightDurationMs: 1000,
  regionNameColor: '#e8f1ff',
  regionCaptionColor: hexToRgba(VISUAL_PALETTE.accent, 1),
  fontFamily: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
});

/** 一栋建筑的显示节点。 */
interface BuildingNode {
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly crane: Phaser.GameObjects.Graphics | null;
  craneTween: Phaser.Tweens.Tween | null;
  /** 当态模型（重绘时按它取三态与失败标记）。 */
  building: MapBuilding;
  /** 已点亮的窗户数（逐个点亮动画的进度）。 */
  litWindows: number;
  /** 逐窗点亮的延时链（画完即焚，节点销毁时一并撤掉）。 */
  timers: Phaser.Time.TimerEvent[];
}

/** 一个区域的显示节点（底色矩形 + 区域模型）。 */
interface RegionNode {
  readonly rect: Phaser.GameObjects.Rectangle;
  region: MapRegion;
  lit: boolean;
}

export interface BuildingLayerOptions {
  readonly style?: BuildingStyle;
}

/**
 * 建筑层：把 MapBoard 的对账结果画成建筑与区域底色，并驱动三态动画。
 */
export class BuildingLayer {
  private readonly scene: Phaser.Scene;
  private readonly style: BuildingStyle;
  private readonly buildings = new Map<string, BuildingNode>();
  private readonly regions = new Map<string, RegionNode>();
  private destroyed = false;

  constructor(scene: Phaser.Scene, options: BuildingLayerOptions = {}) {
    this.scene = scene;
    this.style = options.style ?? BUILDING_STYLE;
  }

  /**
   * 对账显示对象：按 MapSyncResult 增删建筑/区域节点，并响应本次跳变事件。
   * 调用时机：场景收到 core 的 missions/tasks 广播之后（每次状态广播一次）。
   */
  sync(result: MapSyncResult): void {
    if (this.destroyed) return;
    this.syncRegions(result.regions);
    this.syncBuildings(result.buildings);

    for (const id of result.completedBuildingIds) this.startWindowLighting(id);
    for (const id of result.clearedRegionIds) this.lightRegion(id);
  }

  /** 释放全部显示对象与定时器（场景 shutdown 时调用）。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const node of this.buildings.values()) this.disposeBuilding(node);
    this.buildings.clear();
    for (const node of this.regions.values()) node.rect.destroy();
    this.regions.clear();
  }

  // ==========================================================================
  // 内部：区域
  // ==========================================================================

  /** 区域底色：有区域就画一块 5% 的底色；区域消失则销节点。 */
  private syncRegions(regions: readonly MapRegion[]): void {
    const live = new Set<string>();
    for (const region of regions) {
      live.add(region.id);
      let node = this.regions.get(region.id);
      if (!node) {
        const rect = this.scene.add.rectangle(
          region.x + region.width / 2,
          region.y + region.height / 2,
          region.width,
          region.height,
          this.style.regionColor,
          this.style.regionAlphaFrom
        );
        rect.setRounded(12);
        rect.setDepth(BUILDING_DEPTH.region);
        node = { rect, region, lit: false };
        this.regions.set(region.id, node);
      }
      node.region = region;
      // 区域矩形可能因区域集合变化而移动/改尺寸，逐次对齐。
      node.rect.setPosition(region.x + region.width / 2, region.y + region.height / 2);
      node.rect.setSize(region.width, region.height);
    }
    for (const [id, node] of Array.from(this.regions.entries())) {
      if (live.has(id)) continue;
      node.rect.destroy();
      this.regions.delete(id);
    }
  }

  /**
   * 区域点亮：底色 5%→12% 渐变 1s + 区域名浮字浮现。
   * 一次性：已点亮的区域不再重复过渡（MapBoard 只报一次跳变，这里再兜一层）。
   */
  private lightRegion(regionId: string): void {
    const node = this.regions.get(regionId);
    if (!node || node.lit) return;
    node.lit = true;
    this.scene.tweens.add({
      targets: node.rect,
      fillAlpha: this.style.regionAlphaTo,
      duration: this.style.regionLightDurationMs,
      ease: 'Cubic.Out',
    });
    const region = this.regions.get(regionId)?.region;
    if (region) this.showRegionName(region);
  }

  /** 区域名浮字：上浮 + 淡入，停留后淡出自毁（一次性）。 */
  private showRegionName(region: MapRegion): void {
    const title = this.scene.add.text(0, -10, region.name, {
      fontFamily: this.style.fontFamily,
      fontSize: '22px',
      color: this.style.regionNameColor,
    });
    title.setOrigin(0.5, 0.5);
    const caption = this.scene.add.text(0, 14, '区域点亮', {
      fontFamily: this.style.fontFamily,
      fontSize: '13px',
      color: this.style.regionCaptionColor,
    });
    caption.setOrigin(0.5, 0.5);

    const centerX = region.x + region.width / 2;
    const centerY = region.y + region.height / 2;
    const container = this.scene.add.container(centerX, centerY, [title, caption]);
    container.setDepth(BUILDING_DEPTH.floatText);
    container.setAlpha(0);

    this.scene.tweens.add({ targets: container, alpha: 1, duration: 300, ease: 'Cubic.Out' });
    this.scene.tweens.add({
      targets: container,
      y: centerY - 24,
      duration: 900,
      ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: container,
      alpha: 0,
      delay: 1600,
      duration: 600,
      onComplete: () => container.destroy(),
    });
  }

  // ==========================================================================
  // 内部：建筑
  // ==========================================================================

  /** 建筑节点对账：新建 / 换态重画 / 销节点。 */
  private syncBuildings(buildings: readonly MapBuilding[]): void {
    const live = new Set<string>();
    for (const building of buildings) {
      live.add(building.id);
      let node = this.buildings.get(building.id);
      if (!node) {
        node = this.createBuilding(building);
        this.buildings.set(building.id, node);
        this.drawBuilding(node);
        continue;
      }
      if (node.building.state !== building.state) {
        node.building = building;
        node.litWindows = 0;
        this.stopCrane(node);
        this.drawBuilding(node);
      } else {
        node.building = building;
      }
      node.container.setPosition(building.x, building.y);
    }
    for (const [id, node] of Array.from(this.buildings.entries())) {
      if (live.has(id)) continue;
      this.disposeBuilding(node);
      this.buildings.delete(id);
    }
  }

  /** 建节点：主体 + 吊臂（吊臂单独一个 Graphics，绕自身枢轴旋转不带动脚手架）。 */
  private createBuilding(building: MapBuilding): BuildingNode {
    const container = this.scene.add.container(building.x, building.y);
    container.setDepth(BUILDING_DEPTH.building);
    const body = this.scene.add.graphics();
    container.add(body);
    const crane = this.scene.add.graphics();
    crane.setPosition(0, -BUILDING_SIZE / 2 - 6);
    container.add(crane);
    return {
      container,
      body,
      crane,
      craneTween: null,
      building,
      litWindows: 0,
      timers: [],
    };
  }

  /** 按建筑态重画主体。 */
  private drawBuilding(node: BuildingNode): void {
    const graphic = node.body;
    graphic.clear();
    const building = node.building;

    if (building.state === 'foundation') {
      this.drawFoundation(graphic, building.failed);
      return;
    }

    if (building.state === 'building') {
      this.drawScaffold(graphic);
      this.drawCrane(node);
      return;
    }

    this.drawTower(graphic, node.litWindows);
  }

  /** 地基：灰描边空框 + 四角角块（失败/取消的工地加一道红叉）。 */
  private drawFoundation(graphic: Phaser.GameObjects.Graphics, failed: boolean): void {
    const half = BUILDING_SIZE / 2;
    const color = this.style.foundationColor;
    graphic.lineStyle(2, color, this.style.foundationAlpha);
    graphic.strokeRect(-half, -half, BUILDING_SIZE, BUILDING_SIZE);
    graphic.fillStyle(color, this.style.foundationAlpha);
    const corner = 10;
    graphic.fillRect(-half, -half, corner, 3);
    graphic.fillRect(half - corner, -half, corner, 3);
    graphic.fillRect(-half, half - 3, corner, 3);
    graphic.fillRect(half - corner, half - 3, corner, 3);
    if (failed) {
      // 停工工地：绯红叉（调色板 danger）。
      graphic.lineStyle(2, WORLD_PALETTE.danger, 0.9);
      graphic.lineBetween(-half + 8, -half + 8, half - 8, half - 8);
      graphic.lineBetween(half - 8, -half + 8, -half + 8, half - 8);
    }
  }

  /** 施工中：脚手架框 + 交叉斜撑。 */
  private drawScaffold(graphic: Phaser.GameObjects.Graphics): void {
    const half = BUILDING_SIZE / 2;
    const color = this.style.scaffoldColor;
    graphic.lineStyle(2, color, 0.85);
    graphic.strokeRect(-half, -half, BUILDING_SIZE, BUILDING_SIZE);
    graphic.lineStyle(1, color, 0.5);
    graphic.lineBetween(-half, -half, half, half);
    graphic.lineBetween(half, -half, -half, half);
    graphic.lineStyle(2, color, 0.85);
    graphic.lineBetween(-half, -half - 6, half, -half - 6);
  }

  /** 吊臂：枢轴在脚手架顶上方，臂身左右摆 ±craneSwingDeg。 */
  private drawCrane(node: BuildingNode): void {
    const crane = node.crane;
    if (!crane) return;
    crane.clear();
    crane.lineStyle(2, this.style.scaffoldColor, 0.95);
    crane.lineBetween(0, 0, 30, 0);
    crane.lineBetween(30, 0, 30, 9);
    crane.fillStyle(this.style.scaffoldColor, 0.95);
    crane.fillCircle(0, 0, 2.5);
    if (node.craneTween) return;
    node.craneTween = this.scene.tweens.add({
      targets: crane,
      angle: { from: -this.style.craneSwingDeg, to: this.style.craneSwingDeg },
      duration: this.style.cranePeriodMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** 停掉吊臂摆动（建筑离开施工态时；tween 必须停，否则空转烧 CPU）。 */
  private stopCrane(node: BuildingNode): void {
    node.craneTween?.remove();
    node.craneTween = null;
    if (node.crane) {
      node.crane.clear();
      node.crane.angle = 0;
    }
  }

  /** 完工：实心小塔 + 窗户（逐个点亮）+ 屋顶灯（全部点亮后亮起）。 */
  private drawTower(graphic: Phaser.GameObjects.Graphics, litWindows: number): void {
    const bodyColor = this.style.bodyColor;
    // 塔身（底边与地基框底边对齐）。
    graphic.fillStyle(bodyColor, 0.92);
    graphic.fillRect(-18, -40, 36, 64);
    // 屋顶帽。
    graphic.fillStyle(bodyColor, 1);
    graphic.fillRect(-12, -48, 24, 8);

    // 窗户：2 列 × 3 行，逐个点亮（未点亮的画成暗色）。
    const size = this.style.windowSize;
    const columns = [-14, 6];
    const rows = [-30, -14, 2];
    let index = 0;
    for (const y of rows) {
      for (const x of columns) {
        const lit = index < litWindows;
        graphic.fillStyle(lit ? this.style.windowColor : WORLD_PALETTE.background, 1);
        graphic.fillRect(x, y, size, size);
        index += 1;
      }
    }

    // 屋顶灯：窗户全亮后才亮（收尾的仪式感）。
    if (litWindows >= WINDOW_COUNT) {
      graphic.fillStyle(this.style.windowColor, 1);
      graphic.fillCircle(0, -54, 3);
    }
  }

  /**
   * 逐窗点亮：每 windowIntervalMs（200ms）点亮一扇。
   * 用一次性延时链而不是常驻定时器 —— 画完即焚（perf）。
   */
  private startWindowLighting(buildingId: string): void {
    const node = this.buildings.get(buildingId);
    if (!node) return;
    this.clearTimers(node);
    node.litWindows = 0;
    this.drawBuilding(node);

    for (let index = 0; index < WINDOW_COUNT; index += 1) {
      const timer = this.scene.time.delayedCall(index * this.style.windowIntervalMs, () => {
        node.litWindows = index + 1;
        this.drawBuilding(node);
      });
      node.timers.push(timer);
    }
  }

  /** 撤掉节点上的延时链。 */
  private clearTimers(node: BuildingNode): void {
    for (const timer of node.timers) timer.remove(false);
    node.timers.length = 0;
  }

  /** 销毁节点（显示对象 + 定时器 + 吊臂 tween）。 */
  private disposeBuilding(node: BuildingNode): void {
    this.clearTimers(node);
    this.stopCrane(node);
    node.container.destroy();
  }
}
