/**
 * 文件职责：单位集合的唯一持有者 —— 把 core 广播的 UnitView[] 对账成带世界坐标的 UnitObject[]，
 *   并负责框选 / 点击的命中判定。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/objects」+ core/unit/selection.ts 的约定
 *   （"框选命中判定在 world 侧完成，core 只收结果 id"）。
 * 输入：UnitView[]（来自总线 state 通道）、世界边界（决定新单位落位范围）。
 * 输出：对账结果（新增 / 移除 / 更新三组 id）+ 查询接口（按 id 取对象、框选命中、点击命中）。
 * 禁止事项：
 *   1. import phaser —— 命中判定是纯几何，放在渲染层就没法单测；
 *   2. import hud / vue / legacy —— 铁律：world 只认识 core/types；
 *   3. 缓存 UnitView 快照再自行 diff —— 对账只看本次广播的数组，历史状态由 Map 自身承载；
 *   4. 引入无限增长的结构 —— 每次 sync 都按本次 UnitView[] 全量对账，
 *      Map 条目数恒等于当前单位数，不会随时间膨胀（perf：数据不许无限增长）。
 */

import type { Bounds, Point, UnitView } from '../../core/types';
import { DEFAULT_WORLD_BOUNDS } from '../camera/camera-math';

import { UNIT_HIT_RADIUS, UnitObject } from './unit-object';

/** 新单位的落位间距（世界坐标像素）。 */
const SPAWN_GAP = 96;

/** 落位起点相对战场边缘的内缩量。 */
const SPAWN_MARGIN = 96;

export interface UnitRegistryOptions {
  readonly worldBounds?: Bounds;
  readonly hitRadius?: number;
}

export interface UnitSyncResult {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly updated: readonly string[];
}

/**
 * 世界层全部 Agent 单位的唯一持有者。
 * 职责边界：只做「UnitView[] ↔ 带坐标的单位对象」的对账与命中判定，不含任何业务判断
 * （能不能被指派任务之类一律是 core/unit 的事）。
 */
export class UnitRegistry {
  /** Map 保持插入顺序，渲染层级与命中顺序都依赖它。 */
  private readonly objects = new Map<string, UnitObject>();
  private readonly worldBounds: Bounds;
  private readonly hitRadius: number;
  private spawnCursor = 0;

  constructor(options: UnitRegistryOptions = {}) {
    this.worldBounds = options.worldBounds ?? DEFAULT_WORLD_BOUNDS;
    this.hitRadius = options.hitRadius ?? UNIT_HIT_RADIUS;
  }

  get size(): number {
    return this.objects.size;
  }

  get(id: string): UnitObject | undefined {
    return this.objects.get(id);
  }

  /** 按落位顺序（即视觉层级）返回全部单位。 */
  list(): UnitObject[] {
    return Array.from(this.objects.values());
  }

  /**
   * 用一次广播的 UnitView[] 做全量对账。
   * why 保留未出现在本次广播里的旧单位：state 通道发的是完整快照，快照里没有的单位即为已销毁。
   */
  sync(units: readonly UnitView[]): UnitSyncResult {
    const added: string[] = [];
    const updated: string[] = [];
    const seen = new Set<string>();

    for (const view of units) {
      seen.add(view.id);
      const existing = this.objects.get(view.id);
      if (existing) {
        if (existing.sync(view)) updated.push(view.id);
        continue;
      }
      // 新单位没有坐标可继承（core 不持有位置），由世界层按网格分配落位
      this.objects.set(view.id, new UnitObject(view, this.nextSpawnPosition()));
      added.push(view.id);
    }

    const removed: string[] = [];
    for (const id of Array.from(this.objects.keys())) {
      if (seen.has(id)) continue;
      this.objects.delete(id);
      removed.push(id);
    }

    return { added, removed, updated };
  }

  /**
   * 框选命中：返回与矩形相交的单位 id（按落位顺序）。
   * why 用"相交"而非"完全包含"：RTS 惯例是碰到就算，且密集编队下完全包含几乎框不中东西。
   */
  queryBounds(bounds: Bounds): string[] {
    const hitIds: string[] = [];
    for (const object of this.objects.values()) {
      const { x, y } = object.position;
      const nearX = x >= bounds.x - this.hitRadius && x <= bounds.x + bounds.width + this.hitRadius;
      const nearY = y >= bounds.y - this.hitRadius && y <= bounds.y + bounds.height + this.hitRadius;
      if (nearX && nearY) hitIds.push(object.id);
    }
    return hitIds;
  }

  /**
   * 点击命中：返回最上层的单位（后加入的画在上层），没命中返回 null。
   * 反向遍历依赖 Map 的插入顺序 = 渲染层级，无需额外维护 zIndex。
   */
  hitTest(point: Point): UnitObject | null {
    const list = this.list();
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].containsPoint(point, this.hitRadius)) return list[i];
    }
    return null;
  }

  destroy(): void {
    this.objects.clear();
    this.spawnCursor = 0;
  }

  /**
   * 网格落位：**以战场中心为轴左右交替铺开**（0, -1, +1, -2, +2 …），每两个单位换一行。
   * why 从中心铺（@since v3.9，task_026）：默认镜头就对着战场中心，
   *   新单位若落在左上角，用户建完角色在画面上什么也看不到（"角色进战场"等于没发生）。
   * why 左右交替而不是单向向右铺：单向铺会把后来的单位全推到右半边，
   *   而默认镜头的右半边正好压着 HUD 右栏（半透明面板）—— 角色的皮肤色被压暗，看不出染没染上。
   * why 回绕：宁可与已有单位重叠，也不能让新单位落在战场之外（那样既看不见也点不到）。
   */
  private nextSpawnPosition(): Point {
    const usableWidth = Math.max(SPAWN_GAP, this.worldBounds.width - SPAWN_MARGIN * 2);
    const usableHeight = Math.max(SPAWN_GAP, this.worldBounds.height - SPAWN_MARGIN * 2);

    const columns = Math.max(1, Math.floor(usableWidth / SPAWN_GAP));
    const rows = Math.max(1, Math.floor(usableHeight / SPAWN_GAP));

    const index = this.spawnCursor;
    this.spawnCursor += 1;

    // 中心格：网格的中点（0 号单位正好落在它上面）。
    const centerCol = Math.floor((columns - 1) / 2);
    const centerRow = Math.floor((rows - 1) / 2);

    // 左右交替：奇数号往左、偶数号往右，距离逐个加一格。
    const distance = Math.floor((index + 1) / 2);
    const direction = index % 2 === 1 ? -1 : 1;
    // 每两个单位换一行（左右各一个）。
    const layer = Math.floor(index / 2);

    const col = (((centerCol + direction * distance) % columns) + columns) % columns;
    const row = (centerRow + layer) % rows;

    // 网格原点对齐战场中心（默认镜头正对着它）→ 新单位一出现就在画面里。
    return {
      x: this.worldBounds.x + this.worldBounds.width / 2 + (col - centerCol) * SPAWN_GAP,
      y: this.worldBounds.y + this.worldBounds.height / 2 + (row - centerRow) * SPAWN_GAP,
    };
  }
}
