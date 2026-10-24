/**
 * 文件职责：**外观解锁的 HUD 消费面**（纯逻辑，零 DOM，task_041）—— 把 core/progression
 *   的解锁门槛数据（unlocks.ts，task_040）翻译成形象编辑路径的三件事：
 *     ① 选择器过滤：某角色等级下哪些部位类别可编辑、未解锁的灰显并标「Lv.X 解锁」角标；
 *     ② 重随机受限：编辑路径的「重随机」只把 roll 结果里**已解锁类别**的部位并入草稿，
 *        未解锁类别保留草稿现值（向导路径不受限，保持 032 现状 —— 见下方口径说明）；
 *     ③ 升级 toast 文案：「XX 升到 Lv.X！」，跨过解锁门槛才追加「解锁新外观部件」。
 * 输入：角色 level、CharacterAppearance（草稿 / roll 结果）、（toast 用）角色名与前后等级。
 * 输出：解锁判定 / 角标文案 / 合并后的新草稿 / toast 文案 —— 全部纯函数，单测不打桩。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染归 character-screen.ts；
 *   2. import world/、core/bus —— 铁律；core/progression 的**纯函数与常量**是唯一例外
 *      （与 character-catalog 同一口径：门槛数据只有 unlocks.ts 一份真相，HUD 不复制表）；
 *   3. 在这里改解锁门槛 / 算等级 —— 数值真相在 core/progression，本文件只做「翻译」；
 *   4. 隐藏未解锁类别 —— 角标口径是灰显不是藏（用户得知道等级提升有外观收益）。
 *
 * ★ 向导路径 vs 编辑路径（写在这里免得后来者把两条路径接混）：
 *   - 向导（onboarding-screen）是**创建前**：角色尚无等级，新角色即 L1，不受解锁约束 ——
 *     032 的部件选择器 / 重随机原样不动（全类别、normal 档整套替换）；
 *   - 编辑（character-screen 的形象编辑面板）是**创建后**：按角色 level 过滤 + 受限重随机。
 *
 * ★ 重随机口径（需求②「只从未解锁清单外的类别随机」的实现取舍）：
 *   roll（port.randomizeNormal 的 normal 档结果）天然覆盖全类别 —— 本文件按等级把 roll
 *   裁成「已解锁类别子集」并入草稿：未解锁类别保留草稿现值（老形象里来自向导的高等级
 *   部位不会被一次重随机抹掉）；roll 里未提供的已解锁类别（normal 档可选部位 50% 留空的
 *   那批）同样**不删除**草稿现值 —— 「随机没抽到」与「用户不想要」是两回事，删部位是
 *   显式编辑（选择器）的事。体型（bodyType）跟随 roll：body 是 L1 类别，永远已解锁，
 *   体型属于「重新随机长相」的一部分。
 *
 * ★ 随机器三档与 UNLOCKS 的交集行为（task_041 规格要求注明）：
 *   appearance-randomizer 的 skip 清单是**质感规则**（minimal 档的「平民脸不穿甲」），
 *   与解锁门槛**正交**：MINIMAL_SKIP_CATEGORIES 与本表类别有交集（cape / backpack /
 *   neck / shoulders / hat / quiver / shield / weapon / facial），即 minimal 档会跳过某些
 *   L1 就解锁的类别（facial）—— 那是「随机出不长胡子的人」，不是「不能留胡子」；
 *   反过来 normal/full 档会随机到高等级类别（L8 的 shield 等）—— 向导路径（创建前）
 *   这是合法的，编辑路径靠本文件的 merge 把未解锁类别裁掉。两套规则各自独立成立，
 *   不在本文件合并成一份清单。
 *
 * ★ rare_variants 标记位：它不是部件类别（不出现在 CharacterAppearance.parts 键里），
 *   选择器按类别过滤时天然不涉及；「哪些变体算稀有」归素材元数据（渲染侧），本文件不判。
 *
 * @since v3.20（task_041）。依赖：core/progression/unlocks（task_040 的门槛数据）。
 */

import { newlyUnlockedBetween, unlockLevelOf } from '../../core/progression';
import type { AppearancePartValue, CharacterAppearance } from '../../core/types';

/** 未解锁类别的角标文案（例「Lv.3 解锁」）。已解锁 / 无门槛的类别返回 null（渲染层不画角标）。 */
export function lockedCategoryBadge(category: string, level: number): string | null {
  const threshold = unlockLevelOf(category);
  if (threshold === null || level >= threshold) return null;
  return `Lv.${threshold} 解锁`;
}

/** 某类别在该等级下是否可编辑。无门槛的类别（词表外，防御漂移）一律放行。 */
export function isAppearanceCategoryUnlocked(category: string, level: number): boolean {
  return lockedCategoryBadge(category, level) === null;
}

/**
 * 编辑路径的受限重随机：把 roll 结果按等级裁成已解锁子集，覆盖进 current。
 * 未解锁类别保留 current 现值；roll 里没有的已解锁类别也不删 current 现值（见文件头口径）。
 * 返回新对象（immutable），current 不被修改。
 */
export function mergeUnlockedRoll(
  current: CharacterAppearance,
  roll: CharacterAppearance,
  level: number
): CharacterAppearance {
  // current 先铺底：未解锁类别 + roll 未提供的类别都保持现状。
  const parts: Record<string, AppearancePartValue> = { ...current.parts };
  for (const [category, value] of Object.entries(roll.parts)) {
    if (!isAppearanceCategoryUnlocked(category, level)) continue;
    parts[category] = value;
  }
  return { bodyType: roll.bodyType, parts };
}

/**
 * 升级 toast 文案（task_041 需求③）。
 * 基础句「{name} 升到 Lv.{to}！」；from（不含）→ to（含）之间跨过了解锁门槛
 * （newlyUnlockedBetween 非空，含 rare_variants 标记位）才追加「解锁新外观部件」。
 * 门槛裁决在 core/progression —— 本函数只拼文案，不重复算数。
 */
export function levelUpToastText(name: string, fromLevel: number, toLevel: number): string {
  const base = `${name} 升到 Lv.${toLevel}！`;
  return newlyUnlockedBetween(fromLevel, toLevel).length > 0 ? `${base}解锁新外观部件` : base;
}
