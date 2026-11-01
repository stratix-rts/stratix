/**
 * 单测：LPC 角色合成器（src/world/appearance/character-composer.ts）+ 位图 LRU 缓存。
 *
 * 覆盖验收要求的「路径构建 / LRU 驱逐」两段，另加合成计划（z 序、动画别名、跳层）的行为。
 *
 * 隔离方式：画布与图片**注入**（合成器构造参数），不依赖 jsdom（jest 是 node 环境）。
 * 注册表注入真实现（fetch 也是注入的假实现），不 mock 合成器本身。
 */

import { CharacterComposer } from '../character-composer';
import { LruCache } from '../image-cache';
import { PartRegistry } from '../part-registry';
import { createFakeCanvas, createFakeImageFactory, createJsonFetch } from './helpers/fakes';

/** 夹具：形状照抄真实素材元数据。 */
const METADATA = {
  body: {
    name: 'Body Color',
    typeName: 'body',
    required: ['male', 'female'],
    animations: ['walk', 'idle'],
    variants: ['light'],
    layers: { layer_1: { zPos: 10, male: 'body/bodies/male/', female: 'body/bodies/female/' } },
    credits: [{ authors: ['someone'], licenses: ['CC0'] }],
  },
  shirt: {
    name: 'Shirt',
    typeName: 'clothes',
    required: ['male'],
    animations: ['walk'],
    variants: ['1'],
    layers: { layer_1: { zPos: 40, male: 'clothes/shirt/male/' } },
    credits: [],
  },
  hat: {
    name: 'Hat',
    typeName: 'hat',
    required: ['male'],
    animations: ['walk', 'combat'],
    variants: ['1'],
    layers: { layer_1: { zPos: 90, male: 'hat/hat/male/' } },
    credits: [],
  },
} as const;

/** 造一个注入齐全的合成器。 */
async function composerWithFixture(
  options: { maxCacheSize?: number; failImages?: boolean } = {}
): Promise<{
  composer: CharacterComposer;
  images: ReturnType<typeof createFakeImageFactory>;
}> {
  const { fetch } = createJsonFetch(METADATA);
  const registry = new PartRegistry({ fetchImpl: fetch });
  await registry.loadMetadata();

  const images = createFakeImageFactory({ fail: options.failImages });
  const composer = new CharacterComposer({
    registry,
    createCanvas: () => createFakeCanvas().canvas,
    createImage: images.createImage,
    ...(options.maxCacheSize ? { maxCacheSize: options.maxCacheSize } : {}),
  });

  return { composer, images };
}

describe('CharacterComposer：合成计划（纯逻辑）', () => {
  test('按 z 序升序排列（影子/身体在下、衣服居中、帽子最上）', async () => {
    const { composer } = await composerWithFixture();
    const plan = composer.planItems(
      {
        hat: { itemId: 'hat', variant: '1' },
        body: { itemId: 'body', variant: 'light' },
        torso: { itemId: 'shirt', variant: '1' },
      },
      'male',
      ['walk']
    );
    expect(plan.map((p) => p.itemId)).toEqual(['body', 'shirt', 'hat']);
    expect(plan.map((p) => p.zPos)).toEqual([10, 40, 90]);
  });

  test('动画行偏移取自动画表（walk = 第 8 行）', async () => {
    const { composer } = await composerWithFixture();
    const plan = composer.planItems({ body: { itemId: 'body', variant: 'light' } }, 'male', ['walk']);
    expect(plan[0].yPos).toBe(8 * 64);
    expect(plan[0].spritePath).toBe('/spritesheets/body/bodies/male/walk/light.png');
  });

  test('素材不支持该体型 / 该动画 → 该层被跳过', async () => {
    const { composer } = await composerWithFixture();
    // shirt 只有 male 体型
    expect(
      composer.planItems({ torso: { itemId: 'shirt', variant: '1' } }, 'female', ['walk'])
    ).toEqual([]);
    // hat 的素材动画只有 walk 与 combat（combat 别名命中 combat_idle）
    expect(
      composer.planItems({ hat: { itemId: 'hat', variant: '1' } }, 'male', ['slash'])
    ).toEqual([]);
    expect(
      composer.planItems({ hat: { itemId: 'hat', variant: '1' } }, 'male', ['combat_idle']).length
    ).toBe(1);
  });

  test('未知部位 id → 直接跳过（不抛）', async () => {
    const { composer } = await composerWithFixture();
    expect(composer.planItems({ x: { itemId: '不存在', variant: '1' } }, 'male', ['walk'])).toEqual([]);
  });
});

describe('CharacterComposer：合成与位图缓存', () => {
  test('合成后画布被清过并按计划绘制，署名被带出', async () => {
    const { composer, images } = await composerWithFixture();
    const fake = createFakeCanvas();
    const canvas = fake.canvas;

    const result = await composer.composeCharacter(
      { body: { itemId: 'body', variant: 'light' }, torso: { itemId: 'shirt', variant: '1' } },
      { bodyType: 'male', animations: ['walk'], targetCanvas: canvas }
    );

    expect(fake.clearRect).toHaveBeenCalled();
    expect(fake.drawImage).toHaveBeenCalledTimes(2);
    expect(result.parts).toHaveLength(2);
    expect(result.credits).toHaveLength(1);
    // 画布尺寸 = LPC 精灵表尺寸
    expect(canvas.width).toBe(832);
    expect(canvas.height).toBe(3456);
    expect(images.requested).toContain('/spritesheets/body/bodies/male/walk/light.png');
  });

  test('同一张图只取一次（缓存命中）', async () => {
    const { composer, images } = await composerWithFixture();
    const selections = { body: { itemId: 'body', variant: 'light' } };

    await composer.composeCharacter(selections, { bodyType: 'male', animations: ['walk'] });
    const afterFirst = images.requested.length;
    await composer.composeCharacter(selections, { bodyType: 'male', animations: ['walk'] });

    expect(images.requested.length).toBe(afterFirst);
    expect(composer.getCacheSize()).toBe(1);
  });

  test('超过缓存上限时淘汰最久未用的那张（LRU 驱逐）', async () => {
    const { composer, images } = await composerWithFixture({ maxCacheSize: 2 });
    const fake = createFakeCanvas();

    // 第一次：body + shirt（两张）
    await composer.composeCharacter(
      { body: { itemId: 'body', variant: 'light' }, torso: { itemId: 'shirt', variant: '1' } },
      { bodyType: 'male', animations: ['walk'], targetCanvas: fake.canvas }
    );
    expect(composer.getCacheSize()).toBe(2);

    // 第二次：再合成一个 hat（第三张）→ 淘汰最久未用的 body
    await composer.composeCharacter(
      {
        body: { itemId: 'body', variant: 'light' },
        torso: { itemId: 'shirt', variant: '1' },
        hat: { itemId: 'hat', variant: '1' },
      },
      { bodyType: 'male', animations: ['walk'], targetCanvas: fake.canvas }
    );
    expect(composer.getCacheSize()).toBe(2);

    // body 被淘汰了 → 再用到它会重新取一次
    const before = images.requested.length;
    await composer.composeCharacter(
      { body: { itemId: 'body', variant: 'light' } },
      { bodyType: 'male', animations: ['walk'], targetCanvas: fake.canvas }
    );
    expect(images.requested.length).toBeGreaterThan(before);
  });

  test('单张图加载失败不中断整轮合成（该层跳过，其余照常）', async () => {
    const { composer } = await composerWithFixture({ failImages: true });
    const fake = createFakeCanvas();
    const result = await composer.composeCharacter(
      { body: { itemId: 'body', variant: 'light' } },
      { bodyType: 'male', animations: ['walk'], targetCanvas: fake.canvas }
    );
    expect(result.parts).toHaveLength(1); // 计划里有这一层
    expect(fake.drawImage).not.toHaveBeenCalled(); // 但没画出来
    expect(composer.getCacheSize()).toBe(0); // 失败的不入缓存
  });

  test('clearCache 清空位图缓存', async () => {
    const { composer } = await composerWithFixture();
    await composer.composeCharacter(
      { body: { itemId: 'body', variant: 'light' } },
      { bodyType: 'male', animations: ['walk'] }
    );
    expect(composer.getCacheSize()).toBe(1);
    composer.clearCache();
    expect(composer.getCacheSize()).toBe(0);
  });
});

describe('LruCache：缓存自身的行为', () => {
  test('命中会把条目挪到最近使用位置，淘汰时先淘汰最久未用的', async () => {
    const cache = new LruCache<string>({
      maxSize: 2,
      load: async (key) => `loaded:${key}`,
    });

    await cache.get('a');
    await cache.get('b');
    expect(cache.keys()).toEqual(['a', 'b']);

    await cache.get('a'); // 命中 → a 变成最近使用
    expect(cache.keys()).toEqual(['b', 'a']);

    await cache.get('c'); // 超限 → 淘汰最久未用的 b
    expect(cache.keys()).toEqual(['a', 'c']);
    expect(cache.has('b')).toBe(false);
    expect(cache.size).toBe(2);
  });

  test('同一 key 的并发请求只加载一次', async () => {
    let loads = 0;
    const cache = new LruCache<string>({
      maxSize: 4,
      load: async (key) => {
        loads += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        return `loaded:${key}`;
      },
    });

    const [x, y] = await Promise.all([cache.get('a'), cache.get('a')]);
    expect(x).toBe('loaded:a');
    expect(y).toBe('loaded:a');
    expect(loads).toBe(1);
  });

  test('加载失败不入缓存（下次还会重试）', async () => {
    let attempts = 0;
    const cache = new LruCache<string>({
      maxSize: 4,
      load: async () => {
        attempts += 1;
        throw new Error('boom');
      },
    });

    await expect(cache.get('a')).rejects.toThrow('boom');
    expect(cache.size).toBe(0);
    await expect(cache.get('a')).rejects.toThrow('boom');
    expect(attempts).toBe(2);
  });
});
