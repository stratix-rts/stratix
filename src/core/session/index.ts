/**
 * 文件职责：core/session 统一出口 —— 对外只认这一个文件。
 * 输入/输出：见 types.ts（类型契约）与 machine.ts（纯逻辑）/ manager.ts（写 store）。
 * 禁止事项：
 *   1. 让上层跨层 import 子文件（hud/world/app 只认本出口，否则模块边界形同虚设）；
 *   2. 在本文件写逻辑 —— 出口只做再导出。
 *
 * 分层：types（契约）→ machine（纯函数：判相位 / 封事件）→ title-provider（起名规则）
 *   → compress（压缩：折叠规划 / 规则摘要 / 读取路由）→ manager（写 store + 上报 Notice）。
 * world/hud 都**不直接**用这几个模块：HUD 只发 HudCommand，会话真相由 core 持有并广播。
 *
 * @since v3.40（task_091）v3.2a S1。
 * @since v3.46（task_100 / v3.2b-B1）追加 context-replay（事件流派生：上下文快照 / 分叉复制）。
 * @since v3.47（task_104 / v3.2b-B5）追加 title-provider（标题端口的默认实现：规则版起名）。
 * @since v3.48（task_106 / v3.2b-B7）追加 compress（长会话压缩：折叠规划 / 规则摘要 / 读取路由）。
 * @since v3.49（task_107 / v3.2b-B8）追加 reference（@会话引用：语法解析 + 注入块拼装）。
 */

export * from './types';
export * from './machine';
export * from './title-provider';
export * from './compress';
export * from './context-replay';
export * from './reference';
export * from './manager';
