/**
 * 文件职责：world/camera 目录的统一出口 —— 相机钳制规则 + 相机控制器。
 * 输入/输出：见 camera-math.ts 与 camera-controller.ts。
 * 禁止事项：不要在这里 import Phaser 或 world 的其他目录；camera 模块保持零渲染依赖，
 *   这样它的单测可以在 node 环境跑（testEnvironment: 'node'）。
 */

export * from './camera-math';
export * from './camera-controller';
