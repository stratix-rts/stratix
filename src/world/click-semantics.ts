/**
 * 文件职责：画布**点击语义**的纯逻辑（@since v3.3，task_214 / IX-03）。
 *
 * 语义（用户 21:28 原话：「画布点击 agent 是选中事件…双击 agent 是打开单独聊天框」）：
 *   - **单击**单位 = 选中（它是后续操作的锚：右击移动 / 键盘操作都建立在「选中了」之上）；
 *   - **双击**单位 = 打开该 agent 的**单独聊天框**（经 bridge 事件 → core 裁决 → HUD 开框）。
 *
 * 输入：上一次点击的时刻戳（可空）+ 本次点击的时刻戳。
 * 输出：本次点击的动作判定 + 下一击要比对的时刻戳（双击后清空 —— 否则会连成三击）。
 *
 * 禁止事项：
 *   1. import phaser —— 判定必须能在 node 下单测（同 camera/camera-nav 的口径）；
 *   2. 另立一套双击窗口常量 —— 窗口 / 容差一律取 CAMERA_METRICS（唯一事实源，
 *      core/theme/visual-spec.ts）；本模块只做「这一击是什么动作」的判定；
 *   3. 在这里做命中判定 —— 命中在场景侧（world/objects/unit-registry），本模块只看时刻戳；
 *   4. 在这里发事件 / 碰总线 —— 事件由场景经 world/bridge 发（铁律：world 只认识 core 契约）。
 *
 * 语义来源：docs/DESIGN-canvas-interactions.md §2 事件矩阵（P1×O1 / P3×O1 两行）。
 */

import { isDoubleClick, type ClickStamp } from './camera/camera-nav';

/** 一次画布点击的动作语义。 */
export type CanvasClickAction =
  /** 单击：选中（世界层照常发 unit.click —— 选中是右击移动 / 键盘操作的锚）。 */
  | 'select'
  /** 双击：打开该 agent 的单独聊天框（发 unit.chat.open → core 裁决 → HUD 开框）。 */
  | 'chat-open';

/** 一次画布点击的判定结果。 */
export interface CanvasClickDecision {
  /** 这一击的动作。 */
  readonly action: CanvasClickAction;
  /**
   * 下一击要比对的时刻戳；null = 清空（双击之后不再连击判定 ——
   *   连着三击不该被当成「两次双击」，那会让第二次双击又开一次框）。
   */
  readonly nextStamp: ClickStamp | null;
}

/**
 * 判定这一击是「单击选中」还是「双击开聊天框」。
 *
 * why 双击窗口不在这里另立：`isDoubleClick` 的默认参数直接取
 *   `CAMERA_METRICS.doubleClickWindowMs` / `doubleClickSlopPx`（core/theme/visual-spec.ts），
 *   本模块不传参 ⇒ 走的正是那条同源常量（相机双击与画布双击同一窗口）。
 *
 * @param previous 上一次点击的时刻戳（没有则 null）。
 * @param current 本次点击的时刻戳。
 */
export function resolveCanvasClick(
  previous: ClickStamp | null,
  current: ClickStamp
): CanvasClickDecision {
  if (isDoubleClick(previous, current)) {
    return { action: 'chat-open', nextStamp: null };
  }
  return { action: 'select', nextStamp: current };
}
