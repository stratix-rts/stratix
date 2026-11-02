/**
 * 文件职责：**core 任务状态 → 地图建筑 / 区域的纯映射与布局**（task_078）。
 *   方案来源：docs/DEMO-PLAN.md §5「地图：新大陆隐喻」——
 *   「任务 = 地块上的建筑。完成一片区域 → 点亮为『街区』」。
 * 输入：core/types 的 MissionView[]（编组任务）+ CharacterTask[]（角色任务），只读。
 * 输出：MapBoard（对账板）—— sync() 给出区域、建筑、**本次同步新发生的完成/点亮事件**。
 * 禁止事项：
 *   1. import phaser —— 本文件是纯逻辑，画出来是 objects/building-layer.ts 的事（node 单测直接引本文件）；
 *   2. import hud / app / vue / legacy —— 铁律：world 只认识 core/types；
 *   3. 持有第二份任务真相 —— 相位真相在 core（WorldState.missions / WorldState.tasks），
 *      本板只保存「上次同步时的相位」用于**识别状态跳变**（跳变才有动画，静态重绘不需要）；
 *   4. 自己判定业务真相（任务该不该完成）—— 完成与否由 core 的任务状态机说了算，
 *      本文件只把 core 的 status 翻译成「地基 / 施工 / 完工」三种建筑态。
 *
 * ============ 隐喻落到 v3 契约上的对应关系（v2 的「域」已退役，这里给出可落地的替代）============
 *   DEMO-PLAN 原文：项目 = 岛屿，域 = 区域，任务 = 建筑。
 *   v3 的 core 契约里没有「域/项目」（Zone 已在 v3 重构中退役，见 REFACTOR_PLAN_V3 §4），
 *   剩下的两级实体正好一一对应：
 *     - **区域（街区）= MissionView**（编组任务）：有标题（区域名浮字用 mission.title）、
 *       有相位（phase='done' 即整片区域收工）、有归属（unitIds）。
 *     - **建筑 = CharacterTask**（角色任务）：有 status（queued/running/completed/failed），
 *       正好对应三态：地基 → 施工 → 完工。
 *   一条角色任务用 missionId 挂在 mission 上（core/types 的 CharacterTask.missionId，
 *   task_076 加的字段）——这就是「楼在街区里」的归属关系；没挂 mission 的普通派发
 *   落进一块固定的「未归属任务」空地（FREE_REGION_*），不假装它属于某个区域。
 *
 * ============ 布局口径 ============
 *   战场被切成 7×5 = 35 个「地块格」。区域按**创建顺序**占格，
 *   但占格顺序是**从中心向外**（cellOrder）—— 第一个建的区域落在战场正中，
 *   默认镜头正对着那儿，直播时新区域一出现就在画面里（不是甩到角落看不见）。
 *   建筑在所属区域内按 4 列 × 3 行的固定位次排布（位次由任务创建顺序决定，稳定不跳）。
 */

import type { Bounds, CharacterTask, MissionView, Point } from '../../core/types';
import { DEFAULT_WORLD_BOUNDS } from '../camera/camera-math';

/** 建筑的三态（DEMO-PLAN §5「任务建筑三态」）。 */
export type BuildingState =
  /** 地基：灰描边空框（还没动工）。 */
  | 'foundation'
  /** 施工中：脚手架 + 小吊臂左右摆。 */
  | 'building'
  /** 完成：实心小塔 + 窗户逐个点亮。 */
  | 'done';

/**
 * 地块格列数（区域占位网格）。
 * why 取奇数：奇数列行才能让**正中那一格**的中心正好落在战场中心 ——
 *   默认镜头对着战场中心，第一个建的区域就该落在镜头正中（直播时新区域一出现就在画面里）。
 */
export const REGION_COLUMNS = 7;
/** 地块格行数（区域占位网格；与列数同为奇数，理由同上）。 */
export const REGION_ROWS = 5;
/** 区域矩形相对地块格的内缩（世界坐标 px）。 */
export const REGION_PADDING = 24;
/** 区域内建筑的列数。 */
export const BUILDING_COLUMNS = 4;
/** 区域内建筑的首屏行数（超出继续向下排）。 */
export const BUILDING_ROWS = 3;
/** 建筑占地边长（世界坐标 px；与单位命中盒 48px 同尺度）。 */
export const BUILDING_SIZE = 48;
/** 未挂 mission 的普通派发所占的空地区域 id。 */
export const FREE_REGION_ID = 'stratix:region:unassigned';
/** 未挂 mission 的普通派发所占的空地区域名（区域名浮字用）。 */
export const FREE_REGION_NAME = '未归属任务';

/** 一个区域（街区）的表现模型。 */
export interface MapRegion {
  /** 区域 id（= mission id；空地区域为 FREE_REGION_ID）。 */
  readonly id: string;
  /** 区域名（= mission title；空地区域为 FREE_REGION_NAME）。 */
  readonly name: string;
  /** 区域矩形（世界坐标）。 */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 是否已点亮（区域内建筑全部完工 / mission 已收工）。 */
  readonly cleared: boolean;
  /** 区域内建筑数。 */
  readonly buildingCount: number;
}

/** 一栋建筑（= 一条角色任务）的表现模型。 */
export interface MapBuilding {
  /** 建筑 id（= task id）。 */
  readonly id: string;
  /** 所属区域 id。 */
  readonly regionId: string;
  /** 建筑中心（世界坐标）。 */
  readonly x: number;
  readonly y: number;
  /** 建筑态。 */
  readonly state: BuildingState;
  /** 是否为失败/取消的工地（表现上给一圈绯红提示，仍是「地基」态）。 */
  readonly failed: boolean;
}

/** 一次对账的产物：当前全貌 + 本次新发生的跳变事件。 */
export interface MapSyncResult {
  readonly regions: readonly MapRegion[];
  readonly buildings: readonly MapBuilding[];
  /** 本次同步中「刚变成完工」的建筑 id（渲染层据此逐窗点亮）。 */
  readonly completedBuildingIds: readonly string[];
  /** 本次同步中「刚被认领」的建筑 id（task_077：渲染层据此 3D 翻卡）。 */
  readonly claimedBuildingIds: readonly string[];
  /** 本次同步中「刚点亮」的区域 id（渲染层据此做一次性过渡）。 */
  readonly clearedRegionIds: readonly string[];
}

/**
 * 角色任务状态 → 建筑态。
 *   queued            → 地基（还没动工）
 *   running           → 施工中
 *   awaiting_approval → 施工中（等裁决，工期未停 —— 与 core 的「非终态」口径一致）
 *   completed         → 完工
 *   failed/cancelled  → 地基（工地停了；另给 failed 标记做红提示）
 */
export function buildingStateFor(task: CharacterTask): BuildingState {
  switch (task.status) {
    case 'running':
    case 'awaiting_approval':
      return 'building';
    case 'completed':
      return 'done';
    default:
      return 'foundation';
  }
}

/** 失败/取消的工地（仍是地基态，另作红色提示）。 */
export function buildingFailed(task: CharacterTask): boolean {
  return task.status === 'failed' || task.status === 'cancelled';
}

/**
 * 地块格的中心点序列：**从中心向外**（同环内从上到下、从左到右）。
 * why 中心优先：默认镜头对着战场中心，第一个建的区域要落在镜头里，
 *   否则直播时新区域一出现就在画面外（看得见的建筑才有「进度感」）。
 */
export function regionCellCenters(bounds: Bounds): readonly Point[] {
  const cellWidth = bounds.width / REGION_COLUMNS;
  const cellHeight = bounds.height / REGION_ROWS;
  const centerColumn = (REGION_COLUMNS - 1) / 2;
  const centerRow = (REGION_ROWS - 1) / 2;
  const cells: { point: Point; ring: number }[] = [];
  for (let column = 0; column < REGION_COLUMNS; column += 1) {
    for (let row = 0; row < REGION_ROWS; row += 1) {
      cells.push({
        point: {
          x: bounds.x + (column + 0.5) * cellWidth,
          y: bounds.y + (row + 0.5) * cellHeight,
        },
        ring: Math.max(Math.abs(column - centerColumn), Math.abs(row - centerRow)),
      });
    }
  }
  cells.sort((a, b) => a.ring - b.ring || a.point.y - b.point.y || a.point.x - b.point.x);
  return cells.map((cell) => cell.point);
}

export interface MapBoardOptions {
  /** 战场边界（默认 core 的 WORLD_BOUNDS）。 */
  readonly bounds?: Bounds;
}

/**
 * 地图对账板：core 的任务状态 → 区域/建筑布局 + 跳变事件。
 * 纯逻辑（零 Phaser、零 IO、零时钟）—— 时间相关的动画在渲染层，本板只报「跳了」。
 */
export class MapBoard {
  private readonly bounds: Bounds;
  /** 区域 id → 占用的地块格序号（保证区域位置不随新增任务漂移）。 */
  private readonly regionSlots = new Map<string, number>();
  /** 上次同步时的建筑态（用来识别「刚完工」）。 */
  private readonly lastStates = new Map<string, BuildingState>();
  /** 已点亮的区域（用来识别「刚点亮」，点亮只做一次性过渡）。 */
  private readonly clearedRegions = new Set<string>();
  private nextSlot = 0;

  constructor(options: MapBoardOptions = {}) {
    this.bounds = options.bounds ?? DEFAULT_WORLD_BOUNDS;
  }

  /**
   * 用一次状态广播对账全图。
   * @param missions 编组任务（= 区域）。顺序即占格顺序。
   * @param tasks 角色任务（= 建筑）。missionId 决定它落在哪个区域里。
   */
  sync(missions: readonly MissionView[], tasks: readonly CharacterTask[]): MapSyncResult {
    const regionIds = new Set<string>();
    const missionById = new Map<string, MissionView>();
    for (const mission of missions) {
      if (!mission.id || regionIds.has(mission.id)) continue;
      regionIds.add(mission.id);
      missionById.set(mission.id, mission);
    }

    // 任务按归属分组：挂着 mission 的进对应区域，其余进「未归属任务」空地。
    const tasksByRegion = new Map<string, CharacterTask[]>();
    const freeTasks: CharacterTask[] = [];
    for (const task of tasks) {
      const missionId = task.missionId ?? null;
      if (missionId !== null && regionIds.has(missionId)) {
        const bucket = tasksByRegion.get(missionId);
        if (bucket) bucket.push(task);
        else tasksByRegion.set(missionId, [task]);
      } else {
        freeTasks.push(task);
      }
    }
    if (freeTasks.length > 0) {
      tasksByRegion.set(FREE_REGION_ID, freeTasks);
    }

    // 区域顺序：mission 在前（保持 core 的数组顺序 = 创建顺序），空地区域垫后。
    const orderedRegionIds: string[] = missions
      .map((mission) => mission.id)
      .filter((id, index, all) => id.length > 0 && all.indexOf(id) === index);
    if (tasksByRegion.has(FREE_REGION_ID)) orderedRegionIds.push(FREE_REGION_ID);

    const cells = regionCellCenters(this.bounds);
    const cellWidth = this.bounds.width / REGION_COLUMNS;
    const cellHeight = this.bounds.height / REGION_ROWS;

    const regions: MapRegion[] = [];
    const buildings: MapBuilding[] = [];

    for (const regionId of orderedRegionIds) {
      const slot = this.slotFor(regionId);
      const cell = cells[slot % cells.length];
      // 占格数超过格子总数时（同格叠加）沿右下错开一点，避免完全重叠。
      const wrapOffset = Math.floor(slot / cells.length) * 32;
      const width = Math.max(BUILDING_SIZE, cellWidth - REGION_PADDING * 2);
      const height = Math.max(BUILDING_SIZE, cellHeight - REGION_PADDING * 2);
      const regionX = cell.x - width / 2 + wrapOffset;
      const regionY = cell.y - height / 2 + wrapOffset;

      const regionTasks = [...(tasksByRegion.get(regionId) ?? [])].sort(compareTasks);
      const regionBuildings = regionTasks.map((task, index) =>
        this.toBuilding(task, regionId, regionX, regionY, width, height, index, regionTasks.length)
      );
      buildings.push(...regionBuildings);

      const mission = missionById.get(regionId);
      const allDone =
        regionBuildings.length > 0 && regionBuildings.every((building) => building.state === 'done');
      // 区域点亮的两个口径（任一成立即点亮）：
      //   ① mission 收工（core 的 phase='done' —— 区域整体完工的权威信号）；
      //   ② 区域内每栋建筑都完工（core 尚未翻转 mission 相位时的等价表现）。
      const cleared = mission ? mission.phase === 'done' || allDone : allDone;

      regions.push({
        id: regionId,
        name: mission ? mission.title.trim() || '未命名区域' : FREE_REGION_NAME,
        x: regionX,
        y: regionY,
        width,
        height,
        cleared,
        buildingCount: regionBuildings.length,
      });
    }

    // 跳变识别：建筑刚完工 / 刚被认领 / 区域刚点亮。
    const completedBuildingIds: string[] = [];
    const claimedBuildingIds: string[] = [];
    const liveIds = new Set<string>();
    for (const building of buildings) {
      liveIds.add(building.id);
      const previous = this.lastStates.get(building.id);
      if (building.state === 'done' && previous !== 'done') completedBuildingIds.push(building.id);
      // 认领（task_077）：从「地基」跳到「施工」= 有人接单了 → 翻卡演出。
      // why 要求 previous 存在：首次对账看到的就是施工中的任务（早于本次会话开工），
      //   那不是"刚刚被认领"，不该翻卡（否则每次进场满屏翻卡）。
      if (
        building.state === 'building' &&
        previous !== undefined &&
        previous !== 'building'
      ) {
        claimedBuildingIds.push(building.id);
      }
      this.lastStates.set(building.id, building.state);
    }
    for (const id of Array.from(this.lastStates.keys())) {
      if (!liveIds.has(id)) this.lastStates.delete(id);
    }

    const clearedRegionIds: string[] = [];
    for (const region of regions) {
      if (region.cleared && !this.clearedRegions.has(region.id)) clearedRegionIds.push(region.id);
      if (region.cleared) this.clearedRegions.add(region.id);
      else this.clearedRegions.delete(region.id);
    }

    return { regions, buildings, completedBuildingIds, claimedBuildingIds, clearedRegionIds };
  }

  /** 区域占格：已占过的沿用旧格（位置不漂移），新区域取下一个空位。 */
  private slotFor(regionId: string): number {
    const existing = this.regionSlots.get(regionId);
    if (existing !== undefined) return existing;
    const slot = this.nextSlot;
    this.nextSlot += 1;
    this.regionSlots.set(regionId, slot);
    return slot;
  }

  /** 任务 → 建筑：位次 → 区域内坐标；相位 → 三态。 */
  private toBuilding(
    task: CharacterTask,
    regionId: string,
    regionX: number,
    regionY: number,
    regionWidth: number,
    regionHeight: number,
    index: number,
    siblingCount: number
  ): MapBuilding {
    const column = index % BUILDING_COLUMNS;
    const row = Math.floor(index / BUILDING_COLUMNS);
    const spacingX = regionWidth / BUILDING_COLUMNS;
    const spacingY = regionHeight / BUILDING_ROWS;
    // 用到的行在区域里**纵向居中**：区域底板是固定的地块格（不随任务数变形），
    // 建筑排布跟着实际行数居中 —— 空地多时不会把楼挤在边角上。
    const usedRows = Math.ceil(siblingCount / BUILDING_COLUMNS);
    const blockHeight = usedRows * spacingY;
    const blockTop = Math.max(regionY, regionY + (regionHeight - blockHeight) / 2);
    return {
      id: task.id,
      regionId,
      x: regionX + spacingX * (column + 0.5),
      y: blockTop + spacingY * (row + 0.5),
      state: buildingStateFor(task),
      failed: buildingFailed(task),
    };
  }
}

/** 任务排序：创建时间优先，同刻按 id 兜底（保证位次稳定）。 */
function compareTasks(a: CharacterTask, b: CharacterTask): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}
