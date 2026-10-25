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

import {
  appearancePartItemId,
  appearancePartVariant,
  type CharacterAppearance,
  type Point,
  type UnitStatus,
  type UnitView,
} from '../../core/types';

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

  /**
   * 单位带的皮肤 id（@since v3.9）：角色单位带自己的皮肤，渲染层据此染色（见 world/theme.ts）。
   * 没有皮肤的普通单位返回 null —— 渲染层回落到业务态颜色。
   */
  get skinId(): string | null {
    return this.view.skinId ?? null;
  }

  /**
   * 单位带的角色外观（@since v3.10）：渲染层据此合成 LPC 精灵表（见 objects/unit-layer.ts）。
   * 没有外观的单位返回 null —— 渲染层回落到占位形体，不编造长相。
   */
  get appearance(): CharacterAppearance | null {
    return this.view.appearance ?? null;
  }

  /**
   * 单位关联的角色 id（@since v3.10）：形象精灵的缓存键就是它
   * （同一角色的多个单位共用一张精灵表）。
   */
  get characterId(): string | null {
    return this.view.characterId ?? null;
  }

  /**
   * 在线位（@since v3.30，task_054）：false = 绑定的 CLI 掉线 → 渲染层灰显。
   * 缺省 true（UnitView.online 不写入即在档在线 —— 老档 / 未探测不误伤，core 契约同口径）。
   * 与 status 正交：忙闲真相归 task 状态机，这里只叠加灰显。
   */
  get online(): boolean {
    return this.view.online !== false;
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
      this.view.missionId === view.missionId &&
      (this.view.skinId ?? null) === (view.skinId ?? null) &&
      appearanceKey(this.view.appearance) === appearanceKey(view.appearance) &&
      (this.view.online ?? true) === (view.online ?? true)
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

/**
 * 外观的**比较键**（体型 + 部位变体，按类别名排序）。
 * why 要一个键：appearance 是嵌套字典，逐字段比对啰嗦；排序后拼串即可判"变没变"。
 * @since v3.11：键里带上 itemId —— 同变体不同素材（91 个发型共用一套发色）是两张脸，
 *   只比变体会把"换了发型"误判成"没变"。
 */
function appearanceKey(appearance: CharacterAppearance | null | undefined): string {
  if (!appearance) return '';
  const parts = Object.entries(appearance.parts)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(
      ([category, value]) =>
        `${category}=${appearancePartItemId(value) ?? ''}:${appearancePartVariant(value)}`
    )
    .join(',');
  return `${appearance.bodyType}|${parts}`;
}
