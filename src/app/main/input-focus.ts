/**
 * 文件职责：**「此刻有没有输入焦点」的 DOM 侧读口**（@since v3.3，task_217 / IX-04）。
 *
 * 背景（docs/DESIGN-canvas-interactions.md §3 冲突对 C-04）：
 *   聊天框正开着、用户在打字时，画布的键盘钩子（Phaser 挂在 window 上）照样收到键击
 *   ⇒ 聊天框里按 ESC，画面顺手「回全景」。要治它，world 得先知道「有人在输入框里打字」。
 *
 * 口径：**焦点是 DOM 侧的事实，只有组合根（app 层）能问** —— 与 reduced-motion 同一模式
 *   （dev-flags.ts 的 prefersReducedMotion → game.registry → world/motion.ts 的读口）。
 *   本文件是 DOM 侧那一半：组合根把它塞进 registry，world 现取现用。
 *
 * why 判定「可编辑元素」而不是「任何元素」：
 *   焦点落在按钮 / 链接上时，空格 / 回车有**原生语义**（激活该按钮），
 *   画布抢这些键才是真碍事；而焦点在 input / textarea / contenteditable 上时，
 *   键击是**在写字** ⇒ 画布必须让路（快捷键系统用的是同一条判定，见 shortcut-catalog 的 isEditableTarget）。
 *
 * 输入：一个 Document（默认取全局 document）。
 * 输出：此刻是否有可编辑元素持焦。
 * 禁止事项：
 *   1. 缓存结果 —— 焦点随时会变（组合根塞进 registry 的是**探针**，每次现取）；
 *   2. 在这里碰 Phaser / core —— 本文件只回答 DOM 的问题，装配在组合根。
 */

import { isEditableTarget } from '../../hud/components/shortcuts/shortcut-catalog';

/**
 * 找到「当前持焦的可编辑元素」（找不到返回 null）。
 *
 * why 要下钻影子树：焦点在 shadow DOM 内部时，`document.activeElement` 只给到**宿主**
 *   （聊天框就是 `<strat-character-chat-drawer>` 这种自定义元素），真正持焦的是
 *   `host.shadowRoot.activeElement`（聊天框里的那个 textarea）——
 *   只看 document.activeElement 会把「在聊天框里打字」误判成「没在输入」。
 */
function findEditableActiveElement(doc: Document): Element | null {
  let current: Element | null = doc.activeElement;
  // 逐层下钻：宿主 → 影子树里的持焦元素 → 再下一层影子树（嵌套自定义元素）。
  while (current) {
    if (isEditableTarget(current)) return current;
    const root = current.shadowRoot;
    if (!root) return null;
    current = root.activeElement;
  }
  return null;
}

/**
 * 此刻是否有输入焦点（有可编辑元素持焦）。
 *
 * @param doc 文档（默认取全局 document；node 环境没有 document ⇒ 返回 false）。
 * @returns true = 用户正在输入框里打字 ⇒ 画布键盘要让路。
 */
export function hasInputFocus(doc?: Document | null): boolean {
  const target = doc ?? (typeof document === 'undefined' ? null : document);
  if (!target) return false;
  return findEditableActiveElement(target) !== null;
}
