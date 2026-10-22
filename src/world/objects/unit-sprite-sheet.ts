/**
 * 文件职责：单位形象精灵表的**几何与命名**（纯函数，零 DOM、零 Phaser —— 可直接单测）。
 *   任务：.long-run-agent/tasks/task_029.md。
 * 输入：角色 id / 方向行号 / 帧列号。
 * 输出：纹理 key、帧名、精灵带尺寸、动画参数。
 * 禁止事项：
 *   1. import phaser —— 本文件只算数字与字符串（渲染在 unit-layer.ts）；
 *   2. 自己写一份走路帧序列 —— 帧序的事实源是 world/appearance/constants 的 ANIMATION_CONFIGS；
 *   3. 硬编码 64 / 13 这类几何 —— 同样取自 constants（FRAME_SIZE 等）。
 *
 * ★ 帧序为什么沿用 LPC 的 cycle 表：
 *   LPC 的走路动画是"8 帧但每帧停留时间不同"的固定序列（ANIMATION_CONFIGS.walk.cycle），
 *   照抄它脚步节奏才对；自己另编一套序列会让同一份素材在预览与战场长得不一样。
 */

import { ANIMATION_CONFIGS, FRAME_SIZE } from '../appearance/constants';

/** 纹理 key 前缀（角色 id 拼在后面 —— 纹理缓存按角色 id 走，见 unit-layer.ts）。 */
export const UNIT_SHEET_TEXTURE_PREFIX = 'strat-unit-sheet:';

/**
 * 单位形象精灵表的纹理 key。
 * @param characterId 角色 id。
 */
export function unitSheetTextureKey(characterId: string): string {
  return `${UNIT_SHEET_TEXTURE_PREFIX}${characterId}`;
}

/** 单位朝向（行号）：0=上 1=左 2=下 3=右。单位尚未移动，先固定朝下。 */
export const UNIT_WALK_DIRECTION = 2;

/** 走路帧列序（取自 LPC 的 cycle 表，见文件头说明）。 */
export const UNIT_WALK_CYCLE: readonly number[] = Object.freeze([
  ...ANIMATION_CONFIGS.walk.cycle,
]);

/** 精灵带里用到的列数（cycle 里最大列号 + 1 —— 不用整张表的 13 列，省显存）。 */
export const UNIT_SHEET_COLUMNS = Math.max(...UNIT_WALK_CYCLE) + 1;

/** 精灵带单帧边长（LPC 一格 64×64）。 */
export const UNIT_FRAME_SIZE = FRAME_SIZE;

/** 方向行数（上下左右 4 行）。 */
export const UNIT_SHEET_ROWS = 4;

/** 走路动画播放帧率（每秒帧数）。 */
export const UNIT_WALK_FPS = 8;

/**
 * 精灵缩放（LPC 单帧 64×64 太大，单位视觉直径约 32px）。
 * why 0.8：64 × 0.8 = 51px 的画框里角色本体约 40px，与占位圆（直径 32px）同一量级。
 */
export const UNIT_SPRITE_SCALE = 0.8;

/**
 * 精灵带的**缓存张数上限**（perf 硬约束：纹理不许无限增长）。
 * 每张 9 列 × 4 行 × 64px ≈ 576×256 ≈ 0.6MB；24 张约 14MB —— 有界且够用。
 * 超过上限时淘汰最久未用的一张（该角色的单位回落到占位形体，直到下一次广播重试）。
 */
export const MAX_UNIT_SHEET_TEXTURES = 24;

/**
 * 帧名（Phaser 纹理帧的键）：`方向-列号`，如 '2-3'。
 * @param direction 方向行号（0=上 1=左 2=下 3=右）。
 * @param column 帧列号（LPC 精灵表里的列）。
 */
export function unitFrameName(direction: number, column: number): string {
  return `${direction}-${column}`;
}

/**
 * 单位要不要形象精灵 —— **纯判定**（渲染层据此决定"贴精灵"还是"留占位圆"）。
 *
 * why 两个条件都要：光有外观没有角色 id，纹理 key 就没处放（key 按角色 id 走）；
 * 光有角色 id 没有外观 → 没东西可画（宁缺毋滥）。
 *
 * @param appearance 单位带的外观（没有 → null）。
 * @param characterId 单位关联的角色 id（没有 → null）。
 * @returns 纹理 key；null = 该单位走占位形体。
 */
export function resolveUnitSheetKey(
  appearance: { readonly bodyType: string } | null | undefined,
  characterId: string | null | undefined
): string | null {
  if (!appearance || !characterId) return null;
  return unitSheetTextureKey(characterId);
}
