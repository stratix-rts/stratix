/**
 * 文件职责：world/appearance 目录的统一出口（LPC 角色合成栈）。
 *   任务：.long-run-agent/tasks/task_027.md「复活 LPC 角色合成器」。
 * 输入/输出：见各子文件（constants / types / part-registry / appearance-randomizer /
 *   character-composer / image-cache / part-config / spritesheet-path）。
 * 禁止事项：
 *   1. import hud / core 的状态模块 —— world 只认识 core 的**类型**（appearance 只用到
 *      CharacterAppearance 这一个纯数据类型）；
 *   2. 在此 barrel 里写逻辑 —— 出口只做再导出；
 *   3. 引入 DOM —— 本模块零 DOM：画布与图片对象由 app 层注入
 *      （见 src/app/services/appearance-environment.ts）。
 *
 * 分层：
 *   constants / types（形状） → part-registry（素材元数据 + 路径）+ image-cache（LRU）
 *   → character-composer（合成） → part-config（类别展示配置）。
 */

export * from './constants';
export * from './types';
export * from './part-registry';
export * from './appearance-randomizer';
export * from './image-cache';
export * from './character-composer';
export * from './character-look';
export * from './part-config';
export * from './spritesheet-path';
// 角色烘焙（@since v3.3，task_195 / CP-01）：版本号 + 缓存键 + 整图元数据。
export * from './composer-version';
export * from './bake-cache-key';
export * from './bake-sheet-meta';
