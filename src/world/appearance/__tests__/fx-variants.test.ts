/**
 * 单测：**sheet 变体的运行时消费**（world/appearance/fx-variants.ts）。
 *
 * 覆盖（task_192 / AP-02 留下的边界，由 task_194 / AP-04 关闭）：
 *   ① 烘焙 manifest → 运行时变体清单（只收变体序号 > 0 的条目）；
 *   ② 变体清单 → 可播的候选（基础变体 + 同 kind 的变体）；
 *   ③ 候选 → **随机挑一套**（变体真的被消费，而不是"总是挑基础变体"）。
 *
 * 依赖：纯逻辑，零 Phaser。
 *
 * @since v3.3（task_194 / AP-04）
 */

import { SPRITE_FX_SOURCES } from '../fx-sources.generated';
import type { SpriteFxSource } from '../fx-atlas';
import {
  pickSpriteFxCandidate,
  spriteFxCandidates,
  spriteFxVariantSource,
  spriteFxVariantsFromManifest,
  type SpriteFxVariant,
} from '../fx-variants';

/** 一条 manifest 产物记录（形状照烘焙器 scripts/lib/fx-release-bake.ts）。 */
function artifact(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    skin: 'default',
    kind: 'levelUp',
    pixelfxId: 'holy/heal-aoe',
    variantId: 's1',
    variantIndex: 1,
    seed: 1032,
    png: 'default/levelUp__s1.png',
    json: 'default/levelUp__s1.json',
    ...over,
  };
}

/** 基础变体的运行时参数（生成索引里的 levelUp 那条）。 */
const BASE: SpriteFxSource = SPRITE_FX_SOURCES.find((item) => item.kind === 'levelUp') as SpriteFxSource;

describe('manifest → 变体清单', () => {
  test('收下变体序号 > 0 的条目，并推出纹理 / 动画 key', () => {
    const variants = spriteFxVariantsFromManifest({ artifacts: [artifact()] });

    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      kind: 'levelUp',
      variantId: 's1',
      atlasKey: 'fx:levelUp__s1',
      animKey: 'fx-anim:levelUp__s1',
      pngPath: 'default/levelUp__s1.png',
      jsonPath: 'default/levelUp__s1.json',
    });
  });

  test('基础变体（序号 0）不收（它归运行时索引管 —— 重复收会让随机分布歪掉）', () => {
    const variants = spriteFxVariantsFromManifest({
      artifacts: [artifact({ variantIndex: 0, variantId: 'base' })],
    });

    expect(variants).toEqual([]);
  });

  test('别的皮肤 / 别的 kind 一律不收（运行时只认 default 皮肤的六个 kind）', () => {
    const variants = spriteFxVariantsFromManifest({
      artifacts: [
        artifact({ skin: 'pixel' }),
        artifact({ kind: 'notAKind' }),
      ],
    });

    expect(variants).toEqual([]);
  });

  test('manifest 形状不对 / 缺失 → 空清单（没有变体 ⇒ 只播基础变体）', () => {
    expect(spriteFxVariantsFromManifest(null)).toEqual([]);
    expect(spriteFxVariantsFromManifest(undefined)).toEqual([]);
    expect(spriteFxVariantsFromManifest({})).toEqual([]);
    expect(spriteFxVariantsFromManifest({ artifacts: 'nope' })).toEqual([]);
  });
});

describe('变体 → 可播候选', () => {
  const variant: SpriteFxVariant = {
    kind: 'levelUp',
    variantId: 's1',
    atlasKey: 'fx:levelUp__s1',
    animKey: 'fx-anim:levelUp__s1',
    pngPath: 'default/levelUp__s1.png',
    jsonPath: 'default/levelUp__s1.json',
  };

  test('候选 = 基础变体 + 同 kind 的变体（参数沿用基础变体，只换纹理 key）', () => {
    const candidates = spriteFxCandidates(BASE, [variant]);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].atlasKey).toBe(BASE.atlasKey);
    expect(candidates[1].atlasKey).toBe('fx:levelUp__s1');
    // 参数不另存一份（帧数 / 帧率 / 枢轴 / 缩放全同基础变体 —— 少一份就会漂一份）。
    expect(candidates[1].frames).toBe(BASE.frames);
    expect(candidates[1].fps).toBe(BASE.fps);
    expect(candidates[1].scale).toBe(BASE.scale);
    expect(candidates[1].framePrefix).toBe(BASE.framePrefix);
  });

  test('别的 kind 的变体不进候选', () => {
    const other: SpriteFxVariant = { ...variant, kind: 'celebrate' };
    expect(spriteFxCandidates(BASE, [other])).toHaveLength(1);
  });

  test('没有变体 → 候选只剩基础变体（dev / 未烘焙时的行为与 task_161 一致）', () => {
    expect(spriteFxCandidates(BASE, [])).toEqual([BASE]);
  });

  test('派生的变体源：纹理 / 动画 / 路径换掉，其余原样', () => {
    const derived = spriteFxVariantSource(BASE, variant);

    expect(derived.atlasKey).toBe('fx:levelUp__s1');
    expect(derived.animKey).toBe('fx-anim:levelUp__s1');
    expect(derived.pngPath).toBe('default/levelUp__s1.png');
    expect(derived.jsonPath).toBe('default/levelUp__s1.json');
    expect(derived.kind).toBe(BASE.kind);
  });
});

describe('随机挑变体（变体真的被消费）', () => {
  const candidates = [
    { atlasKey: 'fx:levelUp' },
    { atlasKey: 'fx:levelUp__s1' },
  ];

  test('候选为空 → null（没有可播的）', () => {
    expect(pickSpriteFxCandidate([], () => 0)).toBeNull();
  });

  test('随机源给到哪一段就挑哪一段', () => {
    expect(pickSpriteFxCandidate(candidates, () => 0)?.atlasKey).toBe('fx:levelUp');
    expect(pickSpriteFxCandidate(candidates, () => 0.5)?.atlasKey).toBe('fx:levelUp__s1');
    expect(pickSpriteFxCandidate(candidates, () => 0.99)?.atlasKey).toBe('fx:levelUp__s1');
  });

  test('随机源越界（负数 / ≥1）→ 夹回区间内，不越界取到 undefined', () => {
    expect(pickSpriteFxCandidate(candidates, () => -1)?.atlasKey).toBe('fx:levelUp');
    expect(pickSpriteFxCandidate(candidates, () => 1)?.atlasKey).toBe('fx:levelUp__s1');
  });

  test('连挑 100 次 → 基础变体与 __s1 变体都被消费到（不是"总是挑第一个"）', () => {
    const picked = new Set<string>();
    let seed = 20261106;
    // 确定性伪随机（LCG）—— 单测要可复现，不用 Math.random。
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let index = 0; index < 100; index += 1) {
      const chosen = pickSpriteFxCandidate(candidates, random);
      if (chosen) picked.add(chosen.atlasKey);
    }

    expect([...picked].sort()).toEqual(['fx:levelUp', 'fx:levelUp__s1']);
  });
});
