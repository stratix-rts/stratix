/**
 * 单测：world 场景切换策略 + 常驻场景（@since v3.3，task_186 / M1-12）。
 *
 * 覆盖验收要点（design §7.1「M1-12」行①）：
 *   - 组合根场景表 = [BattlefieldScene, FxAssetScene, LobbyScene]；
 *   - `scene.stop('battlefield')` **不影响** FxAssetScene 的资源管线 ——
 *     用它的特效管线（task_161 的 pixelfx sheet）做一次冒烟：停战场后纹理一张不少，
 *     且切换过程从不碰常驻场景；
 *   - 大厅 ⇄ 战场互斥（切一个必停另一个）。
 *
 * why 能直接测真模块：Phaser 在 node 环境跑不起来（无 window/document），
 *   所以把 'phaser' 模块替换成最小桩 —— 切换策略只碰 SceneManager 的 stop/start，
 *   素材场景只碰 registry.get + load.atlas，桩足够（纹理仓库用一张共享 Map 模拟）。
 *
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('phaser', () => {
  // 共享的「纹理仓库」：load.atlas 写进来，只有场景销毁才会少 ——
  //   停战场不该让这里的任何一张少掉（这正是要冒烟的那件事）。
  const textures = new Map<string, unknown>();
  const registry = new Map<string, unknown>();
  class Scene {
    settings: unknown;
    registry = { get: (key: string): unknown => registry.get(key) };
    load = {
      atlas: jest.fn((key: string) => {
        textures.set(key, { frames: [] });
      }),
    };
    cameras = { main: { setBackgroundColor: jest.fn() } };
    add = { graphics: jest.fn() };
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
    __textures: textures,
    __registry: registry,
  };
});

import type Phaser from 'phaser';

import { FX_ASSET_BASE_URL_KEY } from '../appearance/fx-asset-path';
import { SPRITE_FX_SOURCES } from '../appearance/fx-sources.generated';
import { BATTLEFIELD_SCENE_KEY } from '../scenes/BattlefieldScene';
import { FxAssetScene, FX_ASSET_SCENE_KEY } from '../scenes/fx-asset-scene';
import { LOBBY_SCENE_KEY } from '../scenes/LobbyScene';
import { RESIDENT_SCENE_KEYS, switchToBattlefield, switchToLobby } from '../scenes/scene-switch';

/** 桩里的共享状态（纹理仓库 + registry）。 */
const phaserMock = jest.requireMock('phaser') as {
  __textures: Map<string, unknown>;
  __registry: Map<string, unknown>;
};

/** 记录 stop/start 调用的假 SceneManager。 */
interface FakeSceneManager {
  stopped: string[];
  started: Array<{ key: string; data: unknown }>;
  stop(key: string): void;
  start(key: string, data?: unknown): void;
}

function fakeSceneManager(): FakeSceneManager {
  const stopped: string[] = [];
  const started: Array<{ key: string; data: unknown }> = [];
  return {
    stopped,
    started,
    stop(key: string): void {
      stopped.push(key);
    },
    start(key: string, data?: unknown): void {
      started.push({ key, data });
    },
  };
}

function asSceneManager(fake: FakeSceneManager): Phaser.Scenes.SceneManager {
  return fake as unknown as Phaser.Scenes.SceneManager;
}

describe('场景表与切换策略（M1-12）', () => {
  beforeEach(() => {
    phaserMock.__textures.clear();
    phaserMock.__registry.clear();
  });

  test('组合根场景表 = [BattlefieldScene, FxAssetScene, LobbyScene]', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'main', 'main-entry.ts'),
      'utf-8'
    );
    expect(source).toMatch(/scene: \[BattlefieldScene, FxAssetScene, LobbyScene\]/);
  });

  test('互斥（前半）：切大厅 ⇒ 战场停摆、大厅起', () => {
    const fake = fakeSceneManager();

    switchToLobby(asSceneManager(fake));

    expect(fake.stopped).toEqual([BATTLEFIELD_SCENE_KEY]);
    expect(fake.started).toEqual([{ key: LOBBY_SCENE_KEY, data: undefined }]);
  });

  test('互斥（后半）：切战场 ⇒ 大厅停摆、战场起（instanceId 走 scene data 通道）', () => {
    const fake = fakeSceneManager();

    switchToBattlefield(asSceneManager(fake), 'inst_a');

    expect(fake.stopped).toEqual([LOBBY_SCENE_KEY]);
    expect(fake.started).toEqual([{ key: BATTLEFIELD_SCENE_KEY, data: { instanceId: 'inst_a' } }]);
  });

  test('常驻场景：切换过程从不碰 FxAssetScene（素材管线不随切换断掉）', () => {
    const fake = fakeSceneManager();

    switchToLobby(asSceneManager(fake));
    switchToBattlefield(asSceneManager(fake), 'inst_a');

    expect(fake.stopped).not.toContain(FX_ASSET_SCENE_KEY);
    expect(fake.started.map((entry) => entry.key)).not.toContain(FX_ASSET_SCENE_KEY);
    expect(RESIDENT_SCENE_KEYS).toEqual([FX_ASSET_SCENE_KEY]);
  });

  test('冒烟：stop battlefield 不影响 FxAssetScene 的资源管线（特效纹理一张不少）', () => {
    // —— 先让特效素材管线把 sheet 装进纹理仓库（真实路径：FxAssetScene.preload）——
    phaserMock.__registry.set(FX_ASSET_BASE_URL_KEY, 'http://127.0.0.1:7523/fx');
    const fxScene = new FxAssetScene();
    fxScene.preload();

    const atlasCalls = (fxScene.load.atlas as unknown as jest.Mock).mock.calls;
    expect(atlasCalls).toHaveLength(SPRITE_FX_SOURCES.length);
    expect(phaserMock.__textures.size).toBe(SPRITE_FX_SOURCES.length);

    // —— 停战场（大厅态）——
    const fake = fakeSceneManager();
    switchToLobby(asSceneManager(fake));
    expect(fake.stopped).toEqual([BATTLEFIELD_SCENE_KEY]);

    // —— 冒烟结论：素材管线的纹理一张不少，常驻场景也没被停 ——
    expect(phaserMock.__textures.size).toBe(SPRITE_FX_SOURCES.length);
    for (const source of SPRITE_FX_SOURCES) {
      expect(phaserMock.__textures.has(source.atlasKey)).toBe(true);
    }
    expect(fake.stopped).not.toContain(FX_ASSET_SCENE_KEY);
  });
});
