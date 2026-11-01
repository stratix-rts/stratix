/**
 * 文件职责：角色成长看板的**视图模型与纯函数目录**（task_061）—— 角色屏「成长」tab 与
 *   全场总览排行卡的数据变换层。三块：
 *   ① 端口与输入形状（GrowthStatsPort / GrowthOverviewRow / GrowthExpEvent / GrowthTaskInput，
 *      与 app 层 exp-record.ts 的汇报形状**同构** —— 结构一致即可注入，不跨层 import：
 *      本文件不知道 DAO 行形状，exp-record 不知道看板算法，与 TaskStatsProvider 同一口径）；
 *   ② 时序聚合纯函数（buildExpSeries：近 30 天逐日经验曲线 / extractMilestones：升级里程碑 /
 *      buildHeatmap：近 7 天活动热力 —— 全部由 exp_events 单表时间序派生，why：三个来源
 *      权重都 > 0，任务终态与成功对话轮必落 exp 事件，exp_events 就是完整的活动日志）；
 *   ③ 排行与时间线（rankCharacters：等级 / 经验 / 完成率 / 活跃度四键排序可切换 /
 *      successRate：六态计数 → 完成率 / buildGrowthTimeline：建档 + 升级 + 终态任务的履历）。
 * 输入：端口异步取回的事件 / 聚合行 + WorldState.characters（等级 / 经验的当前真相）。
 * 输出：可直接渲染的视图模型（纯数据，无 DOM）。
 * 禁止事项：
 *   1. import app / world —— hud 铁律；数据只经注入端口进来；
 *   2. 在这里发 IPC / 订阅总线 —— 取数时机归 character-screen（tab 激活 / 节流刷新）；
 *   3. 编造数据 —— 空输入一律产空聚合（引导语判定归渲染层），不造假点。
 *
 * @since v3.36，task_061。依赖：exp_events 表（schema v12）、game:taskStats 聚合（task_050）。
 */

import type { CharacterView } from '../../core/types';

// ============================================================================
// ① 端口与输入形状（app 层 exp-record.ts 的同构镜像）
// ============================================================================

/** 六态任务计数（与 game:taskStats 的六态对齐；awaiting = awaiting_approval 缩写）。 */
export interface GrowthTaskCounts {
  readonly queued: number;
  readonly running: number;
  readonly awaiting: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

/** 全场总览的一行（活跃度聚合 + 六态计数；characterId 外的字段缺省由调用方降级）。 */
export interface GrowthOverviewRow {
  readonly characterId: string;
  readonly chatCount: number;
  readonly taskCount: number;
  readonly expEventCount: number;
  /** 三源里最近一次活动时刻；从未活动 = null。 */
  readonly lastActiveAt: number | null;
  /** 建档时刻（characters 表 created_at）；行缺失 = null。 */
  readonly createdAt: number | null;
  readonly taskCounts: GrowthTaskCounts;
}

/** 单条经验事件（app 层 PersistedExpEvent 的同构镜像；characterId 由取数方保证）。 */
export interface GrowthExpEvent {
  readonly delta: number;
  /** task_completed / task_failed / chat_round / level_up（后者的 delta 恒 0）。 */
  readonly reason: 'task_completed' | 'task_failed' | 'chat_round' | 'level_up';
  /** 升级后等级；仅 level_up 行非 null。 */
  readonly level: number | null;
  readonly createdAt: number;
}

/** 履历时间线的近期任务项（终态才有 endedAt）。 */
export interface GrowthTaskInput {
  readonly prompt: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly endedAt: number | null;
}

/** 成长看板数据口（注入 character-screen；各方法取不到返回 null → 引导语降级）。 */
export interface GrowthStatsPort {
  overview(): Promise<readonly GrowthOverviewRow[] | null>;
  expEvents(characterId: string): Promise<readonly GrowthExpEvent[] | null>;
  recentTasks(characterId: string): Promise<readonly GrowthTaskInput[] | null>;
}

// ============================================================================
// ② 时序聚合（exp_events 单表时间序 → 逐日桶）
// ============================================================================

/** 曲线窗口（近 30 天，与 app 侧 EXP_CURVE_WINDOW_MS 一致 —— 两处常量对不上曲线头尾会缺天）。 */
export const EXP_SERIES_DAYS = 30;

/** 热力窗口（近 7 天，日粒度 —— task_061 规格：7×24 与 7 天×日粒度二选一，选日粒度简化）。 */
export const HEATMAP_DAYS = 7;

/** 一天的毫秒数（聚合按日历日切桶，桶起点用本地时区 —— 与玩家「今天」的直觉一致）。 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 本地时区的当日零点（纯函数；jsdom 与生产同跑本地时区，测试可复算）。 */
export function dayStartOf(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 折线图的一个数据点：第 dayIndex 天（0 = 窗口最旧日）的经验增量与窗口内累计。 */
export interface ExpSeriesPoint {
  readonly dayIndex: number;
  /** 该日本地零点（横轴定位与里程碑映射共用）。 */
  readonly dayStart: number;
  /** 当日获得经验（level_up 里程碑行 delta = 0，天然不计数）。 */
  readonly gained: number;
  /** 窗口内截至当日的累计经验（起点非 0：角色早于窗口前就有积累，曲线只表达窗口内增量）。 */
  readonly cumulative: number;
}

/**
 * 近 30 天逐日经验曲线（纯函数）。窗口 = [今天零点 - 29 天, 今天零点]；窗口外事件丢弃
 * （端口侧已按 30 天截取，这里是防御性再截）。返回恒为 30 个点（无活动的天 gained = 0）：
 * 折线图横轴天数固定，缺天补零而不是缩短 —— 「没涨」也是信息。
 */
export function buildExpSeries(events: readonly GrowthExpEvent[], nowMs: number): readonly ExpSeriesPoint[] {
  const todayStart = dayStartOf(nowMs);
  const points: { dayIndex: number; dayStart: number; gained: number; cumulative: number }[] = [];
  for (let i = 0; i < EXP_SERIES_DAYS; i += 1) {
    const dayStart = todayStart - (EXP_SERIES_DAYS - 1 - i) * DAY_MS;
    points.push({ dayIndex: i, dayStart, gained: 0, cumulative: 0 });
  }
  const byDayStart = new Map(points.map((p) => [p.dayStart, p]));
  let running = 0;
  const inWindow = events
    .filter((event) => event.createdAt >= todayStart - (EXP_SERIES_DAYS - 1) * DAY_MS && event.createdAt <= nowMs)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const event of inWindow) {
    const bucket = byDayStart.get(dayStartOf(event.createdAt));
    if (!bucket) continue;
    bucket.gained += event.delta;
  }
  for (const point of points) {
    running += point.gained;
    point.cumulative = running;
  }
  return points;
}

/** 升级里程碑（level_up 行的 level 非 null；按发生时刻升序 —— 曲线标记与时间线共用）。 */
export interface GrowthMilestone {
  readonly at: number;
  readonly level: number;
}

/** 从事件流里挑升级里程碑（防御性：level 为 null 的 level_up 行跳过，不猜等级）。 */
export function extractMilestones(events: readonly GrowthExpEvent[]): readonly GrowthMilestone[] {
  return events
    .filter((event) => event.reason === 'level_up' && event.level !== null)
    .map((event) => ({ at: event.createdAt, level: event.level as number }))
    .sort((a, b) => a.at - b.at);
}

/** 热力图的一个格子：第 dayIndex 天（0 = 6 天前）的活动事件数。 */
export interface HeatCell {
  readonly dayIndex: number;
  readonly dayStart: number;
  readonly count: number;
}

/**
 * 近 7 天活动热力（日粒度，纯函数）。计数 = 当日全部经验事件条数（任务终态与成功对话轮
 * 权重恒 > 0 必落事件 —— 计条数即计活动，不按 delta 加权：一次大任务与一轮对话都算一次活动，
 * 「动没动」比「动了多少」更贴热力语义）。返回恒为 7 格，无活动的天 0。
 */
export function buildHeatmap(events: readonly GrowthExpEvent[], nowMs: number): readonly HeatCell[] {
  const todayStart = dayStartOf(nowMs);
  const cells: { dayIndex: number; dayStart: number; count: number }[] = [];
  for (let i = 0; i < HEATMAP_DAYS; i += 1) {
    const dayStart = todayStart - (HEATMAP_DAYS - 1 - i) * DAY_MS;
    cells.push({ dayIndex: i, dayStart, count: 0 });
  }
  const byDayStart = new Map(cells.map((c) => [c.dayStart, c]));
  const windowStart = todayStart - (HEATMAP_DAYS - 1) * DAY_MS;
  for (const event of events) {
    if (event.createdAt < windowStart || event.createdAt > nowMs) continue;
    const bucket = byDayStart.get(dayStartOf(event.createdAt));
    if (bucket) bucket.count += 1;
  }
  return cells;
}

// ============================================================================
// ③ 排行与时间线
// ============================================================================

/** 排行键（全场总览的排序切换；等级 / 经验 / 完成率 / 活跃度）。 */
export type GrowthRankMode = 'level' | 'exp' | 'successRate' | 'activity';

/** 排行卡条目：WorldState 角色（等级 / 经验当前真相）+ 聚合行（可缺席：无数据 → 中性显示）。 */
export interface GrowthRankEntry {
  readonly character: CharacterView;
  readonly row: GrowthOverviewRow | null;
}

/** 排行模式定义（渲染序 = 声明序；label 供排序切换按钮直用）。 */
export const GROWTH_RANK_MODES: readonly { readonly id: GrowthRankMode; readonly label: string }[] = [
  { id: 'level', label: '等级' },
  { id: 'exp', label: '经验' },
  { id: 'successRate', label: '完成率' },
  { id: 'activity', label: '活跃度' },
];

/**
 * 六态计数 → 完成率（0-1）。分母只数 completed + failed（cancelled / 在办不计入 —— 与
 * 派发推荐的成功率口径一致）；分母为 0 返回 null（无终态 ≠ 完成率 0，那是「没跑过」）。
 */
export function successRate(counts: GrowthTaskCounts): number | null {
  const settled = counts.completed + counts.failed;
  if (settled === 0) return null;
  return counts.completed / settled;
}

/**
 * 全场排行（纯函数）：角色按选定键降序；同级按 WorldState 原序（建档序）稳定破平。
 * 完成率 / 活跃度对「无聚合行」的角色按 -1 记（有数据者恒排前；无数据者之间保持原序）——
 * 不编 0：完成率 0% 与「没跑过」在卡面上要能区分（空数据准则）。
 */
export function rankCharacters(
  characters: readonly CharacterView[],
  rows: readonly GrowthOverviewRow[] | null,
  mode: GrowthRankMode
): readonly GrowthRankEntry[] {
  const byId = new Map((rows ?? []).map((row) => [row.characterId, row]));
  const entries: GrowthRankEntry[] = characters.map((character) => ({ character, row: byId.get(character.id) ?? null }));
  const rankKey = (entry: GrowthRankEntry): number => {
    switch (mode) {
      case 'level':
        return entry.character.level;
      case 'exp':
        return entry.character.experience;
      case 'successRate': {
        if (!entry.row) return -1;
        const rate = successRate(entry.row.taskCounts);
        return rate === null ? -1 : rate;
      }
      case 'activity':
        return entry.row?.lastActiveAt ?? -1;
    }
  };
  // 稳定排序：比较器只对 rankKey 差值表态，同键保持原序（entries 索引即 WorldState 建档序）。
  return entries.slice().sort((a, b) => rankKey(b) - rankKey(a));
}

/** 履历时间线的一条。 */
export interface GrowthTimelineEntry {
  readonly atMs: number;
  readonly kind: 'created' | 'levelUp' | 'task';
  /** 展示文案（时间线纯数据：文案归这里，格式化时刻归渲染层）。 */
  readonly label: string;
}

/** 时间线上限（最新在前；超出截旧 —— 履历是回顾不是流水账全量）。 */
export const GROWTH_TIMELINE_CAP = 12;

/**
 * 相对时刻文案（纯函数）：刚刚 / N 分钟前 / N 小时前 / 落到「M/D HH:MM」。
 * 24h 内用相对措辞（排行卡的「最近活跃」与时间线的近期条目），更早用日期 ——
 * 玩家关心「多久没动」多于「几点几分」，超过一天精确到分钟即可。
 */
export function formatRelative(atMs: number, nowMs: number): string {
  const diff = nowMs - atMs;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(atMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/**
 * 履历时间线（纯函数）：建档（characters.created_at）+ 升级里程碑 + 终态任务，按时刻降序、
 * 截最近 CAP 条。缺锚点（createdAt = null、无事件、无任务）的段自然缺席 —— 不编「某日出生」。
 */
export function buildGrowthTimeline(
  createdAt: number | null,
  events: readonly GrowthExpEvent[],
  tasks: readonly GrowthTaskInput[]
): readonly GrowthTimelineEntry[] {
  const entries: GrowthTimelineEntry[] = [];
  if (createdAt !== null && Number.isFinite(createdAt)) {
    entries.push({ atMs: createdAt, kind: 'created', label: '建档入列' });
  }
  for (const milestone of extractMilestones(events)) {
    entries.push({ atMs: milestone.at, kind: 'levelUp', label: `升到 Lv.${milestone.level}` });
  }
  for (const task of tasks) {
    if (task.endedAt === null) continue;
    const prefix = task.status === 'completed' ? '完成任务' : task.status === 'failed' ? '任务失败' : '取消任务';
    entries.push({ atMs: task.endedAt, kind: 'task', label: `${prefix}：${task.prompt}` });
  }
  return entries.sort((a, b) => b.atMs - a.atMs).slice(0, GROWTH_TIMELINE_CAP);
}
