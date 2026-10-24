/**
 * 文件职责：角色屏的**视图模型派生**（纯逻辑，零 DOM）—— 把一份 WorldState 派生成
 *   「单选单位的角色详情 + 编组内单位↔角色关联行 + 角色养成总览卡片」，UI 呈现全在 character-screen.ts。
 *   成长阈值（每级经验 / 等级上限）**不复制**：直接 import core/progression 的纯函数与常量
 *   （task_040 起曲线化：每级所需不再是全局常数，分母按当前等级查表）——
 *   HUD 只渲染、不重算数值裁决（与 types.ts UnitCapabilitiesView 的「由 core 计算、HUD 只渲染」同一铁律）。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级（main / settings / character）+ D3（技能树砍、成长数值保留）。
 * 输入：WorldState 快照（只读）。
 * 输出：CharacterScreenModel（渲染用模型）与 characterSignature（渲染判重签名）。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染是 character-screen.ts 的事；
 *   2. import world/、vue、@/stratix-rts、core/bus —— 铁律，HUD 一律经注入的 adapter 收发；
 *   3. 修改 WorldState —— 本文件对 state 只读；
 *   4. 编造数值 —— 契约里没有的量（技能树、养成曲线、经验来源）一律不显示或显示"未提供"，
 *      不拿 level 冒充属性、不编一列假的技能（D3 已砍技能树，见下方技能区说明）；
 *   5. 直接 emitCommand —— 本文件不碰总线。
 *
 * ★ 三段结构与各自的口径（写在这里免得后来者重新猜一套）：
 *   - focus（单选单位的角色详情）：只有**恰好选中 1 个单位**且该单位 characterId 命中 characters 时才有。
 *     未关联 / 找不到角色一律 null —— 屏上写「未关联角色」，不拿别的角色的数据顶上。
 *   - links（编组内单位 ↔ 角色）：按当前选择集逐个解析，**未关联的单位照样列出来**（标「未关联角色」）：
 *     "哪些人还没角色"正是这屏要回答的问题，把它们藏起来等于让用户以为编组已经齐了。
 *   - cards（角色养成总览）：WorldState.characters 的前 MAX_CHARACTER_CARDS 个，
 *     超出的只报数不渲染（perf：派生数据必须有界，见 cardOverflow / linkOverflow）。
 *
 * 技能区说明：契约的 CharacterView 只有 id/name/persona/level/experience（D3 明确砍掉技能树），
 *   所以本屏的"属性列表"就是**契约里真实存在**的那些列：等级、累计经验、本级进度、距下一级、关联单位。
 *   旧 SharedSkillStore 的 learnedSkills / installedSkills 属于旧角色编辑器的本地存储，
 *   不在本轮迁移范围（D3：技能树不迁移），故不渲染、也不假装有。
 */

import {
  experienceIntoLevel,
  experienceToNextLevel,
  expSpanForLevel,
  isMaxLevel,
} from '../../core/progression';
import type { CharacterView, SelectionState, UnitView, WorldState } from '../../core/types';

// ============================================================================
// 容量与阈值（perf 硬约束：派生出来的每一份数据都有界）
// ============================================================================

/** 角色总览最多渲染几张卡。契约里 characters 没有上限常量，本屏自己收一道显示上限并如实报溢出数。 */
export const MAX_CHARACTER_CARDS = 32;

/** 编组关联行最多渲染几条。选择集本身已由 MAX_SELECTION_SIZE 封顶，这里只是显示上限 + 溢出数。 */
export const MAX_CHARACTER_LINKS = 32;

/** 选择形态。与 agent-panel 的 AgentPanelMode 同名同义（编组 = 当前多选集合，见 core/unit/group.ts）。 */
export type CharacterScreenMode = 'empty' | 'single' | 'group';

// ============================================================================
// 成长数值投影
// ============================================================================

/**
 * 一个角色的成长数值投影。所有阈值来自 core/progression（task_040 起的曲线表），HUD 不重算等级：
 *   - percent 是**本级内**进度（0–100 整数），不是"总经验 / 满级所需"（后者在满级后没有上界）；
 *   - toNext 为 null = 已满级（progression 的 experienceToNextLevel 语义），屏上写「已满级」而不是「还差 0」；
 *   - levelSpan 按当前等级查表（曲线化之后每级所需不同；满级为 0 —— 没有下一级）；
 *   - level 原样取 core 广播的值（core/character/growth 保证它与 experience 一致，见该文件「等级是派生量」）。
 */
export interface CharacterGrowthModel {
  readonly level: number;
  readonly experience: number;
  /** 本级内已积累经验（进度条已填）。 */
  readonly intoLevel: number;
  /** 当前等级升下一级所需经验（进度条满格值；满级为 0 —— 没有下一级）。 */
  readonly levelSpan: number;
  /** 距下一级还差多少；满级为 null。 */
  readonly toNext: number | null;
  /** 本级进度 0–100（整数）。 */
  readonly percent: number;
  readonly maxed: boolean;
}

export function resolveGrowth(character: CharacterView): CharacterGrowthModel {
  const level = character.level;
  const intoLevel = experienceIntoLevel(character.experience);
  const maxed = isMaxLevel(level);
  // 分母按当前等级查表（task_040 曲线化：每级所需不同，不再是全局常数 EXP_PER_LEVEL）。
  const levelSpan = expSpanForLevel(level);
  return {
    level,
    experience: character.experience,
    intoLevel,
    levelSpan,
    toNext: experienceToNextLevel(character.experience),
    percent: maxed || levelSpan <= 0 ? 100 : Math.min(100, Math.round((intoLevel / levelSpan) * 100)),
    maxed,
  };
}

// ============================================================================
// 渲染用模型
// ============================================================================

/** 一张角色卡（养成总览与详情位共用同一形状，省掉一份重复结构）。 */
export interface CharacterCardModel {
  readonly id: string;
  readonly name: string;
  /** 角色提示词（契约里的 persona 字符串）。空串即"没写"，屏上不渲染空段。 */
  readonly persona: string;
  readonly growth: CharacterGrowthModel;
  /** 关联到该角色的单位名（按 units 顺序，只取 characterId 命中的）。 */
  readonly linkedUnits: readonly string[];
  /** 是否为当前单选单位关联的角色（详情位据此高亮，总览里点亮的也是它）。 */
  readonly focused: boolean;
}

/** 编组内一个单位 ↔ 角色的关联行。未关联时 character 字段全为 null（屏上写「未关联角色」）。 */
export interface CharacterLinkModel {
  readonly unitId: string;
  readonly unitName: string;
  readonly characterId: string | null;
  readonly characterName: string | null;
  /** 命中时的角色等级；未关联为 null。 */
  readonly level: number | null;
}

export interface CharacterScreenModel {
  readonly mode: CharacterScreenMode;
  /** 抬头文案：说清此刻在看谁（单选=「已选中 1 个单位」，编组=「已选中 N 个单位」，空=提示语）。 */
  readonly summary: string;
  /** 单选单位关联的角色详情；未关联 / 未选中时为 null。 */
  readonly focus: CharacterCardModel | null;
  /** 编组内单位 ↔ 角色关联行（按选择集顺序，未关联的单位也在列）。 */
  readonly links: readonly CharacterLinkModel[];
  /** links 未渲染的部分（>0 才提示"还有 N 个"，避免假装列全了）。 */
  readonly linkOverflow: number;
  /** 全部角色卡片（养成总览）。 */
  readonly cards: readonly CharacterCardModel[];
  /** cards 未渲染的部分（>0 才提示）。 */
  readonly cardOverflow: number;
  /** 编组内未关联角色的单位数（>0 才提示"有 N 个单位还没有角色"）。 */
  readonly unboundUnits: number;
}

/**
 * 本屏只依赖 WorldState 的三个切片。
 * why 单独定这个结构：屏在挂载前 / 单测里常拿到 null 或裁剪过的快照，
 * 用一个最小结构接住，比硬凑一个"缺字段的 WorldState"诚实（也免得各处写 as 断言）。
 */
interface CharacterSource {
  readonly units: readonly UnitView[];
  readonly characters: readonly CharacterView[];
  readonly selection: SelectionState;
}

/** 空快照：屏还没收到任何广播时按它渲染（空态文案），不编数据。 */
const EMPTY_SOURCE: CharacterSource = {
  units: [],
  characters: [],
  selection: { unitIds: [], previewUnitIds: [], revision: 0 },
};

function toSource(state: WorldState | null): CharacterSource {
  return state ?? EMPTY_SOURCE;
}

/** 按 id 建索引：选择集每变一次就要查每个选中单位/角色，重复遍历是白烧 CPU。 */
function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item] as const));
}

/** 一张角色卡：把 character 与 units（找关联单位）拼成渲染模型。 */
function buildCard(
  character: CharacterView,
  units: ReadonlyMap<string, UnitView>,
  focusedCharacterId: string | null
): CharacterCardModel {
  const linkedUnits: string[] = [];
  units.forEach((unit) => {
    if (unit.characterId === character.id) linkedUnits.push(unit.name);
  });
  return {
    id: character.id,
    name: character.name,
    persona: character.persona,
    growth: resolveGrowth(character),
    linkedUnits,
    focused: focusedCharacterId === character.id,
  };
}

/**
 * 解析当前单选单位关联的角色 id。
 * why 不用 previewUnitIds：preview 是框选拖拽过程中的实时集合（松手即归零），
 * 拿它算"当前在看谁"会在松手瞬间把人弹回总览。
 */
function focusedCharacterId(source: CharacterSource): string | null {
  const selected = source.selection.unitIds;
  if (selected.length !== 1) return null;
  const unit = source.units.find((u) => u.id === selected[0]);
  return unit?.characterId ?? null;
}

/** 编组关联行：逐个解析选择集里的单位，未关联的照样列出来（见文件头 links 口径）。 */
function buildLinks(
  source: CharacterSource,
  units: ReadonlyMap<string, UnitView>,
  characters: ReadonlyMap<string, CharacterView>
): { links: CharacterLinkModel[]; overflow: number; unbound: number } {
  const rows: CharacterLinkModel[] = [];
  const seen = new Set<string>();
  let unbound = 0;
  for (const unitId of source.selection.unitIds) {
    if (seen.has(unitId)) continue;
    seen.add(unitId);
    const unit = units.get(unitId);
    const character = unit?.characterId ? characters.get(unit.characterId) : undefined;
    if (!character) unbound += 1;
    rows.push({
      unitId,
      unitName: unit?.name ?? unitId,
      characterId: character?.id ?? null,
      characterName: character?.name ?? null,
      level: character?.level ?? null,
    });
  }
  return {
    links: rows.slice(0, MAX_CHARACTER_LINKS),
    overflow: Math.max(0, rows.length - MAX_CHARACTER_LINKS),
    unbound,
  };
}

export function resolveCharacterModel(state: WorldState | null): CharacterScreenModel {
  const source = toSource(state);
  const units = indexById(source.units);
  const characters = indexById(source.characters);
  const focusId = focusedCharacterId(source);
  const { links, overflow: linkOverflow, unbound } = buildLinks(source, units, characters);
  const focusCharacter = focusId ? characters.get(focusId) : undefined;
  const count = source.selection.unitIds.length;

  return {
    mode: count === 0 ? 'empty' : count === 1 ? 'single' : 'group',
    summary:
      count === 0
        ? '未选中任何单位：下面是全部角色的养成总览'
        : `已选中 ${count} 个单位`,
    focus: focusCharacter ? buildCard(focusCharacter, units, focusId) : null,
    links,
    linkOverflow,
    cards: source.characters.slice(0, MAX_CHARACTER_CARDS).map((c) => buildCard(c, units, focusId)),
    cardOverflow: Math.max(0, source.characters.length - MAX_CHARACTER_CARDS),
    unboundUnits: unbound,
  };
}

/**
 * 渲染判重签名（O(角色数 + 单位数)，纯字符串拼接）。
 * 只含影响本屏显示的东西：选择集、单位↔角色关联、角色 id/等级/经验/**提示词**。
 * persona 进签名是因为它渲染在卡上 —— 只签 id/等级的话，改提示词时本屏会拿着旧签名跳过重绘。
 * 任务相位变动、通知、总线活跃度等一律不触发本屏重渲染（core 每次广播都是全量的）。
 */
export function characterSignature(state: WorldState | null): string {
  const source = toSource(state);
  const links = source.units
    .filter((u) => u.characterId)
    .map((u) => `${u.id}:${u.characterId}`)
    .join(',');
  const selected = source.selection.unitIds.join(',');
  const chars = source.characters
    .map((c) => `${c.id}:${c.level}:${c.experience}:${c.persona}`)
    .join(',');
  return `${selected}|${links}|${chars}`;
}