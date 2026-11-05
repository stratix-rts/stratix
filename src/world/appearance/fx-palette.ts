/**
 * 文件职责：**代码路由特效调色板的 world 侧读口**（@since v3.3，task_162）。
 *   数据来源：Phaser game registry 里由组合根（app/main/main-entry.ts）塞进来的
 *   「token 名 → 色值」表 —— 那张表是 HUD 层从 DOM 热读出来的（hud/theme/fx-palette-reader.ts）。
 *
 * ★ 为什么走 registry 而不是总线：
 *   皮肤是**每客户端本地**的展示偏好，core/types.ts 明写「皮肤不进 WorldState、不广播」
 *   —— 把它塞进 WorldState 等于给状态机加第二个真相源（core/runtime.ts 的 theme.set 落地口径）。
 *   而 registry 是**每客户端本地**的（Phaser 实例就在客户端里），语义天然一致：
 *   「这个客户端的战场用什么色」。同款先例：reduced-motion（world/motion.ts）。
 *
 * 禁止事项：
 *   1. import hud —— world 只认 core（铁律）；
 *   2. 自己读 DOM —— world 零 DOM；
 *   3. 在 world 侧缓存一份 —— 读口每次现取（皮肤随时能切）。
 */

import { resolveFxPalette, type FxPalette } from '../../core/theme/fx-palette';

/**
 * 调色板表在 Phaser game registry 里的键。
 * why 放 world 侧：键名与读口是同一件事（app 层从 world 侧 import 它去写 —— 同 reduced-motion 口径）。
 */
export const FX_PALETTE_KEY = 'stratix:fx-palette';

/** 只读的键值存储（Phaser 的 DataManager 满足这个形状）。 */
export interface PaletteStore {
  get(key: string): unknown;
}

/**
 * 读当前调色板。
 *
 * @param store Phaser game registry（场景的 `this.registry`）。
 * @returns 角色齐全的调色板（registry 里没有 / 值非法 → 走 core 的兜底色）。
 */
export function readFxPalette(store: PaletteStore | null | undefined): FxPalette {
  if (!store) return resolveFxPalette(null);
  return resolveFxPalette(store.get(FX_PALETTE_KEY));
}
