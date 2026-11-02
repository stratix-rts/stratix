/**
 * 文件职责：**当日回放**（task_082 / DEMO-PLAN.md §9）的纯逻辑层 —— 时间轴条目形状、
 *   单位密度热力条的分桶、60 秒模式的压缩节奏、时间戳格式化与分级配色。
 *   来源：docs/DEMO-PLAN.md §9（底部 scrubber + 「▶ 60 秒看完今天」）。
 * 输入：core 总线上落盘的 task_run 事件（经读取口翻译成的 DayReplayEntry 列表）+ 唯一事实源
 *   里的 REPLAY_METRICS（桶数 / 压缩区间 / 气泡节流比）。
 * 输出：回放组件与回放控制器直接消费的常量与纯函数（无 IO、无 DOM、无副作用）。
 * 禁止事项：
 *   1. import world / phaser / app —— 铁律：hud 只认识 core；
 *   2. 自己读库 / 发总线事件 —— 读由读取口做（DayReplayPort），发由控制器做；
 *   3. 编造数据 —— 没有就是没有（无数据日走空态分支，不造一条假事件出来充数）；
 *   4. 写死色值字面量 —— 颜色取自唯一事实源 core/theme/visual-spec.ts 的 VISUAL_PALETTE，
 *      本文件只做「语义 → CSS 变量 + 兜底色」的翻译；
 *   5. 在这里做「哪条事件算回放节拍」的裁决 —— 那是读取口的事（它认会话事件的 type），
 *      本文件只处理**已经翻译好**的条目。
 *
 * ============ 条目形状（DayReplayEntry）============
 *   一条 = 当天某条 task_run 事件被翻译成的「一拍」：谁（characterId）、做了什么
 *   （kind）、什么时候（at）、短句（label）。回放器按 at 排序重演。
 *
 * @since v3.3（task_082）。
 */

import { REPLAY_METRICS, VISUAL_PALETTE } from '../../../core/theme/visual-spec';

/** 回放条目的一拍是什么（与 core/types 的 ReplayBeatKind 同一词表，去掉 reset —— reset 是控制流不是内容）。 */
export type DayReplayKind = 'spawn' | 'work' | 'done' | 'error';

/** 时间轴上的一条（= 当天的一条 task_run 事件）。 */
export interface DayReplayEntry {
  /** 真实时刻（ms）—— 时间轴定位与角标都按它。 */
  readonly at: number;
  /** 这一拍是什么。 */
  readonly kind: DayReplayKind;
  /** 执行角色 id。 */
  readonly characterId: string;
  /** 关联任务 id。 */
  readonly taskId: string;
  /** 短句（步骤标签 / 任务摘要截断）。 */
  readonly label: string;
  /** 来源会话 id（同一任务的多条事件归到一条会话上）。 */
  readonly sessionId: string;
}

/**
 * 当日回放的读取口（**结构同形**于 app 层的实现，见 app/services/day-replay.ts）。
 * 缺端口 = 没有回放（组件显示空态），绝不用假数据顶上。
 */
export interface DayReplayPort {
  /** 读某一天（本地日历日，缺省 = 今天）的 task_run 事件流；无数据 → 空数组。 */
  loadDay(options?: { readonly day?: Date }): Promise<readonly DayReplayEntry[]>;
}

/** 空态提示（无数据日显示它 —— 「今天没有活儿」也是一句实话）。 */
export const REPLAY_EMPTY_TEXT = '今天还没有任务记录 · 跑一条任务就有回放了';

/** 读取失败时的提示（读不到与没有是两回事，要说清楚）。 */
export const REPLAY_ERROR_TEXT = '回放数据读不到（存储面未附着）· 今天先手动看';

/** 分级 → 图标（零资产：字形，不引图标库、不加图片文件）。 */
export const REPLAY_ICONS: Readonly<Record<DayReplayKind, string>> = Object.freeze({
  spawn: '📋',
  work: '⚙️',
  done: '✅',
  error: '⚠️',
});

/**
 * 分级 → 语义色键（键名即 core/theme/visual-spec.ts 的 VISUAL_PALETTE 键）。
 * why 用键不用色值：色值只在唯一事实源一处。
 */
const REPLAY_TONE_KEYS: Readonly<Record<DayReplayKind, 'unit' | 'progress' | 'success' | 'danger'>> =
  Object.freeze({
    spawn: 'unit',
    work: 'progress',
    done: 'success',
    error: 'danger',
  });

/** 分级 → CSS 颜色表达式（`var(--srf-visual-*, 兜底色)`）；token 由 hud/theme/visual-tokens.ts 注入。 */
export function replayToneColor(kind: DayReplayKind): string {
  const key = REPLAY_TONE_KEYS[kind];
  return `var(--srf-visual-${key}, ${VISUAL_PALETTE[key]})`;
}

/** 时间轴的活跃时段（首末事件之间）。没有条目 → null（空态，不画条）。 */
export interface ReplaySpan {
  readonly from: number;
  readonly to: number;
}

/**
 * 取时间轴的活跃时段：首条到末条。
 * why 不按自然日 00:00-24:00 切：一天的活儿通常集中在几小时里，
 *   按自然日切会让热力条挤成一根针 —— 直播时观众什么都看不见。
 *   活跃时段两端各留 1 分钟余量（事件刚好落在边界上也不贴边）。
 */
export function replaySpan(entries: readonly DayReplayEntry[]): ReplaySpan | null {
  if (entries.length === 0) return null;
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry.at < from) from = entry.at;
    if (entry.at > to) to = entry.at;
  }
  if (from === to) return { from: from - 60_000, to: to + 60_000 };
  return { from: from - 60_000, to: to + 60_000 };
}

/** 时刻落在第几桶（越界夹住 —— 拖到最右端就是最后一桶）。 */
export function replayBucketIndex(at: number, span: ReplaySpan, buckets: number): number {
  if (buckets <= 0) return 0;
  const ratio = (at - span.from) / Math.max(1, span.to - span.from);
  const index = Math.floor(ratio * buckets);
  if (index < 0) return 0;
  if (index >= buckets) return buckets - 1;
  return index;
}

/**
 * 单位密度热力条：每桶统计**在场过的角色数**（不是事件条数 —— 事件密度会被
 * 「一个任务刷 50 条 step」灌爆，单位密度才读得出「今天有几个人在干活」）。
 * 返回长度 = 桶数，每格是该桶内的角色数。
 */
export function replayHeatBuckets(
  entries: readonly DayReplayEntry[],
  span: ReplaySpan,
  buckets: number = REPLAY_METRICS.heatBuckets
): number[] {
  const counts = new Array<number>(Math.max(1, buckets)).fill(0);
  const seen = new Map<number, Set<string>>();
  for (const entry of entries) {
    const index = replayBucketIndex(entry.at, span, counts.length);
    let set = seen.get(index);
    if (!set) {
      set = new Set<string>();
      seen.set(index, set);
    }
    set.add(entry.characterId);
  }
  for (const [index, set] of seen) counts[index] = set.size;
  return counts;
}

/**
 * 60 秒模式的每事件间隔（ms）：总时长摊到事件数上，再夹进规格钦定的 0.5-2s 区间。
 * why 夹住：事件太少时摊出来的间隔会到几十秒（那就不是「60 秒看完今天」了）；
 *   事件太多时摊出来的间隔会低于 0.5s（快到看不清在演什么）。
 */
export function replayGapMs(
  entryCount: number,
  targetMs: number = REPLAY_METRICS.sixtySecondTargetMs
): number {
  if (entryCount <= 0) return REPLAY_METRICS.maxEventGapMs;
  const raw = targetMs / entryCount;
  if (raw < REPLAY_METRICS.minEventGapMs) return REPLAY_METRICS.minEventGapMs;
  if (raw > REPLAY_METRICS.maxEventGapMs) return REPLAY_METRICS.maxEventGapMs;
  return Math.round(raw);
}

/** 时间戳角标：HH:MM:SS（本地时区 —— 回放的是「本地这一天」）。 */
export function formatReplayClock(at: number): string {
  const date = new Date(at);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** 角标上的日期：M月D日。 */
export function formatReplayDate(at: number): string {
  const date = new Date(at);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 条目短句（跑马灯 / 气泡用）：谁 + 做了什么 + 哪件事。 */
export function replayEntryText(entry: DayReplayEntry, characterName?: string | null): string {
  const who = (characterName ?? '').trim();
  const what = entry.label.trim();
  const target = what.length > 0 ? `「${what}」` : '';
  switch (entry.kind) {
    case 'spawn':
      return who && target ? `${who} 开工${target}` : who ? `${who} 开工了` : target ? `开工${target}` : '有人开工了';
    case 'work':
      return who && target ? `${who} 在${target}上推进` : who ? `${who} 在推进` : target ? `推进${target}` : '有人在推进';
    case 'done':
      return who && target ? `${who} 完成了${target}` : who ? `${who} 完成了任务` : target ? `${target}完成了` : '任务完成';
    case 'error':
      return who && target ? `${who} 在${target}上卡住了` : who ? `${who} 卡住了` : target ? `${target}卡住了` : '有任务卡住了';
  }
}

/** 按时刻升序排序（回放按时间走 —— 乱序会让画面跳）。不改原数组（纯函数）。 */
export function sortReplayEntries(entries: readonly DayReplayEntry[]): DayReplayEntry[] {
  return [...entries].sort((a, b) => a.at - b.at);
}

/**
 * 条目数封顶：超过上限只留**最新**的那些（老事件留着也没人回看；数据不许无限增长）。
 * why 留新不留旧：回放是「今天的故事」，结尾才是当下。
 */
export function capReplayEntries(
  entries: readonly DayReplayEntry[],
  max: number = REPLAY_METRICS.maxEntries
): DayReplayEntry[] {
  if (entries.length <= max) return [...entries];
  return sortReplayEntries(entries).slice(entries.length - max);
}

/** 时刻 → 时间轴上的比例（0-1；拖动定位用）。 */
export function replayRatio(at: number, span: ReplaySpan): number {
  const ratio = (at - span.from) / Math.max(1, span.to - span.from);
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

/** 比例 → 时刻（拖动定位的反函数）。 */
export function replayTimeAt(ratio: number, span: ReplaySpan): number {
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  return span.from + clamped * (span.to - span.from);
}
