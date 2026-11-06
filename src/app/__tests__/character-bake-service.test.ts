/**
 * 单测：**角色烘焙管线**（app/services/character-bake-service.ts）。
 *
 * 覆盖验收口径：
 *   - 缓存命中：第二次触发不再合成（复用落盘的整图）；
 *   - 版本失效：Composer 版本号变 ⇒ 新键 ⇒ 重新烘焙（旧图不再被用）；
 *   - 整体重建：清掉缓存（删目录）后下次触发全量重烘；
 *   - 静默降级：合成/写盘失败只返回 failed，不抛（运行时直合成兜底）。
 *
 * 边界说明：合成器与注册表都是**假实现**（真素材 1.3G 不在仓内），
 *   缓存存取口用内存实现（另一个真实实现，不是 mock 数据）。
 */

import type { CharacterAppearance } from '../../core/types';
import type { CharacterComposer } from '../../world/appearance/character-composer';
import type { PartRegistry } from '../../world/appearance/part-registry';
import {
  createFakeCanvas,
  createFakeImageFactory,
} from '../../world/appearance/__tests__/helpers/fakes';

import { createCharacterBakeService } from '../services/character-bake-service';
import {
  createMemoryCharacterBakeStore,
  type CharacterBakeStore,
} from '../services/character-bake-store';

const APPEARANCE: CharacterAppearance = {
  bodyType: 'male',
  parts: { hair: 'black', body: 'light' },
};

/** 假注册表：默认部位 + 解析结果（够合成器用）。 */
function createFakeRegistry(): PartRegistry {
  return {
    loadMetadata: jest.fn(async () => undefined),
    getDefaultSelections: jest.fn(() => ({
      shadow: { itemId: 'shadow', variant: 'shadow' },
      body: { itemId: 'body', variant: 'light' },
    })),
    resolveSelections: jest.fn(() => ({ hair: { itemId: 'hair', variant: 'black' } })),
  } as unknown as PartRegistry;
}

/** 假合成器：返回一张假精灵表；可注入失败。 */
function createFakeComposer(options: { fail?: boolean } = {}): CharacterComposer & {
  composeCharacter: jest.Mock;
} {
  const fake = createFakeCanvas();
  const composeCharacter = jest.fn(async () => {
    if (options.fail) throw new Error('合成炸了');
    // parts 非空：合成计划为空 = 部件缺件（task_196 / CP-02 的失败面①），
    // 正常路径必须有一层可画的层。
    return {
      canvas: fake.canvas,
      parts: [
        {
          itemId: 'body',
          variant: 'light',
          spritePath: '/spritesheets/body/male/walk/light.png',
          zPos: 10,
          layerNum: 1,
          animation: 'walk',
          yPos: 0,
        },
      ],
      credits: [],
    };
  });
  return { composeCharacter } as unknown as CharacterComposer & { composeCharacter: jest.Mock };
}

/** 造一套服务（默认：内存缓存口 + 假合成器）。 */
function createService(
  options: {
    composer?: CharacterComposer & { composeCharacter: jest.Mock };
    store?: CharacterBakeStore | null;
    composerVersion?: string;
  } = {}
) {
  const composer = options.composer ?? createFakeComposer();
  const store = options.store === undefined ? createMemoryCharacterBakeStore() : options.store;
  const images = createFakeImageFactory();
  const service = createCharacterBakeService({
    registry: createFakeRegistry(),
    composer,
    createCanvas: () => createFakeCanvas().canvas,
    createImage: images.createImage,
    store,
    ...(options.composerVersion ? { composerVersion: options.composerVersion } : {}),
  });
  return { service, composer, store };
}

describe('角色烘焙管线（app 层实现）', () => {
  test('首次触发：合成整图并落盘（产物 = PNG + atlas 元数据）', async () => {
    const { service, composer, store } = createService();

    const outcome = await service.ensureBaked('char_1', APPEARANCE);

    expect(outcome).toBe('baked');
    expect(composer.composeCharacter).toHaveBeenCalledTimes(1);
    const memoryStore = store as ReturnType<typeof createMemoryCharacterBakeStore>;
    expect(memoryStore.size()).toBe(1);
  });

  test('缓存命中：再次触发不再合成（复用落盘的整图）', async () => {
    const { service, composer } = createService();

    await service.ensureBaked('char_1', APPEARANCE);
    const second = await service.ensureBaked('char_1', APPEARANCE);

    expect(second).toBe('cached');
    expect(composer.composeCharacter).toHaveBeenCalledTimes(1);
  });

  test('缓存命中（跨服务实例 = 跨进程重启）：直接复用落盘产物，不重新合成', async () => {
    const store = createMemoryCharacterBakeStore();
    const first = createService({ store });
    await first.service.ensureBaked('char_1', APPEARANCE);

    // 换一个服务实例（模拟重启：内存记性没了，磁盘还在）。
    const second = createService({ store });
    const outcome = await second.service.ensureBaked('char_1', APPEARANCE);

    expect(outcome).toBe('cached');
    expect(second.composer.composeCharacter).not.toHaveBeenCalled();
  });

  test('版本失效：Composer 版本号变 ⇒ 新键 ⇒ 重新烘焙（旧图不再被用）', async () => {
    const store = createMemoryCharacterBakeStore();
    const old = createService({ store, composerVersion: 'r1-aaaaaaaa' });
    await old.service.ensureBaked('char_1', APPEARANCE);

    const next = createService({ store, composerVersion: 'r2-bbbbbbbb' });
    const outcome = await next.service.ensureBaked('char_1', APPEARANCE);

    expect(outcome).toBe('baked');
    expect(next.composer.composeCharacter).toHaveBeenCalledTimes(1);
    // 两条产物并存：旧键的还在（无害，键不同互不干扰），新键另起一份。
    expect((store as ReturnType<typeof createMemoryCharacterBakeStore>).size()).toBe(2);
  });

  test('整体重建：清掉缓存后下次触发全量重烘（删目录 ⇒ 无其他依赖）', async () => {
    const store = createMemoryCharacterBakeStore();
    const { service, composer } = createService({ store });

    await service.ensureBaked('char_1', APPEARANCE);
    await service.clearCache();
    expect((store as ReturnType<typeof createMemoryCharacterBakeStore>).size()).toBe(0);

    const outcome = await service.ensureBaked('char_1', APPEARANCE);
    expect(outcome).toBe('baked');
    expect(composer.composeCharacter).toHaveBeenCalledTimes(2);
  });

  test('运行时取缓存整图：命中返回画布（尺寸 = 整张精灵表）', async () => {
    const { service } = createService();
    await service.ensureBaked('char_1', APPEARANCE);

    const sheet = await service.loadCachedSheet('char_1', APPEARANCE);

    expect(sheet).not.toBeNull();
    expect(sheet?.width).toBe(832);
    expect(sheet?.height).toBe(3456);
  });

  test('运行时取缓存整图：未命中返回 null（调用方直合成兜底）', async () => {
    const { service } = createService();
    expect(await service.loadCachedSheet('char_1', APPEARANCE)).toBeNull();
  });

  test('静默降级：合成失败只返回 failed，不抛（用户无感知）', async () => {
    const composer = createFakeComposer({ fail: true });
    const { service } = createService({ composer });

    const outcome = await service.ensureBaked('char_1', APPEARANCE);

    expect(outcome).toBe('failed');
    expect(await service.loadCachedSheet('char_1', APPEARANCE)).toBeNull();
  });

  test('静默降级：写盘失败只返回 failed（不抛、不记账，下次还会重试）', async () => {
    const store: CharacterBakeStore = {
      read: async () => null,
      write: async () => {
        throw new Error('磁盘满了');
      },
      clear: async () => undefined,
    };
    const { service } = createService({ store });

    const outcome = await service.ensureBaked('char_1', APPEARANCE);

    expect(outcome).toBe('failed');
    expect(await service.loadCachedSheet('char_1', APPEARANCE)).toBeNull();
  });

  test('无缓存存取口（纯浏览器 dev）⇒ 全部降级：不烘焙、运行时直合成', async () => {
    const { service, composer } = createService({ store: null });

    expect(await service.ensureBaked('char_1', APPEARANCE)).toBe('skipped');
    expect(await service.loadCachedSheet('char_1', APPEARANCE)).toBeNull();
    expect(composer.composeCharacter).not.toHaveBeenCalled();
  });

  test('触发面：只给「有外观」的角色触发（没外观的角色没有整图可烘）', async () => {
    const { service, composer } = createService();

    service.syncCharacters([
      { id: 'char_1', appearance: APPEARANCE },
      { id: 'char_2', appearance: null },
      { id: 'char_3' },
    ]);
    // 触发是异步的（烘焙在后台跑），等它落定。
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(composer.composeCharacter).toHaveBeenCalledTimes(1);
  });
});
