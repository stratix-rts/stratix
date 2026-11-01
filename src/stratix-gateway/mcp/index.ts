/**
 * 文件职责：MCP 模块的公共出口（barrel）—— 工具面、协议层、传输层、数据面端口一处取齐。
 * 输入：无（只做再导出）。
 * 输出：gateway 装配与 stdio 入口所需的全部公开 API。
 * 禁止事项：
 *   1. 在本文件里写逻辑 —— 它只是出口；
 *   2. 导出内部实现细节（私有辅助函数）—— 出口面越宽，越容易长出旁路调用。
 */

export * from './types';
export * from './envelope';
export * from './registry';
export * from './context';
export * from './server';
export * from './transport/stdio';
export * from './transport/http';
export { worldSnapshotTool } from './tools/world';
export { taskAssignTool, taskStatusTool } from './tools/task';
