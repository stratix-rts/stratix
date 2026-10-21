/**
 * 文件职责：core/agent-link 统一出口 —— 对外只认这一个文件。
 * 输入/输出：见各子模块。
 * 禁止事项：
 *   1. 让上层跨层 import 子文件（hud/world 只认本出口，否则模块边界形同虚设）；
 *   2. 在本文件写逻辑 —— 出口只做再导出。
 *
 * 分层（自下而上）：protocol（编解码） → transport（端口）→ gateway-transport（真实 IO）
 *        → session（单会话状态机）→ manager（多会话 + 状态投影）。
 */

export * from './types';
export * from './protocol';
export * from './transport';
export * from './session';
export * from './manager';
// 真实 IO 实现：hud/world 不该直接用（浏览器缺 fetch 兜底时构造即抛），Node 侧与冒烟脚本从这里取
export * from './gateway-transport';