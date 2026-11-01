/**
 * 文件职责：**等级曲线（经验 → 等级）的数值真相源**（task_040）—— 纯函数 + 常量表，
 *   零依赖（不 import 任何其它模块；类型自足）。全仓库只有这里知道「升一级要多少经验」：
 *   core/character/growth 的状态机、hud 的进度条、app 层的 progression-service 全部来这里取数。
 *   来源：.long-run-agent/tasks/task_040.md（L1→L20 封顶、L1→2 需 100、约 ×1.5 递增、
 *   四舍五入到 5 的倍数、最后一档允许溢出展示）。
 * 输入：经验总量（experience，非「本级内经验」）/ 等级。
 * 输出：EXP_TABLE（等级 → 跨级跨度）、MAX_LEVEL、totalExpForLevel / expSpanForLevel /
 *   levelForExperience / experienceIntoLevel / experienceToNextLevel / levelUpCheck。
 * 禁止事项：
 *   1. import 任何模块（core progression 铁律：零依赖纯函数 —— 数值表不许认识 CharacterView、
 *      store、bus；那是 growth（状态机）与 app 层（编排）的事）；
 *   2. 在这里写「经验从哪来 / 一次加多少」—— 那是 weights.ts（来源权重）的事；
 *   3. 在这里写「几级解锁什么」—— 那是 unlocks.ts（外观门槛）的事；
 *   4. 表值手抖 —— 生成规则见下，单测（progression.test.ts）用同一公式对拍每一档。
 *
 * ============ 与 core/character/growth 的分工（040 接管前的历史见 growth 文件头）============
 * v3.7-v3.18 期间 growth.ts 自带「每级 100、封顶 5」的线性模型；task_040 起数值**全部**收拢到本模块：
 *   - growth 保留 CharacterView 级状态机（grantExperience / 错误码 / transition），
 *     等级结算委托本模块的 levelUpCheck —— 它仍是「一个角色此刻几级」的裁决点，但**不再拥有数值**；
 *   - hud 的进度条（character-catalog）改为直接 import 本模块 —— 分母按当前等级查表，
 *     不再是全局一个常数（曲线化之后「每级经验」不再是常量）。
 *
 * @since v3.19（task_040）。
 */

/** 等级上限（封顶）。曲线到 L20 为止：等级停在 20，经验继续累计（溢出展示，见 levelUpCheck）。 */
export const MAX_LEVEL = 20;

/**
 * 满级判定（旧 growth 语义随曲线一起迁入）。HUD 的进度条满格态与"距下一级"文案都用它
 * （import 本函数，不另写 level === MAX_LEVEL —— 两处写法必然漂移）。
 */
export function isMaxLevel(level: number): boolean {
  return clampLevel(level) >= MAX_LEVEL;
}

/**
 * 等级曲线表：EXP_TABLE[L] = **从 L 级升到 L+1 级**所需经验（本级跨度，不是累计）。
 * 生成规则（单测按同一公式逐档对拍）：
 *   span(L) = round5(100 × 1.5^(L-1))，round5 = 四舍五入到最近的 5 的倍数。
 *   —— 100, 150, 225, 337.5→340, 506.25→505, …（乘出来是 337.5/338 这类原始值，取整到 340）
 * 前快后慢：L1→2 只要 100（首屏成长反馈快），越往后越贵（L19→20 要 147790，长线目标）。
 * 表里没有 20 的键：20 是封顶，没有「20→21」的跨度（expSpanForLevel(20) 返回 0）。
 * 表值按生成规则展开后**手写为字面量**（不是启动时算出来）：调曲线 = 改这一张表 + 同步改对拍单测。
 */
export const EXP_TABLE: Readonly<Record<number, number>> = {
  1: 100,
  2: 150,
  3: 225,
  4: 340,
  5: 505,
  6: 760,
  7: 1140,
  8: 1710,
  9: 2565,
  10: 3845,
  11: 5765,
  12: 8650,
  13: 12975,
  14: 19460,
  15: 29195,
  16: 43790,
  17: 65685,
  18: 98525,
  19: 147790,
};

/** 到达等级 L 所需的**累计**经验（CUMULATIVE[L]）。模块内由 EXP_TABLE 前缀和展开，不导出真相之外的第二份。 */
const CUMULATIVE: readonly number[] = (() => {
  const sums: number[] = [0, 0]; // CUMULATIVE[0] 占位（无 0 级）、CUMULATIVE[1] = 0（1 级免费）
  for (let level = 2; level <= MAX_LEVEL; level += 1) {
    sums[level] = sums[level - 1]! + (EXP_TABLE[level - 1] as number);
  }
  return sums;
})();

/** 等级夹取到 [1, MAX_LEVEL]（脏输入兜底：非有限数 / 越界一律夹回合法区间，不产 NaN 级）。 */
function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
}

/**
 * 到达等级 level 所需的累计经验（总经验口径）。
 * L1 → 0（新角色免费）；脏输入夹取后按边界档返回（不抛异常 —— 数值查表函数必须全路径安全）。
 */
export function totalExpForLevel(level: number): number {
  return CUMULATIVE[clampLevel(level)] as number;
}

/**
 * 从 level 升到下一级的跨度（EXP_TABLE 查表）。
 * 已封顶（level ≥ MAX_LEVEL）返回 0：「没有下一级」，进度条据此走满格分支，不做除零运算。
 */
export function expSpanForLevel(level: number): number {
  const clamped = clampLevel(level);
  if (clamped >= MAX_LEVEL) return 0;
  return EXP_TABLE[clamped] as number;
}

/**
 * 经验总量 → 等级（等级是派生量：恒等于本函数，见 growth 文件头的旧契约说明，语义不变、曲线换代）。
 * 脏数据兜底与旧版一致：非有限数 / ≤0 → 1 级（脏档案不该渲染成 0 级或 NaN 级）。
 */
export function levelForExperience(experience: number): number {
  if (!Number.isFinite(experience) || experience <= 0) return 1;
  // 表最多 19 档，从高往低找第一个命中的累计阈值 —— 线性扫即可，不值得再建索引。
  for (let level = MAX_LEVEL; level >= 2; level -= 1) {
    if (experience >= (CUMULATIVE[level] as number)) return level;
  }
  return 1;
}

/**
 * 本级内已积累经验（进度条已填部分，总经验 − 到达本级所需累计）。
 * 满级返回 0：封顶后经验继续累计，但「本级进度」已无意义 —— 满格比假性回零诚实（旧语义保留）。
 */
export function experienceIntoLevel(experience: number): number {
  if (!Number.isFinite(experience) || experience <= 0) return 0;
  const level = levelForExperience(experience);
  if (level >= MAX_LEVEL) return 0;
  return experience - (CUMULATIVE[level] as number);
}

/**
 * 距下一级还差多少经验；已满级返回 null（调用方据此显示「已满级」而不是「还差 0」）。
 */
export function experienceToNextLevel(experience: number): number | null {
  if (!Number.isFinite(experience) || experience <= 0) return expSpanForLevel(1);
  const level = levelForExperience(experience);
  if (level >= MAX_LEVEL) return null;
  return (CUMULATIVE[level + 1] as number) - experience;
}

/** levelUpCheck 的结算结果。 */
export interface LevelSettlement {
  /** 结算后等级（= levelForExperience(exp)，封顶 MAX_LEVEL）。 */
  readonly level: number;
  /** 经验原样返回（封顶后仍累计 —— 溢出展示；本函数只结算等级，不改写经验数字）。 */
  readonly exp: number;
  /** 结算后等级**高于**入参等级才为 true：跨多级也算一次 true（一次结算一条升级事件）；
   *  入参 level 比 exp 算出来的还高（脏档案对账降级）为 false —— 降级不算「升级」。 */
  readonly leveledUp: boolean;
}

/**
 * 升级结算（task_040 规格的纯函数）：给定角色当前 level（可能陈旧）与累计后的经验总量，
 * 一次结算出新等级 —— 跨多级只结算一次（leveledUp 单布尔，级差由调用方 `to - from` 表达）。
 * 与 growth.grantExperience 的关系：growth 是 CharacterView 级封装（增量校验 + 不可变投影），
 * 数值结算委托本函数；app 层 progression-service 只编排事件，不重复算数。
 */
export function levelUpCheck(level: number, exp: number): LevelSettlement {
  const settled = levelForExperience(exp);
  const from = clampLevel(level);
  return { level: settled, exp, leveledUp: settled > from };
}
