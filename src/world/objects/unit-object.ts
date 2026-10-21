/**
 * 文件职责：战场上单个 Agent 单位的最简渲染对象 —— 位置（世界层自治）+ 业务态镜像。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/objects 单位」+ §1 组织模型（编组 = 多选集合，D5）。
 * 输入：core 广播的 UnitView（只读业务态）+ 世界坐标。
 * 输出：只读单位属性 + 位置读写 + 与最新 UnitView 的对账结果。
 * 禁止事项：
 *   1. import phaser —— 本文件是纯数据对象，画出来是 objects/unit-layer.ts 的事；
 *   2. import hud / vue / legacy(stratix-rts) —— 铁律：world 只认识 core/types；
 *   3. 让 sync() 改动位置 —— core 的 UnitView 根本不含坐标（见 core/types.ts 的说明），
 *      位置真相只在本文件，一旦被业务态同步覆盖，单位就会每来一次状态广播就瞬移回出生点；
 *   4. 塞业务规则（能否被指派任务等）—— 那是 core/unit 的状态机职责。
 */

import type { Point, UnitStatus, UnitView } from '../../core/types';

/** 点击 / 框选共用的命中半径（世界坐标像素）。 */
export const UNIT_HIT_RADIUS = 20;

/**
 * 战场上的一个 Agent 单位：世界层自治的位置 + core 广播的业务态镜像。
 * 实例一律由 UnitRegistry 创建与回收 —— 位置真相只在这里，别处直接 new 会绕过对账逻辑。
 */
export class UnitObject {
  readonly id: string;

  private x: number;
  private y: number;
  private view: UnitView;

  constructor(view: UnitView, position: Point) {
    this.id = view.id;
    this.x = position.x;
    this.y = position.y;
    this.view = view;
  }

  get position(): Point {
    return { x: this.x, y: this.y };
  }

  get status(): UnitStatus {
    return this.view.status;
  }

  get name(): string {
    return this.view.name;
  }

  get power(): number {
    return this.view.power;
  }

  get missionId(): string | null {
    return this.view.missionId;
  }

  /** 移动到新的世界坐标，返回是否真的动了（调用方可据此跳过无变化重绘）。 */
  setPosition(x: number, y: number): boolean {
    if (this.x === x && this.y === y) return false;
    this.x = x;
    this.y = y;
    return true;
  }

  /**
   * 用最新的 UnitView 刷新业务态。
   * 返回是否有实质变化（渲染层据此决定要不要重画）。
   * 注意：这里刻意只更新 view，不碰 x/y —— 位置由世界层自治，core 不持有坐标。
   */
  sync(view: UnitView): boolean {
    if (
      this.view.status === view.status &&
      this.view.name === view.name &&
      this.view.power === view.power &&
      this.view.missionId === view.missionId
    ) {
      return false;
    }
    this.view = view;
    return true;
  }

  /** 点击命中判定：命中半径为圆（与框选判定共用同一半径，手感一致）。 */
  containsPoint(point: Point, radius: number = UNIT_HIT_RADIUS): boolean {
    const dx = point.x - this.x;
    const dy = point.y - this.y;
    return dx * dx + dy * dy <= radius * radius;
  }
}
