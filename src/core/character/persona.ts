/**
 * 文件职责：角色提示词（persona）的**纯函数改写面** ——「给某个角色换提示词」的唯一裁决点，
 *   把 free-text 入参校验 + 写入新档案的逻辑独立成纯函数，便于 manager 与单测共用同一份"什么是合法提示词"。
 *   数值裁决全在 growth.ts（同一域只一份），本文件只管 persona 字符串的合法性。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 character/ 角色域（D3「角色提示词保留」） +
 *        §5 总线契约（character.persona.update）。
 * 输入：CharacterView（要改的角色）+ 新提示词 string。
 * 输出：新的 CharacterView 或「未变/被拒」的结构化结果（manager 据此写库 / 转 Notice）。
 * 禁止事项：
 *   1. 碰 store / bus / DOM —— 本文件只算状态，写库在 manager.ts，渲染在 hud/screens/；
 *   2. 直接修改传入的 character —— 角色态是 immutable，返回新对象；
 *   3. 抛异常 —— 命令总线是同步的，抛异常会打断整轮广播；失败一律用 error 码返回，由上层转 Notice；
 *   4. 静默改写 —— prompt 与原值相同也原样返回原引用，让调用方按"是否实质变更"决定广播。
 *
 * 提示词合法性口径（写在这里免得后人在屏上各写一份校验）：
 *   - null / 非字符串 / 空白字符串 → 拒发（empty）。契约里 persona 是 string，
 *     但 HUD 端会把 textarea 的空串提交上来 —— 空 persona 让 HUD 卡上那段提示词区消失太安静，
 *     转一条 warn Notice 比"点了没反应"好排查；
 *   - 长度 > PERSONA_MAX_LEN → 拒发（too-long）。无上限会让一次广播撑爆（HUD 全量广播，perf 硬约束）。
 *   - 合法：trim 后的字符串（去掉首尾空白；中间换行 / 缩进保留，persona 本就是多行文本）。
 *   - 与原 persona 严格相等 → next 是入参引用、不广播（store「引用未变即不广播」约定）。
 */

import type { CharacterView } from '../types';

/**
 * persona 字符串长度上限（按字符数 UTF-16 code units 计，与 JS string.length 同口径）。
 * why 32000：HUD 全量广播 WorldState，长提示词每次都全量跟着发，
 * 上限参照 Notice.text 的同档量级足以覆盖绝大多数实际 persona；过短会卡死业务，过长则在 HUD 上几乎不可读。
 */
export const PERSONA_MAX_LEN = 32_000;

/** persona 写入被拒的机器可读原因。manager 据此决定 Notice 文案，不解析字符串。 */
export type PersonaErrorCode = 'empty' | 'not-a-string' | 'too-long';

/**
 * @since v3.25（task_049）plan-first 人设的特征标记。人设正文含该短语 → 该角色的任务走
 * 「先出计划，批准后执行」的审批门（app 层 task-service 据此在任务 prompt 尾部追加
 * 计划指令、并在流结束后检测挂起标记）。定义在 core/character：它属于「persona 的语义
 * 裁决」（与 normalizePersonaPrompt 同一层），两路识别共用这一个词：
 *   ① 手写路径：用户在自由文本里写下「先出计划」（如 RULES 分节里手补一行）；
 *   ② 预设路径：persona-presets 的 plan-first 预设把含该标记的一行写进 RULES 节。
 * 选短语而不是结构标记（如某节标题）：自由文本人设没有可靠结构，字符串包含是唯一
 * 对两条路径都成立的稳定判定（与 stratix-agent 的标记节思路同源，但降为短语级）。
 */
export const PERSONA_PLAN_FIRST_MARKER = '先出计划';

/**
 * @since v3.25（task_049）纯函数：persona 是否声明了「先计划后执行」的工作方式。
 * 含 PERSONA_PLAN_FIRST_MARKER 即认定（见上：两路识别共用同一个词）。空串 / 不含 = false。
 * 导出供单测与 app 层 task-service 复用 —— 判定口径只允许这一处。
 */
export function personaPlanFirst(persona: string): boolean {
  return persona.includes(PERSONA_PLAN_FIRST_MARKER);
}

export interface PersonaTransition {
  /** 改写后的角色；被拒 / 无变化时是**原引用**（调用方据此判定"没变"，不必自己判 error）。 */
  readonly next: CharacterView;
  /** 是否产生了实质变更（prompt 与原值不同且合法）。 */
  readonly changed: boolean;
  /** 写入后实际生效的 persona（trim 后的版本；便于 Notice 日志落字一致）。 */
  readonly prompt: string;
  readonly error?: PersonaErrorCode;
}

/** length 计算按 UTF-16 code units（JS string.length），与契约\"string\"一致；不引 polyfill。 */
function codeUnits(s: string): number {
  return s.length;
}

/**
 * 校验 prompt 是否合法；返回 null = 合法 + 已 trim 的字符串；非 null = 错误码。
 *
 * @since v3.7 **导出**给 core/character/profile.ts 复用（建档时的 persona 合法性必须与改写时同口径，
 *   两处各判一次必然漂移：一边放行 40000 字、一边拒发，用户看到的现象是"建档成功但保存失败"）。
 *   注意口径差异只在**调用方**：本函数对空串一律判 'empty'，而建档时空 persona 走默认模板
 *   （那是 profile.ts 的分支，不是本函数的放宽）。
 */
export function normalizePersonaPrompt(raw: unknown): { prompt: string } | { error: PersonaErrorCode } {
  if (typeof raw !== 'string') return { error: 'not-a-string' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { error: 'empty' };
  if (codeUnits(trimmed) > PERSONA_MAX_LEN) return { error: 'too-long' };
  return { prompt: trimmed };
}

/**
 * 状态机本体 —— 改写 persona。纯函数、可穷举测试。
 * 语义两条：
 *   1. 与原值严格相等 → next 为入参引用（让 store 的\"引用未变即不广播\"约定自动生效）；
 *   2. 非法 prompt → next 为入参引用 + error 码（manager 据此走 Notice，不写库、不广播状态）。
 */
export function updatePersona(current: CharacterView, raw: unknown): PersonaTransition {
  const normalized = normalizePersonaPrompt(raw);
  if ('error' in normalized) {
    return { next: current, changed: false, prompt: current.persona, error: normalized.error };
  }
  if (normalized.prompt === current.persona) {
    return { next: current, changed: false, prompt: current.persona };
  }
  return {
    next: { ...current, persona: normalized.prompt },
    changed: true,
    prompt: normalized.prompt,
  };
}
