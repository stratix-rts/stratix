/**
 * 单测：**合成器版本号**与源码的一致性（world/appearance/composer-version.ts）。
 *
 * 覆盖：版本号里的源码哈希段 = 当前合成器源码（character-composer.ts / part-registry.ts /
 *   constants.ts）的 sha256 前 8 位。
 *
 * ★ 这条单测是「自动失效」的执行机制：
 *   改了合成器源码却没更新版本号 ⇒ 这条单测红 ⇒ 开发者照抄提示里的期望值更新
 *   ⇒ 缓存键的第三要素变了 ⇒ 旧烘焙图自动失效重烘（DESIGN §2.2 纪律 1）。
 */

import { COMPOSER_VERSION, COMPOSER_VERSION_SOURCE_FILES } from '../composer-version';

import { computeComposerSourceHash } from './helpers/composer-version-hash';

describe('合成器版本号（task_195 / CP-01）', () => {
  test('版本号的哈希段与当前源码一致（改了合成器必须更新版本号）', () => {
    const expected = computeComposerSourceHash();
    expect(COMPOSER_VERSION.endsWith(`-${expected}`)).toBe(true);
  });

  test('版本号格式：手工位 + 8 位十六进制哈希', () => {
    expect(COMPOSER_VERSION).toMatch(/^r\d+-[0-9a-f]{8}$/);
  });

  test('参与哈希的源码清单非空且不含版本号文件自身（否则自我引用，改一次变一次）', () => {
    expect(COMPOSER_VERSION_SOURCE_FILES.length).toBeGreaterThan(0);
    expect(COMPOSER_VERSION_SOURCE_FILES).not.toContain('composer-version.ts');
  });
});
