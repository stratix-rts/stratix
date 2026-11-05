/**
 * 单测：**进副本仪式**（@since v3.3，task_187 / M1-13）。
 *
 * 覆盖 §7.1「M1-13」行的三条验收：
 *   ① 总时长 ≤ 700ms；
 *   ② 任意输入即跳到末态（遮罩撤掉 + 相机瞬跳回 `overviewPose()`）；
 *   ③ 无「地块点亮」「单位入场」两拍（**已推迟**，design §2.2 R1-34）。
 * 外加：名牌上的四项（名字 / 分支 / 路径尾段 / 在办任务数）都是 **WorldState 的投影**，
 *   不新增任何业务状态（铁律 1：world 零业务状态）。
 *
 * why 能直接测真类：Phaser 在 node 环境跑不起来（无 window/document），
 *   所以这里把 'phaser' 换成最小桩 —— 牌子板只碰 add.rectangle / add.text / tweens.add / scale，
 *   桩足够；而**任何额外形状**（circle / graphics / image / sprite）一被调用就直接抛错
 *   ⇒ 「没有地块点亮 / 单位入场两拍」这条验收由桩本身兜住。
 *
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('phaser', () => {
  class Scene {
    settings: unknown;
    constructor(config?: unknown) {
      this.settings = config ?? {};
    }
  }
  return {
    __esModule: true,
    default: { Scene, Scenes: { Events: { SHUTDOWN: 'shutdown' } } },
  };
});

import { emitState, resetBus } from '../../core/bus';
import {
  DEFAULT_INSTANCE_ID,
  type CharacterTask,
  type ProjectInstanceView,
  type WorldState,
} from '../../core/types';
import { createInitialState } from '../../core/store';
import { createWorldBridge, type WorldScenePort } from '../bridge/bus-adapter';
import {
  INSTANCE_CEREMONY_METRICS,
  INSTANCE_CEREMONY_TOTAL_MS,
  InstanceNameplate,
  type InstanceNameplateData,
} from '../objects/instance-nameplate';
import {
  BattlefieldScene,
  countActiveTasks,
  pathTailOf,
} from '../scenes/BattlefieldScene';

/** 桩显示对象：只实现牌子板用到的那几个方法。 */
class FakeGameObject {
  alpha = 1;
  destroyed = false;
  depth = 0;
  text = '';
  style: unknown = null;
  constructor(readonly kind: string) {}
  setOrigin(): this {
    return this;
  }
  setScrollFactor(): this {
    return this;
  }
  setDepth(depth: number): this {
    this.depth = depth;
    return this;
  }
  setSize(): this {
    return this;
  }
  setPosition(): this {
    return this;
  }
  setText(text: string): this {
    this.text = text;
    return this;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

/** 桩补间配置（保留 onComplete，测试可以手动把仪式推到末态）。 */
interface StubTween {
  config: Record<string, unknown>;
  remove: jest.Mock;
}

/** 造一个够用的场景桩。 */
function makeSceneStub() {
  const created: FakeGameObject[] = [];
  const tweenCalls: StubTween[] = [];
  const add = {
    rectangle: jest.fn((_x: number, _y: number, _w: number, _h: number, _color: number, alpha?: number) => {
      const object = new FakeGameObject('rectangle');
      object.alpha = alpha ?? 1;
      created.push(object);
      return object;
    }),
    text: jest.fn((_x: number, _y: number, text: string, style: unknown) => {
      const object = new FakeGameObject('text');
      object.text = text;
      object.style = style;
      created.push(object);
      return object;
    }),
    // ★ 下面这四个是「不该出现的形状」：一旦有人加「地块点亮 / 单位入场」两拍，
    //   桩会当场抛错 ⇒ 验收③ 由桩兜住，而不是靠注释自证。
    circle: jest.fn(() => {
      throw new Error('仪式里不该出现圆形对象（地块点亮 / 单位入场两拍已推迟）');
    }),
    graphics: jest.fn(() => {
      throw new Error('仪式里不该出现 Graphics 对象（地块点亮 / 单位入场两拍已推迟）');
    }),
    image: jest.fn(() => {
      throw new Error('仪式里不该出现图片对象（地块点亮 / 单位入场两拍已推迟）');
    }),
    sprite: jest.fn(() => {
      throw new Error('仪式里不该出现精灵对象（单位入场两拍已推迟）');
    }),
  };
  const tweens = {
    add: jest.fn((config: Record<string, unknown>) => {
      const tween: StubTween = { config, remove: jest.fn() };
      tweenCalls.push(tween);
      return tween;
    }),
  };
  const scene = {
    add,
    tweens,
    scale: { width: 1280, height: 720 },
    events: { once: jest.fn(), on: jest.fn(), off: jest.fn() },
  };
  return { scene, add, tweens, created, tweenCalls };
}

/** 仪式钩子（记录相机归位怎么走的）。 */
function makeHooks() {
  return {
    cameraHome: jest.fn(),
    cameraHomeNow: jest.fn(),
  };
}

const PLATE_DATA: InstanceNameplateData = {
  name: 'Stratix',
  branch: 'demo/v3.3',
  pathTail: 'Stratix-demo',
  activeTaskCount: 2,
};

function makeTask(id: string, status: CharacterTask['status']): CharacterTask {
  return {
    id,
    characterId: `char-${id}`,
    prompt: `任务 ${id}`,
    status,
    createdAt: 1,
    startedAt: null,
    endedAt: null,
    output: '',
  };
}

function stateWith(patch: Partial<WorldState>): WorldState {
  return { ...createInitialState(), ...patch };
}

const INSTANCE_VIEW: ProjectInstanceView = {
  instanceId: DEFAULT_INSTANCE_ID,
  projectId: 'proj_stratix',
  path: '/Users/kingj/code/Stratix-demo',
  title: 'Stratix',
  lastOpenedAt: 1,
  pinned: false,
  archived: false,
  status: 'active',
  vcs: { branch: 'demo/v3.3' },
};

describe('进副本仪式：两拍（task_187 / M1-13）', () => {
  test('验收① 总时长 ≤ 700ms（两拍之和算出来，不是写死的数）', () => {
    expect(INSTANCE_CEREMONY_TOTAL_MS).toBeLessThanOrEqual(700);
    expect(INSTANCE_CEREMONY_TOTAL_MS).toBe(
      INSTANCE_CEREMONY_METRICS.plateMs + INSTANCE_CEREMONY_METRICS.fadeMs
    );

    const { scene, tweens, tweenCalls } = makeSceneStub();
    const hooks = makeHooks();
    const plate = new InstanceNameplate(scene as never, hooks);

    plate.start(PLATE_DATA);

    // 两拍 = 一条补间：delay = 名牌那一拍，duration = 淡出那一拍。
    expect(tweens.add).toHaveBeenCalledTimes(1);
    const config = tweenCalls[0].config;
    expect(config.delay).toBe(INSTANCE_CEREMONY_METRICS.plateMs);
    expect(config.duration).toBe(INSTANCE_CEREMONY_METRICS.fadeMs);
    expect((config.delay as number) + (config.duration as number)).toBe(
      INSTANCE_CEREMONY_TOTAL_MS
    );

    // 相机与遮罩**并行**归位（同一时刻落地 ⇒ 总时长仍是 600ms）。
    expect(hooks.cameraHome).toHaveBeenCalledTimes(1);
    expect(hooks.cameraHome).toHaveBeenCalledWith(INSTANCE_CEREMONY_TOTAL_MS);
  });

  test('验收② 任意输入即跳到末态：遮罩撤掉 + 相机瞬跳回全景', () => {
    const { scene, created, tweenCalls } = makeSceneStub();
    const hooks = makeHooks();
    const plate = new InstanceNameplate(scene as never, hooks);

    plate.start(PLATE_DATA);
    expect(plate.active).toBe(true);
    expect(created.every((object) => !object.destroyed)).toBe(true);

    // 任意输入 = 跳过（不是「等剩下的时长」）。
    plate.skip();

    // 末态：遮罩与三行名牌都不在场上。
    expect(created).toHaveLength(4);
    for (const object of created) {
      expect({ kind: object.kind, destroyed: object.destroyed }).toEqual({
        kind: object.kind,
        destroyed: true,
      });
    }
    // 未跑完的淡出补间被撤掉（不留一个还在改 alpha 的孤儿补间）。
    expect(tweenCalls[0].remove).toHaveBeenCalledTimes(1);
    // 相机瞬跳（不补间）。
    expect(hooks.cameraHomeNow).toHaveBeenCalledTimes(1);
    expect(plate.active).toBe(false);
    expect(plate.settled).toBe(true);

    // 跳过之后再来一次输入 = 无事发生（幂等）。
    plate.skip();
    expect(hooks.cameraHomeNow).toHaveBeenCalledTimes(1);
  });

  test('验收② 演完（不跳过）也到同一个末态', () => {
    const { scene, created, tweenCalls } = makeSceneStub();
    const hooks = makeHooks();
    const plate = new InstanceNameplate(scene as never, hooks);

    plate.start(PLATE_DATA);
    // 手动把时间推到补间结束（模拟 600ms 后）。
    (tweenCalls[0].config.onComplete as () => void)();

    expect(plate.settled).toBe(true);
    expect(plate.active).toBe(false);
    for (const object of created) {
      expect(object.destroyed).toBe(true);
    }
    // 演完**不该**走「瞬跳」那条路（相机本来就补间到位了）。
    expect(hooks.cameraHomeNow).not.toHaveBeenCalled();
  });

  test('验收③ 无「地块点亮」「单位入场」两拍：只有一层遮罩 + 三行字 + 一条补间', () => {
    const { scene, add, created, tweens } = makeSceneStub();
    const plate = new InstanceNameplate(scene as never, makeHooks());

    plate.start(PLATE_DATA);

    // 一层遮罩（= 黑场与遮罩合并）+ 三行名牌。
    expect(add.rectangle).toHaveBeenCalledTimes(1);
    expect(add.text).toHaveBeenCalledTimes(3);
    expect(created.map((object) => object.kind)).toEqual([
      'rectangle',
      'text',
      'text',
      'text',
    ]);
    // 一条补间（两拍 = 一条时间线）。
    expect(tweens.add).toHaveBeenCalledTimes(1);
  });

  test('验收③ 牌子板不碰地面层 / 单位层（那两拍的载体）', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'objects', 'instance-nameplate.ts'),
      'utf-8'
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    // 只认 phaser 与 world 门面（调色板）—— 不碰地面 / 单位 / 任务任何一层。
    expect(imports).toEqual(['phaser', '../theme']);
    expect(source).not.toMatch(/ground-layer|unit-layer|task-building|unit-registry/);
  });

  test('名牌内容 = WorldState 的投影（知道的画出来，不知道的不画）', () => {
    const { scene, created } = makeSceneStub();
    const plate = new InstanceNameplate(scene as never, makeHooks());

    plate.start(PLATE_DATA);

    expect(created[1].text).toBe('Stratix');
    expect(created[2].text).toBe('分支 demo/v3.3 · Stratix-demo');
    expect(created[3].text).toBe('在办 2 条任务');

    // 未知项（分支 / 路径 / 任务数都还没到）⇒ 不画那一段，不拿占位值糊弄。
    plate.setData({
      name: 'Stratix',
      branch: null,
      pathTail: null,
      activeTaskCount: null,
    });
    expect(created[2].text).toBe('');
    expect(created[3].text).toBe('');
  });
});

describe('场景侧接线：进副本才演仪式（task_187 / M1-13）', () => {
  test('init() 从 scene data 冻结 instanceId（design §2.5 破除点 #1）', () => {
    const scene = new BattlefieldScene();
    const internals = scene as unknown as { instanceId: string | null };

    scene.init({ instanceId: DEFAULT_INSTANCE_ID });
    expect(internals.instanceId).toBe(DEFAULT_INSTANCE_ID);

    // Phaser 复用场景实例 ⇒ 每次启动都重读（开机直接进战场 ⇒ 没有 instanceId）。
    scene.init();
    expect(internals.instanceId).toBeNull();
  });

  test('仪式期间的一次输入被仪式吃掉（ESC / 任意按键都不顺手选单位）', () => {
    const scene = new BattlefieldScene();
    const internals = scene as unknown as {
      nameplate: { active: boolean; skip: jest.Mock } | null;
      onEscape(): void;
      onKeyDown(): void;
    };

    const plate = { active: true, skip: jest.fn() };
    internals.nameplate = plate;

    // ESC：仪式在演 ⇒ 只跳过仪式（没走到「回全景」那步，否则 this.view 未就绪会炸）。
    internals.onEscape();
    expect(plate.skip).toHaveBeenCalledTimes(1);

    // 任意按键同理。
    internals.onKeyDown();
    expect(plate.skip).toHaveBeenCalledTimes(2);

    // 仪式不在演 ⇒ 输入不被吃掉（交给平时的处理）。
    plate.active = false;
    internals.onKeyDown();
    expect(plate.skip).toHaveBeenCalledTimes(2);
  });

  test('名牌数据 = 实例视图 + 在办任务数的投影', () => {
    const scene = new BattlefieldScene();
    const internals = scene as unknown as {
      instanceId: string | null;
      instanceView: ProjectInstanceView | null;
      activeTaskCount: number | null;
      nameplateData(): InstanceNameplateData;
    };

    scene.init({ instanceId: DEFAULT_INSTANCE_ID });
    internals.instanceView = INSTANCE_VIEW;
    internals.activeTaskCount = 3;

    expect(internals.nameplateData()).toEqual({
      name: 'Stratix',
      branch: 'demo/v3.3',
      pathTail: 'Stratix-demo',
      activeTaskCount: 3,
    });
  });

  test('在办任务数：只数未终结的任务（终态是历史，不算在办）', () => {
    expect(
      countActiveTasks([
        makeTask('a', 'queued'),
        makeTask('b', 'running'),
        makeTask('c', 'awaiting_approval'),
        makeTask('d', 'completed'),
        makeTask('e', 'failed'),
        makeTask('f', 'cancelled'),
      ])
    ).toBe(3);
    expect(countActiveTasks([])).toBe(0);
  });

  test('路径尾段：取最后一段（posix / windows 都认），空路径 = 未知', () => {
    expect(pathTailOf('/Users/kingj/code/Stratix-demo')).toBe('Stratix-demo');
    expect(pathTailOf('C:\\work\\Stratix-demo\\')).toBe('Stratix-demo');
    expect(pathTailOf('')).toBeNull();
  });
});

describe('桥接层：转发 active instance 视图（task_187 / M1-13）', () => {
  afterEach(() => resetBus());

  test('state 通道的实例清单里，活跃副本那一条被推给场景', () => {
    const views: (ProjectInstanceView | null)[] = [];
    const port: WorldScenePort = {
      syncUnits: () => undefined,
      syncSelection: () => undefined,
      syncInstanceView: (view) => void views.push(view),
    };
    const bridge = createWorldBridge(port, { now: () => 0 });

    emitState(
      stateWith({
        projectInstances: [INSTANCE_VIEW],
        activeInstanceId: DEFAULT_INSTANCE_ID,
      })
    );

    expect(views).toHaveLength(1);
    expect(views[0]?.instanceId).toBe(DEFAULT_INSTANCE_ID);
    expect(views[0]?.vcs?.branch).toBe('demo/v3.3');

    bridge.destroy();
  });

  test('在大厅（activeInstanceId = null）⇒ 推 null（场景没有副本可画）', () => {
    const views: (ProjectInstanceView | null)[] = [];
    const port: WorldScenePort = {
      syncUnits: () => undefined,
      syncSelection: () => undefined,
      syncInstanceView: (view) => void views.push(view),
    };
    const bridge = createWorldBridge(port, { now: () => 0 });

    emitState(
      stateWith({
        projectInstances: [INSTANCE_VIEW],
        activeInstanceId: null,
      })
    );

    expect(views).toEqual([null]);

    bridge.destroy();
  });
});
