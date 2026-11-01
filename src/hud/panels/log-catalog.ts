/**
 * 文件职责：统一日志抽屉的**视图模型派生**（纯逻辑，零 DOM、零依赖）—— 把旧 LogPanelModal
 *   （指令日志：状态色块 + 时间 + 来源）与 TaskLogViewer（任务日志：按 agent / 状态 / 时间段过滤）
 *   合并成一份 WorldState → LogModel 的派生，UI 呈现全部在 log-drawer.ts。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级；语义提取自 src/components/LogPanelModal.vue
 *   与 src/components/TaskLogViewer.vue（只提取语义，未复制任何实现）。
 * 输入：WorldState（notices + missions）。
 * 输出：LogEntryView[]（累积日志条目）与 LogModel（过滤 + 计数后的渲染用模型）。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染是 log-drawer.ts 的事；
 *   2. import world/、vue、@/stratix-rts、core/bus —— 铁律，经注入的 adapter 收发；
 *   3. 拉取日志（fetch / 轮询）—— 旧 TaskLogViewer 的 2s 轮询是它的私有实现，v3 的日志是
 *      **core 广播的副产品**，轮询既拿不到 WorldState 又会凭空造一份第二真相；
 *   4. 在本地维护业务态 —— 条目全部由 WorldState.notices / WorldState.missions 派生；
 *   5. 造数据 —— 没有 notice / 任务变化就没有日志行，空就是空，绝不编造占位行。
 *
 * ★ 本文件最重要的一条语义（与旧面板的根本差异）：
 *   **抽屉是累积视图，不是 WorldState.notices 的镜像。**
 *   notices 有 NOTICE_TTL_MS(6s) 的自动过期、且被 core 按 MAX_NOTICES 截断 ——
 *   若每次广播都"从 state 重画"，日志会在 6 秒后自己清空，抽屉就废了。
 *   所以这里的口径是 **增量消费**：见过的条目留在本地环缓冲里，直到被挤出上限或用户清空。
 *   这也是 mergeLogEntries 存在的全部理由。
 */

import type { MissionPhase, MissionView, NoticeLevel, WorldState } from '../../core/types';

// ============================================================================
// 容量上限（perf 硬约束：累积视图必须有界，否则 core 一直广播、日志一直涨）
// ============================================================================

/**
 * 日志环缓冲上限：最多保留最近 N 条，超出丢最旧的。
 * why 需要它：notices 已由 core 按 MAX_NOTICES 截断、missions 按 MAX_MISSIONS 截断，
 *   但抽屉是**累积**的（见文件头），不设上限就会随运行时长无限增长 —— 内存 + 每次重绘成本一起涨。
 * 取 500：足够看完一轮联调，又不至于让单次重绘变贵。
 */
export const MAX_LOG_ENTRIES = 500;

/**
 * "已消费"跟踪器的容量上限（比缓冲宽 4 倍）。
 * why 需要它：合并时要判断"这条 notice / 这个任务相位是不是第一次见"，这份记忆本身也是累积的。
 * 上限保证它不无限增长；FIFO 淘汰掉的 id 都是远早于缓冲视界的旧 id，
 * 而 core 侧 notices 6s 就过期、missions 上限 100，理论上不会造成重复行。
 */
export const MAX_TRACKED_IDS = MAX_LOG_ENTRIES * 4;

// ============================================================================
// 词表（契约取值 → 中文标签；改这里即可改文案，不牵连组件）
// ============================================================================

/**
 * 日志级别。**刻意复用契约的 NoticeLevel**，不另立一套词表：
 * 日志的级别来源就是 Notice.level，另起 'debug'/'success' 会让 HUD 与 core 的级别判定漂移。
 * 任务事件按相位映射到 info / warn（见 MISSION_PHASE_LEVELS）。
 */
export type LogLevel = NoticeLevel;

/** 契约的三级就是日志的级别全集，按"重要性从低到高"排列，用于渲染级别筛选条的按钮顺序。 */
export const LOG_LEVELS: readonly LogLevel[] = ['info', 'warn', 'error'];

const LEVEL_LABELS: Record<LogLevel, string> = {
  info: '信息',
  warn: '警告',
  error: '错误',
};

/** 级别 → 渲染用的语义色槽。组件据此挑 --srf-* 变量，色值本身不落在这里。 */
const LEVEL_TONES: Record<LogLevel, 'info' | 'warn' | 'error'> = {
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/** 行来源。notice = core 通知；mission = 任务相位迁移（由 WorldState.missions 现算，不是 core 显式事件流）。 */
export type LogSourceKind = 'notice' | 'mission';

const SOURCE_LABELS: Record<LogSourceKind, string> = {
  notice: '通知',
  mission: '任务',
};

/**
 * 任务相位 → 日志级别。
 * why：契约的 NoticeLevel 只有三级，而 MissionPhase 有六个 —— 必须有一张显式的归一表，
 *   否则"HUD 认为该记什么级别"就成了各组件各写一套 if 的隐含约定。
 * cancelled 记 warn（值得注意但不是故障）、done 记 info；草稿/待确认/已接收/进行中都是 info。
 */
const MISSION_PHASE_LEVELS: Record<MissionPhase, LogLevel> = {
  draft: 'info',
  pending: 'info',
  confirmed: 'info',
  running: 'info',
  done: 'info',
  cancelled: 'warn',
};

const MISSION_PHASE_LABELS: Record<MissionPhase, string> = {
  draft: '草稿',
  pending: '待确认',
  confirmed: '已接收',
  running: '进行中',
  done: '已完成',
  cancelled: '已取消',
};

/** notice 未标注 source（Notice.source 是 @since v3.4 的可选增补）时的兜底来源文案。 */
const DEFAULT_NOTICE_SOURCE = SOURCE_LABELS.notice;

// ============================================================================
// 渲染用模型
// ============================================================================

/** 一行日志。字段与任务书一一对应：时间 / 来源 / 级别 / 正文（+ 归属任务，供按任务过滤）。 */
export interface LogEntryView {
  /**
   * 条目稳定 id，格式 `notice:<noticeId>` / `mission:<missionId>:<phase>`。
   * why 要合成 id：增量消费靠它判重，而任务会反复在多个相位之间迁移，
   * 只有带上相位，"pending→running" 才算两条不同的事（否则第二次迁移被当成重复吞掉）。
   */
  readonly id: string;
  /** 发生时刻（ms）。notice 取 createdAt；任务事件取 HUD 观测到迁移的时刻（见 mergeLogEntries）。 */
  readonly at: number;
  readonly level: LogLevel;
  /** 级别语义色槽，供组件选 --srf-* 变量。 */
  readonly tone: 'info' | 'warn' | 'error';
  readonly levelLabel: string;
  /** 来源类别，决定"来源"列的图标/前缀。 */
  readonly sourceKind: LogSourceKind;
  /** 来源文案：notice.source（core 标注了才显示它）或来源类别兜底文案。 */
  readonly source: string;
  /** 正文。 */
  readonly text: string;
  /** 归属任务 id；与任务无关的通知为 null。 */
  readonly missionId: string | null;
  /** 归属任务标题（命中 WorldState.missions 才有）；悬空时为 null，组件退化成显示 id。 */
  readonly missionTitle: string | null;
}

/** 任务下拉的候选项。label 由 core 的 mission.title 提供，抽屉不自己起名。 */
export interface MissionOption {
  readonly id: string;
  readonly label: string;
}

/**
 * 日志筛选条件。
 *   missionId = null → 全部任务；给值 → 只留归属该任务的条目（与任务无关的通知不在其中）。
 *   levels    = null → 不过滤（全部级别）；给 Set → 只留集合内的级别，空 Set 则一条都不显示。
 * 用 null 而不是空值表达"不过滤"，是为了让"取消勾选全部"与"没设置过滤"在语义上不混淆。
 */
export interface LogFilter {
  readonly missionId: string | null;
  readonly levels: ReadonlySet<LogLevel> | null;
}

export const EMPTY_LOG_FILTER: LogFilter = { missionId: null, levels: null };

export interface LogModel {
  /** 过滤后、即将渲染的条目（倒序：最新在前）。 */
  readonly entries: readonly LogEntryView[];
  /** 缓冲里过滤后的总条数（可能大于 entries.length，因渲染上限截断）。 */
  readonly matchCount: number;
  /** 缓冲总条数（未过滤）。 */
  readonly totalCount: number;
  /** 累计被环缓冲挤掉的旧条目数：>0 说明有历史没显示，如实报出，不假装"这就是全部"。 */
  readonly droppedCount: number;
  /** 任务下拉候选项（来自当前 state.missions，按 title 排序，空 title 退化成 id）。 */
  readonly missions: readonly MissionOption[];
  /** 摘要文案，如「12 / 40 条」。 */
  readonly summary: string;
}

// ============================================================================
// 已消费跟踪（增量消费的记忆）
// ============================================================================

/**
 * "已消费"跟踪器：记住见过哪些条目 id，供 mergeLogEntries 判重。
 * 刻意**不提供 clear()**：抽屉的「清空当前视图」只清条目、不清这份记忆 ——
 *   否则下一次广播会把 state 里还活着的 notice 全部回放一遍，"清空"等于没清。
 *   调方想重置只能整个重建跟踪器（而抽屉没有重建的理由）。
 */
export interface SeenTracker {
  has(id: string): boolean;
  add(id: string): void;
  readonly size: number;
}

/** 建一个上限为 limit 的 FIFO 跟踪器（满则淘汰最早的 id，保证记忆本身有界）。 */
export function createSeenTracker(limit: number = MAX_TRACKED_IDS): SeenTracker {
  const seen = new Set<string>();
  const order: string[] = [];
  return {
    has: (id) => seen.has(id),
    add: (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      order.push(id);
      while (order.length > limit) {
        const oldest = order.shift();
        if (oldest !== undefined) seen.delete(oldest);
      }
    },
    get size(): number { return seen.size; },
  };
}

// ============================================================================
// 派生：notice / mission 事件 → 日志条目
// ============================================================================

/** notice id → 条目 id。格式与 mission 事件错开，避免两类来源撞 id。 */
export const noticeEntryId = (noticeId: string): string => `notice:${noticeId}`;

/** mission 相位 → 条目 id。带相位：同一任务的多次迁移是多个条目。 */
export const missionEntryId = (missionId: string, phase: MissionPhase): string => `mission:${missionId}:${phase}`;

/**
 * notice → 日志条目。
 * source 取 core 标注的 Notice.source（@since v3.4 可选字段），没标注就用通用来源文案，不编造。
 * missionId 同理：没标注就是 null（与任务无关），不硬塞一个当前任务上去。
 */
function fromNotice(notice: WorldState['notices'][number]): LogEntryView {
  const level: LogLevel = notice.level;
  return {
    id: noticeEntryId(notice.id),
    at: notice.createdAt,
    level,
    tone: LEVEL_TONES[level],
    levelLabel: LEVEL_LABELS[level],
    sourceKind: 'notice',
    source: notice.source ?? DEFAULT_NOTICE_SOURCE,
    text: notice.text,
    missionId: notice.missionId ?? null,
    missionTitle: null, // 标题在 buildLogModel 里按 missionId 回填（此处还没有 missions 全集）
  };
}

/**
 * 任务相位 → 日志条目。时刻用观测时刻 observedAt，不复用 MissionView.createdAt：
 * createdAt 是**任务创建**时间，不是这次相位迁移的时间，拿它当行时间会显示成"很早以前发生过"。
 * 契约里没有相位迁移时间戳，本地也没有时钟真相 —— 观测时刻是唯一诚实的取值，并在此写明。
 */
function fromMission(mission: MissionView, observedAt: number): LogEntryView {
  const level = MISSION_PHASE_LEVELS[mission.phase];
  return {
    id: missionEntryId(mission.id, mission.phase),
    at: observedAt,
    level,
    tone: LEVEL_TONES[level],
    levelLabel: LEVEL_LABELS[level],
    sourceKind: 'mission',
    source: SOURCE_LABELS.mission,
    text: `「${mission.title}」${MISSION_PHASE_LABELS[mission.phase]}`,
    missionId: mission.id,
    missionTitle: mission.title,
  };
}

/** 一次增量合并的结果。added / dropped 单独报出来，是为了让"溢出"可被如实统计（不能从截断后的数组反推）。 */
export interface LogMergeResult {
  /** 新缓冲（最新在前，长度 ≤ MAX_LOG_ENTRIES）。 */
  readonly entries: readonly LogEntryView[];
  /** 本次并入的新条目数。 */
  readonly added: number;
  /** 本次因上限被挤掉的旧条目数。 */
  readonly dropped: number;
}

/**
 * 增量合并：把一次 WorldState 广播里"第一次见到的" notice / 任务相位并进本地缓冲。
 *
 * @param prev    已有缓冲（最新在前）
 * @param state   本次 core 广播；null = 还没收到状态，原样返回 prev
 * @param observedAt 任务事件的观测时刻（调用方传 Date.now()，单测传固定值 → 可确定性断言）
 * @param seen    已消费跟踪器（会被就地写入）
 *
 * 幂等：同一份 state 反复合并不会长出新条目（判重靠 seen，不靠"当前 state 快照"），
 *   无新增时连数组引用都不换（调用方可据此跳过重绘）。
 * 首帧会**播种** state 里已有的 notice 与任务当前相位 —— 抽屉一挂上就有内容，
 * 而不是等下一条事件才空着（这也让"订阅即渲染"这条验收标准可观察）。
 */
export function mergeLogEntries(
  prev: readonly LogEntryView[],
  state: WorldState | null,
  observedAt: number,
  seen: SeenTracker,
): LogMergeResult {
  if (!state) return { entries: prev, added: 0, dropped: 0 };

  const fresh: LogEntryView[] = [];

  for (const notice of state.notices) {
    const id = noticeEntryId(notice.id);
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push(fromNotice(notice));
  }

  for (const mission of state.missions) {
    const id = missionEntryId(mission.id, mission.phase);
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push(fromMission(mission, observedAt));
  }

  if (fresh.length === 0) return { entries: prev, added: 0, dropped: 0 };

  // 一次广播里可能同时来多条（同相位迁移共用观测时刻），按时间倒序 + id 倒序定序，保证可重现。
  fresh.sort((a, b) => (b.at - a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  const merged = [...fresh, ...prev];
  // 上限同时约束缓冲长度：累积视图不设界会随运行时长无限涨（perf 硬约束）。
  return {
    entries: merged.length > MAX_LOG_ENTRIES ? merged.slice(0, MAX_LOG_ENTRIES) : merged,
    added: fresh.length,
    dropped: Math.max(0, merged.length - MAX_LOG_ENTRIES),
  };
}

// ============================================================================
// 日志流（把"累积缓冲 + 已消费记忆 + 溢出计数"收在一处的有状态壳）
// ============================================================================

/**
 * 日志流：抽屉持有的累积视图。
 * why 需要它：累积语义天生跨帧有状态（prev / seen / 溢出计数），若让组件自己维护这三个变量，
 *   组件就得既懂派生规则又懂存储规则，两处都会漂。收进一个壳后，组件只剩"喂 state、读模型"。
 */
export interface LogStream {
  /** 当前缓冲（最新在前，长度 ≤ MAX_LOG_ENTRIES）。 */
  readonly entries: readonly LogEntryView[];
  /** 累计被缓冲上限挤掉的条数。 */
  readonly droppedCount: number;
  /** 喂一次 core 广播；无可合并内容时原样返回，不产生新数组。 */
  consume(state: WorldState | null, observedAt: number): readonly LogEntryView[];
  /**
   * 清空当前视图（用户点「清空」）。
   * ★ 刻意**不清 seen**：state 里还活着的 notice 若立刻回放，"清空"就等于没清。
   *   代价是新任务相位仍会照常记入（那本来就是新事件），这是对的。
   */
  clear(): void;
}

/** 造一个日志流。缓冲上限由 mergeLogEntries 统一按 MAX_LOG_ENTRIES 强制，记忆上限按 MAX_TRACKED_IDS。 */
export function createLogStream(): LogStream {
  const seen = createSeenTracker();
  let entries: readonly LogEntryView[] = [];
  let dropped = 0;

  return {
    get entries(): readonly LogEntryView[] { return entries; },
    get droppedCount(): number { return dropped; },
    consume: (state, observedAt) => {
      const result = mergeLogEntries(entries, state, observedAt, seen);
      // added === 0 时 merge 返回的是同一个数组引用，跳过赋值 = 不惊动调用方的判重。
      if (result.added > 0) {
        entries = result.entries;
        dropped += result.dropped;
      }
      return entries;
    },
    clear: () => { entries = []; },
  };
}

// ============================================================================
// 派生：过滤 + 渲染模型
// ============================================================================

/** 任务下拉候选项。排序稳定（按 label 的 zh 序），空 title 退化成 id —— 不留空选项。 */
export function collectMissionOptions(state: WorldState | null): readonly MissionOption[] {
  if (!state) return [];
  return [...state.missions]
    .map((m) => ({ id: m.id, label: m.title || m.id }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
}

/** 按 missionId / 级别过滤。返回的仍是原序（倒序），不重排。 */
export function filterLogEntries(
  entries: readonly LogEntryView[],
  filter: LogFilter = EMPTY_LOG_FILTER,
): readonly LogEntryView[] {
  return entries.filter((entry) => {
    if (filter.missionId !== null && entry.missionId !== filter.missionId) return false;
    if (filter.levels !== null && !filter.levels.has(entry.level)) return false;
    return true;
  });
}

/**
 * 汇总成渲染模型：回填任务标题 → 过滤 → 计数 → 按渲染上限截断。
 * @param all   缓冲全量（最新在前）
 * @param state 当前 state，只用来查 mission 标题（不参与过滤判定，避免"标题查不到就不显示"）
 */
export function buildLogModel(
  all: readonly LogEntryView[],
  filter: LogFilter = EMPTY_LOG_FILTER,
  state: WorldState | null = null,
  droppedCount = 0,
): LogModel {
  const titles = new Map<string, string>();
  for (const m of state?.missions ?? []) {
    if (m.title) titles.set(m.id, m.title);
  }

  // 标题回填是纯展示补全：命中 missions 就显示标题，否则显示 id，条目本身一条都不少。
  const titled = all.map((entry) =>
    entry.missionId !== null && entry.missionTitle === null && titles.has(entry.missionId)
      ? { ...entry, missionTitle: titles.get(entry.missionId) ?? null }
      : entry,
  );

  const matched = filterLogEntries(titled, filter);

  return {
    entries: matched,
    matchCount: matched.length,
    totalCount: titled.length,
    droppedCount,
    missions: collectMissionOptions(state),
    summary: buildSummary(titled.length, matched.length),
  };
}

function buildSummary(total: number, matched: number): string {
  return matched === total ? `${total} 条` : `${matched} / ${total} 条`;
}

// ============================================================================
// 渲染签名（perf：core 每次状态变更都全量广播，无变化的广播不该触发重绘）
// ============================================================================

/**
 * 日志源的签名：只对"会影响日志视图"的状态敏感 —— notices 的 id/级别/时刻/来源/归属，
 * 以及 missions 的 id/相位/标题。选中集、单位读数等变化不改变签名。
 *
 * why 需要它：抽屉是**累积**的，合并逻辑每帧都要扫 notices + missions 两次（各 ≤ MAX_*）。
 * 签名先判一道，绝大多数广播（选择拖拽、相机移动等）在合并前就被挡掉。
 * 标题也进签名：任务改名不改相位，不改签名的话已有行的标题会一直显示旧值（buildLogModel 是按
 * state 现回填标题的），而抽屉是累积视图 —— 没有新行也要把显示补齐。
 */
export function logSignature(state: WorldState | null): string {
  if (!state) return 'none';
  const notices = state.notices
    .map((n) => `${n.id}~${n.level}~${n.createdAt}~${n.source ?? ''}~${n.missionId ?? ''}`)
    .join(',');
  const missions = state.missions.map((m) => `${m.id}~${m.phase}~${m.title}`).join(',');
  return `n:${notices}|m:${missions}`;
}

// ============================================================================
// 小工具
// ============================================================================

/**
 * 行时间格式化：本地时区 HH:MM:SS。
 * 刻意不用 toLocaleString —— 旧 TaskLogViewer 用的是 zh-CN 长格式，输出随 ICU 数据/时区变，
 * 单测没法断言；固定零填充格式在任何机器上都稳定，且日志视图要的是"扫一眼"而不是"读全日期"。
 */
export function formatLogTime(at: number): string {
  if (!Number.isFinite(at)) return '--:--:--';
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 级别 → 中文标签（组件与测试共用，避免两处各写一份）。 */
export function levelLabel(level: LogLevel): string {
  return LEVEL_LABELS[level];
}

/** 来源类别 → 中文文案。 */
export function sourceLabel(kind: LogSourceKind): string {
  return SOURCE_LABELS[kind];
}