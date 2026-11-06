/**
 * 文件职责：**代码路由特效源注册表**的 world 侧读口（@since v3.3，task_194 / AP-04）。
 *
 *   代码路由的「效果源」（哪个 kind 用哪个 pixelfx 效果、什么尺寸、什么调色板槽位）
 *   由**组合根**（app 层）装配 —— 因为只有它认识 pixelfx（第三方库的形状不许漏进 world，
 *   铁律：world 只认 core 与自己的契约）。
 *   战场场景（BattlefieldScene）由 Phaser 实例化，构造器拿不到注入 ⇒ 走 game.registry
 *   （与调色板 FX_PALETTE_KEY、形象源 UNIT_SPRITE_SOURCE_KEY 同一模式）。
 *
 * ★ 为什么不用总线：效果源是**本客户端的资产事实**（不是业务状态）——
 *   塞进 WorldState 等于给状态机加第二个真相源（core/types.ts 明写皮肤与素材不进状态）。
 *
 * 禁止事项：
 *   1. import app / hud —— 铁律：world 只认 core；
 *   2. import pixelfx —— 外部库的知识只留在 app 层的适配器里；
 *   3. 在 world 侧缓存一份 —— 读口每次现取（源可能被换掉）。
 */

import type { CodeFxSource } from '../objects/code-fx-layer';

/**
 * 代码路由特效源在 Phaser game registry 里的键。
 * why 放 world 侧：键名与读口是同一件事（app 层从 world 侧 import 它去写 —— 同调色板口径）。
 */
export const CODE_FX_SOURCES_KEY = 'stratix:code-fx-sources';

/** 只读的键值存储（Phaser 的 DataManager 满足这个形状）。 */
export interface CodeFxSourceStore {
  get(key: string): unknown;
}

/**
 * 读当前注册在册的代码路由特效源。
 *
 * @param store Phaser game registry（场景的 `this.registry`）。
 * @returns 特效源列表（没注册 / 值非法 ⇒ 空列表 ⇒ 该走 sheet 路由）。
 */
export function readCodeFxSources(store: CodeFxSourceStore | null | undefined): readonly CodeFxSource[] {
  if (!store) return [];
  const raw = store.get(CODE_FX_SOURCES_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isCodeFxSource);
}

/** 一个值是不是合法的代码路由特效源（形状校验 —— registry 里什么都能塞）。 */
function isCodeFxSource(value: unknown): value is CodeFxSource {
  if (typeof value !== 'object' || value === null) return false;
  const source = value as Partial<CodeFxSource>;
  return (
    typeof source.kind === 'string' &&
    source.kind.length > 0 &&
    typeof source.create === 'function' &&
    typeof source.width === 'number' &&
    typeof source.height === 'number'
  );
}
