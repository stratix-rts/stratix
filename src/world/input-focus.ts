/**
 * 文件职责：**「当前是否有输入焦点」的 world 侧读口**（@since v3.3，task_217 / IX-04）。
 *
 * 背景（docs/DESIGN-canvas-interactions.md §3 冲突对 C-04）：
 *   画布的键盘钩子挂在 **window** 上（Phaser 的键盘插件），而聊天框的输入框在 **HUD** 里 ——
 *   用户在聊天框打字时按 ESC，画面会「顺手」回全景：输入在打字，镜头却跑了。
 *   根因不是 Phaser，而是 **world 不知道「现在有人在输入框里打字」**。
 *
 * 口径：**焦点在哪是 DOM 侧的事实，world 只读一个探针** ——
 *   与 reduced-motion 同一模式（app 层判 → game.registry → world 现读，见 world/motion.ts）。
 *   组合根（app 层）装配探针，world 用时现取，**不缓存**（焦点随时会变，缓存必然过期）。
 *
 * why 不走 core 契约（design §5.4 扩展点 E-3a 的 `WorldState.inputFocus`）：
 *   ① 焦点是**本机视图态**，不是世界真相 —— 放进共享的 WorldState 会让多客户端互相覆盖
 *      （客户端 A 在打字会把客户端 B 的画布也一起锁住）；
 *   ② 每一次焦点变化都要广播一份全量快照（远程模式还得多走一趟 WS 往返）——
 *      为「谁在打字」付这个代价不划算（perf：广播数据必须有界且成本可控）；
 *   ③ core 只认 core/types 与 core/bus，焦点是 DOM 事实 —— 塞进契约等于把 DOM 泄漏进真相面。
 *   契约纪律上本条仍满足 design §3 C-04 的要求：「DOM 侧提供，world 通过契约读」。
 *
 * 输入：Phaser game registry 里的一个探针函数（app 层装配时塞进去）。
 * 输出：此刻是否有输入焦点（true = 有可编辑元素持焦 ⇒ 画布键盘要让路）。
 * 禁止事项：
 *   1. 在 world 里读 document / activeElement —— **world 层零 DOM**（与 motion.ts 同口径）；
 *   2. 在 world 里缓存一份焦点状态 —— 读口每次现取（焦点会变）。
 */

/**
 * 「输入焦点探针」在 Phaser game registry 里的键。
 * why 走 registry：BattlefieldScene 由 Phaser 实例化（构造器拿不到注入），
 *   组合根在 preBoot 里塞、场景用时现取 —— 与 REDUCED_MOTION_KEY 同一模式。
 */
export const INPUT_FOCUS_KEY = 'stratix:input-focus';

/** 只读的键值存储（Phaser 的 DataManager 满足这个形状）。 */
export interface InputFocusStore {
  get(key: string): unknown;
}

/** 探针：问 DOM 侧「此刻有输入焦点吗」。 */
export type InputFocusProbe = () => boolean;

/** 是不是探针（type guard：registry 里的值类型未知）。 */
function isProbe(value: unknown): value is InputFocusProbe {
  return typeof value === 'function';
}

/**
 * 读「当前是否有输入焦点」。
 *
 * @param store Phaser game registry（场景的 `this.registry`）。
 * @returns true = 有可编辑元素持焦（聊天框 / 命令行 / contenteditable）⇒ 画布键盘要让路。
 */
export function readInputFocus(store: InputFocusStore | null | undefined): boolean {
  if (!store) return false;
  const probe = store.get(INPUT_FOCUS_KEY);
  if (!isProbe(probe)) return false;
  try {
    return probe() === true;
  } catch {
    // 探针抛错（DOM 已卸载 / 宿主被拆）⇒ 按「没有输入焦点」处理：
    // 宁可画布照常响应，也不要整条键盘链哑掉。
    return false;
  }
}
