/**
 * 单测：world 侧视觉规格门面（world/visual-spec.ts）—— 数字色与唯一事实源同值。
 * @since v3.3（task_110）
 */

import { VISUAL_PALETTE, hexToNumber } from '../../core/theme/visual-spec';

import { VISUAL_METRICS, WORLD_PALETTE } from '../visual-spec';
import {
  VISUAL_PALETTE as THEME_VISUAL_PALETTE,
  WORLD_PALETTE as THEME_WORLD_PALETTE,
} from '../theme';

describe('world 门面：数字色由唯一事实源换算而来', () => {
  test('七色数字值与十六进制事实源一一对应', () => {
    expect(WORLD_PALETTE.background).toBe(hexToNumber(VISUAL_PALETTE.background));
    expect(WORLD_PALETTE.grid).toBe(hexToNumber(VISUAL_PALETTE.grid));
    expect(WORLD_PALETTE.unit).toBe(hexToNumber(VISUAL_PALETTE.unit));
    expect(WORLD_PALETTE.progress).toBe(hexToNumber(VISUAL_PALETTE.progress));
    expect(WORLD_PALETTE.success).toBe(hexToNumber(VISUAL_PALETTE.success));
    expect(WORLD_PALETTE.danger).toBe(hexToNumber(VISUAL_PALETTE.danger));
    expect(WORLD_PALETTE.accent).toBe(hexToNumber(VISUAL_PALETTE.accent));
  });

  test('world/theme.ts 是 world 侧取色入口（门面从这里透出）', () => {
    expect(THEME_WORLD_PALETTE.unit).toBe(WORLD_PALETTE.unit);
    expect(THEME_VISUAL_PALETTE).toEqual(VISUAL_PALETTE);
  });

  test('尺寸 / 时长规范随门面透出', () => {
    expect(VISUAL_METRICS.unitHitboxPx).toBe(48);
  });
});
