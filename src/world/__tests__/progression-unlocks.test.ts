/**
 * 单测：core/progression 解锁词表 ↔ world/appearance 部位类别的**对齐对拍**（task_040）。
 *
 * why 放在 world 层测：core/progression 的 UNLOCK_KEYS 刻意不 import world/appearance
 *   （core 不依赖渲染层是分层铁律），两边各自单列 —— 词表漂移必须有一条测试红出来：
 *   world 加了新部件类别而 progression 的解锁表没跟上（或反之删了类别留下死键）时，
 *   本文件失败。方向上 world → core 是合法依赖（本文件只 import core 的纯常量）。
 *
 * @since v3.19（task_040）。
 */

import { UNLOCK_KEYS } from '../../core/progression';
import { PART_CATEGORIES } from '../appearance/constants';

describe('UNLOCK_KEYS ↔ PART_CATEGORIES 对齐（两侧各自单列，靠这条测试防漂移）', () => {
  test('解锁词表 = 全部部件类别 + rare_variants 标记位（不缺、不多）', () => {
    const withoutMarker = UNLOCK_KEYS.filter((key) => key !== 'rare_variants');
    expect([...withoutMarker].sort()).toEqual([...PART_CATEGORIES].sort());
  });

  test('rare_variants 只是标记位：它不是部件类别（不出现在 PART_CATEGORIES 里）', () => {
    expect(UNLOCK_KEYS).toContain('rare_variants');
    expect((PART_CATEGORIES as readonly string[]).includes('rare_variants')).toBe(false);
  });
});
