/**
 * 文件职责：**皮肤 → 图标集**的联动（@since v3.8，task_135）。
 *
 * 背景：task_121 把图标组（hud/widgets/icon-set.ts）设计成「图标集（IconSet）」——
 *   同一组图标名，每个皮肤一套路径数据，并**预留了 pixel 位**（当时是空的）。
 *   用户验收反馈：「图标还是现代 SVG 换描边，不是真像素艺术」——
 *   因为像素皮虽然加了 crispEdges / 2px 描边，**图形本身还是那套矢量线条**。
 *   本文件把 pixel 位填上，并把「切皮肤」与「换图标集」绑在一起。
 *
 * 输入：皮肤 id（string）。
 * 输出：把当前图标集切到该皮肤对应的那套，并就地刷新 DOM 里已画好的图标。
 * 禁止事项：
 *   1. 重建 / 重绘 HUD —— 切皮肤只换图形与 token，**布局骨架一个像素都不动**；
 *   2. 改现代皮肤的图标数据 —— 现代集（MODERN_ICON_SET）一个字节都不动；
 *   3. 依赖 DOM 环境（node / 单测无 DOM）—— 取不到 document 就只切「当前图标集」。
 */

import { refreshIconsInDom, setActiveIconSet } from '../widgets/icon-set';

/**
 * 皮肤 id → 图标集 id。
 * why 只有 pixel 一条：其余皮肤（crimson / forest / ocean…）都是「现代线条 + 换色板」，
 *   图形本来就该是线条版（它们只是配色不同，不是像素美术）；pixel 是唯一走美术像素的一套。
 */
const ICON_SET_BY_SKIN: Readonly<Record<string, string>> = Object.freeze({
  pixel: 'pixel',
});

/** 取某个皮肤该用的图标集 id（认不出的皮肤 → modern）。 */
export function iconSetIdForSkin(skinId: string | null | undefined): string {
  if (!skinId) return 'modern';
  return ICON_SET_BY_SKIN[skinId] ?? 'modern';
}

/**
 * 切到某皮肤对应的图标集，并刷新 DOM 里已画好的图标。
 *
 * why 要「刷新」：切皮肤**不重建 DOM**（重建会丢组件状态、还会动布局），
 *   已画好的 svg 还拿着旧图形 —— 不刷就等于没换（这正是上一版被退回的原因）。
 */
export function syncIconsForSkin(skinId: string | null | undefined): void {
  setActiveIconSet(iconSetIdForSkin(skinId));
  refreshIconsInDom();
}
