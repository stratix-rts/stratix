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
 *   5. 让站位种子回到**全局键** —— 键必须按副本分区（task_185 / M1-11），
 *      旧全局键只许出现在一次性迁移里，迁完即删。
 */

import { DEFAULT_INSTANCE_ID, type Bounds, type Point, type ProjectInstanceId, type UnitView } from '../../core/types';
import { DEFAULT_WORLD_BOUNDS } from '../camera/camera-math';

import { UNIT_HIT_RADIUS, UnitObject } from './unit-object';

/** 新单位的落位间距（世界坐标像素）。 */
const SPAWN_GAP = 96;

/** 落位起点相对战场边缘的内缩量。 */
const SPAWN_MARGIN = 96;

/**
 * 站位种子键的**前缀**（@since v3.3，task_185 / M1-11）—— 完整键 = 前缀 + 副本 id。
 *
 * why 按副本分区：站位是「**按 instance 归属**的事实」（design §7.1 M1-11 行）。
 *   旧实现把整份站位塞进**一个全局键**（`stratix:unit-position-seed`）⇒ A 副本的位置会漏到 B 副本
 *   （design §2.5 #6 / #18 / #22）。dsh 侧是同一条纪律：workspace 唯一性按 realpath、
 *   session 归属按 `header.cwd` —— 归属是硬事实，不是显示偏好。
 *
 * 值形状：ReadonlyMap<unitId, Point>，来自 app 层持久化快照（unit_positions 表）。
 */
export const UNIT_POSITION_SEED_KEY_PREFIX = 'stratix:unit-position-seed:';

/**
 * 站位种子的**旧全局键**（@since v3.12，task_033；@since v3.3 task_185 / M1-11 降级为「迁移专用」）。
 *
 * ⚠️ 这个键**只**允许出现在一次性迁移里（migrateLegacyPositionSeed）：它是全局单份，
 *   留着就等于留着「A 的位置迟早漏进 B」的口子。迁移完成即删除，全仓不再有第二个读取点。
 * why 键本身住在 registry（Phaser game.registry）而不是场景构造器：场景由 Phaser 实例化，
 *   构造器拿不到注入 —— 与 UNIT_SPRITE_SOURCE_KEY 同一模式：组合根在 preBoot 里塞，场景 create 时取。
 */
export const LEGACY_UNIT_POSITION_SEED_KEY = 'stratix:unit-position-seed';

/**
 * 新键（按副本分区）：`stratix:unit-position-seed:<instanceId>`。
 * why 单独一个函数而不是各处拼字符串：键名是**契约**（app 层写、world 层读），只有一处定义。
 */
export function unitPositionSeedKey(instanceId: ProjectInstanceId): string {
  return `${UNIT_POSITION_SEED_KEY_PREFIX}${instanceId}`;
}

/**
 * 站位种子的键仓（Phaser `game.registry` 的最小形状）。
 * why 抽象成接口：迁移与读取都是纯逻辑，不该被 Phaser 绑死（world 层零 Phaser 依赖 ⇒ 可单测）。
 */
export interface PositionSeedStore {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  remove(key: string): void;
}

/** 判断某个值是不是站位种子（Map<unitId, Point>）。 */
function isSeedMap(value: unknown): value is ReadonlyMap<string, Point> {
  return value instanceof Map;
}

/** 一次性迁移的输入（归属信息由 app 层给 —— world 层不知道「谁属于哪个副本」）。 */
export interface PositionSeedMigrationOptions {
  /**
   * 单位 → 所属副本的裁决（app 层提供：角色的 instanceId，缺省归默认沙盒）。
   * why 需要它：旧键是**全局单份**，里面混着各副本的站位 —— 不按归属拆开就等于把 A 的位置塞进 B。
   */
  readonly ownerOf?: (unitId: string) => ProjectInstanceId | undefined;
  /**
   * 归属查不到时的落点（两侧都取**默认沙盒**：老存档没有副本维度 ⇒ 归默认沙盒，
   * 不是「无归属」—— 与 core 侧 scopeOf 的 COALESCE 口径同一条纪律）。
   * why 不落给「正在读的那个副本」：那正是把旧数据塞给先读到它的副本 = 漏口。
   */
  readonly fallbackInstanceId: ProjectInstanceId;
}

/** 一次性迁移的结果。 */
export interface PositionSeedMigrationResult {
  /** 实际迁进新键的条目数。 */
  readonly migrated: number;
  /** 迁移前旧键是否存在（false = 本来就是新格式，无需迁移）。 */
  readonly legacyPresent: boolean;
}

/**
 * **一次性迁移**：旧全局键 → 各副本的新键，迁完**删掉旧键**。
 *
 * ⚠️ 这是「搬走」，**不是**「回落」：旧键的内容被**拆进各副本的键**（按归属），
 *   然后旧键当场删除 ⇒ 此后全仓再没有一个地方能从旧键读到站位
 *   ⇒ A 副本的位置不会漏进 B 副本（design §7.1 M1-11 行①②③）。
 *
 * why 迁移点在 app 层（组合根启动时）而不是战场读取时：归属（谁的站位）只有读档那一侧知道
 *   （角色档案上的 instanceId）；战场侧只知道「我现在是哪个副本」，不知道「这个单位属于谁」。
 *   在读取点迁移只能把整份旧数据塞给「先读到的那一个副本」—— 那正是设计点名禁止的漏法。
 *
 * @param store 键仓（Phaser game.registry）。
 * @param options 归属裁决 + 归属查不到时的落点。
 */
export function migrateLegacyPositionSeed(
  store: PositionSeedStore,
  options: PositionSeedMigrationOptions
): PositionSeedMigrationResult {
  const legacy = store.get(LEGACY_UNIT_POSITION_SEED_KEY);
  // 旧键不存在 ⇒ 已是新格式（没有可迁的东西，也就没有残留）。
  if (!isSeedMap(legacy)) return { migrated: 0, legacyPresent: false };

  // 逐条按归属拆进各副本的新键；新键已有条目不覆盖（新数据优先于老存档）。
  let migrated = 0;
  for (const [unitId, point] of legacy) {
    const owner = options.ownerOf?.(unitId) ?? options.fallbackInstanceId;
    const key = unitPositionSeedKey(owner);
    const existing = store.get(key);
    const target: Map<string, Point> = isSeedMap(existing)
      ? (existing as Map<string, Point>)
      : new Map<string, Point>();
    if (target.has(unitId)) continue;
    target.set(unitId, point);
    store.set(key, target);
    migrated += 1;
  }

  // 迁完即删旧键：**不留回落口**（旧键是全局单份，留着迟早漏进别的副本）。
  store.remove(LEGACY_UNIT_POSITION_SEED_KEY);
  return { migrated, legacyPresent: true };
}

/**
 * 读当前副本的站位种子。
 *
 * ⚠️ **只读新键**（`stratix:unit-position-seed:<instanceId>`）：读不到时最多做**一次**迁移
 *   （旧全局键 → 新键，旧键当场删除），**绝不**「读不到新键就回落旧键」——
 *   旧键是全局单份，回落之后 A 副本的位置仍然会漏进 B 副本（只是不报错），
 *   这正是 design §7.1 M1-11 行③ 点名禁止的写法。
 *
 * 迁移时归属查不到的条目归**默认沙盒**（COALESCE 口径：老存档没有副本维度）
 *   ⇒ 读 B 副本时旧数据也不会落到 B 头上（安全网不许变成漏口）。
 *
 * @param store 键仓（Phaser game.registry）。
 * @param instanceId 当前副本 id。
 * @param options 迁移时的归属裁决（省略 ⇒ 全部归默认沙盒）。
 */
export function resolvePositionSeed(
  store: PositionSeedStore,
  instanceId: ProjectInstanceId,
  options?: { readonly ownerOf?: (unitId: string) => ProjectInstanceId | undefined }
): ReadonlyMap<string, Point> | undefined {
  const key = unitPositionSeedKey(instanceId);
  const existing = store.get(key);
  if (isSeedMap(existing)) {
    // 新键已有数据 ⇒ 旧键（若还在）只可能是**残留**（老版本留下 / 上一次迁移漏网）：
    //   旧键是全局单份、无法归属 ⇒ 当场删掉，不留任何回落口。
    if (store.get(LEGACY_UNIT_POSITION_SEED_KEY) !== undefined) {
      store.remove(LEGACY_UNIT_POSITION_SEED_KEY);
    }
    return existing;
  }

  // 读不到新键 ⇒ 一次性迁移（搬走旧键，不是回落）；迁完旧键即消失，此后不可能再回落。
  migrateLegacyPositionSeed(store, {
    ownerOf: options?.ownerOf,
    fallbackInstanceId: DEFAULT_INSTANCE_ID,
  });
  const migrated = store.get(key);
  return isSeedMap(migrated) ? migrated : undefined;
}

export interface UnitRegistryOptions {
  readonly worldBounds?: Bounds;
  readonly hitRadius?: number;
  /**
   * 恢复站位（@since v3.12，task_033）：unitId → 上次会话的世界坐标。
   * sync() 新增单位时优先用这里的坐标；没记录的沿用网格落位。
   * 只读：注册表不拥有这份缓存，消费后不删除（同 id 重复加入时重用旧位是合法回退）。
   */
  readonly restoredPositions?: ReadonlyMap<string, Point>;
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
  private restoredPositions?: ReadonlyMap<string, Point>;
  private spawnCursor = 0;

  constructor(options: UnitRegistryOptions = {}) {
    this.worldBounds = options.worldBounds ?? DEFAULT_WORLD_BOUNDS;
    this.hitRadius = options.hitRadius ?? UNIT_HIT_RADIUS;
    this.restoredPositions = options.restoredPositions;
  }

  /**
   * 注入恢复站位（@since v3.12，task_033）。
   * why 是方法而不只是构造器选项：注册表实例是场景的字段初始化器建的，
   *   早于 create()（那时还拿不到 game.registry），场景只能在 create 里补注。
   * 传 undefined 是 no-op（不清空已注入的种子）：dev 页从不注入，不该能抹掉生产侧的注入。
   */
  applyRestoredPositions(positions: ReadonlyMap<string, Point> | undefined): void {
    if (positions) this.restoredPositions = positions;
  }

  get size(): number {
    return this.objects.size;
  }

  /**
   * 战场边界（只读）。
   * why 暴露出去：渲染层要算"从战场边缘走进来"的入场起点（task_140 的走位）。
   */
  get bounds(): Bounds {
    return this.worldBounds;
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
      // 新单位没有坐标可继承（core 不持有位置）：有持久化记录的按记录恢复（@since v3.12，task_033），
      // 没记录的由世界层按网格分配落位（沿用现有随机落位逻辑，语义不变）
      const restored = this.restoredPositions?.get(view.id);
      this.objects.set(view.id, new UnitObject(view, restored ?? this.nextSpawnPosition()));
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
    this.restoredPositions = undefined;
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
