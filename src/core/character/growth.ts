/**
 * 文件职责：角色成长数值（等级 / 经验）—— **纯函数**，是「一个角色此刻该是几级、离下一级还差多少、
 *   加一次经验之后会变成什么」的唯一裁决点。
 *   数值模型来源：src/stratix-character-creator/core/SharedSkillStore.ts（**只提炼语义，未搬运任何实现**）：
 *   旧模型是「每 EXP_PER_LEVEL 点经验升 1 级、等级封顶 MAX_LEVEL、经验只增不减（封顶后仍继续累计）」。
 *   来源：docs/REFACTOR_PLAN_V3.md §2「character/growth.ts —— 参考现 SharedSkillStore，改为角色级；技能树不迁移」
 *        + D3「角色提示词保留；技能树砍；数值系统保留」。
 * 输入：CharacterView（角色档案 + 成长数值）+ 一个经验增量。
 * 输出：新的 CharacterView 与本次变更的明细（加了多少经验、升了几级、是否实质变更 / 被拒原因）。
 * 禁止事项：
 *   1. 碰 store / bus / DOM —— 本文件只算数值，写库在 manager.ts，渲染在 hud/screens/；
 *   2. 直接修改传入的 character —— 角色态是 immutable，返回新对象；
 *   3. 抛异常 —— 命令总线是同步的，抛异常会打断整轮广播；失败一律用 error 码返回，由上层转 Notice；
 *   4. 改 EXP_PER_LEVEL / MAX_LEVEL 时不告知 hud —— 这两个数是进度条的分母，hud/screens/character-catalog
 *      直接 import 本文件的纯函数渲染（不另抄一份阈值，两处必然漂移）；
 *   5. 引入技能树 —— 技能树已砍（D3），本文件只管角色级 level / experience。
 *
 * ★ 等级是**派生量**：level 恒等于 levelForExperience(experience)，不是独立真相。
 *   why：契约里 level 与 experience 并列（CharacterView），但旧模型本来就是拿经验除出来的
 *   （SharedSkillStore.addExperience 每加一次经验就重算等级）。若允许两者各写各的，
 *   「level=5 / exp=10」这种自相矛盾的档案就会长期留在状态里。
 *   代价是：外部构造出的不一致档案在**下一次 grantExperience 时被对账修正**（见 transition.levelUps 说明）。
 */

import type { CharacterView } from '../types';

/** 每升一级所需经验。旧 SharedSkillStore 里写死 100，这里把它变成可被两侧引用的具名常量。 */
export const EXP_PER_LEVEL = 100;

/**
 * 等级上限。旧模型封顶 5 级 —— 养成曲线的最终形态还没设计（见 docs 的 TODO(v3.x) 养成感设计），
 * 先沿用旧上限，避免 v3 一上线就改变玩家已积累的等级语义。
 * TODO(v3.x): 养成曲线落地时改这里 + character-catalog 的进度条满级态，两处自动跟随（都 import 本常量）。
 */
export const MAX_LEVEL = 5;

/** 本次加经验被拒的机器可读原因。HUD / 单测据此分流，不解析错误字符串。 */
export type GrowthErrorCode =
  /** 增量非法：非有限数（NaN / Infinity）或 ≤ 0。经验只增不减，减法不是"扣经验"而是另一套语义。 */
  | 'invalid-amount';

export interface GrowthTransition {
  /** 变更后的角色；被拒时是**原引用**（调用方据此判定"没变"，不必自己判 error）。 */
  readonly next: CharacterView;
  readonly changed: boolean;
  /** 实际加上的经验（被拒为 0）。 */
  readonly gained: number;
  /**
   * 本次跨越的级数。被拒为 0；正常路径 ≥ 0。
   * 可能为负：入参角色的 level 与 experience 自相矛盾时（level=5 / exp=10），
   * 一次加经验会把等级**对账**回 1，此时 levelUps = -4。调用方（manager）据此决定要不要发"升级"提示：
   * levelUps > 0 才算升级，降级对账不该惊动用户。
   */
  readonly levelUps: number;
  readonly error?: GrowthErrorCode;
}

/** 满级判定。HUD 的进度条满格态与"距下一级"文案都用它（import 本函数，不另写 level === MAX_LEVEL）。 */
export function isMaxLevel(level: number): boolean {
  return level >= MAX_LEVEL;
}

/**
 * 经验 → 等级。语义与旧 SharedSkillStore 完全一致（每 EXP_PER_LEVEL 升 1 级、封顶 MAX_LEVEL），
 * 额外把非有限数 / 负经验兜到 1 级：脏数据不该把角色渲染成 0 级或 NaN 级。
 */
export function levelForExperience(experience: number): number {
  if (!Number.isFinite(experience) || experience <= 0) return 1;
  return Math.min(MAX_LEVEL, Math.floor(experience / EXP_PER_LEVEL) + 1);
}

/**
 * 当前等级内已积累的经验（进度条已填部分）。
 * 满级时返回 0：封顶后经验继续累计，但"本级进度"已无意义，让它满格比让它假性回零诚实。
 */
export function experienceIntoLevel(experience: number): number {
  if (!Number.isFinite(experience) || experience <= 0) return 0;
  if (levelForExperience(experience) >= MAX_LEVEL) return 0;
  return experience % EXP_PER_LEVEL;
}

/** 距下一级还差多少经验；已满级返回 null（"无可跨越的级"，调用方据此显示「已满级」而不是「还差 0」）。 */
export function experienceToNextLevel(experience: number): number | null {
  if (levelForExperience(experience) >= MAX_LEVEL) return null;
  const into = experienceIntoLevel(experience);
  return EXP_PER_LEVEL - into;
}

/** 被拒：原样返回当前引用 + changed=false，调用方不需要判断"是否变了"。 */
function reject(current: CharacterView, error: GrowthErrorCode): GrowthTransition {
  return { next: current, changed: false, gained: 0, levelUps: 0, error };
}

/**
 * 状态机本体 —— 加一次经验。纯函数、可穷举测试。
 * 语义三条（与旧 SharedSkillStore 对齐）：
 *   1. 经验只增不减，且**封顶后仍继续累计**（只有等级封顶）——累计经验是既成事实，不该被抹掉；
 *   2. 等级恒由经验重算（见文件头「等级是派生量」），入参不一致即对账；
 *   3. 非法增量不抛异常也不改状态，返回 error 码由 manager 转 Notice（"点了没反应"最伤用户）。
 */
export function grantExperience(current: CharacterView, amount: number): GrowthTransition {
  if (!Number.isFinite(amount) || amount <= 0) return reject(current, 'invalid-amount');

  // 基数先兜底：脏档案（experience 为 NaN / 负数）不该把一次加经验变成把 NaN 传播下去。
  const base = Number.isFinite(current.experience) ? Math.max(0, current.experience) : 0;
  const experience = base + amount;
  const level = levelForExperience(experience);
  // 合法增量必改状态（experience 严格增加），故这里一定 changed —— 无需再判一次"有没有变"。
  return {
    next: { ...current, experience, level },
    changed: true,
    gained: amount,
    levelUps: level - current.level,
  };
}