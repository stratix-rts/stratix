/**
 * 单测：**角色的"长相裁决"**（src/world/appearance/character-look.ts）。
 *
 * why 单独测：这一层是**上场链路的第一环** —— 角色档案进来，长相出去。
 *   裁决错了的后果很具体：
 *     - 用户亲手挑的长相被覆盖 → 用户白挑了；
 *     - 品牌预设没命中 → 同一家的 agent 在战场上长得都不一样，认不出来；
 *     - 随机兜底不播种 → 刷新一次换一张脸，用户认不出自己的角色；
 *     - 返回空 → 战场上只剩一个占位圆（"战场恒空"的旧毛病）。
 *   这些错在肉眼手测里很难一眼归因，所以在纯逻辑层锁死。
 *
 * 隔离方式：
 *   - 素材元数据用手写小夹具（不读 1.4MB 真文件）—— 锁的是**裁决规则**，不是素材内容；
 *   - 品牌预设直接引用 BRAND_PRESETS 本身（引用相等即证明"没被重新生成"）。
 */

import type { CharacterAppearance } from '../../../core/types';
import { BRAND_PRESETS } from '../brand-presets';
import { resolveCharacterLook, seededRandom } from '../character-look';
import { PartRegistry } from '../part-registry';
import { createJsonFetch } from './helpers/fakes';

/** 一条素材的最小形状（其余字段注册表用不到）。 */
function part(
  name: string,
  typeName: string,
  variants: string[],
  required: string[] = ['male']
): Record<string, unknown> {
  return {
    name,
    typeName,
    required,
    variants,
    animations: ['walk'],
    layers: { layer_1: { zPos: 10, male: `${typeName}/${name}/male/` } },
    credits: [],
  };
}

/**
 * 夹具：够 minimal 档选出几个部位（人形基底）。
 * why 每类给多个变体：只有一种变体时，"不同角色 id 结果不同"这条根本测不出来
 *   （不管播什么种子都抽到同一条）—— 变体池够大，种子差异才显形。
 */
const METADATA: Record<string, Record<string, unknown>> = {
  shadow: part('Shadow', 'shadow', ['shadow']),
  body: part('Body', 'body', ['light', 'tan', 'dark']),
  heads_human_male: part('Human Male Head', 'head', ['light', 'tan', 'dark']),
  torso_clothes_robe: part('Robe', 'clothes', ['red', 'blue']),
  legs_hose: part('Hose Legs', 'legs', ['black', 'gray']),
  feet_sandals: part('Sandals', 'shoes', ['black', 'brown']),
};

async function registryWithFixture(): Promise<PartRegistry> {
  const { fetch } = createJsonFetch(METADATA);
  const registry = new PartRegistry({ fetchImpl: fetch });
  await registry.loadMetadata();
  return registry;
}

describe('长相裁决：优先级（自带外观 > 品牌预设 > 随机）', () => {
  test('角色自带的外观原样返回（用户挑的最高优先，不被覆盖）', async () => {
    const registry = await registryWithFixture();
    const own: CharacterAppearance = {
      bodyType: 'female',
      parts: { head: { variant: 'light', itemId: 'heads_human_female' } },
    };

    const look = resolveCharacterLook(
      { id: 'c1', appearance: own, agentKind: 'claude-code' },
      { registry }
    );

    expect(look).toBe(own);
  });

  test('没有自带外观但 agent 种类命中品牌预设 → 用预设本体（不被重新生成）', async () => {
    const registry = await registryWithFixture();

    const look = resolveCharacterLook({ id: 'c1', appearance: null, agentKind: 'claude-code' }, { registry });

    expect(look).toBe(BRAND_PRESETS['claude-code']);
  });

  test('不同 agent 种类 → 不同预设（两家一眼可辨）', async () => {
    const registry = await registryWithFixture();

    const claude = resolveCharacterLook({ id: 'c1', agentKind: 'claude-code' }, { registry });
    const codex = resolveCharacterLook({ id: 'c2', agentKind: 'codex' }, { registry });

    expect(claude).toBe(BRAND_PRESETS['claude-code']);
    expect(codex).toBe(BRAND_PRESETS.codex);
    expect(claude).not.toEqual(codex);
  });

  test('词表外的 agent 种类（自定义 agent）→ 走随机兜底，不是预设', async () => {
    const registry = await registryWithFixture();

    const look = resolveCharacterLook({ id: 'c1', agentKind: 'my-own-cli' }, { registry });

    expect(look).not.toBe(BRAND_PRESETS['claude-code']);
    expect(Object.keys(look.parts).length).toBeGreaterThan(0);
  });

  test('没有 agent 种类也没有外观 → 仍然给出一份可合成的外观（绝不返回空）', async () => {
    const registry = await registryWithFixture();

    const look = resolveCharacterLook({ id: 'c1' }, { registry });

    expect(look).toBeDefined();
    expect(look.parts).toBeDefined();
    expect(look.bodyType).toBe('male');
  });
});

describe('长相裁决：随机兜底的确定性', () => {
  test('同一角色 id → 每次裁决结果完全相同（刷新页面不换脸）', async () => {
    const registry = await registryWithFixture();

    const first = resolveCharacterLook({ id: 'character_42', agentKind: 'unknown-kind' }, { registry });
    const second = resolveCharacterLook({ id: 'character_42', agentKind: 'unknown-kind' }, { registry });

    expect(first).toEqual(second);
  });

  test('不同角色 id → 结果不同（不是一张脸发给所有人）', async () => {
    const registry = await registryWithFixture();

    const first = resolveCharacterLook({ id: 'character_1', agentKind: 'unknown-kind' }, { registry });
    const second = resolveCharacterLook({ id: 'character_2', agentKind: 'unknown-kind' }, { registry });

    expect(first).not.toEqual(second);
  });

  test('体型透传（options.bodyType 决定随机兜底的体型）', async () => {
    const registry = await registryWithFixture();

    const look = resolveCharacterLook(
      { id: 'c1', agentKind: 'unknown-kind' },
      { registry, bodyType: 'female' }
    );

    expect(look.bodyType).toBe('female');
  });

  test('素材元数据缺失 → parts 为空（真实降级，不编造长相）', async () => {
    const { fetch } = createJsonFetch({});
    const registry = new PartRegistry({ fetchImpl: fetch });
    await registry.loadMetadata();

    const look = resolveCharacterLook({ id: 'c1', agentKind: 'unknown-kind' }, { registry });

    expect(look.parts).toEqual({});
  });
});

describe('确定性随机源（mulberry32 + FNV-1a）', () => {
  test('同一种子 → 同一串数', () => {
    const a = seededRandom('character_1');
    const b = seededRandom('character_1');
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];

    expect(seqA).toEqual(seqB);
  });

  test('不同种子 → 不同的数', () => {
    const a = seededRandom('character_1');
    const b = seededRandom('character_2');

    expect(a()).not.toBe(b());
  });

  test('取值落在 [0,1) 区间内（抽签概率用）', () => {
    const random = seededRandom('character_1');
    for (let i = 0; i < 200; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
