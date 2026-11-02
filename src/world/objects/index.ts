/**
 * 文件职责：world/objects 目录的统一出口。
 * 输入/输出：见 unit-object.ts / unit-registry.ts / unit-layer.ts / selection-box.ts / task-fx*.ts /
 *   ground-layout.ts / ground-layer.ts / task-building.ts / building-layer.ts（task_078 地面与建筑）。
 * 禁止事项：
 *   1. import hud / vue / legacy(stratix-rts) —— 铁律：world 只认识 core/types；
 *   2. 在此 barrel 里塞 hud 或 core 的转发 —— 同上，跨层引用只允许出现在 bridge/。
 *
 * ⚠️ 本 barrel 会连带拉入 Phaser（unit-layer / selection-box / task-fx-layer / ground-layer /
 *   building-layer）。
 *   纯逻辑单测请直接从 ./unit-object、./unit-registry、./task-fx、./ground-layout、./task-building
 *   导入，不要经过此文件，否则 node 环境下 import phaser 会直接失败。
 */

export * from './unit-object';
export * from './unit-registry';
export * from './unit-layer';
export * from './unit-sprite-source';
export * from './unit-sprite-sheet';
export * from './selection-box';
export * from './task-fx';
export * from './task-fx-layer';
export * from './ground-layout';
export * from './ground-layer';
export * from './task-building';
export * from './building-layer';
