/**
 * 文件职责：角色档案的**构造面**（纯函数）—— 「起一个 agent 角色」这件事的合法性裁决点：
 *   名字 / agent 种类 / 皮肤 id / 人设提示词的校验与规范化全部集中在这里，
 *   manager 只做「落库 + 报错」，纯函数与单测共用同一份「什么算合法档案」。
 *   来源：.long-run-agent/tasks/task_021.md（AgentProfile 模型 + character.create 命令）
 *        + docs/AGENT-MATRIX.md（本地 CLI agent 词表 / externalSessionId 原样透传）。
 * 输入：一份「建档意图」（id 由调用方给，其余字段按 unknown 收 —— HUD 是运行时边界，类型系统拦不住脏值）。
 * 输出：AgentProfile（可落库的完整档案）或结构化错误码（**不抛异常**）。
 * 禁止事项：
 *   1. 碰 store / bus / DOM —— 本文件只算档案，写库在 manager.ts，渲染在 hud/screens/；
 *   2. 抛异常 —— 命令总线是同步的，抛异常会打断整轮广播；失败一律用错误码返回，由上层转 Notice；
 *   3. 判「同名冲突」 —— 那要看状态（store），是 manager 的职责；本文件只管**单个档案本身**合不合法；
 *   4. 随机分配皮肤 —— 皮肤由调用方传入（引导屏负责随机 / 换肤），本文件不猜；
 *   5. 另判一套 persona 合法性 —— persona 的类型 / 长度口径在 persona.ts，本文件只调它。
 *
 * 分层：profile（纯函数，算档案） → manager（写 store + 上报 Notice）。
 *   与 growth / persona 同属"一个域只一份真相"的老规矩：数值在 growth.ts、提示词在 persona.ts、
 *   建档合法性在本文件，三处口径互不重叠。
 */

import {
  APPEARANCE_BODY_TYPES,
  MAX_APPEARANCE_ITEM_ID_LEN,
  MAX_APPEARANCE_PARTS,
  MAX_APPEARANCE_VARIANT_LEN,
  MAX_CHARACTER_NAME_LEN,
  MAX_EXTERNAL_SESSION_ID_LEN,
  MAX_SKIN_ID_LEN,
  isAppearancePartSelection,
  isBindableAgentKind,
  type AgentKind,
  type AgentProfile,
  type AppearanceBodyType,
  type AppearancePartValue,
  type CharacterAppearance,
  type CharacterView,
} from '../types';

import { normalizePersonaPrompt, type PersonaErrorCode } from './persona';

/**
 * 默认人设模板。空 persona 时套它（不是拒发）。
 * why 允许空：首启引导是"先起名、回头再调人设"的渐进流程，
 * 建档这一步若因为人设没写就整条拒掉，用户会卡在第一步；
 * 拒发留给"写了但写得不对"（非字符串 / 超长）—— 那是真错误，该让人看见。
 */
export const DEFAULT_PERSONA_TEMPLATE = [
  '你是一名在 Stratix 工作台里干活的本地 coding agent：',
  '先读懂上下文与既有约定再动手，改动保持最小、不越界；',
  '不确定时先说清不确定在哪，而不是猜一个结论；',
  '完成后自检，并如实汇报做了什么、验证到哪一步。',
].join('\n');

/** 建档被拒的机器可读原因。manager 据此决定 Notice 文案，不解析字符串。 */
export type ProfileErrorCode =
  /** 名字 trim 后为空（或不是字符串）。 */
  | 'empty-name'
  /** 名字超过 MAX_CHARACTER_NAME_LEN 码点。 */
  | 'name-too-long'
  /** agentKind 不在词表内（内置五家 AGENT_KINDS 或 `custom:<id>` 形态之外，见 task_056）。 */
  | 'unknown-agent-kind'
  /** skinId 不是非空字符串，或超长。 */
  | 'invalid-skin-id'
  /** externalSessionId 不是非空字符串，或超长。 */
  | 'invalid-session-id'
  /** 外观（@since v3.10）不是合法形状：体型不在词表内 / 部位字典非法 / 条数或长度超限。 */
  | 'invalid-appearance'
  /** persona 的类型 / 长度问题（口径来自 persona.ts）。 */
  | PersonaErrorCode;

export interface AgentProfileInput {
  /** 角色 id：由调用方（manager）生成，本文件不生成、不校验。 */
  readonly id: string;
  readonly name: unknown;
  readonly agentKind: unknown;
  readonly skinId: unknown;
  readonly persona?: unknown;
  readonly externalSessionId?: unknown;
  /** 外观（@since v3.10）：缺省 / null = 无外观（老档案照旧合法，不补默认长相）。 */
  readonly appearance?: unknown;
}

export type ProfileResult =
  | { readonly ok: true; readonly profile: AgentProfile }
  | { readonly ok: false; readonly code: ProfileErrorCode };

/**
 * 码点长度（不是 UTF-16 code unit）：用户心里的"24 字"是 24 个汉字 / 字母，
 * 用 code unit 会让 emoji / 生僻字提前被截（一个 emoji 就是 2 个 code unit）。
 */
function codePointLength(s: string): number {
  return Array.from(s).length;
}

/** agentKind 合法性：内置五家词表（AGENT_KINDS）或形状合法的自定义段（`custom:<id>`，task_056）。 */
function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && isBindableAgentKind(value);
}

/**
 * 构造一份 agent 档案（纯函数、可穷举测试）。
 * 语义五条：
 *   1. 名字：trim 后非空、≤ MAX_CHARACTER_NAME_LEN 码点；存档用 trim 后的版本；
 *   2. agentKind：内置五家词表（AGENT_KINDS）或形状合法的自定义段（`custom:<id>`，task_056）；
 *   3. skinId：trim 后的非空资源键（core 不解析资源是否存在 —— 那是渲染侧的事）；
 *   4. persona：缺省 / null / 空串 / 纯空白 → 套 DEFAULT_PERSONA_TEMPLATE；
 *      其余走 persona.ts 的既有校验（类型 / 长度口径与改写 persona 时完全一致）；
 *   5. externalSessionId：缺省 / null → null；给了就必须是非空字符串且不超长；
 *   6. appearance（@since v3.10）：缺省 / null → 档案不带外观（老档案照旧合法）；
 *      给了就按 resolveAppearance 的四条校验逐项判，给了但非法 → 拒发。
 * 被拒一律返回错误码，**不抛异常**（命令总线是同步的）。
 */
export function createAgentProfile(input: AgentProfileInput): ProfileResult {
  // —— 名字 ——
  if (typeof input.name !== 'string') return { ok: false, code: 'empty-name' };
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, code: 'empty-name' };
  if (codePointLength(name) > MAX_CHARACTER_NAME_LEN) return { ok: false, code: 'name-too-long' };

  // —— agent 种类 ——
  if (!isAgentKind(input.agentKind)) return { ok: false, code: 'unknown-agent-kind' };

  // —— 皮肤资源键 ——
  if (typeof input.skinId !== 'string') return { ok: false, code: 'invalid-skin-id' };
  const skinId = input.skinId.trim();
  if (skinId.length === 0 || skinId.length > MAX_SKIN_ID_LEN) {
    return { ok: false, code: 'invalid-skin-id' };
  }

  // —— 人设提示词 ——
  const persona = resolvePersona(input.persona);
  if ('error' in persona) return { ok: false, code: persona.error };

  // —— 外部会话 id（各 CLI 原样透传） ——
  const externalSessionId = resolveExternalSessionId(input.externalSessionId);
  if ('error' in externalSessionId) return { ok: false, code: 'invalid-session-id' };

  // —— 外观（@since v3.10，可选） ——
  const appearance = resolveAppearance(input.appearance);
  if ('error' in appearance) return { ok: false, code: 'invalid-appearance' };

  return {
    ok: true,
    profile: {
      id: input.id,
      agentKind: input.agentKind,
      displayName: name,
      skinId,
      persona: persona.prompt,
      level: 1,
      exp: 0,
      externalSessionId: externalSessionId.sessionId,
      // 只有真给了外观才带上这个键：老档案的投影形状保持原样（不凭空多一个 undefined 字段）。
      ...(appearance.appearance ? { appearance: appearance.appearance } : {}),
    },
  };
}

/**
 * persona 归一：空 → 默认模板；非空 → 走 persona.ts 的既有校验。
 * why 空不拒发：引导流程允许"先建档、回头再调人设"（见 DEFAULT_PERSONA_TEMPLATE 注释）。
 */
function resolvePersona(raw: unknown): { prompt: string } | { error: PersonaErrorCode } {
  if (raw === undefined || raw === null) return { prompt: DEFAULT_PERSONA_TEMPLATE };
  if (typeof raw !== 'string') return { error: 'not-a-string' };
  if (raw.trim().length === 0) return { prompt: DEFAULT_PERSONA_TEMPLATE };
  return normalizePersonaPrompt(raw);
}

/** externalSessionId 归一：缺省 / null → null；给了就必须是长度合规的非空字符串。 */
function resolveExternalSessionId(
  raw: unknown
): { sessionId: string | null } | { error: 'invalid-session-id' } {
  if (raw === undefined || raw === null) return { sessionId: null };
  if (typeof raw !== 'string') return { error: 'invalid-session-id' };
  const sessionId = raw.trim();
  if (sessionId.length === 0) return { sessionId: null };
  if (sessionId.length > MAX_EXTERNAL_SESSION_ID_LEN) return { error: 'invalid-session-id' };
  return { sessionId };
}

/**
 * 外观归一（@since v3.10）：缺省 / null → 无外观（不补默认长相，老档案照旧合法）。
 *
 * 合法性四条：
 *   1. 必须是普通对象（不是数组 / null / 原始值）；
 *   2. bodyType 必须在 APPEARANCE_BODY_TYPES 词表内（词表 = 素材目录事实，见 core/types.ts）；
 *   3. parts 必须是普通对象，条数 ≤ MAX_APPEARANCE_PARTS（随状态广播，必须有界）；
 *   4. 每个部位键与变体值都必须是长度合规的非空字符串。
 *
 * @since v3.11：部位值有两种形态 —— 旧的**纯变体串**（原样保留，不变形）与
 *   新的**精确选择** `{ variant, itemId? }`（itemId 可选；带了就校验长度）。
 *
 * why 校验得这么细：外观直接决定"这个角色长什么样"，写错体型 → 渲染侧找不到素材目录；
 *   部位塞垃圾 → 渲染侧静默不画，用户看不出哪里错。宁可建档时拒发并报明确错误码。
 *   注意 core **不校验素材是否存在**（那是渲染侧资源的事，core 不该碰文件系统 / 网络）。
 */
export function resolveAppearance(
  raw: unknown
): { appearance: CharacterAppearance | null } | { error: ProfileErrorCode } {
  if (raw === undefined || raw === null) return { appearance: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid-appearance' };

  const meta = raw as Record<string, unknown>;

  const bodyType = meta.bodyType;
  if (
    typeof bodyType !== 'string' ||
    !(APPEARANCE_BODY_TYPES as readonly string[]).includes(bodyType)
  ) {
    return { error: 'invalid-appearance' };
  }

  const rawParts = meta.parts;
  if (typeof rawParts !== 'object' || rawParts === null || Array.isArray(rawParts)) {
    return { error: 'invalid-appearance' };
  }
  const entries = Object.entries(rawParts as Record<string, unknown>);
  if (entries.length > MAX_APPEARANCE_PARTS) return { error: 'invalid-appearance' };

  const parts: Record<string, AppearancePartValue> = {};
  for (const [category, value] of entries) {
    if (category.length === 0 || category.length > MAX_APPEARANCE_VARIANT_LEN) {
      return { error: 'invalid-appearance' };
    }

    // —— 旧形态（纯变体串）—— 原样保留为串：存档里的老数据不因模型扩展而变形。
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_APPEARANCE_VARIANT_LEN) {
        return { error: 'invalid-appearance' };
      }
      parts[category] = trimmed;
      continue;
    }

    // —— 新形态（@since v3.11：{ variant, itemId? }）——
    if (!isAppearancePartSelection(value)) return { error: 'invalid-appearance' };
    const variant = value.variant;
    if (typeof variant !== 'string') return { error: 'invalid-appearance' };
    const trimmedVariant = variant.trim();
    if (trimmedVariant.length === 0 || trimmedVariant.length > MAX_APPEARANCE_VARIANT_LEN) {
      return { error: 'invalid-appearance' };
    }
    if (value.itemId === undefined) {
      parts[category] = { variant: trimmedVariant };
      continue;
    }
    if (typeof value.itemId !== 'string') return { error: 'invalid-appearance' };
    const trimmedItemId = value.itemId.trim();
    if (trimmedItemId.length === 0 || trimmedItemId.length > MAX_APPEARANCE_ITEM_ID_LEN) {
      return { error: 'invalid-appearance' };
    }
    parts[category] = { variant: trimmedVariant, itemId: trimmedItemId };
  }

  return { appearance: { bodyType: bodyType as AppearanceBodyType, parts } };
}

/**
 * 同名判定（大小写不敏感、trim 后比较）。
 * why 大小写不敏感：角色名基本是拉丁人名，"Neo" 与 "neo" 在头像列表里是同一个人，
 * 让两份档案并存比拒发更难排查。中文名无大小写，行为一致。
 */
export function isSameCharacterName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * 两份外观是否**语义相等**（体型相同 + 逐部位值相同，@since v3.20 task_041）。
 * why 需要它：manager.updateAppearance 的「与原值一致则不写库不广播」约定需要一个判据 ——
 *   形象编辑面板每次保存都构造新对象，只比引用会把「没实质改动」也当成一次写入广播。
 * 语义比较而不是引用比较：部位值可能是纯变体串或 { variant, itemId }，两种形态各自比内容；
 *   部位条数不同（一边多一个空类别）即不相等。
 */
export function isSameCharacterAppearance(a: CharacterAppearance, b: CharacterAppearance): boolean {
  if (a.bodyType !== b.bodyType) return false;
  const aEntries = Object.entries(a.parts);
  const bEntries = Object.entries(b.parts);
  if (aEntries.length !== bEntries.length) return false;
  const bParts = b.parts as Readonly<Record<string, AppearancePartValue>>;
  for (const [category, aValue] of aEntries) {
    const bValue = bParts[category];
    if (bValue === undefined) return false;
    if (typeof aValue === 'string' || typeof bValue === 'string') {
      if (aValue !== bValue) return false;
      continue;
    }
    // 两个都是 { variant, itemId? } 形态：itemId 未定义与不存在同义。
    if (aValue.variant !== bValue.variant) return false;
    if ((aValue.itemId ?? undefined) !== (bValue.itemId ?? undefined)) return false;
  }
  return true;
}

/** 状态里是否已有同名角色（manager 的重复判定用，纯函数便于单测）。 */
export function hasDuplicateCharacterName(
  characters: readonly CharacterView[],
  name: string
): boolean {
  return characters.some((character) => isSameCharacterName(character.name, name));
}

/**
 * agent 视角投影：CharacterView（状态里的真相）→ AgentProfile（agent 侧词表）。
 * why 是投影而不是两份存储：状态里只存 CharacterView 一份 persona / 等级，
 * 两处各存一份必然漂移（"改了名字没改 displayName"这类 bug 的源头）。
 * 未绑定 agent 的角色 → 返回 null（**不编造** agentKind）。
 */
export function toAgentProfile(character: CharacterView): AgentProfile | null {
  if (!character.agentKind) return null;
  return {
    id: character.id,
    agentKind: character.agentKind,
    displayName: character.name,
    skinId: character.skinId ?? '',
    persona: character.persona,
    level: character.level,
    exp: character.experience,
    externalSessionId: character.externalSessionId ?? null,
    // 同理：角色没外观 → 投影里就不带这个键（老档案的投影形状保持原样）。
    ...(character.appearance ? { appearance: character.appearance } : {}),
  };
}
