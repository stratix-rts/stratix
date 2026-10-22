/**
 * 文件职责：首启向导屏的**纯逻辑层**（零 DOM）—— 扫描报告派生 / 名字校验 / 人设问答拼装 / 建档清单派生。
 *   UI 呈现全在 onboarding-screen.ts；本文件只算"什么算合法、什么算装好了"。
 *   来源：.long-run-agent/tasks/task_025.md「hud 首启向导屏（扫描报告→起名+皮肤→人设生成→完成 四步）」。
 *   依赖的既有能力：task_022（WorldState.detectedAgents 检测结果）、task_021（character.create 建档口径）、
 *   task_024（皮肤库 skin-registry）。
 * 输入：WorldState 快照（只读）+ 用户填的名字 / 答卷。
 * 输出：OnboardingScanRow / OnboardingIdentity / 人设模板与校验结果。
 * 禁止事项：
 *   1. 碰 DOM —— 本文件必须能在 node 环境单测，渲染是 onboarding-screen.ts 的事；
 *   2. import world/、vue、@/stratix-rts、core/bus —— 铁律，HUD 一律经注入的 adapter 收发；
 *   3. 修改 WorldState —— 本文件对 state 只读；
 *   4. 自己判"能不能建档"另起一套词表 —— 可建档种类只看 core 的 AGENT_KINDS（见下方说明）；
 *   5. 编造探测结论 —— 屏上"已装 / 未装"只反映 core 广播的 detectedAgents，不本地探测。
 *
 * ★ 三条口径（写在这里免得后来者重新猜一套）：
 *   - **已装**（installed）：只看 DetectedAgent.installed —— 它表示"**确认**有二进制"。
 *     status 说的是"这次探测的结论"（timeout / failed 时结论未确认），两者不同时以 installed 为准。
 *   - **可建档**（bindable）：只有 core 的 AGENT_KINDS（T1 五家）能作为 character.create 的 agentKind；
 *     T2 / T3 的探测结果（gemini / qwen / crush / goose / aider / copilot）**只展示不建档** ——
 *     建档校验在 core/character/profile.ts，HUD 提前拦一道，免得白跑一趟再吃 Notice。
 *   - **名字唯一**：core 侧同名会被拒（落库时报错），向导这里提前拦（duplicate-name），
 *     免得用户填完一路走到最后才发现建不出来。
 */

import { PERSONA_MAX_LEN } from '../../core/character/persona';
import { DEFAULT_PERSONA_TEMPLATE } from '../../core/character/profile';
import type { SkinId } from '../../core/theme/skin-registry';
import {
  AGENT_KINDS,
  DETECTABLE_AGENT_KINDS,
  MAX_CHARACTER_NAME_LEN,
  type AgentDetectionStatus,
  type AgentDetectionTier,
  type AgentKind,
  type WorldState,
} from '../../core/types';

// ============================================================================
// 步骤
// ============================================================================

/** 向导的四步。顺序即推进顺序，倒退一步即上一个。 */
export type OnboardingStep = 'scan' | 'identity' | 'persona' | 'confirm';

/** 全部步骤（顺序 = 推进顺序）。 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = Object.freeze([
  'scan',
  'identity',
  'persona',
  'confirm',
]);

/** 每步的标题（顶栏与步骤条用）。 */
export const STEP_LABELS: Readonly<Record<OnboardingStep, string>> = Object.freeze({
  scan: '扫描报告',
  identity: '起名与皮肤',
  persona: '人设生成',
  confirm: '确认建档',
});

// ============================================================================
// 标签文案
// ============================================================================

/** 可建档的 T1 五家 agent 的显示名。 */
export const AGENT_KIND_LABELS: Readonly<Record<AgentKind, string>> = Object.freeze({
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  kimi: 'Kimi',
  openclaw: 'OpenClaw',
});

/** 取 agent 种类的显示名；词表外的（仅探测注册那些）原样返回 id —— 不编造名字。 */
export function agentKindLabel(kind: string): string {
  const labels = AGENT_KIND_LABELS as Readonly<Record<string, string>>;
  return labels[kind] ?? kind;
}

/** 探测分层的显示名。 */
export const TIER_LABELS: Readonly<Record<AgentDetectionTier, string>> = Object.freeze({
  T1: 'T1 深度适配',
  T2: 'T2 基础适配',
  T3: 'T3 仅探测',
});

/** 探测结论的显示名。 */
export const DETECTION_STATUS_LABELS: Readonly<Record<AgentDetectionStatus, string>> = Object.freeze({
  installed: '已安装',
  'not-installed': '未安装',
  timeout: '探测超时',
  failed: '探测失败',
});

// ============================================================================
// ① 扫描报告
// ============================================================================

/** 扫描报告的一行（一个被探测的 agent）。 */
export interface OnboardingScanRow {
  /** agent 种类 id（原样透传）。 */
  readonly kind: string;
  /** 显示名。 */
  readonly label: string;
  /** 探测分层。 */
  readonly tier: AgentDetectionTier;
  /** 是否**确认**已安装（已装 → 屏上高亮）。 */
  readonly installed: boolean;
  /** 本次探测的结论。 */
  readonly status: AgentDetectionStatus;
  /** 版本号（取不到为 null）。 */
  readonly version: string | null;
  /** 二进制路径（取不到为 null）。 */
  readonly path: string | null;
  /** 能否建档：只有 AGENT_KINDS 词表内的种类可以。 */
  readonly bindable: boolean;
}

/**
 * 从 WorldState.detectedAgents 派生扫描报告行。
 * why 去重：同一 kind 只留第一条 —— 屏上重复行没有意义（core 侧同名覆盖，但广播顺序不保证）。
 */
export function resolveScanRows(state: WorldState | null): OnboardingScanRow[] {
  const detected = state?.detectedAgents ?? [];
  const rows: OnboardingScanRow[] = [];
  const seen = new Set<string>();
  for (const agent of detected) {
    if (seen.has(agent.kind)) continue;
    seen.add(agent.kind);
    rows.push({
      kind: agent.kind,
      label: agentKindLabel(agent.kind),
      tier: agent.tier,
      installed: agent.installed === true,
      status: agent.status,
      version: agent.version,
      path: agent.path,
      bindable: (AGENT_KINDS as readonly string[]).includes(agent.kind),
    });
  }
  return rows;
}

/**
 * 可建档的 agent 种类（已装 ∩ AGENT_KINDS），按检测顺序。
 * 这份名单决定第二步要为谁起名 —— T2/T3 的那些不进名单（探得到但还没适配）。
 */
export function resolveBindableKinds(state: WorldState | null): AgentKind[] {
  return resolveScanRows(state)
    .filter((row) => row.installed && row.bindable)
    .map((row) => row.kind as AgentKind);
}

/**
 * 扫描是否跑完（检测器把名单逐个跑完，每个目标都会产出一条结论 —— 装的 / 没装的都算一条）。
 *
 * why 用「名单长度」判定完成（@since v3.9，task_026）：检测是**逐条推送**的，
 *   用户可能在扫到一半时就点了"下一步"，那样只会给已探到的 agent 建档。
 *   屏上据此如实说明"扫描中 / 扫描完成"，不把半张名单说成全部。
 *   判据取自 core 的名单词表（DETECTABLE_AGENT_KINDS）—— 名单变了这里自动跟着变。
 */
export function isDetectionComplete(state: WorldState | null): boolean {
  const detected = state?.detectedAgents ?? [];
  return detected.length >= DETECTABLE_AGENT_KINDS.length;
}

/** 扫描进度文案（扫描中 / 已完成）。 */
export function resolveScanStatus(state: WorldState | null): { readonly complete: boolean; readonly text: string } {
  const detected = state?.detectedAgents ?? [];
  const total = DETECTABLE_AGENT_KINDS.length;
  if (isDetectionComplete(state)) {
    return { complete: true, text: `扫描完成（${detected.length}/${total} 项已探测）` };
  }
  return { complete: false, text: `扫描中…（已探测 ${detected.length}/${total} 项）` };
}

// ============================================================================
// ② 起名校验
// ============================================================================

/** 名字被拒的原因。 */
export type NameErrorCode = 'empty-name' | 'name-too-long' | 'duplicate-name';

/** 名字校验结果。 */
export interface NameValidation {
  readonly ok: boolean;
  /** trim 后的名字（被拒时也带，便于回填输入框）。 */
  readonly value: string;
  readonly code: NameErrorCode | null;
}

/** 名字被拒时的提示文案。 */
export const NAME_ERROR_MESSAGES: Readonly<Record<NameErrorCode, string>> = Object.freeze({
  'empty-name': '名字不能为空',
  'name-too-long': `名字不能超过 ${MAX_CHARACTER_NAME_LEN} 个字`,
  'duplicate-name': '名字重复了，换一个',
});

/**
 * 校验角色名。
 * 口径与 core/character/profile.ts 的建档校验**一致**：trim 后非空、≤ MAX_CHARACTER_NAME_LEN **码点**。
 * why 按码点而不按 UTF-16 长度：用户心里的"24 字"是 24 个汉字 / 字母，
 * 一个 emoji 是 2 个 code unit，用 length 会让生僻字与 emoji 提前被拒。
 */
export function validateAgentName(raw: string): NameValidation {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) return { ok: false, value, code: 'empty-name' };
  if (Array.from(value).length > MAX_CHARACTER_NAME_LEN) {
    return { ok: false, value, code: 'name-too-long' };
  }
  return { ok: true, value, code: null };
}

/** 找出重复的名字（trim 后比较；返回重复的那些名字，首个重复项只报一次）。 */
export function findDuplicateNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const raw of names) {
    const value = raw.trim();
    if (value.length === 0) continue;
    if (seen.has(value)) duplicated.add(value);
    else seen.add(value);
  }
  return [...duplicated];
}

// ============================================================================
// ③ 人设问答
// ============================================================================

/** 人设问卷的一个选项。 */
export interface PersonaOption {
  readonly id: string;
  readonly label: string;
  /** 该选项拼进人设模板的一句话。 */
  readonly fragment: string;
}

/** 人设问卷的一道题。 */
export interface PersonaQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly PersonaOption[];
}

/**
 * 人设问卷（4 题）。
 * why 题量固定 4：少于 3 题拼不出有区分度的模板，多于 4 题首启流程太长（每题都要用户做决定）。
 * 每题每选项都自带 fragment —— 拼装是**纯查表**，不做任何文本推理（HUD 侧不猜人设）。
 */
export const PERSONA_QUESTIONS: readonly PersonaQuestion[] = Object.freeze([
  {
    id: 'role',
    prompt: '这个角色主要干什么？',
    options: [
      { id: 'builder', label: '编码主力', fragment: '角色定位：编码主力 —— 主要负责把需求落成可运行的代码。' },
      { id: 'analyst', label: '研究分析', fragment: '角色定位：研究分析 —— 主要负责读代码、查资料、给结论。' },
      { id: 'reviewer', label: '审阅挑错', fragment: '角色定位：审阅挑错 —— 主要负责找问题、把关质量。' },
      { id: 'generalist', label: '全能管家', fragment: '角色定位：全能管家 —— 需求不明确时的默认承接方。' },
    ],
  },
  {
    id: 'tone',
    prompt: '你希望它怎么跟你说话？',
    options: [
      { id: 'terse', label: '简洁直给', fragment: '沟通风格：简洁直给 —— 先给结论，必要时再补细节。' },
      { id: 'detailed', label: '详尽解释', fragment: '沟通风格：详尽解释 —— 把来龙去脉讲清楚再下判断。' },
      { id: 'structured', label: '结论先行', fragment: '沟通风格：结论先行 —— 结论放最前，推理过程跟在后面。' },
      { id: 'cautious', label: '谨慎留白', fragment: '沟通风格：谨慎留白 —— 不确定的地方明说，不硬凑答案。' },
    ],
  },
  {
    id: 'autonomy',
    prompt: '它可以自己决定做到哪一步？',
    options: [
      { id: 'ask-first', label: '先问再动', fragment: '自主程度：先问再动 —— 动手前先确认方向。' },
      { id: 'balanced', label: '平衡推进', fragment: '自主程度：平衡推进 —— 常规步骤自己做，方向性问题先问。' },
      { id: 'full-auto', label: '完全自主', fragment: '自主程度：完全自主 —— 自行推进到可交付，遇阻再上报。' },
    ],
  },
  {
    id: 'delivery',
    prompt: '交付习惯选哪种？',
    options: [
      { id: 'iterative', label: '小步快跑', fragment: '交付习惯：小步快跑 —— 拆成小块，每块都可单独验证。' },
      { id: 'one-shot', label: '一次到位', fragment: '交付习惯：一次到位 —— 尽量把整件事做完再交付。' },
      { id: 'plan-first', label: '先计划后执行', fragment: '交付习惯：先计划后执行 —— 先给计划，确认后再动手。' },
    ],
  },
]);

/** 答卷：题目 id → 选项 id。 */
export type PersonaAnswers = Readonly<Record<string, string>>;

/** 没答的题目 id（按题目顺序）。 */
export function missingPersonaAnswers(answers: PersonaAnswers): string[] {
  return PERSONA_QUESTIONS.filter((question) => !answers[question.id]).map((question) => question.id);
}

/**
 * 按答卷拼装人设提示词。
 * 结构：core 的默认人设模板（行为底线）+ 各题对应的 fragment（角色画像）。
 * why 以 core 模板打底：默认模板是 core 认定的"合格人设下限"（core/character/profile.ts），
 * HUD 只在它之上追加用户选出来的画像，不另起一份底线（否则两处模板会漂移）。
 */
export function buildPersona(answers: PersonaAnswers): string {
  const fragments: string[] = [];
  for (const question of PERSONA_QUESTIONS) {
    const optionId = answers[question.id];
    if (!optionId) continue;
    const option = question.options.find((candidate) => candidate.id === optionId);
    if (option) fragments.push(option.fragment);
  }
  if (fragments.length === 0) return DEFAULT_PERSONA_TEMPLATE;
  return [DEFAULT_PERSONA_TEMPLATE, ...fragments].join('\n');
}

/** 人设被拒的原因（目前只有超长；空人设不算错 —— core 会套默认模板）。 */
export type PersonaErrorCode = 'persona-too-long';

/** 人设校验结果。 */
export interface PersonaValidation {
  readonly ok: boolean;
  readonly value: string;
  readonly code: PersonaErrorCode | null;
}

/**
 * 校验人设文本（用户在预览区改过之后）。
 * 长度口径与 core/character/persona.ts 一致（UTF-16 code units + PERSONA_MAX_LEN）——
 * 两处各判一次必然漂移（一边放行 40000 字、一边拒发）。
 * 空串**不算错**：core 的建档路径对空 persona 套默认模板，不拒发。
 */
export function validatePersona(raw: string): PersonaValidation {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length > PERSONA_MAX_LEN) {
    return { ok: false, value, code: 'persona-too-long' };
  }
  return { ok: true, value, code: null };
}

/** 人设超长的提示文案。 */
export const PERSONA_ERROR_MESSAGES: Readonly<Record<PersonaErrorCode, string>> = Object.freeze({
  'persona-too-long': `人设太长了（上限 ${PERSONA_MAX_LEN} 字）`,
});

// ============================================================================
// ④ 建档清单
// ============================================================================

/** 一个待建档的角色（第二步起名 + 皮肤的结果）。 */
export interface OnboardingIdentity {
  /** agent 种类（core 词表内）。 */
  readonly kind: AgentKind;
  /** 显示名（agent 名字，不是角色名）。 */
  readonly label: string;
  /** 角色名（用户填的）。 */
  readonly name: string;
  /** 皮肤资源键。 */
  readonly skinId: SkinId;
}

/** 建档前的一行确认摘要。 */
export interface OnboardingSummaryRow {
  readonly kind: AgentKind;
  readonly label: string;
  readonly name: string;
  readonly skinId: SkinId;
}

/** 把身份清单摊平成确认摘要。 */
export function resolveSummaryRows(
  identities: readonly OnboardingIdentity[]
): OnboardingSummaryRow[] {
  return identities.map((identity) => ({
    kind: identity.kind,
    label: identity.label,
    name: identity.name,
    skinId: identity.skinId,
  }));
}
