/**
 * 文件职责：右击移动的**编队落位纯函数**（task_045）—— 把「N 个单位 id + 一个目标点」
 *   翻译成每个单位的终点坐标（网格以目标点为中心铺开）。
 * 血缘（v2 考古，同 task_030 移植纪律）：算法移植自 master 分支
 *   stratix-rts/systems/FormationSystem.ts 的 box 编队（calculateFormationPositions('box')）——
 *   cols = ceil(√n)、rows = ceil(n/cols)、网格**以目标点为中心**、间距 spacing=50 原样保留。
 *   v2 对小队的「平移保形」分支（moveGroup：保持当前相对队形整体平移）**刻意不移植**：
 *   它需要读各单位当前坐标，而 core 不持有坐标（UnitView 不含位置，位置真相在世界层）——
 *   core 只知道「有谁」，不知道「他们在哪」。人数 ≤3 的小队同样走网格（1 人 = 目标点本点，
 *   2-3 人 = 一行小横队），视觉无碍且落位确定。
 * ★ 位置立即生效于状态，动画只是渲染过渡：本函数产出的是**终值**；runtime 把终值经
 *   unit.position 逐单位广播，世界层立即写进 UnitObject（状态真相），tween 只负责画面过渡。
 * 输入：单位 id 列表（顺序 = 编队槽位顺序，一般即选择顺序）+ 目标点（世界坐标）。
 * 输出：逐单位终值坐标（FormationSlot[]）。
 * 禁止事项：
 *   1. 任何 IO / 总线 / store —— 纯函数；过滤未知单位与广播在 runtime 的接线层做；
 *   2. 读单位当前坐标 —— core 没有坐标真相（世界层自治，见 types.ts UnitView 注释）；
 *   3. import Phaser / DOM —— core 是依赖图底层。
 *
 * @since v3.21（task_045）。
 */

/** 编队相邻两单位的最小间距（世界坐标 px）。血缘：v2 FormationSystem.calculateFormationPositions 的 spacing=50。 */
export const FORMATION_SPACING = 50;

/** 一个单位的编队落位：单位 id + 终点坐标（世界坐标）。 */
export interface FormationSlot {
  readonly unitId: string;
  readonly x: number;
  readonly y: number;
}

/** 编队落位的目标点最小形状（core/types 的 Point 是 readonly 的，这里收宽不收窄）。 */
export interface FormationTarget {
  readonly x: number;
  readonly y: number;
}

/**
 * 计算编队落位（纯函数，无副作用）：
 *   - 空 → 空数组（runtime 据此零广播）；
 *   - 1 人 → 目标点本点（血缘：v2 moveGroup 的单人分支）；
 *   - N 人 → ceil(√N) 列 × ceil(N/列) 行的网格，**以目标点为中心**（血缘：v2 box 编队），
 *     槽位顺序 = 传入 id 顺序（去重保序），第 i 个单位落在第 ⌊i/cols⌋ 行第 i%cols 列。
 */
export function computeFormationSlots(unitIds: readonly string[], target: FormationTarget): FormationSlot[] {
  const ids = Array.from(new Set(unitIds));
  if (ids.length === 0) return [];
  if (ids.length === 1) return [{ unitId: ids[0], x: target.x, y: target.y }];

  const cols = Math.ceil(Math.sqrt(ids.length));
  const rows = Math.ceil(ids.length / cols);
  // 网格中心对齐目标点：startX/startY 是第一格中心，向右下铺开（v2 box 口径原样）
  const startX = target.x - ((cols - 1) * FORMATION_SPACING) / 2;
  const startY = target.y - ((rows - 1) * FORMATION_SPACING) / 2;

  const slots: FormationSlot[] = [];
  ids.forEach((unitId, index) => {
    slots.push({
      unitId,
      x: startX + (index % cols) * FORMATION_SPACING,
      y: startY + Math.floor(index / cols) * FORMATION_SPACING,
    });
  });
  return slots;
}
