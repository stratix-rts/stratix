/**
 * 文件职责：角色成长**状态机**（等级 / 经验）—— 「给一个 CharacterView 加一次经验，
 *   会变成什么」的唯一裁决点。**只管状态迁移，不管数值**：升一级要多少经验、等级曲线长什么样，
 *   自 task_040 起全部收拢到 core/progression/curve.ts（养成数值的单一真相源）—— 本文件对
 *   累计后的经验做等级结算时**委托** progression 的 levelUpCheck，不再自带曲线。
 *   （v3.7-v3.18 期间本文件自带「每级 100、封顶 5」的线性模型，task_040 换代为 ×1.5 递增曲线
 *   （L1→L20），数值迁移史见 progression/curve.ts 文件头。）
 * 输入：CharacterView（角色档案 + 成长数值）+ 一个经验增量。
 * 输出：新的 CharacterView 与本次变更的明细（加了多少经验、升了几级、是否实质变更 / 被拒原因）。
 * 禁止事项：
 *   1. 碰 store / bus / DOM —— 本文件只算数值，写库在 manager.ts，渲染在 hud/screens/；
 *   2. 直接修改传入的 character —— 角色态是 immutable，返回新对象；
 *   3. 抛异常 —— 命令总线是同步的，抛异常会打断整轮广播；失败一律用 error 码返回，由上层转 Notice；
 *   4. 在这里写曲线数值 —— EXP_TABLE / MAX_LEVEL 在 core/progression/curve.ts，
 *      两处数值必然漂移（hud 的进度条已改从 progression 取分母，见 character-catalog.ts）；
 *   5. 引入技能树 —— 技能树已砍（D3），本文件只管角色级 level / experience。
 *
 * ★ 等级是**派生量**：level 恒等于 progression.levelForExperience(experience)，不是独立真相。
 *   若外部构造出两者矛盾的档案，**下一次 grantExperience 时被对账修正**（levelUps 为负，
 *   见下）。曲线换代后旧档案的等级语义会变（旧线性模型下的 Lv.5 在新曲线下按经验重算）——
 *   对账机制保证它在下一次加经验时自动落到新曲线的正确档位，不需要迁移脚本。
 */

import { levelUpCheck } from '../progression/curve';
import type { CharacterView } from '../types';

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
   * 一次加经验会把等级**对账**回正确档位，此时 levelUps < 0。调用方（manager / progression-service）
   * 据此决定要不要发"升级"广播：levelUps > 0 才算升级，降级对账不该惊动用户。
   */
  readonly levelUps: number;
  readonly error?: GrowthErrorCode;
}

/** 被拒：原样返回当前引用 + changed=false，调用方不需要判断"是否变了"。 */
function reject(current: CharacterView, error: GrowthErrorCode): GrowthTransition {
  return { next: current, changed: false, gained: 0, levelUps: 0, error };
}

/**
 * 状态机本体 —— 加一次经验。纯函数、可穷举测试。
 * 语义三条（曲线换代，语义不变）：
 *   1. 经验只增不减，且**封顶后仍继续累计**（只有等级封顶）——累计经验是既成事实，不该被抹掉；
 *   2. 等级恒由经验按 progression 曲线重算（见文件头「等级是派生量」），入参不一致即对账
 *      （结算细节委托 progression.levelUpCheck：跨多级一次结算）；
 *   3. 非法增量不抛异常也不改状态，返回 error 码由 manager 转 Notice（"点了没反应"最伤用户）。
 */
export function grantExperience(current: CharacterView, amount: number): GrowthTransition {
  if (!Number.isFinite(amount) || amount <= 0) return reject(current, 'invalid-amount');

  // 基数先兜底：脏档案（experience 为 NaN / 负数）不该把一次加经验变成把 NaN 传播下去。
  const base = Number.isFinite(current.experience) ? Math.max(0, current.experience) : 0;
  const experience = base + amount;
  // 等级结算走 progression 的曲线（单一数值真相源）；growth 不自算 —— 两处算必然漂移。
  const settled = levelUpCheck(current.level, experience);
  // 合法增量必改状态（experience 严格增加），故这里一定 changed —— 无需再判一次"有没有变"。
  return {
    next: { ...current, experience, level: settled.level },
    changed: true,
    gained: amount,
    levelUps: settled.level - current.level,
  };
}
