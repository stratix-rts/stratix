/**
 * 文件职责：**外观解锁门槛数据**（task_040）—— 「几级解锁哪些部件类别」的数值真相源，
 *   单文件常量、后续好调（调门槛 = 改这一张表，消费侧全部自动跟随）。
 *   消费者：041 的部件选择器（按角色 level 过滤 + 灰显「Lv.X 解锁」）与随机形象（只从已解锁类别随机）。
 *   本任务只落数据与查询函数，UI 接线归 041。
 * 输入：等级（1..MAX_LEVEL，来自 curve.ts —— unlocks 引用同模块的曲线常量，零外部依赖）。
 * 输出：UNLOCK_KEYS（类别词表）、UNLOCKS（等级 → 新解锁类别）、unlockedCategoriesAt（等级 → 累计可解锁集合）。
 * 禁止事项：
 *   1. import world/appearance —— 词表与 world 的 PART_CATEGORIES **刻意各自单列**（core 不依赖渲染层），
 *      两侧对齐由 world 层单测对拍（src/world/__tests__/progression-unlocks.test.ts）——
 *      world 加了新类别而本表没跟上，那条测试会红；
 *   2. 在这里写「稀有变体具体是哪些素材」—— 本表只有 rare_variants 标记位（开关），
 *      「哪些变体算稀有」归素材元数据（渲染侧）；
 *   3. 一个类别出现在多档 —— 每个类别恰好解锁一次（单测穷举），重复解锁只会让门槛语义含混。
 *
 * ============ 门槛设计（task_040 规格）============
 *   L1  基础：body/head/hair/eyes/ears/facial —— 建档即有的「长相底子」；
 *   L3  服装：torso/legs/feet —— 最先吃到的外观成长；
 *   L5  饰品：hat/backpack；
 *   L8  武装：weapon/shield/cape；
 *   L12 全量补全 + 稀有变体标记位 —— 其余所有类别（nose/arms/hands/neck/shoulders/wrists/quiver/shadow）
 *      一次解锁，连同 rare_variants（此后各部件可出现稀有款）。
 *
 * @since v3.19（task_040）。
 */

import { MAX_LEVEL } from './curve';

/**
 * 解锁键词表（顺序即 UI 展示分组顺序：基础 → 服装 → 饰品 → 武装 → 补全 → 标记位）。
 * 除 rare_variants 外与 world/appearance/constants.ts 的 PART_CATEGORIES 一一对应（对拍单测见文件头）。
 * rare_variants 是**标记位**不是部件类别：它不出现在 CharacterAppearance.parts 的键里，
 * 消费方（041 选择器 / 素材侧）用它门控「稀有变体是否可见」，与具体类别正交。
 */
export const UNLOCK_KEYS = [
  // L1 基础（建档即解锁）
  'body',
  'head',
  'hair',
  'eyes',
  'ears',
  'facial',
  // L3 服装
  'torso',
  'legs',
  'feet',
  // L5 饰品
  'hat',
  'backpack',
  // L8 武装
  'weapon',
  'shield',
  'cape',
  // L12 补全（其余全部类别）
  'nose',
  'arms',
  'hands',
  'neck',
  'shoulders',
  'wrists',
  'quiver',
  'shadow',
  // L12 标记位（非部件类别）
  'rare_variants',
] as const;

/** 解锁键类型。 */
export type UnlockKey = (typeof UNLOCK_KEYS)[number];

/** 等级 → 该级**新**解锁的键（不是累计集 —— 累计查询用 unlockedCategoriesAt）。 */
export const UNLOCKS: Readonly<Record<number, readonly UnlockKey[]>> = {
  1: ['body', 'head', 'hair', 'eyes', 'ears', 'facial'],
  3: ['torso', 'legs', 'feet'],
  5: ['hat', 'backpack'],
  8: ['weapon', 'shield', 'cape'],
  12: ['nose', 'arms', 'hands', 'neck', 'shoulders', 'wrists', 'quiver', 'shadow', 'rare_variants'],
};

/** 门槛等级升序列表（UNLOCKS 的键排序快照 —— unlockedCategoriesAt 按它累加，顺序稳定可测）。 */
const UNLOCK_LEVELS: readonly number[] = Object.keys(UNLOCKS)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * 查询：等级 → 累计已解锁的键集合（含该级当档）。
 * 顺序稳定：按门槛等级升序、同档按 UNLOCKS 列出的顺序 —— 041 的 UI 直接拿去渲染分组，不必再排。
 * 脏输入兜底：level < 1 按 1（L1 基础是建档底子，不存在「一级都没解锁」的角色）；
 * 超过 MAX_LEVEL 按 MAX_LEVEL（封顶即全量）。
 */
export function unlockedCategoriesAt(level: number): readonly UnlockKey[] {
  const clamped = !Number.isFinite(level) ? 1 : Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  const unlocked: UnlockKey[] = [];
  for (const threshold of UNLOCK_LEVELS) {
    if (threshold > clamped) break;
    unlocked.push(...(UNLOCKS[threshold] as readonly UnlockKey[]));
  }
  return unlocked;
}
