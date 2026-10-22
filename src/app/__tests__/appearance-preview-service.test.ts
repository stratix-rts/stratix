/**
 * 集成测试：形象预览服务（app/services/appearance-preview-service.ts）。
 * 覆盖：部位变体清单（按体型过滤）、随机形象、预览合成与刷新、过期结果丢弃、
 *   Phaser 实例生命周期（attach/destroy）。
 * @jest-environment jsdom
 *
 * 边界说明：本文件测的是"服务这一侧"—— 它把 world/appearance 的素材与合成器
 *   和 Phaser 迷你实例包成 hud 认识的端口。真 canvas 的画面效果归 task_029 手测，
 *   故这里的预览游戏是**假实现**（只记录调用）。
 */

import { PartRegistry } from '../../world/appearance/part-registry';
import {
  createFakeCanvas,
  createFakeImageFactory,
} from '../../world/appearance/__tests__/helpers/fakes';

import { createAppearancePreviewService } from '../services/appearance-preview-service';

/** 素材元数据夹具（最小可用集：两个体型、五类部位）。 */
const METADATA = {
  body: {
    typeName: 'body',
    required: ['male', 'female'],
    animations: ['walk'],
    variants: ['dark', 'light'],
    layers: {
      layer_1: { male: 'body/bodies/male/', female: 'body/bodies/female/' },
    },
    credits: [],
  },
  shadow: {
    typeName: 'shadow',
    required: ['male', 'female'],
    animations: ['walk'],
    variants: ['shadow'],
    layers: { layer_1: { male: 'body/shadows/male/', female: 'body/shadows/female/' } },
    credits: [],
  },
  hair: {
    typeName: 'hair',
    required: ['male', 'female'],
    animations: ['walk'],
    variants: ['black', 'blonde'],
    layers: { layer_1: { male: 'hair/male/', female: 'hair/female/' } },
    credits: [],
  },
  eyes: {
    typeName: 'eyes',
    required: ['male', 'female'],
    animations: ['walk'],
    variants: ['blue'],
    layers: { layer_1: { male: 'eyes/male/', female: 'eyes/female/' } },
    credits: [],
  },
  /** 只支持 male 的部位：female 时应当被过滤掉。 */
  beard: {
    typeName: 'beard',
    required: ['male'],
    animations: ['walk'],
    variants: ['beard'],
    layers: { layer_1: { male: 'beard/male/' } },
    credits: [],
  },
} as const;

function createRegistry(payload: unknown = METADATA): PartRegistry {
  const registry = new PartRegistry({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    }),
  });
  return registry;
}

/** 假预览游戏：记录创建 / 销毁 / 换表。 */
interface GameLog {
  created: number;
  destroyed: number;
  sheets: HTMLCanvasElement[];
}

function createStubGame(): { createGame: (host: HTMLElement) => { setSheet: (c: HTMLCanvasElement) => void; destroy: () => void }; log: GameLog } {
  const log: GameLog = { created: 0, destroyed: 0, sheets: [] };
  return {
    log,
    createGame: () => {
      log.created += 1;
      return {
        setSheet: (canvas: HTMLCanvasElement) => { log.sheets.push(canvas); },
        destroy: () => { log.destroyed += 1; },
      };
    },
  };
}

function createService(options: { registry?: PartRegistry; random?: () => number } = {}) {
  const fakeCanvas = createFakeCanvas();
  const images = createFakeImageFactory();
  const game = createStubGame();
  const service = createAppearancePreviewService({
    registry: options.registry ?? createRegistry(),
    createCanvas: () => fakeCanvas.canvas,
    createImage: images.createImage,
    createGame: game.createGame,
    ...(options.random ? { random: options.random } : {}),
  });
  return { service, game, images, canvas: fakeCanvas.canvas };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('形象预览服务', () => {
  test('部位清单：五类，且按体型过滤（只支持 male 的部位在 female 下不出现）', async () => {
    const { service } = createService();
    await service.whenReady();

    const male = service.listCategories('male');
    expect(male.map((category) => category.category)).toEqual(['body', 'hair', 'eyes', 'ears', 'facial']);
    expect(male.find((c) => c.category === 'body')?.variants).toEqual(['dark', 'light']);
    expect(male.find((c) => c.category === 'hair')?.variants).toEqual(['black', 'blonde']);
    // beard 的 typeName 是 'beard' → 归到 facial 类别
    expect(male.find((c) => c.category === 'facial')?.variants).toEqual(['beard']);

    const female = service.listCategories('female');
    // beard 只支持 male → female 下 facial 没有可选变体
    expect(female.find((c) => c.category === 'facial')?.variants).toEqual([]);
  });

  test('随机形象：体型在 male/female 之间，部位变体来自素材', async () => {
    const { service } = createService({ random: () => 0 });
    await service.whenReady();

    const appearance = service.randomize();
    expect(appearance).not.toBeNull();
    expect(['male', 'female']).toContain(appearance?.bodyType);
    expect(appearance?.parts.hair).toBeDefined();
    expect(appearance?.parts.eyes).toBeDefined();
  });

  test('素材没加载出来（清单全空）→ randomize 返 null（不编造长相）', async () => {
    const { service } = createService({ registry: createRegistry({}) });
    await service.whenReady();

    expect(service.randomize()).toBeNull();
  });

  test('attach：同一个容器重复挂只建一个实例；换容器才重建', () => {
    const { service, game } = createService();

    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    service.attach(hostA);
    service.attach(hostA);
    expect(game.log.created).toBe(1);

    service.attach(hostB);
    expect(game.log.created).toBe(2);
  });

  test('preview：合成后把精灵表交给预览实例', async () => {
    const { service, game } = createService();
    await service.whenReady();

    const host = document.createElement('div');
    service.attach(host);
    service.preview({ bodyType: 'male', parts: { body: 'light', hair: 'blonde' } });

    // 合成是异步的（取图）→ 等它落地
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(game.log.sheets).toHaveLength(1);
    expect(game.log.sheets[0]).toBeTruthy();
  });

  test('连点随机：只显示最后一次的结果（过期合成被丢弃）', async () => {
    const { service, game } = createService();
    await service.whenReady();

    const host = document.createElement('div');
    service.attach(host);
    service.preview({ bodyType: 'male', parts: { body: 'light' } });
    service.preview({ bodyType: 'female', parts: { body: 'dark' } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(game.log.sheets).toHaveLength(1);
  });

  test('生命周期：destroy 销毁预览实例，之后的 preview 不再上屏', async () => {
    const { service, game } = createService();
    await service.whenReady();

    const host = document.createElement('div');
    service.attach(host);
    service.destroy();
    expect(game.log.destroyed).toBe(1);

    service.preview({ bodyType: 'male', parts: { body: 'light' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(game.log.sheets).toHaveLength(0);
  });
});
