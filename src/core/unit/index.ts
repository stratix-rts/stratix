/**
 * 文件职责：core/unit 单元格的统一出口 —— 选择状态机 + 编组语义 + 编队落位。
 * 输入/输出：见 selection.ts、group.ts 与 formation.ts。
 * 禁止事项：不要在这里 import Phaser / Vue / world / hud；单元内保持零渲染依赖。
 */

export * from './formation';
export * from './group';
export * from './selection';