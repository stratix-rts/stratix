/**
 * 单测：LPC 部位注册表（src/world/appearance/part-registry.ts）。
 *
 * 覆盖验收要求的「元数据解析 / 精灵路径构建」两段，另加「加载失败退化」与
 * 「由 core 外观模型展开成部位选择」。
 *
 * 隔离方式：fetch **注入**（不碰全局 fetch、不发真实请求）；
 * 素材元数据用一份**手写的小夹具**（形状照抄真实 item-metadata.json 的字段），
 * 而不是真读 1.4MB 的 assets/spritesheets/item-metadata.json ——
 * 真文件在单测里既慢又脆（素材一改就红），单测要锁的是**解析规则**，不是素材内容。
 */

import {
  PartRegistry,
  variantToFilename,
  type FetchLike,
} from '../part-registry';
import { createFakeFetch, createJsonFetch } from './helpers/fakes';

/** 夹具：形状照抄真实素材元数据（body / hair / 一件衣服 + 一条坏数据）。 */
const METADATA = {
  body: {
    name: 'Body Color',
    priority: 10,
    typeName: 'body',
    required: ['male', 'female'],
    animations: ['walk', 'idle'],
    variants: ['light', 'dark'],
    layers: {
      layer_1: { zPos: 10, male: 'body/bodies/male/', female: 'body/bodies/female/' },
    },
    credits: [{ authors: ['bluecarrot16'], licenses: ['CC-BY-SA'], file: 'body/bodies/male' }],
  },
  hair_long: {
    name: 'Long Hair',
    typeName: 'hair',
    required: ['male'],
    animations: ['walk'],
    variants: ['1', '2'],
    layers: { layer_1: { zPos: 85, male: 'hair/long/male/' } },
    credits: [],
  },
  hair_curly: {
    // 与 hair_long 共用同一套变体名 —— 复刻真实素材的形态（91 个发型共用一套发色）
    name: 'Curly Hair',
    typeName: 'hair',
    required: ['male'],
    animations: ['walk'],
    variants: ['1', '2'],
    layers: { layer_1: { zPos: 85, male: 'hair/curly/male/' } },
    credits: [],
  },
  shirt: {
    name: 'Shirt',
    typeName: 'clothes',
    required: ['male'],
    animations: ['walk'],
    variants: ['1'],
    layers: { layer_1: { zPos: 40, male: 'clothes/shirt/male/' } },
    credits: [{ authors: ['someone'], licenses: ['CC0'] }],
  },
  broken: {
    name: '坏数据（没有 typeName）',
    required: ['male'],
  },
} as const;

/** 造一个装好夹具的注册表。 */
async function registryWithFixture(
  options: { basePath?: string } = {}
): Promise<PartRegistry> {
  const { fetch } = createJsonFetch(METADATA);
  const registry = new PartRegistry({ fetchImpl: fetch, ...options });
  await registry.loadMetadata();
  return registry;
}

describe('PartRegistry：元数据解析', () => {
  test('坏数据被跳过，好数据全部进索引', async () => {
    const registry = await registryWithFixture();
    expect(registry.size).toBe(4); // broken 被跳过
    expect(registry.getPart('broken')).toBeNull();
    expect(registry.getPart('body')?.itemId).toBe('body');
  });

  test('条目 id 由 JSON 的键补齐（素材文件里可能缺 itemId 字段）', async () => {
    const { fetch } = createJsonFetch({
      hat: { name: 'Hat', typeName: 'hat', required: ['male'], animations: [], variants: [], layers: {} },
    });
    const registry = new PartRegistry({ fetchImpl: fetch });
    await registry.loadMetadata();
    expect(registry.getPart('hat')?.itemId).toBe('hat');
  });

  test('类别索引同时含素材自身类别与别名类别（clothes → torso）', async () => {
    const registry = await registryWithFixture();
    expect(registry.getPartsByCategory('hair').map((p) => p.itemId)).toEqual([
      'hair_long',
      'hair_curly',
    ]);
    // 素材类别名 'clothes' 自身可查
    expect(registry.getPartsByCategory('clothes').map((p) => p.itemId)).toEqual(['shirt']);
    // 别名类别 'torso' 也能查到衣服（body 本身也在 torso 别名列表里 —— 裸身也是躯干层）
    expect(registry.getPartsByCategory('torso').map((p) => p.itemId)).toEqual(['body', 'shirt']);
    expect(registry.getAllCategories()).toContain('torso');
  });

  test('元数据不是对象时退化为空表（不抛）', async () => {
    const { fetch } = createJsonFetch(['not', 'a', 'map']);
    const registry = new PartRegistry({ fetchImpl: fetch });
    await registry.loadMetadata();
    expect(registry.size).toBe(0);
    expect(registry.isLoaded()).toBe(true);
  });

  test('加载失败（网络报错 / 非 2xx）不抛，退化为空表且只重试一次', async () => {
    const boom = createFakeFetch(() => {
      throw new Error('network down');
    });
    const registry = new PartRegistry({ fetchImpl: boom.fetch as FetchLike });
    await registry.loadMetadata();
    expect(registry.size).toBe(0);
    expect(registry.isLoaded()).toBe(true);

    // 第二次调用不再发请求（失败也记成"加载过了"，否则每次合成都重试网络）
    await registry.loadMetadata();
    expect(boom.calls).toHaveLength(1);
  });

  test('非 2xx 响应同样退化为空表', async () => {
    const { fetch } = createJsonFetch(METADATA, { ok: false, status: 404 });
    const registry = new PartRegistry({ fetchImpl: fetch });
    await registry.loadMetadata();
    expect(registry.size).toBe(0);
  });
});

describe('PartRegistry：精灵路径构建', () => {
  test('路径 = 素材根 + 图层相对路径 + 动画 + 变体文件名', async () => {
    const registry = await registryWithFixture();
    expect(registry.buildSpritePath('body', 'light', 'male', 'walk', 1)).toBe(
      '/spritesheets/body/bodies/male/walk/light.png'
    );
    expect(registry.buildSpritePath('body', 'light', 'female', 'walk', 1)).toBe(
      '/spritesheets/body/bodies/female/walk/light.png'
    );
  });

  test('素材根可替换（file:// 正式包走绝对 URL 基址）', async () => {
    const registry = await registryWithFixture({ basePath: 'file:///app/dist/frontend/spritesheets' });
    expect(registry.buildSpritePath('body', 'light', 'male', 'walk', 1)).toBe(
      'file:///app/dist/frontend/spritesheets/body/bodies/male/walk/light.png'
    );
  });

  test('变体名按文件名规则规整（小写 + 空格转下划线）', async () => {
    const registry = await registryWithFixture();
    expect(registry.buildSpritePath('body', 'Dark Skin', 'male', 'walk', 1)).toBe(
      '/spritesheets/body/bodies/male/walk/dark_skin.png'
    );
    expect(variantToFilename('  Mixed  Case ')).toBe('_mixed_case_');
  });

  test('缺部位 / 缺图层 / 体型没有图层 → null（跳过该层，不拼出坏路径）', async () => {
    const registry = await registryWithFixture();
    expect(registry.buildSpritePath('nope', 'light', 'male', 'walk', 1)).toBeNull();
    expect(registry.buildSpritePath('body', 'light', 'male', 'walk', 7)).toBeNull();
    // hair_long 只有 male 体型 → 用 female 拼不出来
    expect(registry.buildSpritePath('hair_long', '1', 'female', 'walk', 1)).toBeNull();
  });

  test('部位是否支持某体型 + 某动画（别名表生效）', async () => {
    const registry = await registryWithFixture();
    expect(registry.isPartSupported('body', 'male', 'walk')).toBe(true);
    expect(registry.isPartSupported('body', 'male', 'idle')).toBe(true);
    expect(registry.isPartSupported('body', 'male', 'slash')).toBe(false);
    expect(registry.isPartSupported('hair_long', 'female', 'walk')).toBe(false);
  });
});

describe('PartRegistry：由 core 外观模型展开部位选择', () => {
  test('category → variant 展开成 {itemId, variant}', async () => {
    const registry = await registryWithFixture();
    const selections = registry.resolveSelections({
      bodyType: 'male',
      parts: { body: 'dark', torso: '1', hair: '2' },
    });
    expect(selections).toEqual({
      body: { itemId: 'body', variant: 'dark' },
      torso: { itemId: 'shirt', variant: '1' },
      hair: { itemId: 'hair_long', variant: '2' },
    });
  });

  test('同类别多素材共用变体名 → 列出全部候选，展开时取第一个（确定次序）', async () => {
    const registry = await registryWithFixture();
    expect(registry.findPartsByVariant('hair', '1').map((p) => p.itemId)).toEqual([
      'hair_long',
      'hair_curly',
    ]);
    const selections = registry.resolveSelections({
      bodyType: 'male',
      parts: { hair: '1' },
    });
    expect(selections.hair).toEqual({ itemId: 'hair_long', variant: '1' });
  });

  test('变体在素材里找不到 → 跳过该部位（其余部位照常）', async () => {
    const registry = await registryWithFixture();
    const selections = registry.resolveSelections({
      bodyType: 'male',
      parts: { body: 'light', hair: '根本没有这个变体' },
    });
    expect(selections.body).toEqual({ itemId: 'body', variant: 'light' });
    expect(selections.hair).toBeUndefined();
  });

  test('默认部位选择 = 身体（素材没有 shadow 就只给身体）', async () => {
    const registry = await registryWithFixture();
    expect(registry.getDefaultSelections('male')).toEqual({
      body: { itemId: 'body', variant: 'light' },
    });
  });
});

describe('PartRegistry：版权署名', () => {
  test('按部位汇总并按作者去重', async () => {
    const registry = await registryWithFixture();
    const credits = registry.getCredits(['body', 'hair_long']);
    expect(credits).toHaveLength(1);
    expect(credits[0].authors).toEqual(['bluecarrot16']);
    expect(credits[0].licenses).toEqual(['CC-BY-SA']);
  });
});
