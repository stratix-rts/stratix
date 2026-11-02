/**
 * 文件职责：**屏幕空间特效的纯逻辑**（@since v3.3，task_086）—— 报错红光晕的触发判定。
 *   方案来源：docs/DEMO-PLAN.md §7「导演模式」+ 用户验收意见（红框降级为柔和红光晕）。
 * 输入：core 总线的一条 world 事件 + 导演模式开关的当前值。
 * 输出：是否该呼吸一次红光晕（布尔）。
 * 禁止事项：
 *   1. import world / phaser / app —— 铁律：hud 只认识 core；
 *   2. 直接 import core/bus —— 事件订阅归组合根（main-entry），本文件只做纯判定；
 *   3. 持有状态 —— 「导演模式开没开」是 core 的 WorldState.directorEnabled，
 *      由组合根现读后喂进来（组件与本文件都不存一份）。
 *
 * ★ 为什么红光晕只在导演模式亮：
 *   红光的语义是「**导演**注意到 agent 卡住了」—— 那是导演模式的能力提示。
 *   正常模式下报错由跑马灯（红字条目）与音效承担，画面不必再压一层红。
 */

import type { WorldEvent } from '../../../core/types';

/**
 * 是否该为这条事件呼吸一次报错红光晕。
 *
 * @param event core 总线 world 通道上的一条事件。
 * @param directorEnabled 导演模式当前是否开启（core 的 WorldState.directorEnabled）。
 * @returns true = 该呼吸一次（仅 task.failed 且导演模式开启）。
 */
export function errorGlowTrigger(event: WorldEvent, directorEnabled: boolean): boolean {
  if (!directorEnabled) return false;
  return event.type === 'task.failed';
}
