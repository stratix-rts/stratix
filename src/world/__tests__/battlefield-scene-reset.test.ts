/**
 * 单测：BattlefieldScene.init() 的显式清理（@since v3.3，task_183 / M1-09）。
 *
 * 背景（为什么必须显式清理，而不是「靠场景重建」侥幸回收）：
 *   Phaser 的 `scene.start` **不重建场景实例** —— SceneManager 取已有实例再走
 *   init → create（node_modules/phaser/src/scene/SceneManager.js 的 start → bootScene）
 *   ⇒ 字段初始化器只跑一次 ⇒ 四块表现态板跨副本复用 ⇒ A 副本的残留会直接串到 B 副本。
 *
 * 覆盖：
 *   - A→B 零残留：进 A 造出单位 / 区域 / 浮标 / 回放化身 → 切 B（再走一次 init）
 *     ⇒ units.objects.size === 0、mapBoard.nextSlot === 0、浮标与回放化身一并清空；
 *   - UnitRegistry.destroy() 确实被调用（此前全仓无调用方）；
 *   - speechBoard 不清理：它在 create() 里 new ⇒ 每次 create() 都是新实例 ⇒ 天然零残留。
 *
 * why 能直接测真场景类：Phaser 在 node 环境跑不起来（无 window/document），
 *   所以这里把 'phaser' 模块替换成最小桩 —— 被测的 init() 只碰四块纯逻辑板，
 *   不碰任何渲染对象，桩足够（渲染层在 shutdown 时已逐层析构，不在本测范围内）。
 *
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('phaser', () => {
  class Scene {
    constructor(_config?: unknown) {}
  }
  return {
    __esModule: true,
    default: {
      Scene,
      Scenes: { Events: { SHUTDOWN: 'shutdown' } },
    },
  };
});

import type { CharacterTask, MissionView, Point, UnitView } from '../../core/types';
import { MapBoard, type BuildingState } from '../objects/task-building';
import { ReplayBoard } from '../objects/replay-board';
import { TaskFxBoard } from '../objects/task-fx';
import { UnitRegistry } from '../objects/unit-registry';
import { BattlefieldScene } from '../scenes/BattlefieldScene';

/** 测试窥探：四块板与场景字段都是私有表现态（对宿主不可见），只能从内部断言。 */
interface UnitRegistryInternals {
  objects: Map<string, unknown>;
  restoredPositions?: ReadonlyMap<string, Point>;
  spawnCursor: number;
}

interface MapBoardInternals {
  nextSlot: number;
  regionSlots: Map<string, number>;
  lastStates: Map<string, BuildingState>;
  clearedRegions: Set<string>;
}

interface TaskFxInternals {
  markers: Map<string, unknown>;
}

interface SceneBoards {
  units: UnitRegistry;
  taskFx: TaskFxBoard;
  replayBoard: ReplayBoard;
  mapBoard: MapBoard;
  speechBoard?: unknown;
}

function boardsOf(scene: BattlefieldScene): SceneBoards {
  return scene as unknown as SceneBoards;
}

function unitInternals(registry: UnitRegistry): UnitRegistryInternals {
  return registry as unknown as UnitRegistryInternals;
}

function mapInternals(board: MapBoard): MapBoardInternals {
  return board as unknown as MapBoardInternals;
}

function fxInternals(board: TaskFxBoard): TaskFxInternals {
  return board as unknown as TaskFxInternals;
}

function makeUnit(id: string, characterId: string): UnitView {
  return { id, name: `单位 ${id}`, status: 'idle', missionId: null, power: 1, characterId };
}

function makeMission(id: string): MissionView {
  return { id, title: `区域 ${id}`, phase: 'running', unitIds: [], createdAt: 1 };
}

function makeTask(id: string, missionId: string | null = null): CharacterTask {
  return {
    id,
    characterId: `char-${id}`,
    prompt: `任务 ${id}`,
    status: 'running',
    createdAt: 1,
    startedAt: null,
    endedAt: null,
    output: '',
    missionId,
  };
}

describe('BattlefieldScene.init()：切副本前的显式清理（M1-09）', () => {
  test('A→B 零残留：切副本后四块板都回到「刚 new 出来」的样子', () => {
    const scene = new BattlefieldScene();
    const boards = boardsOf(scene);

    // —— 副本 A：造出单位与区域（以及浮标 / 回放化身）——
    boards.units.sync([makeUnit('u-a', 'ch-a'), makeUnit('u-b', 'ch-b')]);
    boards.mapBoard.sync([makeMission('m-a')], [makeTask('t-a', 'm-a'), makeTask('t-b')]);
    boards.taskFx.setWorking('u-a');
    boards.taskFx.setDone('u-b');
    boards.replayBoard.apply({ at: 1, kind: 'work', characterId: 'ch-a', taskId: 't-a' });

    // 前置：A 副本确实有东西（否则「B 无残留」是空断言）
    expect(unitInternals(boards.units).objects.size).toBe(2);
    expect(mapInternals(boards.mapBoard).nextSlot).toBeGreaterThan(0);
    expect(fxInternals(boards.taskFx).markers.size).toBe(2);
    expect(boards.replayBoard.list()).toHaveLength(1);

    // —— 切副本 B：Phaser 复用场景实例 ⇒ 走一次 init() ——
    scene.init();

    // 验收点（§7.1 M1-09 行①）：B 副本零残留
    expect(unitInternals(boards.units).objects.size).toBe(0);
    expect(mapInternals(boards.mapBoard).nextSlot).toBe(0);
    expect(fxInternals(boards.taskFx).markers.size).toBe(0);
    expect(boards.replayBoard.list()).toHaveLength(0);

    // 槽位表 / 上次态 / 已点亮区域一并清空（M1-08 的对称析构被真正用上）
    expect(mapInternals(boards.mapBoard).regionSlots.size).toBe(0);
    expect(mapInternals(boards.mapBoard).lastStates.size).toBe(0);
    expect(mapInternals(boards.mapBoard).clearedRegions.size).toBe(0);
    // 恢复站位与落位游标也归零（否则新副本的单位会接着旧副本的站位排）
    expect(unitInternals(boards.units).restoredPositions).toBeUndefined();
    expect(unitInternals(boards.units).spawnCursor).toBe(0);
  });

  test('UnitRegistry.destroy() 确实被调用（此前全仓无调用方）', () => {
    const destroySpy = jest.spyOn(UnitRegistry.prototype, 'destroy');
    const scene = new BattlefieldScene();
    boardsOf(scene).units.sync([makeUnit('u-a', 'ch-a')]);

    scene.init();

    expect(destroySpy).toHaveBeenCalledTimes(1);
    destroySpy.mockRestore();
  });

  test('speechBoard 不需清理：它在 create() 里 new（每次都是新实例 ⇒ 天然零残留）', () => {
    const scene = new BattlefieldScene();

    // init() 不碰气泡板：它在 create() 里才被 new 出来，此刻根本不存在
    scene.init();
    expect(boardsOf(scene).speechBoard).toBeUndefined();

    // 依据（源码口径）：气泡板是 create() 里的 new，不是跨副本复用的字段 ⇒ 无残留可清
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'scenes', 'BattlefieldScene.ts'),
      'utf-8'
    );
    expect(extractMethod(source, 'init(): void {')).not.toMatch(/speechBoard/);
    expect(extractMethod(source, 'create(): void {')).toMatch(
      /this\.speechBoard = new SpeechBubbleBoard\(/
    );
  });
});

/** 按大括号配对截出某个方法的源码块（避免用固定长度切片猜边界）。 */
function extractMethod(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`方法签名未找到：${signature}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`方法体括号不配对：${signature}`);
}
