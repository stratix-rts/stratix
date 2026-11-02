/**
 * 单测：core 任务状态 → 地图建筑 / 区域的纯映射与布局（world/objects/task-building.ts，task_078）。
 * 覆盖：
 *   - buildingStateFor：六种任务状态 → 三态（地基 / 施工 / 完工）；
 *   - MapBoard：区域（= 编组任务 mission）与建筑（= 角色任务 task）的归属、位次、坐标；
 *   - 跳变识别：建筑「刚完工」只报一次、区域「刚点亮」只报一次（点亮是一次性过渡）；
 *   - 区域点亮口径：区域内全部完工 或 mission 收工（phase='done'）；
 *   - 未挂 mission 的普通派发落进「未归属任务」空地，不冒充某个区域；
 *   - 区域位置稳定：新增任务不漂移既有区域（占格不回收）。
 *
 * @jest-environment node
 */

import type { CharacterTask, MissionView } from '../../core/types';
import {
  BUILDING_COLUMNS,
  FREE_REGION_ID,
  FREE_REGION_NAME,
  MapBoard,
  buildingFailed,
  buildingStateFor,
  regionCellCenters,
} from '../objects/task-building';

function makeTask(
  id: string,
  status: CharacterTask['status'],
  missionId: string | null = null,
  createdAt = 1
): CharacterTask {
  return {
    id,
    characterId: `char-${id}`,
    prompt: `任务 ${id}`,
    status,
    createdAt,
    startedAt: null,
    endedAt: null,
    output: '',
    missionId,
  };
}

function makeMission(id: string, phase: MissionView['phase'] = 'running', title = `区域 ${id}`): MissionView {
  return {
    id,
    title,
    phase,
    unitIds: [],
    createdAt: 1,
  };
}

describe('buildingStateFor：任务相位 → 建筑三态', () => {
  test('queued → 地基；running / awaiting_approval → 施工；completed → 完工', () => {
    expect(buildingStateFor(makeTask('t1', 'queued'))).toBe('foundation');
    expect(buildingStateFor(makeTask('t2', 'running'))).toBe('building');
    expect(buildingStateFor(makeTask('t3', 'awaiting_approval'))).toBe('building');
    expect(buildingStateFor(makeTask('t4', 'completed'))).toBe('done');
  });

  test('failed / cancelled → 仍是地基，但带失败标记（停工工地）', () => {
    expect(buildingStateFor(makeTask('t5', 'failed'))).toBe('foundation');
    expect(buildingFailed(makeTask('t5', 'failed'))).toBe(true);
    expect(buildingFailed(makeTask('t6', 'cancelled'))).toBe(true);
    expect(buildingFailed(makeTask('t7', 'running'))).toBe(false);
  });
});

describe('MapBoard：区域与建筑的归属 / 布局', () => {
  test('mission = 区域；挂上 missionId 的任务 = 该区域里的建筑', () => {
    const board = new MapBoard();
    const result = board.sync(
      [makeMission('m1')],
      [makeTask('t1', 'running', 'm1'), makeTask('t2', 'queued', 'm1')]
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].id).toBe('m1');
    expect(result.regions[0].name).toBe('区域 m1');
    expect(result.regions[0].buildingCount).toBe(2);
    expect(result.buildings).toHaveLength(2);
    expect(result.buildings.every((building) => building.regionId === 'm1')).toBe(true);
  });

  test('建筑态随任务状态流转（地基 → 施工 → 完工）', () => {
    const board = new MapBoard();
    board.sync([makeMission('m1')], [makeTask('t1', 'queued', 'm1')]);
    expect(board.sync([makeMission('m1')], [makeTask('t1', 'running', 'm1')]).buildings[0].state).toBe('building');
    expect(board.sync([makeMission('m1')], [makeTask('t1', 'completed', 'm1')]).buildings[0].state).toBe('done');
  });

  test('同一区域内多栋建筑按位次排开（不重叠）', () => {
    const board = new MapBoard();
    const tasks = Array.from({ length: 5 }, (_, index) =>
      makeTask(`t${index}`, 'queued', 'm1', index + 1)
    );
    const result = board.sync([makeMission('m1')], tasks);
    const positions = result.buildings.map((building) => `${building.x},${building.y}`);
    expect(new Set(positions).size).toBe(5);

    const region = result.regions[0];
    for (const building of result.buildings) {
      expect(building.x).toBeGreaterThanOrEqual(region.x);
      expect(building.x).toBeLessThanOrEqual(region.x + region.width);
      expect(building.y).toBeGreaterThanOrEqual(region.y);
      expect(building.y).toBeLessThanOrEqual(region.y + region.height);
    }
    // 前 BUILDING_COLUMNS 栋在同一行（列位次推进）。
    expect(result.buildings[0].y).toBe(result.buildings[BUILDING_COLUMNS - 1].y);
    expect(result.buildings[0].x).not.toBe(result.buildings[1].x);
  });

  test('未挂 mission 的普通派发落进「未归属任务」空地，不冒充某个区域', () => {
    const board = new MapBoard();
    const result = board.sync([makeMission('m1')], [makeTask('free', 'running', null)]);
    expect(result.regions.map((region) => region.id)).toEqual(['m1', FREE_REGION_ID]);
    const free = result.regions.find((region) => region.id === FREE_REGION_ID);
    expect(free?.name).toBe(FREE_REGION_NAME);
    expect(free?.buildingCount).toBe(1);
    expect(result.buildings[0].regionId).toBe(FREE_REGION_ID);
  });

  test('区域位置稳定：新增区域/任务不漂移既有区域', () => {
    const board = new MapBoard();
    const first = board.sync([makeMission('m1')], [makeTask('t1', 'queued', 'm1')]);
    const second = board.sync(
      [makeMission('m1'), makeMission('m2')],
      [makeTask('t1', 'queued', 'm1'), makeTask('t2', 'queued', 'm2')]
    );
    const before = first.regions[0];
    const after = second.regions.find((region) => region.id === 'm1');
    expect(after).toBeDefined();
    expect(after?.x).toBe(before.x);
    expect(after?.y).toBe(before.y);
  });

  test('地块格顺序从中心向外（第一个区域正好落在战场中心）', () => {
    const centers = regionCellCenters({ x: 0, y: 0, width: 3200, height: 2400 });
    expect(centers).toHaveLength(35);
    expect(centers[0].x).toBeCloseTo(1600, 5);
    expect(centers[0].y).toBeCloseTo(1200, 5);
  });
});

describe('MapBoard：跳变事件（点亮是一次性过渡）', () => {
  test('建筑刚完工只报一次；区域刚点亮只报一次', () => {
    const board = new MapBoard();
    board.sync([makeMission('m1')], [makeTask('t1', 'running', 'm1')]);

    const completed = board.sync([makeMission('m1')], [makeTask('t1', 'completed', 'm1')]);
    expect(completed.completedBuildingIds).toEqual(['t1']);
    expect(completed.clearedRegionIds).toEqual(['m1']);

    // 再同步一次同样的状态：不重复报（否则动画会重放）。
    const again = board.sync([makeMission('m1')], [makeTask('t1', 'completed', 'm1')]);
    expect(again.completedBuildingIds).toEqual([]);
    expect(again.clearedRegionIds).toEqual([]);
  });

  test('区域内全部建筑完工 → 区域点亮', () => {
    const board = new MapBoard();
    const tasks = [makeTask('t1', 'completed', 'm1', 1), makeTask('t2', 'completed', 'm1', 2)];
    const result = board.sync([makeMission('m1')], tasks);
    expect(result.regions[0].cleared).toBe(true);
    expect(result.clearedRegionIds).toEqual(['m1']);
  });

  test('还有没完工的建筑 → 区域不点亮', () => {
    const board = new MapBoard();
    const tasks = [makeTask('t1', 'completed', 'm1', 1), makeTask('t2', 'running', 'm1', 2)];
    const result = board.sync([makeMission('m1')], tasks);
    expect(result.regions[0].cleared).toBe(false);
    expect(result.clearedRegionIds).toEqual([]);
  });

  test('mission 收工（phase=done）→ 区域点亮', () => {
    const board = new MapBoard();
    const result = board.sync([makeMission('m1', 'done')], []);
    expect(result.regions[0].cleared).toBe(true);
    expect(result.clearedRegionIds).toEqual(['m1']);
  });

  test('区域从点亮退回未点亮（任务被重开）→ 下次再点亮会重新报', () => {
    const board = new MapBoard();
    board.sync([makeMission('m1')], [makeTask('t1', 'completed', 'm1')]);
    const reopened = board.sync([makeMission('m1', 'running')], [makeTask('t1', 'running', 'm1')]);
    expect(reopened.clearedRegionIds).toEqual([]);
    const clearedAgain = board.sync([makeMission('m1')], [makeTask('t1', 'completed', 'm1')]);
    expect(clearedAgain.clearedRegionIds).toEqual(['m1']);
  });
});
