/**
 * 文件职责：**画布键盘的归属裁决**（@since v3.3，task_217 / IX-04）——
 *   一次键击归谁：仪式 / 输入焦点 / 画布。
 *
 * 优先级链（docs/DESIGN-canvas-interactions.md §2.3 规则 4 + §3 C-04/C-07）：
 *
 *   ① 仪式在演 —— 整次输入被仪式吃掉（task_187：任意输入即跳到末态）；
 *   ② 输入焦点在输入框里 —— 画布键盘**让路**（打字不被劫持，ESC 不动镜头）；
 *   ③ 画布手势 —— 画布自己的键位（ESC = 镜头归位，task_079）。
 *
 * why 单独抽成纯函数（不写在场景里）：
 *   ① 这条链是**规则**，不是实现细节 —— 抽出来才能在 node 下直打断言（场景要 Phaser）；
 *   ② 规则只有一处 ⇒ 不会出现「ESC 走了一条、任意键走了另一条」的分叉。
 *
 * 输入：两个事实 —— 仪式在不在演、有没有输入焦点。
 * 输出：这一次键击的归属（'ceremony' / 'input' / 'canvas'）。
 * 禁止事项：
 *   1. import phaser —— 判定必须能在 node 下单测（同 camera/camera-nav 的口径）；
 *   2. 在这里碰 DOM / 事件 —— 本模块只回答「归谁」，事实由调用方取（world 零 DOM）；
 *   3. 在这里做动作 —— 本模块只裁决，动作由场景 / HUD 各自执行。
 */

/** 一次键击的归属。 */
export type KeyboardOwner =
  /** 仪式在演 —— 这次输入被仪式吃掉（跳过仪式）。 */
  | 'ceremony'
  /** 有输入焦点 —— 画布让路（打字 / ESC 不触发画布行为）。 */
  | 'input'
  /** 画布自己的键位（ESC = 镜头归位）。 */
  | 'canvas';

/** 裁决所需的两个事实。 */
export interface KeyboardPriorityInput {
  /** 仪式在不在演（副本进场仪式）。 */
  readonly ceremonyPlaying: boolean;
  /** 有没有输入焦点（聊天框 / 命令行 / contenteditable 持焦）。 */
  readonly inputFocused: boolean;
}

/**
 * 裁决一次键击归谁。
 *
 * why 仪式排在最前：仪式是**整次吞掉输入**的演出（task_187「任意输入即跳到末态」）——
 *   仪式在演时，这一次键击根本轮不到「让不让路」再问。
 * why 输入焦点排在画布之前：用户在聊天框打字时，画布的 ESC 不该把镜头拽走
 *   （design §3 C-04：聊天框聚焦 vs 画布键盘）。
 */
export function resolveKeyboardOwner(input: KeyboardPriorityInput): KeyboardOwner {
  if (input.ceremonyPlaying) return 'ceremony';
  if (input.inputFocused) return 'input';
  return 'canvas';
}
