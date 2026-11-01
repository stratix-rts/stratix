/**
 * 文件职责：core/mission 统一出口 —— 对外只认这一个文件。
 * 输入/输出：见 machine.ts（纯状态机）与 manager.ts（store 投影）。
 * 禁止事项：
 *   1. 让上层跨层 import 子文件（hud/world 只认本出口，否则模块边界形同虚设）；
 *   2. 在本文件写逻辑 —— 出口只做再导出。
 *
 * 分层：machine（纯函数，判相位）→ manager（写 store + 上报 Notice）。
 * world/hud 都**不直接**用这两个模块：HUD 只发 HudCommand，任务真相由 core 持有并广播。
 */

export * from './machine';
export * from './manager';