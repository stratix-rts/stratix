/**
 * 文件职责：战场侧的**皮肤染色**工具 —— 把「单位带的皮肤 id」翻译成 Phaser 能用的颜色。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §3「战场层（Phaser）皮肤由 world 侧读取同名 token 常量」。
 * 输入：UnitView.skinId（core 广播的资源键）+ 业务态兜底色。
 * 输出：0xRRGGBB 的数字颜色（Phaser setFillStyle 用）。
 * 禁止事项：
 *   1. import hud —— 铁律：world 只认识 core 与 core/bus；
 *      皮肤登记表因此落在 core/theme/skin-registry.ts（hud 与 world 唯一的共用底座）；
 *   2. 自己维护一份皮肤色表 —— 色值只在 core/theme/skin-registry.ts 一处，本文件只做格式转换；
 *   3. import phaser —— 本文件是纯函数（颜色换算不依赖渲染引擎，便于单测）。
 */

import { resolveAccent } from '../core/theme/skin-registry';

/** 没有皮肤时的兜底色（与 unit-layer 的未知状态色同值：中性灰，不冒充任何身份）。 */
export const DEFAULT_UNIT_COLOR = 0x94a3b8;

/**
 * 解析 CSS 十六进制颜色（`#rgb` / `#rrggbb`）→ 数字颜色。
 * 解析不了（空串 / 非法格式）时返回 null —— 由调用方决定回落，不静默吞掉。
 */
export function parseHexColor(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (hex.length === 3) {
    const short = hex.split('').map((ch) => ch + ch).join('');
    return parseHexColor(short);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return Number.parseInt(hex, 16);
}

/**
 * 单位填充色：有皮肤 → 皮肤徽标色（身份标识）；没有皮肤 → 业务态兜底色。
 *
 * why 皮肤优先于业务态：皮肤是角色的**身份**（用户建档时挑的那一套），
 * 而业务态颜色是普通单位（gateway 数据流来的）的状态提示 —— 两者不是一回事，不混用。
 */
export function resolveUnitColor(skinId: string | null | undefined, fallback: number): number {
  if (!skinId) return fallback;
  return parseHexColor(resolveAccent(skinId)) ?? fallback;
}

/**
 * 场景调色板与视觉规范（@since v3.3，task_110）—— **从本文件取色**的 world 侧唯一入口。
 *   事实源：src/core/theme/visual-spec.ts（唯一事实源，含七色 / 尺寸 / 时长 / easing）；
 *   world 门面：src/world/visual-spec.ts（把十六进制色换算成 Phaser 数字色）。
 * why 走 theme.ts 而不是各自 import visual-spec：world 侧的取色入口收敛在一处，
 *   改色只改事实源一处，world 各文件只认这个门面。
 */
export {
  INTERACTION_FX_METRICS,
  VISUAL_METRICS,
  VISUAL_PALETTE,
  WORLD_PALETTE,
  UNIT_ANIMATION_METRICS,
  hexToRgba,
} from './visual-spec';
