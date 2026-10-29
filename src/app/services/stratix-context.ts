/**
 * 文件职责：Stratix 上下文注入中间件（task_053）—— 对话 / 任务**首发**自动附带战场现状。
 *   三件事，全部零 IO（本文件是纯函数 + 注入件装配工厂，读写库 / IPC 一律在调用方）：
 *   ① buildStratixContextBlock：把（角色档案摘要 / 同场角色名单 / 近期任务史 / 最近对话话题）
 *      四路输入拼成结构化 <stratix-context> 块 —— 分节小标题，与 043 的 persona 分节风格一致
 *      （# 角色档案 / # 同场角色 / # 近期任务 / # 最近对话）；
 *   ② createStratixContextProvider：context-source 注入件工厂 —— 从注入的 getState（WorldState
 *      的 characters / units / tasks 三面）+ 话题缓存口 + 全局开关口组装出
 *      provideContextSnapshot(characterId) 快照端口，service 层只消费这个纯输入（零 IO）；
 *   ③ resolveStratixContextBlock：service 侧统一入口 —— 取快照 → 拼块 → 任何异常吞掉
 *      （上下文是增强，不是依赖，坏了不能绑架对话 / 任务回路）。
 * 输入：StratixContextInput（纯数据）；WorldState 的三个可选面；Storage 形状（localStorage）。
 * 输出：'<stratix-context>…</stratix-context>' 字符串（空输入降级为 ''，调用方按无块处理）。
 * 禁止事项：
 *   1. import fs / electron / DAO —— 本文件零 IO（分层铁律：读 WorldState / 库的权限在
 *      app 层注入件装配方 = 组合根 main-entry，service 只拿纯输入）；
 *   2. 在这里读 localStorage / Date.now 之外的任何环境（时间戳一律由调用方给；
 *      isGlobalContextEnabled 的 storage 由调用方传 —— 测试可注内存面）；
 *   3. 抛错 —— 对外函数全部不抛（resolve… 吞错记日志；build… 对非法输入降级为 ''）。
 *
 * ============ 截断策略（总体积上限，文件头契约）============
 * STRATIX_CONTEXT_MAX_CHARS = 4000（含包裹标签）。分节按优先级排序：
 *   角色档案 > 同场角色 > 近期任务 > 最近对话。超限时**从尾部段整段砍**：
 *   1. 先逐段拼装（每段内部再有自己的预截断：同场角色最多列 STRATIX_CONTEXT_MAX_PEERS 名、
 *      任务摘要 / 话题各自截到固定字长）—— 这些预截断保证常规快照远小于 4000；
 *   2. 拼好的总长仍超限 → 丢掉最后一个分节重新拼（循环，直到放进或只剩首段）；
 *   3. 只剩「角色档案」一段仍超限（极端：外部注入的超长摘要）→ 对首段正文硬截断，
 *      收尾加「…」并保留闭合标签 —— 包裹标签任何情况下都保持配对完整。
 *
 * ============ 开关两级（注入条件，task_053 规格③）============
 *   - 全局开关：localStorage 键 STRATIX_CONTEXT_TOGGLE_KEY（'stratix.context.enabled'，
 *     值 '0' = 关）。读法见 isGlobalContextEnabled —— 键在 core/types.ts 冻结（hud 设置屏写入 /
 *     app 层读取，两侧共用同一份常量，不各抄一份）。缺省（无键 / 无 localStorage）= 开。
 *   - 角色级开关：CharacterView.contextEnabled（characters 表 context_enabled 列，schema v9；
 *     false = 该角色不注入）。两开关是**与**关系，全局关或角色关都不注入。
 *   两级开关都在 provider 内裁决（service 无感知）；provider 返回 null = 不注入。
 *
 * @since v3.29，task_053。
 */

import { STRATIX_CONTEXT_TOGGLE_KEY, type CharacterView, type TaskStatus, type WorldState } from '../../core/types';

// ============================================================================
// 契约常量
// ============================================================================

/** 包裹标签（开）。注入位置：persona 之后、用户消息之前（见 chat/task-service 的拼装函数）。 */
export const STRATIX_CONTEXT_TAG_OPEN = '<stratix-context>';
/** 包裹标签（闭）。 */
export const STRATIX_CONTEXT_TAG_CLOSE = '</stratix-context>';

/** 总体积上限（含标签）。截断策略见文件头。 */
export const STRATIX_CONTEXT_MAX_CHARS = 4000;

/** 同场角色最多列多少名（超出附「…等 N 名」；防 MAX_CHARACTERS=64 的满编战把块撑爆）。 */
export const STRATIX_CONTEXT_MAX_PEERS = 12;

/** 单条任务摘要的截断字长（码点近似 —— prompt 可达 20k 字，必须预截）。 */
export const STRATIX_CONTEXT_TASK_SUMMARY_LEN = 48;

/** 最近对话话题的截断字长。 */
export const STRATIX_CONTEXT_TOPIC_LEN = 80;

/** 块头的说明行（告诉 agent 这是什么、不是用户消息）。 */
const BLOCK_LEAD = '以下是 Stratix 战场现状快照，供你回答时贴合当前情况（这不是用户消息）：';

/** 任务状态 → 中文标签（与 agent-catalog 的 TASK_STATUS_LABELS 同词表；hud 不许被 app import，两处各持一份并同步）。 */
const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  queued: '排队中',
  running: '执行中',
  awaiting_approval: '待审批',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// ============================================================================
// 输入形状（provider 与 builder 的交接面 —— 纯数据，无 IO）
// ============================================================================

/** 同场角色一名：id + 名字 + 绑定的 agent 种类（kind 为可读串，未绑定为「未绑定」）。 */
export interface StratixPeerBrief {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly level: number;
}

/** 近期任务一条：摘要（已截断）+ 状态 + 时间戳（ms）。 */
export interface StratixTaskBrief {
  readonly summary: string;
  readonly status: TaskStatus;
  readonly at: number;
}

/** 最近对话话题：最近一条用户消息（已截断）+ 时间戳。 */
export interface StratixTopicBrief {
  readonly text: string;
  readonly at: number;
}

/** builder 的完整输入（provider 产出，service 只消费）。 */
export interface StratixContextInput {
  readonly characterId: string;
  readonly characterName: string;
  /** 当前角色档案摘要（成长数值行；persona 已在 prompt 里，这里不重复全文）。 */
  readonly profileSummary: string;
  readonly peers: readonly StratixPeerBrief[];
  readonly recentTasks: readonly StratixTaskBrief[];
  readonly lastTopic: StratixTopicBrief | null;
}

/**
 * context-source 注入接口（task_053 规格④）：characterId → 快照或 null。
 * null = 不注入（角色不在档 / 两级开关任一关 / 没有任何可注入内容）。
 * 约定：实现方零抛错由 resolveStratixContextBlock 兜底，但实现本身也不该抛（防御性契约）。
 */
export type StratixContextSource = (characterId: string) => StratixContextInput | null;

// ============================================================================
// builder（纯函数）
// ============================================================================

/** 码点截断（数组切片按码点数；超长尾部换省略号）。导出供测试与未来消费者复用。 */
export function truncateByCodePoints(text: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  const chars = Array.from(text);
  if (chars.length <= maxLen) return text;
  return `${chars.slice(0, maxLen - 1).join('')}…`;
}

/** 时间戳 → 「MM-DD HH:mm」（本地时区；年份省略 —— 战场语境里跨年任务史不是重点）。 */
export function formatContextTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 一个分节的渲染产物（title = 小标题行含 # 前缀；body = 正文，可为多行）。 */
interface ContextSection {
  readonly title: string;
  readonly body: string;
}

/** 输入 → 分节序列（空输入的分节直接不产出 —— 降级策略见单测）。 */
function renderSections(input: StratixContextInput): ContextSection[] {
  const sections: ContextSection[] = [];
  const profile = input.profileSummary.trim();
  if (profile.length > 0) {
    sections.push({ title: '# 角色档案', body: `${input.characterName}（${profile}）` });
  }
  if (input.peers.length > 0) {
    const shown = input.peers.slice(0, STRATIX_CONTEXT_MAX_PEERS);
    const lines = shown.map((p) => `- ${p.name}（Lv.${p.level} · ${p.kind}）`);
    if (input.peers.length > shown.length) lines.push(`…等共 ${input.peers.length} 名`);
    sections.push({ title: '# 同场角色', body: lines.join('\n') });
  }
  if (input.recentTasks.length > 0) {
    const lines = input.recentTasks.map(
      (t) => `- [${TASK_STATUS_LABELS[t.status]}] ${truncateByCodePoints(t.summary, STRATIX_CONTEXT_TASK_SUMMARY_LEN)}（${formatContextTime(t.at)}）`
    );
    sections.push({ title: '# 近期任务', body: lines.join('\n') });
  }
  if (input.lastTopic) {
    sections.push({
      title: '# 最近对话',
      body: `用户最近说：${truncateByCodePoints(input.lastTopic.text, STRATIX_CONTEXT_TOPIC_LEN)}`,
    });
  }
  return sections;
}

/** 分节序列 → 完整块（含从尾部段砍的截断策略，见文件头）。 */
function assembleBlock(sections: readonly ContextSection[]): string {
  const lead = `${STRATIX_CONTEXT_TAG_OPEN}\n${BLOCK_LEAD}`;
  const render = (kept: readonly ContextSection[]): string =>
    [lead, ...kept.map((s) => `${s.title}\n${s.body}`), STRATIX_CONTEXT_TAG_CLOSE].join('\n\n');

  let kept = sections;
  // 从尾部段砍（最后一段整体丢弃，保前段完整性）；保底留首段 —— 首段仍超限走下面的硬截断。
  while (kept.length > 1 && render(kept).length > STRATIX_CONTEXT_MAX_CHARS) {
    kept = kept.slice(0, -1);
  }
  if (kept.length === 0) return '';
  const block = render(kept);
  if (block.length <= STRATIX_CONTEXT_MAX_CHARS) return block;

  // 只剩首段仍超限（极端输入）：硬截断首段正文，保住闭合标签配对（预算制拼接：
  // 先扣掉前缀（标签头 + 说明行 + 小标题）与后缀（闭合标签）再截正文，总长恒不超限）。
  const [first] = kept;
  const prefix = `${lead}\n\n${first.title}\n`;
  const suffix = `\n\n${STRATIX_CONTEXT_TAG_CLOSE}`;
  const budget = STRATIX_CONTEXT_MAX_CHARS - prefix.length - suffix.length;
  const bodyText = budget > 1 ? `${first.body.slice(0, budget - 1)}…` : '';
  return `${prefix}${bodyText}${suffix}`;
}

/**
 * 快照 → 结构化 <stratix-context> 块（service 拼装函数把返回串插在 persona 之后、
 * 用户消息之前）。没有任何可注入内容（四路输入全空）→ 返回 ''（调用方按无块处理）。
 */
export function buildStratixContextBlock(input: StratixContextInput): string {
  try {
    const sections = renderSections(input);
    if (sections.length === 0) return '';
    return assembleBlock(sections);
  } catch {
    // 防御：渲染不该抛（渲染内部也无 throw 路径），真抛了降级为不注入。
    return '';
  }
}

// ============================================================================
// 全局开关（localStorage；键常量在 core/types.ts 冻结，见文件头「开关两级」）
// ============================================================================

/** 最小 Storage 面（localStorage / 单测内存面都满足；null = 无存储环境 → 视为开）。 */
export function isGlobalContextEnabled(storage: Storage | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(STRATIX_CONTEXT_TOGGLE_KEY) !== '0';
  } catch {
    return true; // 存储 API 抛错（隐私模式等）：默认开，不绑架可用性。
  }
}

// 键常量在 core/types.ts 冻结（STRATIX_CONTEXT_TOGGLE_KEY）—— hud 设置屏（写入方）与
// app 读取方共用同一份真相（hud 不 import app，core 是两侧公共底座，不各抄一份字面量）。

// ============================================================================
// provider（注入件工厂 —— 组合根装配，service 只消费纯输入）
// ============================================================================

/** provider 需要的 WorldState 面（characters / units / tasks；同场与任务史都从这取）。 */
export type StratixContextState = Pick<WorldState, 'characters' | 'units' | 'tasks'>;

export interface StratixContextProviderDeps {
  /** 世界快照读取口（组合根传 worldStore.getState；单测传夹具）。 */
  readonly getState: () => StratixContextState;
  /** 最近对话话题口（缺省无话题 —— 组合根传 createTopicCachePersister 的缓存读数）。 */
  readonly lastTopicFor?: (characterId: string) => StratixTopicBrief | null;
  /** 全局开关口（缺省恒开；组合根传 localStorage 的读取闭包）。 */
  readonly isEnabled?: () => boolean;
}

/** CharacterView → 档案摘要行（成长数值；persona 已随首发全文内嵌，不重复）。 */
function profileSummaryOf(character: CharacterView): string {
  const kind = character.agentKind ?? '未绑定 agent';
  return `Lv.${character.level} · EXP ${character.experience} · ${kind}`;
}

/**
 * 组装 context-source：characterId → StratixContextInput | null。
 * 裁决顺序：全局开关 → 角色在档 → 角色级开关（contextEnabled === false 拒）→ 派生快照。
 * 派生规则：
 *   - 同场角色 = 战场单位（WorldState.units 的 characterId 命中）在档且有 agent 绑定，
 *     排除自己（自己已在 prompt 里有完整档案）；未绑 agent 的角色列不出 kind，跳过
 *     （「同场名单」的意义是让 agent 知道能跟谁协作，没绑 agent 的角色此刻无法协作）；
 *   - 近期任务 = 该角色任务按创建时间倒序取前 3（摘要 = 指令原文预截断；时间 = 收尾时刻，
 *     未收尾用创建时刻）；
 *   - 话题 = 注入的 lastTopicFor（缓存由 createTopicCachePersister 维护）。
 */
export function createStratixContextProvider(
  deps: StratixContextProviderDeps
): StratixContextSource {
  const getState = deps.getState;
  const lastTopicFor = deps.lastTopicFor ?? ((): StratixTopicBrief | null => null);
  const isEnabled = deps.isEnabled ?? ((): boolean => true);

  return (characterId: string): StratixContextInput | null => {
    if (!isEnabled()) return null;
    const state = getState();
    const me = state.characters.find((c) => c.id === characterId);
    if (!me) return null;
    if (me.contextEnabled === false) return null;

    const onField = new Set<string>();
    for (const unit of state.units) {
      if (unit.characterId) onField.add(unit.characterId);
    }
    const peers = state.characters
      .filter((c) => c.id !== characterId && c.agentKind != null && onField.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, kind: c.agentKind as string, level: c.level }));

    const recentTasks = (state.tasks ?? [])
      .filter((t) => t.characterId === characterId)
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .map((t) => ({
        summary: t.prompt,
        status: t.status,
        at: t.endedAt ?? t.startedAt ?? t.createdAt,
      }));

    return {
      characterId,
      characterName: me.name,
      profileSummary: profileSummaryOf(me),
      peers,
      recentTasks,
      lastTopic: lastTopicFor(characterId),
    };
  };
}

// ============================================================================
// 话题缓存（组合根装配用：包住落库回调，顺手记每角色最近一条用户消息）
// ============================================================================

/** 服务侧落库消息的最小面（与 chat-service 的 ChatPersistedMessage 结构同构，不倒灌依赖）。 */
interface PersistLike {
  readonly characterId: string;
  readonly role: 'user' | 'assistant' | 'system' | 'error';
  readonly text: string;
}

export interface TopicCachePersister<M extends PersistLike = PersistLike> {
  /** 服务 persistMessage 的替换注入件：记 user 话题 + 原样委托 base。 */
  persist(message: M): void;
  /** 话题读数口（喂 provider 的 lastTopicFor）。没有记录返回 null。 */
  lastTopicFor(characterId: string): StratixTopicBrief | null;
}

/**
 * 包一层落库回调：user 消息顺手进话题缓存（「最近对话」的数据源），其余原样透传。
 * why 缓存在这里而不是服务里：话题是**注入件的私产**（service 不知道它的存在，
 * persistMessage 契约零改动）；落库回调是现成的观测点（user 消息必经它）。
 * 抛错隔离：base 抛错只记日志（与服务的 persist 同一口径 —— 话题完整性不绑架对话回路）。
 */
export function createTopicCachePersister<M extends PersistLike>(
  base: ((message: M) => void) | undefined,
  logger: (line: string) => void = (line) => console.warn(line)
): TopicCachePersister<M> {
  const topics = new Map<string, StratixTopicBrief>();
  return {
    persist(message: M): void {
      if (message.role === 'user') {
        topics.set(message.characterId, { text: message.text, at: Date.now() });
      }
      if (!base) return;
      try {
        base(message);
      } catch (error) {
        logger(`[StratixContext] 话题缓存委托落库抛错（${message.characterId}/${message.role}）：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    lastTopicFor(characterId: string): StratixTopicBrief | null {
      return topics.get(characterId) ?? null;
    },
  };
}

// ============================================================================
// service 侧统一入口（吞错 + 空快照降级）
// ============================================================================

/**
 * context-source → 块文本（chat / task / agent-chat 三个 service 共用的取件口）：
 * 注入件缺省（非 Electron / 测试）→ ''；快照 null → ''；实现抛错 → '' + 记日志。
 * 返回 '' 一律按「无块」处理（拼装函数原样走 035/037 的老路径）。
 */
export function resolveStratixContextBlock(
  source: StratixContextSource | undefined,
  characterId: string,
  logger: (line: string) => void = ((): void => { /* 缺省静默 */ })
): string {
  if (!source) return '';
  try {
    const snapshot = source(characterId);
    if (!snapshot) return '';
    return buildStratixContextBlock(snapshot);
  } catch (error) {
    logger(`[StratixContext] 快照取件抛错（${characterId}），本轮不注入：${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}
