/**
 * 单测：LobbyScene（@since v3.3，task_186 / M1-12）。
 *
 * 覆盖验收要点（design §7.1「M1-12」行②）：
 *   - LobbyScene **只画背景/氛围**，**不持任何业务状态**（铁律 1）：
 *     ① 源码零 core / core-bus 引用（不读业务事实）；
 *     ② 实例上没有任何业务字段（副本 / 单位 / 任务 / 角色 / 项目）；
 *     ③ 不订阅总线（只挂 Phaser 自己的 SHUTDOWN 钩子）。
 *   - 氛围本身确实画出来了（背景色 + 两层 Graphics + 一条呼吸补间）。
 *
 * why 能直接测真场景类：Phaser 在 node 环境跑不起来（无 window/document），
 *   所以这里把 'phaser' 模块替换成最小桩 —— 大厅场景只碰
 *   cameras / add / tweens / events / scale 这几个面，桩足够。
 *
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('phaser', () => {
  const makeGraphics = () => ({
    fillStyle: jest.fn(),
    fillCircle: jest.fn(),
    fillRect: jest.fn(),
    clearFillStyle: jest.fn(),
    setAlpha: jest.fn(),
    destroy: jest.fn(),
  });
  class Scene {
    settings: unknown;
    registry = { get: (): unknown => undefined };
    load = { atlas: jest.fn() };
    cameras = { main: { setBackgroundColor: jest.fn() } };
    add = { graphics: jest.fn(() => makeGraphics()) };
    tweens = { add: jest.fn(() => ({ remove: jest.fn() })) };
    events = { once: jest.fn(), on: jest.fn(), off: jest.fn() };
    scale = { width: 1280, height: 720 };
    constructor(config?: unknown) {
      this.settings = config ?? {};
    }
  }
  return {
    __esModule: true,
    default: { Scene, Scenes: { Events: { SHUTDOWN: 'shutdown' } } },
  };
});

import { LOBBY_AMBIENCE, LOBBY_SCENE_KEY, LobbyScene } from '../scenes/LobbyScene';
import { WORLD_PALETTE } from '../theme';

/** 场景实例上的私有字段（测试窥探：表现态字段都是私有的）。 */
interface LobbyInternals {
  starfield: unknown;
  horizon: unknown;
  breath: { remove: jest.Mock } | null;
}

function internalsOf(scene: LobbyScene): LobbyInternals {
  return scene as unknown as LobbyInternals;
}

describe('LobbyScene：大厅底景（零业务状态）', () => {
  test('只画背景/氛围：背景色 + 星尘 + 地平线 + 一条呼吸补间', () => {
    const scene = new LobbyScene();
    scene.create();

    const cameras = scene.cameras as unknown as {
      main: { setBackgroundColor: jest.Mock };
    };
    expect(cameras.main.setBackgroundColor).toHaveBeenCalledWith(WORLD_PALETTE.background);

    const add = scene.add as unknown as { graphics: jest.Mock };
    expect(add.graphics).toHaveBeenCalledTimes(2);

    const tweens = scene.tweens as unknown as { add: jest.Mock };
    expect(tweens.add).toHaveBeenCalledTimes(1);
    const tweenConfig = tweens.add.mock.calls[0][0] as { duration: number; repeat: number };
    expect(tweenConfig.duration).toBe(LOBBY_AMBIENCE.breathMs);
    expect(tweenConfig.repeat).toBe(-1);

    // 氛围元素真的画了内容（不是空 Graphics）。
    const starfield = internalsOf(scene).starfield as {
      fillCircle: jest.Mock;
    };
    expect(starfield.fillCircle).toHaveBeenCalledTimes(LOBBY_AMBIENCE.moteCount);
  });

  test('零业务状态：实例上没有任何业务字段（铁律 1）', () => {
    const scene = new LobbyScene();
    scene.create();

    // 副本 / 单位 / 任务 / 角色 / 项目 —— 大厅一个都不碰。
    const businessField = /(instance|unit|mission|task|character|project|copy|state)/i;
    for (const key of Object.keys(scene)) {
      expect({ key, business: businessField.test(key) }).toEqual({ key, business: false });
    }
  });

  test('零业务状态：源码不碰 core / core-bus（不读业务事实）', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scenes', 'LobbyScene.ts'), 'utf-8');

    // 不 import core（业务事实与端口都在那儿）—— 一 import 就等于把业务引进 world。
    expect(source).not.toMatch(/from '\.\.\/\.\.\/core/);
    expect(source).not.toMatch(/core\/bus/);
    // 不订阅总线（订阅即引入业务事实）。
    expect(source).not.toMatch(/onState|onWorldEvent|onCommand|emitState|emitWorldEvent/);
    // 只 import phaser 与 world 门面（调色板）。
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['phaser', '../theme']);
  });

  test('不订阅总线：只挂 Phaser 自己的 SHUTDOWN 钩子（资源必须可清理）', () => {
    const scene = new LobbyScene();
    scene.create();

    const events = scene.events as unknown as { once: jest.Mock; on: jest.Mock };
    expect(events.once).toHaveBeenCalledTimes(1);
    expect(events.once.mock.calls[0][0]).toBe('shutdown');
    expect(events.on).not.toHaveBeenCalled();
  });

  test('停机即回收：补间摘掉、显示对象销毁（perf：资源必须可清理）', () => {
    const scene = new LobbyScene();
    scene.create();
    const internals = internalsOf(scene);
    const breath = internals.breath;
    const starfield = internals.starfield as { destroy: jest.Mock };
    const horizon = internals.horizon as { destroy: jest.Mock };

    // 触发 Phaser 的 SHUTDOWN（场景被停掉时 Phaser 发的事件）。
    // why 手工 .call(scene)：桩里的 events.once 只是 jest.fn，不像 Phaser 那样把上下文绑上去。
    const shutdownHandler = (scene.events as unknown as { once: jest.Mock }).once.mock.calls[0][1] as () => void;
    shutdownHandler.call(scene);

    expect(breath?.remove).toHaveBeenCalledTimes(1);
    expect(starfield.destroy).toHaveBeenCalledTimes(1);
    expect(horizon.destroy).toHaveBeenCalledTimes(1);
    expect(internals.breath).toBeNull();
    expect(internals.starfield).toBeNull();
    expect(internals.horizon).toBeNull();
  });

  test('开机不进大厅：场景键固定、且不自动启动（active: false）', () => {
    expect(LOBBY_SCENE_KEY).toBe('lobby');
    const scene = new LobbyScene();
    const settings = (scene as unknown as { settings: { key: string; active: boolean } }).settings;
    expect(settings.key).toBe('lobby');
    expect(settings.active).toBe(false);
  });
});
