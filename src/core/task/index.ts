/**
 * 文件职责：core/task 统一出口 —— 对外只认这一个文件。
 * 输入/输出：见 machine.ts（纯状态机）与 manager.ts（store 投影 + 生命周期事件）。
 * 禁止事项：
 *   1. 让上层跨层 import 子文件（hud/world/app 只认本出口，否则模块边界形同虚设）；
 *   2. 在本文件写逻辑 —— 出口只做再导出。
 *
 * 分层：machine（纯函数，判相位）→ manager（写 store + 发 task.* 事件 + 上报 Notice）。
 * transport 执行**不在 core**（零 IO 铁律）：app 层 task-service 订阅 task.queued 出队执行，
 * 经 start/complete/fail 三个口子回报相位。
 *
 * @since v3.16（task_037）。
 */

export * from './machine';
export * from './manager';
