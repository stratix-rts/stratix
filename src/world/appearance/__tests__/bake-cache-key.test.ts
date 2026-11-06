/**
 * 单测：角色烘焙缓存键（world/appearance/bake-cache-key.ts）。
 *
 * 覆盖：缓存键三要素齐（agent 标识 + 皮肤 + Composer 版本号）、换肤/换版本 ⇒ 键变、
 *   同样的长相（部位顺序不同）⇒ 键不变、键片段消毒（不进路径分隔符）。
 *
 * 权威定义：docs/DESIGN-asset-pipelines.md §2.2 纪律 1。
 */

import type { CharacterAppearance } from '../../../core/types';
import {
  appearanceFingerprint,
  characterBakeKey,
  sanitizeKeySegment,
} from '../bake-cache-key';
import { COMPOSER_VERSION } from '../composer-version';

const BASE: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    hair: 'black',
    body: 'light',
  },
};

describe('角色烘焙缓存键（task_195 / CP-01）', () => {
  test('键由三要素拼成：agent 标识 + 皮肤指纹 + Composer 版本号', () => {
    const key = characterBakeKey({ agentId: 'char_1', appearance: BASE });

    expect(key).toContain('char_1');
    expect(key).toContain(appearanceFingerprint(BASE));
    expect(key).toContain(sanitizeKeySegment(COMPOSER_VERSION));
    // 三段以双下划线分隔（格式固定，便于肉眼核对）。
    expect(key.split('__')).toHaveLength(3);
  });

  test('换 agent ⇒ 键变（不同角色各一份，互不覆盖）', () => {
    const left = characterBakeKey({ agentId: 'char_1', appearance: BASE });
    const right = characterBakeKey({ agentId: 'char_2', appearance: BASE });
    expect(left).not.toBe(right);
  });

  test('换皮肤 ⇒ 键变（同角色换肤后旧图自动作废）', () => {
    const before = characterBakeKey({ agentId: 'char_1', appearance: BASE });
    const after = characterBakeKey({
      agentId: 'char_1',
      appearance: { bodyType: 'male', parts: { hair: 'brown', body: 'light' } },
    });
    expect(after).not.toBe(before);
  });

  test('换体型 ⇒ 键变', () => {
    const before = characterBakeKey({ agentId: 'char_1', appearance: BASE });
    const after = characterBakeKey({
      agentId: 'char_1',
      appearance: { bodyType: 'female', parts: { hair: 'black', body: 'light' } },
    });
    expect(after).not.toBe(before);
  });

  test('换 Composer 版本号 ⇒ 键变（合成器升级 ⇒ 旧缓存自动失效重烘）', () => {
    const before = characterBakeKey({ agentId: 'char_1', appearance: BASE });
    const after = characterBakeKey({
      agentId: 'char_1',
      appearance: BASE,
      composerVersion: 'r2-deadbeef',
    });
    expect(after).not.toBe(before);
  });

  test('部位顺序不同但内容相同 ⇒ 键不变（同一张脸不重复烘）', () => {
    const left = characterBakeKey({
      agentId: 'char_1',
      appearance: { bodyType: 'male', parts: { hair: 'black', body: 'light' } },
    });
    const right = characterBakeKey({
      agentId: 'char_1',
      appearance: { bodyType: 'male', parts: { body: 'light', hair: 'black' } },
    });
    expect(right).toBe(left);
  });

  test('精确形态（带 itemId）与纯变体形态 ⇒ 键不同（定位到的素材不是同一个）', () => {
    const plain = characterBakeKey({ agentId: 'char_1', appearance: BASE });
    const exact = characterBakeKey({
      agentId: 'char_1',
      appearance: {
        bodyType: 'male',
        parts: { hair: { variant: 'black', itemId: 'hair_long' }, body: 'light' },
      },
    });
    expect(exact).not.toBe(plain);
  });

  test('键片段消毒：路径分隔符与异类字符被换掉（键要当文件名用）', () => {
    const key = characterBakeKey({ agentId: '../../etc/passwd', appearance: BASE });
    expect(key).not.toContain('/');
    expect(key).not.toContain('..');
    expect(key.split('__')[0]).toBe('etc-passwd');
  });

  test('消毒后的片段非空（空 id 不该产出空段）', () => {
    expect(sanitizeKeySegment('')).toBe('unknown');
    expect(sanitizeKeySegment('///')).toBe('unknown');
  });
});
