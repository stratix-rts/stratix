/**
 * 文件职责：**角色 → 战场单位**的投影（纯函数）—— 「建了一个角色，战场上就多一个 agent 单位」。
 *   来源：.long-run-agent/tasks/task_026.md「首启触发逻辑 + 全链路联调」；
 *   组织模型依据 docs/REFACTOR_PLAN_V3.md §1「战场上的组织单位是 Agent 单位」（D5：Zone 已砍）。
 * 输入：一份已落库的角色档案（CharacterView）。
 * 输出：一个 UnitView（core 契约里的单位投影，渲染侧据此画单位）。
 * 禁止事项：
 *   1. 碰 store / bus / DOM —— 本文件只算单位长什么样，写库在 manager.ts，渲染在 world/；
 *   2. 自己造位置 —— core 不持有坐标（位置由 world 层自治，见 core/types.ts UnitView 注释）；
 *   3. 编造能力数值 —— 能力评估器尚未落地（core/unit 只有选择 / 编组），power 老实记 0；
 *   4. 引用 hud / world —— core 是依赖图底层。
 *
 * why 投影放在 core（而不是让 world 自己从 characters 造单位）：
 *   单位是**业务实体**（可被指派任务、可被选中、可进编组），真相必须在 core。
 *   若由 world 凭 characters 凭空造单位，那单位只存在于画面里 —— core 不认它，
 *   选中会被对账丢弃，HUD 的单位计数也与画面对不上。故建档时在 core 侧一并投影出单位。
 */

import type { CharacterView, UnitView } from '../types';

/** 角色单位 id 的前缀（与角色 id 一起构成唯一 id，命名空间分开便于排查）。 */
export const CHARACTER_UNIT_ID_PREFIX = 'unit_';

/**
 * 把角色投影成战场单位。
 *
 * 语义：
 *   - id：`unit_<角色 id>` —— 稳定、可回溯到角色（不随广播变化）；
 *   - name：角色名（战场上显示的就是用户起的名字）；
 *   - status：恒为 'idle' —— 角色建档时尚未接入任何任务；
 *   - power：0 —— 能力评估器未落地，不编造数值；
 *   - characterId / skinId：回指角色档案与它的皮肤（渲染侧据此染色）；
 *   - appearance：角色外观（@since v3.10）—— 渲染侧据此合成 LPC 精灵表，
 *     没有外观的单位回落到占位形体；
 *   - level：等级投影（@since v3.37，task_062）—— 战场头顶「Lv 小字」的数据面，
 *     升级时由 manager.grantExperience 在同一次 setState 里刷新（两侧不漂移）。
 *
 * @param character 已落库的角色档案（id / name / skinId / appearance 取自它）。
 */
export function toCharacterUnit(character: CharacterView): UnitView {
  return {
    id: `${CHARACTER_UNIT_ID_PREFIX}${character.id}`,
    name: character.name,
    status: 'idle',
    missionId: null,
    power: 0,
    characterId: character.id,
    skinId: character.skinId ?? null,
    // 老角色没有外观 → null（渲染侧回落到占位形体，不编造长相）。
    appearance: character.appearance ?? null,
    // 等级投影（task_062 名字标签）：老单位 / 非 character 单位缺省 null → 只显名字。
    level: character.level,
  };
}
