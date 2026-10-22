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
  AGENT_KINDS,
  MAX_CHARACTER_NAME_LEN,
  MAX_EXTERNAL_SESSION_ID_LEN,
  MAX_SKIN_ID_LEN,
  type AgentKind,
  type AgentProfile,
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
  /** agentKind 不在 AGENT_KINDS 词表内。 */
  | 'unknown-agent-kind'
  /** skinId 不是非空字符串，或超长。 */
  | 'invalid-skin-id'
  /** externalSessionId 不是非空字符串，或超长。 */
  | 'invalid-session-id'
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

/** agentKind 合法性：只认契约词表内的种类，不认识的（拼错 / 未来新增但未落地）一律拒发。 */
function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value);
}

/**
 * 构造一份 agent 档案（纯函数、可穷举测试）。
 * 语义五条：
 *   1. 名字：trim 后非空、≤ MAX_CHARACTER_NAME_LEN 码点；存档用 trim 后的版本；
 *   2. agentKind：必须在 AGENT_KINDS 词表内；
 *   3. skinId：trim 后的非空资源键（core 不解析资源是否存在 —— 那是渲染侧的事）；
 *   4. persona：缺省 / null / 空串 / 纯空白 → 套 DEFAULT_PERSONA_TEMPLATE；
 *      其余走 persona.ts 的既有校验（类型 / 长度口径与改写 persona 时完全一致）；
 *   5. externalSessionId：缺省 / null → null；给了就必须是非空字符串且不超长。
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
 * 同名判定（大小写不敏感、trim 后比较）。
 * why 大小写不敏感：角色名基本是拉丁人名，"Neo" 与 "neo" 在头像列表里是同一个人，
 * 让两份档案并存比拒发更难排查。中文名无大小写，行为一致。
 */
export function isSameCharacterName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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
  };
}
