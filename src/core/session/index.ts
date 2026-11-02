/**
 * 文件职责：core/session 统一出口 —— 对外只认这一个文件。
 * 输入/输出：见 types.ts（类型契约）与 machine.ts（纯逻辑）/ manager.ts（写 store）。
 * 禁止事项：
 *   1. 让上层跨层 import 子文件（hud/world/app 只认本出口，否则模块边界形同虚设）；
 *   2. 在本文件写逻辑 —— 出口只做再导出。
 *
 * 分层：types（契约）→ machine（纯函数：判相位 / 起名 / 封事件）→ manager（写 store + 上报 Notice）。
 * world/hud 都**不直接**用这三个模块：HUD 只发 HudCommand，会话真相由 core 持有并广播。
 *
 * @since v3.40（task_091）v3.2a S1。
 * @since v3.46（task_100 / v3.2b-B1）追加 context-replay（事件流派生：上下文快照 / 分叉复制）。
 */

export * from './types';
export * from './machine';
export * from './context-replay';
export * from './manager';
