/**
 * 文件职责：service 组合根的对外出口 —— 只做再导出。
 * 输入/输出：见 stratix-service.ts（headless 组合根）、task-execution.ts（执行环接线，A2）、
 *   storage.ts（存储归一，A3）。
 * 禁止事项：
 *   1. 在本文件写逻辑 —— 出口只做再导出；
 *   2. 顺带导出渲染层 / app 层的杂项 —— 本出口只暴露 core 装配面与执行环接线面。
 */

export * from './stratix-service';
export * from './task-execution';
export * from './storage';
