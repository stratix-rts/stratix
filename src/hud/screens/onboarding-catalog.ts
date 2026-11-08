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
  DEFAULT_INSTANCE_ID,
  DETECTABLE_AGENT_KINDS,
  MAX_CHARACTER_NAME_LEN,
  customAgentIdOf,
  isBindableAgentKind,
  type AgentDetectionStatus,
  type AgentDetectionTier,
  type AgentKind,
  type AppearancePartValue,
  type CharacterAppearance,
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

/**
 * 可建档的内置 T1 六家 agent 的显示名（@since v3.32 task_056：只盖内置 —— 自定义注册的
 * 显示名在注册表里，随 DetectedAgent.label 广播，见 agentKindLabel 的回落链）。
 * @since v3.33（task_088）并入 dsh（DeepSeek Harness）。 */
export const AGENT_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  kimi: 'Kimi',
  openclaw: 'OpenClaw',
  dsh: 'DeepSeek Harness',
});

/**
 * 取 agent 种类的显示名；词表外的原样返回 id —— 不编造名字。
 * 自定义注册段（task_056）：优先用检测行自带的 label（注册名，见 resolveScanRows）；
 * 没有检测行可查的地方（旧档案 / 下拉枚举）退回 slug（剥掉 custom: 前缀 —— 'myagent' 比
 * 'custom:myagent' 可读，且不会和内置名混淆）。
 */
export function agentKindLabel(kind: string): string {
  const customId = customAgentIdOf(kind);
  if (customId !== null) return customId;
  return AGENT_KIND_LABELS[kind] ?? kind;
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
  /** 能否建档：内置五家（AGENT_KINDS）或形状合法的自定义注册段（`custom:<id>`，task_056）。 */
  readonly bindable: boolean;
}

/**
 * 从 WorldState.detectedAgents 派生扫描报告行。
 * why 去重：同一 kind 只留第一条 —— 屏上重复行没有意义（core 侧同名覆盖，但广播顺序不保证）。
 * @since v3.32（task_056）：显示名优先取检测行自带的 label（自定义注册的用户命名 ——
 * 注册名字只存在注册表里，检测行是它进入 WorldState 的唯一载体）；bindable 按内置 ∪
 * 自定义段裁决（isBindableAgentKind，与 core 建档校验同一份口径）。
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
      label: agent.label && agent.label.trim().length > 0 ? agent.label : agentKindLabel(agent.kind),
      tier: agent.tier,
      installed: agent.installed === true,
      status: agent.status,
      version: agent.version,
      path: agent.path,
      bindable: isBindableAgentKind(agent.kind),
    });
  }
  return rows;
}

/**
 * 可建档的 agent 种类（已装 ∩ 可建档词表），按检测顺序。
 * 这份名单决定第二步要为谁起名 —— T2/T3 的那些不进名单（探得到但还没适配）；
 * 自定义注册段进名单（@since v3.32，task_056）：能探测（probeCmd）就能建档，
 * 后续逐个配置流程与内置同链路（起名/皮肤/人设，规格③）。
 */
export function resolveBindableKinds(state: WorldState | null): AgentKind[] {
  return resolveScanRows(state)
    .filter((row) => row.installed && row.bindable)
    .map((row) => row.kind as AgentKind);
}

/**
 * 扫描是否跑完：静态名单（DETECTABLE_AGENT_KINDS）全部有结论即完。
 * @since v3.32（task_056）：自定义注册行**不计入**完成判定 —— 它们是用户注册进来才有的
 * 动态行（不注册 = 0 行也算扫完），但会被计入 detected.length；分母取
 * max(静态名单长度, 当前行数) 保持「x/y」文案在注册后仍然单调不倒退。
 */
export function isDetectionComplete(state: WorldState | null): boolean {
  const detected = state?.detectedAgents ?? [];
  const total = resolveDetectionTotal(detected.length);
  return detected.length >= total;
}

/** 扫描进度文案的分母：静态名单长度，但不少于当前已见行数（注册行加入后文案不倒退）。 */
export function resolveDetectionTotal(detectedCount: number): number {
  return Math.max(DETECTABLE_AGENT_KINDS.length, detectedCount);
}

/** 扫描进度文案（扫描中 / 已完成）。 */
export function resolveScanStatus(state: WorldState | null): { readonly complete: boolean; readonly text: string } {
  const detected = state?.detectedAgents ?? [];
  const total = resolveDetectionTotal(detected.length);
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
// ② 形象草稿（@since v3.12，task_032：每 agent 一份独立形象）
// ============================================================================

/**
 * 一个 agent 的形象草稿 —— 就是 CharacterAppearance，单独起名是为了把
 * "向导屏内可变的那份"与"core 状态里只读的那份"在类型层区分开。
 */
export type AppearanceDraft = CharacterAppearance;

/**
 * 默认形象的来源（注入式）：按 agent 种类给一份初始形象，取不到 → null。
 * 正式实现住在 app 层（品牌预设查表 + 无预设时 minimal 档规则随机兜底），
 * 向导屏只认这个函数形状 —— hud 不 import world（铁律）。
 */
export type AppearancePresetSource = (kind: string) => CharacterAppearance | null;

/**
 * 深拷贝一份外观。
 * why 必须：品牌预设是模块级常量（world/appearance/brand-presets），多个调用点共享同一份引用 ——
 * 直接存进屏内草稿的话，"改 A 的部件"会写穿到预设常量、连带 B 的初始形象一起变。
 * 部件值（AppearancePartSelection）一并克隆：字符串形态（旧格式）本就不可变，原样保留。
 */
export function cloneAppearance(source: CharacterAppearance): AppearanceDraft {
  const parts: Record<string, AppearancePartValue> = {};
  for (const [category, value] of Object.entries(source.parts)) {
    parts[category] =
      typeof value === 'string' ? value : { variant: value.variant, ...(value.itemId !== undefined ? { itemId: value.itemId } : {}) };
  }
  return { bodyType: source.bodyType, parts };
}

/**
 * 给一批 agent 种类初始化形象草稿表：每个 kind 一份**独立深拷贝**的默认形象。
 * 预设源返 null（素材没就绪、无预设且兜底也抽不出）的 kind 不进表 ——
 * 屠里靠 appearanceOf(kind) === null 提示，等素材就绪后再补（不编造长相）。
 */
export function createAppearanceDrafts(
  kinds: readonly string[],
  presetSource: AppearancePresetSource
): Map<string, AppearanceDraft> {
  const drafts = new Map<string, AppearanceDraft>();
  for (const kind of kinds) {
    const preset = presetSource(kind);
    if (!preset) continue;
    drafts.set(kind, cloneAppearance(preset));
  }
  return drafts;
}

// ============================================================================
// ③ 人设问答
// ============================================================================

/**
 * 人设正文的分节 id（顺序即输出顺序；rules 恒在末尾）。
 * 分节体系与 stratix-agent 的 10 层提示词模板（templates/partials/layers/）同源——
 * 结构对齐（分节 + 双语标题），语义面向战场角色（这里只保留首启问卷用得上的 6 节）。
 * hud 不 import stratix-agent（渲染层隔离），对齐靠约定而不是引用。
 */
export type PersonaSectionId = 'role' | 'mission' | 'style' | 'autonomy' | 'delivery' | 'rules';

/** 分节头（统一格式：`# 中文名 ENGLISH`）。 */
export const PERSONA_SECTION_TITLES: Readonly<Record<PersonaSectionId, string>> = Object.freeze({
  role: '角色定位 ROLE',
  mission: '使命 MISSION',
  style: '沟通风格 STYLE',
  autonomy: '自主程度 AUTONOMY',
  delivery: '交付习惯 DELIVERY',
  rules: '行为规则 RULES',
});

/** 问卷能填充的前五节（rules 恒在，由 core 默认模板派生，见 personaRulesLines）。 */
const QUESTIONNAIRE_SECTION_ORDER: readonly PersonaSectionId[] = ['role', 'mission', 'style', 'autonomy', 'delivery'];

/**
 * 行为规则分节的列表行：core 默认人设模板（DEFAULT_PERSONA_TEMPLATE）四条底线 → `-` 列表项。
 * why 从 core 常量派生而不是另抄一份：底线口径只允许有一个来源，core 改了这里自动跟；
 * 派生只做排版改写（去句末标点、加列表符），语义一字不动。
 */
export function personaRulesLines(): readonly string[] {
  return DEFAULT_PERSONA_TEMPLATE.split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `- ${line.replace(/[：:；;。.，,]+$/u, '')}`);
}

/**
 * 把分节内容渲染成统一的人设正文：每节「# 标题 + 空行 + 内容行」，节间空行。
 * 空节（没给内容行的）整节省略——问卷没答的题对应的节不出现。
 */
export function composePersonaSections(
  sections: Readonly<Partial<Record<PersonaSectionId, readonly string[]>>>
): string {
  const parts: string[] = [];
  for (const id of QUESTIONNAIRE_SECTION_ORDER) {
    const lines = sections[id];
    if (!lines || lines.length === 0) continue;
    parts.push([`# ${PERSONA_SECTION_TITLES[id]}`, '', ...lines].join('\n'));
  }
  const rules = sections.rules;
  if (rules && rules.length > 0) {
    parts.push([`# ${PERSONA_SECTION_TITLES.rules}`, '', ...rules].join('\n'));
  }
  return parts.join('\n\n');
}

/** 人设问卷的一个选项。 */
export interface PersonaOption {
  readonly id: string;
  readonly label: string;
  /** 该选项写进人设各分节的内容（分节 id → 正文行；一题可贡献多节，如 role 同时给 ROLE 与 MISSION）。 */
  readonly sections: Readonly<Partial<Record<PersonaSectionId, string>>>;
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
 * 每题每选项自带 sections —— 拼装是**纯查表**（查表后按分节排序渲染），不做任何文本推理
 * （HUD 侧不猜人设）。分节头由 composePersonaSections 统一给，选项内容不带「角色定位：」这类前缀。
 */
export const PERSONA_QUESTIONS: readonly PersonaQuestion[] = Object.freeze([
  {
    id: 'role',
    prompt: '这个角色主要干什么？',
    options: [
      {
        id: 'builder',
        label: '编码主力',
        sections: {
          role: '编码主力 —— 把需求落成可运行的代码是第一职责，产出以代码为中心。',
          mission: '交付可运行、可验证、可维护的代码，让每个需求都有落地的实现。',
        },
      },
      {
        id: 'analyst',
        label: '研究分析',
        sections: {
          role: '研究分析 —— 读代码、查资料、做实验，把不确定的问题拆解成结论与依据。',
          mission: '给出有依据的结论与建议，让决策建立在事实而不是猜测上。',
        },
      },
      {
        id: 'reviewer',
        label: '审阅挑错',
        sections: {
          role: '审阅挑错 —— 找问题、把关质量，对将要合入的一切改动保持职业怀疑。',
          mission: '把缺陷拦在合入之前，让交付出去的东西经得起推敲。',
        },
      },
      {
        id: 'generalist',
        label: '全能管家',
        sections: {
          role: '全能管家 —— 需求不明确时的默认承接方，先接住再分流。',
          mission: '让每一件事都有人管、有着落，不掉在地板上。',
        },
      },
    ],
  },
  {
    id: 'tone',
    prompt: '你希望它怎么跟你说话？',
    options: [
      { id: 'terse', label: '简洁直给', sections: { style: '先给结论，必要时再补细节；不铺垫、不绕弯。' } },
      { id: 'detailed', label: '详尽解释', sections: { style: '把来龙去脉讲清楚再下判断，关键取舍要说明理由。' } },
      { id: 'structured', label: '结论先行', sections: { style: '结论放最前，推理过程与依据跟在后面，按层级展开。' } },
      { id: 'cautious', label: '谨慎留白', sections: { style: '不确定的地方明说不确定在哪，不硬凑答案。' } },
    ],
  },
  {
    id: 'autonomy',
    prompt: '它可以自己决定做到哪一步？',
    options: [
      { id: 'ask-first', label: '先问再动', sections: { autonomy: '动手前先确认方向，得到认可再推进。' } },
      { id: 'balanced', label: '平衡推进', sections: { autonomy: '常规步骤自行决定，方向性或有风险的改动先问再做。' } },
      { id: 'full-auto', label: '完全自主', sections: { autonomy: '自行推进到可交付，遇到阻塞或超出口径再上报。' } },
    ],
  },
  {
    id: 'delivery',
    prompt: '交付习惯选哪种？',
    options: [
      { id: 'iterative', label: '小步快跑', sections: { delivery: '拆成小块交付，每块都可单独验证。' } },
      { id: 'one-shot', label: '一次到位', sections: { delivery: '尽量把整件事做完再交付，减少来回。' } },
      { id: 'plan-first', label: '先计划后执行', sections: { delivery: '先给计划，确认后再动手，按计划推进并同步偏差。' } },
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
 * 按答卷拼装**结构化**人设：分节 markdown（`# 中文名 ENGLISH` 分节头 + 空行 + 内容行，节间空行）。
 * - 问卷答案 → 前 5 节（没答的题对应的节整节省略）；
 * - 行为规则节恒在末尾：core 默认模板四条底线（DEFAULT_PERSONA_TEMPLATE 派生，见 personaRulesLines）——
 *   默认模板是 core 认定的「合格人设下限」（core/character/profile.ts），HUD 只换排版不换语义，
 *   不另起一份底线（否则两处模板会漂移）。
 * 一题都没答 → 只剩行为规则节（这就是预览框的初始底线形态）。
 */
export function buildPersona(answers: PersonaAnswers): string {
  const collected = new Map<PersonaSectionId, string[]>();
  for (const question of PERSONA_QUESTIONS) {
    const optionId = answers[question.id];
    if (!optionId) continue;
    const option = question.options.find((candidate) => candidate.id === optionId);
    if (!option) continue;
    for (const id of QUESTIONNAIRE_SECTION_ORDER) {
      const line = option.sections[id];
      if (!line) continue;
      const bucket = collected.get(id) ?? [];
      bucket.push(line);
      collected.set(id, bucket);
    }
  }
  return composePersonaSections({ ...Object.fromEntries(collected), rules: personaRulesLines() });
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

// ============================================================================
// 归属条（@since v3.3 / task_227 · CC-02 · 设计文档 docs/DESIGN-character-creation.md §3.C3）
// ============================================================================

/**
 * 向导的归属结论：建档最终落到哪儿 + 该怎么跟用户说。
 *
 * why 要有它（设计原则④「归属必须可见」）：`character.create` **不带 instanceId**，
 * 落库按 COALESCE 归默认沙盒（app/services/persistence/character-record.ts）——
 * 在项目实例里建的角色**当下看得见、重载项目后消失**（instance-loader 只 load 本实例实体）。
 * 用户有权在做之前就知道"建到哪儿"。
 */
export interface OnboardingOwnership {
  /** 归属目标（当前只有默认沙盒一种：建档命令不带 instanceId）。 */
  readonly target: string;
  /** 是否在项目实例里（activeInstanceId ≠ DEFAULT_INSTANCE_ID）。 */
  readonly projectMode: boolean;
  /** 当前项目实例的标题（清单里查不到 → null，不编造名字）。 */
  readonly projectTitle: string | null;
  /** 归属条全文（向导顶部常驻那行）。 */
  readonly text: string;
  /** 完成 toast 的归属补充说明；null = 沙盒实例，维持现状文案。 */
  readonly toastNote: string | null;
}

/**
 * 解析向导归属（纯函数，零 DOM）。
 *
 * 口径（与 core 的 null 语义一致）：
 *   - `activeInstanceId` 缺省 / null = **大厅态**（还没进任何副本）→ 归属按沙盒说；
 *   - `activeInstanceId === DEFAULT_INSTANCE_ID` = **默认沙盒** → 归属按沙盒说；
 *   - 其余 = **项目实例** → 归属仍是沙盒，但要补一句名册契约的实话。
 */
export function resolveOnboardingOwnership(state: WorldState | null): OnboardingOwnership {
  const activeId = state?.activeInstanceId ?? null;
  const projectMode = activeId !== null && activeId !== DEFAULT_INSTANCE_ID;
  if (!projectMode) {
    return {
      target: '默认沙盒',
      projectMode: false,
      projectTitle: null,
      text: '将建到：默认沙盒',
      toastNote: null,
    };
  }
  const projectTitle =
    state?.projectInstances?.find((item) => item.instanceId === activeId)?.title ?? null;
  const projectPart = projectTitle ? `当前项目「${projectTitle}」` : '当前项目';
  return {
    target: '默认沙盒',
    projectMode: true,
    projectTitle,
    text: `将建到：默认沙盒 · ${projectPart}的角色由名册契约管理（.stratix/roster/），这里建的角色归沙盒`,
    toastNote: '建到默认沙盒 · 项目角色由名册契约管理（.stratix/roster/）',
  };
}

/**
 * 「查看 CLI 安装指引」的外链（docs 入口）。
 *
 * why 指这份文档：它是本仓**唯一**的 CLI 权威清单（docs/AGENT-MATRIX.md）——
 * 逐家列了支持的 CLI、检测命令（`which claude` 等）与调用方式，用户照着就能装对、验对。
 * 走 GitHub 链接而不是本地路径：向导跑在渲染层，用户机器上未必有这份仓库。
 */
export const CLI_INSTALL_GUIDE_URL = 'https://github.com/stratix-rts/stratix/blob/main/docs/AGENT-MATRIX.md';

