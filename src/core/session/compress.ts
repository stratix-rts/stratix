/**
 * 文件职责：**会话长会话压缩**（core/session —— v3.2b-B7 / task_106）—— 三件事：
 *   ① **折叠规划**：哪一段原文该被折叠（老段折、近期留）；
 *   ② **规则摘要**：结构化摘要（**不用 LLM**；LLM 端口留在 types.ts，本期不实现）；
 *   ③ **读取路由**：「摘要 + 近期原文」的读法（含 includeRaw 展开原段 + 分页）。
 * 方案来源：docs/SESSION-PLAN.md §8「压缩规则版先行」（eventCount>阈值 → 老事件段折叠为
 *   type=compressed 的 summary 事件；get_events 读取路由返回「摘要+近期原文」）。
 * 输入：会话事件流（读面视图；seq 正序）+ 一条会话摘要。
 * 输出：折叠计划（纯数据）/ 摘要载荷 / 路由结果（可见事件的一段）。
 * 禁止事项：
 *   1. 碰存储 / SQLite / DOM —— 本文件是**纯逻辑**（读路由的 IO 由 app 层做）；
 *   2. 改写或删除原文事件 —— 事件流是 append-only 的审计真相：
 *      折叠靠**摘要事件盖住区间**（fromSeq..toSeq）实现跳过，原文一个字都不改；
 *   3. 在这里发网络请求 —— LLM 摘要要 IO，属 app 层；core 这边只有规则版（零 IO、可单测）；
 *   4. 自己决定「读多少条」 —— 分页口径（beforeSeq 游标 / limit）归调用方，本文件只路由。
 *
 * ★ 为什么「折叠」能只靠**追加一条摘要**实现：
 *   session_events 是 append-only 的（不删行是这张表的立表理由）。若把老原文"删掉"，
 *   审计真相就毁了；于是反过来 —— **摘要盖住区间**：读路由遇到一条 compressed 摘要，
 *   就跳过它覆盖的 [fromSeq..toSeq] 区间的原文（除非调用方要 includeRaw 展开）。
 *   代价：库里那几行原文还在（存储不省），换来的是「历史可查、折叠可逆、摘要可追」。
 *
 * ★ 为什么「已折叠」是一个**前缀区间**（coveredToSeq）：
 *   折叠总是从**最老的未折叠原文**开始，且保留窗（最近 N 条原文）永远在最末 ——
 *   于是被折叠的原文恒为一段前缀，摘要区间合并后是一条连续区间。
 *   这让「哪些原文已被折叠」可以用一个数（coveredToSeq）表达：
 *   追加事件时增量维护它，不必每次重扫全量事件流（性能铁律：长会话不许 O(n) per append）。
 *
 * @since v3.48（task_106 / v3.2b-B7）。
 */

import {
  MAX_SESSION_COMPRESS_KEY_EVENTS,
  MAX_SESSION_COMPRESS_SUMMARY_LEN,
  MAX_SESSION_PARTICIPANTS,
  type SessionCompressInput,
  type SessionCompressPayload,
  type SessionCompressSummarizer,
  type SessionRecord,
} from './types';

/** 压缩摘要事件的类型名（与 SessionEventPayloadMap 的键同名）。 */
export const COMPRESSED_EVENT_TYPE = 'compressed';

/**
 * 可路由的事件**最小形状**（写面事件 / 持久化行都满足它）。
 * why 不直接用 SessionEventView：读路由的调用方有两类 —— core 侧拿到的是
 *   SessionEventView，app 侧 DAO 拿到的是 PersistedSessionEvent（同一形状、不同名字）。
 *   路由只用到 seq / type / payload 三个字段，故按**结构最小形状**收口（两份形状都能进）。
 */
export interface RoutableSessionEvent {
  readonly sessionId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: number;
}

/** 折叠区间（摘要覆盖的 seq 区间，含端点）。 */
export interface CompressedRange {
  readonly fromSeq: number;
  readonly toSeq: number;
}

/** 一次折叠的**计划**（纯数据：还不写任何东西）。 */
export interface CompressionPlan {
  /** 被折叠的原文事件（seq 正序）。 */
  readonly folded: readonly RoutableSessionEvent[];
  /** 折叠区间（含端点）。 */
  readonly fromSeq: number;
  readonly toSeq: number;
  /** 折叠后**保留**的近期原文条数（= 保留窗大小）。 */
  readonly keptCount: number;
}

/** 读取路由的入参。 */
export interface SessionEventRouteOptions {
  /** 展开被折叠的原段（缺省 = 只给「摘要 + 近期原文」）。 */
  readonly includeRaw?: boolean;
  /** 游标：只取 seq **小于**它的那些事件（与 DAO 的 beforeSeq 同一口径）。 */
  readonly beforeSeq?: number;
  /** 本页条数上限（调用方给；本文件只做下限保护）。 */
  readonly limit: number;
}

/** 读取路由的结果。 */
export interface SessionEventRoute {
  /** 本页事件（seq 正序）。 */
  readonly items: readonly RoutableSessionEvent[];
  /** 路由后**可见**的事件总数（默认视图 = 摘要 + 近期原文；展开原段时 = 全量）。 */
  readonly total: number;
  /** 本页之前还有没有更多可见事件。 */
  readonly hasMore: boolean;
  /** 该会话是否发生过压缩（有没有摘要事件）。 */
  readonly compressed: boolean;
  /** 被折叠的区间（供客户端定位原段 / 提示"这里可以展开"）。 */
  readonly ranges: readonly CompressedRange[];
}

/**
 * 解析事件流里的**折叠区间**（读面不校验载荷形状 → 这里必须防御式解析）。
 *
 * why 防御：摘要载荷来自库里的 JSON（可能来自旧版本 / 脏行）——
 *   解析失败就当这条摘要不存在（**不编造**区间），宁可少折叠也不错折叠。
 */
export function collectCompressedRanges(
  events: readonly RoutableSessionEvent[]
): CompressedRange[] {
  const ranges: CompressedRange[] = [];
  for (const event of events) {
    if (event.type !== COMPRESSED_EVENT_TYPE) continue;
    const payload = asRecord(event.payload);
    if (!payload) continue;
    const fromSeq = toFiniteInt(payload.fromSeq);
    const toSeq = toFiniteInt(payload.toSeq);
    if (fromSeq === null || toSeq === null || toSeq < fromSeq) continue;
    ranges.push({ fromSeq, toSeq });
  }
  return ranges;
}

/**
 * 把折叠区间合并成**互不相交**的有序区间（相邻的也合并）。
 *
 * why 要合并：折叠是逐段追加的，区间天然首尾相接（[1..151]、[152..152]、[153..153]…）——
 *   合并成一条后，判断「某 seq 是否被折叠」退化成一次二分查找（O(log n)），
 *   而不是每次扫全部区间（O(n) per event，长会话下会拖垮读路由）。
 */
export function mergeCompressedRanges(
  ranges: readonly CompressedRange[]
): CompressedRange[] {
  const valid = ranges.filter((range) => range.toSeq >= range.fromSeq);
  if (valid.length === 0) return [];
  const sorted = valid.slice().sort((a, b) => a.fromSeq - b.fromSeq);
  const merged: CompressedRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.fromSeq <= last.toSeq + 1) {
      // 相接或重叠 → 并成一条（保留更长的那一端）。
      if (range.toSeq > last.toSeq) {
        merged[merged.length - 1] = { fromSeq: last.fromSeq, toSeq: range.toSeq };
      }
      continue;
    }
    merged.push({ fromSeq: range.fromSeq, toSeq: range.toSeq });
  }
  return merged;
}

/**
 * 某个 seq 是否落在某个折叠区间里（区间已合并 → 二分查找）。
 */
export function isCoveredSeq(seq: number, ranges: readonly CompressedRange[]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = ranges[mid]!;
    if (seq < range.fromSeq) {
      high = mid - 1;
    } else if (seq > range.toSeq) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * 规划一次折叠：从给定的原文里折掉**最老的 count 条**（其余留着）。
 *
 * 口径：
 *   - 「原文」= 非 compressed 类型、且不在任何折叠区间里的事件（seq 正序）；
 *   - 折掉的是**最老**的那 count 条（新的原文永远比老的更值得看）；
 *   - 实际可折不足 count 条 → 就折那么多（返回的计划里 folded 就是实折的那些）。
 *
 * why 用「条数」而不是「保留窗」做参数：调用方（manager）手里有**待折原文的条数**
 *   （增量维护的计数，见 SessionCompressState），据此算出「要折几条 = 待折数 - 保留窗」；
 *   保留窗的口径只在 manager 一处发生（core 这里不重算一遍 = 两份真相）。
 *   这样 manager 只需把**要折的那几条**取出来（向前读，O(条数)）就能规划，不必把整段原文拉回来。
 *
 * why 返回 null 而不是空计划：调用方据此判定"这次不用动" ——
 *   压缩是幂等的：已折叠的段不会被折第二次（区间已记在摘要里）。
 */
export function planFoldOldest(
  events: readonly RoutableSessionEvent[],
  count: number
): CompressionPlan | null {
  const want = Math.max(0, Math.floor(count));
  if (want === 0) return null;
  const ranges = mergeCompressedRanges(collectCompressedRanges(events));
  const raws = events.filter(
    (event) => event.type !== COMPRESSED_EVENT_TYPE && !isCoveredSeq(event.seq, ranges)
  );
  const folded = raws.slice(0, want);
  if (folded.length === 0) return null;
  return {
    folded,
    fromSeq: folded[0]!.seq,
    toSeq: folded[folded.length - 1]!.seq,
    keptCount: raws.length - folded.length,
  };
}

/**
 * 读面视图 → 摘要载荷（**防御式解析**）。
 *
 * why 防御：摘要载荷来自库里的 JSON（可能是旧版本写的 / 脏行）——
 *   解析不出来就当"没有上一条摘要"（**不编造**），宁可少合并一次，也不拿半截载荷去拼。
 */
export function parseCompressPayload(value: unknown): SessionCompressPayload | null {
  const record = asRecord(value);
  if (!record) return null;
  const fromSeq = toFiniteInt(record.fromSeq);
  const toSeq = toFiniteInt(record.toSeq);
  if (fromSeq === null || toSeq === null) return null;
  const participants = Array.isArray(record.participants)
    ? record.participants.filter((item): item is string => typeof item === 'string')
    : [];
  const keyEvents = Array.isArray(record.keyEvents)
    ? record.keyEvents.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    fromSeq,
    toSeq,
    rounds: toFiniteInt(record.rounds) ?? 0,
    participants,
    firstSummary: typeof record.firstSummary === 'string' ? record.firstSummary : '',
    lastSummary: typeof record.lastSummary === 'string' ? record.lastSummary : '',
    keyEvents,
    foldedCount: toFiniteInt(record.foldedCount) ?? 0,
  };
}

/**
 * 事件流里**最后一条摘要**的载荷（没有 / 解析不出来 → null）。
 *
 * why 要"最后一条"：摘要内容是累积的（每次折叠都把上一条合并进来），
 *   所以最新那条就是当前最全的一份（前面的都是它的碎片）。
 */
export function latestSummaryPayload(
  events: readonly RoutableSessionEvent[]
): SessionCompressPayload | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type !== COMPRESSED_EVENT_TYPE) continue;
    const payload = parseCompressPayload(event.payload);
    if (payload) return payload;
  }
  return null;
}

/**
 * 把**上一条摘要**与**新折叠的一段**合并成一条（累积式摘要）。
 *
 * why 要合并（而不是每次各出一条摘要）：
 *   折叠是**逐段**发生的（每追加一条就折一点），若每段各出一条摘要，
 *   读面就会堆出一长串"每段一句"的摘要（一条事件对应一段 —— 越往后越碎）。
 *   合并后，每条摘要描述的是**至今为止被折叠掉的全部历史**（累积摘要）：
 *   轮次 / 参与者 / 结论行逐次累加，首条消息摘要定下不动，末条消息摘要随折叠推进刷新。
 *
 * 合并后的区间 = [上一条的 fromSeq（没有则用本段起点), 本段终点] ——
 *   于是历次摘要的区间首尾相接，合并后就是**一条连续前缀**（读路由据此跳过被折原文）。
 *
 * @param prev 上一条摘要的载荷（没有则 null —— 第一次折叠）。
 * @param next 本次新折叠那一段的摘要载荷。
 */
export function mergeCompressPayload(
  prev: SessionCompressPayload | null,
  next: SessionCompressPayload
): SessionCompressPayload {
  if (!prev) return next;
  const participants = unique([...prev.participants, ...next.participants]).slice(
    0,
    MAX_SESSION_PARTICIPANTS
  );
  return {
    fromSeq: Math.min(prev.fromSeq, next.fromSeq),
    toSeq: Math.max(prev.toSeq, next.toSeq),
    rounds: prev.rounds + next.rounds,
    participants,
    // 首条摘要定下不动（除非之前没有）；末条摘要随折叠推进刷新（越靠后越接近当下）。
    firstSummary: prev.firstSummary || next.firstSummary,
    lastSummary: next.lastSummary || prev.lastSummary,
    // 结论行只留最后若干条（越靠后越接近当下）。
    keyEvents: [...prev.keyEvents, ...next.keyEvents].slice(-MAX_SESSION_COMPRESS_KEY_EVENTS),
    foldedCount: prev.foldedCount + next.foldedCount,
  };
}

/**
 * **规则版摘要**（结构化；不用 LLM）—— 把一段原文压成一条摘要载荷。
 *
 * 口径（每一条都是"读者最想知道"的）：
 *   - rounds      = 段内 'round' 事件条数（轮次数）；
 *   - participants= 段内消息署名的去重集合（谁在聊）；
 *   - first/last  = 首/末消息摘要（没有消息时退化成首/末事件的摘要）；
 *   - keyEvents   = **中断 / 结论**事件的人话列表（中断、完成、失败、收尾、分叉、恢复）。
 *
 * why 规则版先行：摘要要**确定**（同样的事件流永远给出同样的摘要 → 可单测、可比对）；
 *   LLM 摘要留端口不实现（方案 §8）—— 真接 LLM 时，规则版就是回退实现。
 */
export function buildRuleSummary(
  session: SessionRecord,
  folded: readonly RoutableSessionEvent[]
): SessionCompressPayload {
  const messages = folded.filter((event) => event.type === 'message');
  const rounds = folded.filter((event) => event.type === 'round').length;
  const speakers = unique(
    messages.map((event) => payloadText(event.payload, 'author')).filter((name) => name.length > 0)
  );
  // 参与者：优先取段内消息署名（谁在聊）；段里没有消息（如纯 task_run 段）时退化成会话参与者。
  const participants = (speakers.length > 0 ? speakers : [...session.participants]).slice(
    0,
    MAX_SESSION_PARTICIPANTS
  );
  const firstEvent = messages[0] ?? folded[0];
  const lastEvent = messages[messages.length - 1] ?? folded[folded.length - 1];
  const keyEvents = folded
    .filter((event) => isKeyEventType(event.type))
    .map((event) => describeKeyEvent(event))
    .filter((line) => line.length > 0)
    .slice(-MAX_SESSION_COMPRESS_KEY_EVENTS);

  return {
    fromSeq: folded.length > 0 ? folded[0]!.seq : 0,
    toSeq: folded.length > 0 ? folded[folded.length - 1]!.seq : 0,
    rounds,
    participants,
    firstSummary: firstEvent ? summarizeEvent(firstEvent) : '',
    lastSummary: lastEvent ? summarizeEvent(lastEvent) : '',
    keyEvents,
    foldedCount: folded.length,
  };
}

/**
 * 规则版摘要**端口实现**（core/session/compress.ts 的默认摘要器）。
 * why 单独包一个对象：manager 只认端口（SessionCompressSummarizer），
 *   换实现（未来的 LLM 版）时 manager 一行都不用改。
 */
export const ruleCompressSummarizer: SessionCompressSummarizer = {
  id: 'rules',
  summarize(input: SessionCompressInput): SessionCompressPayload {
    return buildRuleSummary(input.session, input.events);
  },
};

/**
 * **读取路由**：把一条会话的事件流变成「摘要 + 近期原文」的一段。
 *
 * 口径：
 *   - 默认（includeRaw 缺省）：被折叠区间的原文**跳过**；摘要只留**最后一条**
 *     （摘要内容是累积的 —— 最后一条已经把前面各段都吸收了，多露几条只是碎片）；
 *   - includeRaw = true：**展开原段** —— 被折叠的原文与全部摘要都回来（完整历史）；
 *   - 分页：beforeSeq 游标（seq 小于它）+ limit（取**最后** limit 条，与 DAO 窗口同一口径）。
 */
export function routeSessionEvents(
  events: readonly RoutableSessionEvent[],
  options: SessionEventRouteOptions
): SessionEventRoute {
  const ranges = mergeCompressedRanges(collectCompressedRanges(events));
  const includeRaw = options.includeRaw === true;
  const beforeSeq = options.beforeSeq;
  const limit = Math.max(0, Math.floor(options.limit));
  // 最后一条摘要（累积摘要的"最新一份"）：默认视图只露它。
  const latestSummaryToSeq = latestSummaryBoundary(events);
  const visible = events.filter((event) => {
    if (beforeSeq !== undefined && event.seq >= beforeSeq) return false;
    if (event.type === COMPRESSED_EVENT_TYPE) {
      if (includeRaw) return true;
      // 摘要的"新旧"看的是它盖住的区间终点（toSeq），不是它自己的 seq
      //   （摘要事件是折叠**之后**才写的，seq 天然比它盖住的原文新）。
      return summaryToSeq(event) === latestSummaryToSeq;
    }
    if (includeRaw) return true;
    return !isCoveredSeq(event.seq, ranges);
  });
  const page = limit >= visible.length ? visible.slice() : visible.slice(visible.length - limit);
  return {
    items: page,
    total: visible.length,
    hasMore: visible.length > page.length,
    compressed: ranges.length > 0,
    ranges,
  };
}

/** 摘要事件盖住的区间终点（读不出就返回 null —— 脏行不参与"谁最新"的判定）。 */
function summaryToSeq(event: RoutableSessionEvent): number | null {
  const payload = asRecord(event.payload);
  if (!payload) return null;
  return toFiniteInt(payload.toSeq);
}

/** 全部摘要里最大的区间终点（没有摘要 → null）。 */
function latestSummaryBoundary(events: readonly RoutableSessionEvent[]): number | null {
  let max: number | null = null;
  for (const event of events) {
    if (event.type !== COMPRESSED_EVENT_TYPE) continue;
    const toSeq = summaryToSeq(event);
    if (toSeq === null) continue;
    if (max === null || toSeq > max) max = toSeq;
  }
  return max;
}

/**
 * 读「seq 大于 afterSeq」的**整段**事件（seq 正序）—— 慢路径。
 *
 * why 只有慢路径：读口的口径是「窗口」= 取**最后** limit 条（beforeSeq 游标向前翻页），
 *   没有"从某个 seq 往后取"的能力 → 想要 afterSeq 之后的那一段，
 *   只能从最新往回翻页翻到它 —— 翻过的路里堆着历次折叠的摘要事件（每次折叠追加一条），
 *   于是读量随会话长度增长（O(n) per append，性能铁律：长会话不许这样）。
 *   所以有了 readSessionEventsAfter（向前读）这条快路径；本函数只是它的兜底。
 */
export function readRegionAfter(
  read: SessionEventReadLike,
  sessionId: string,
  afterSeq: number,
  pageLimit = ROUTE_SCAN_PAGE
): readonly RoutableSessionEvent[] {
  const out: RoutableSessionEvent[] = [];
  let beforeSeq: number | undefined;
  for (;;) {
    const page =
      beforeSeq === undefined
        ? read.readSessionEvents(sessionId, { limit: pageLimit })
        : read.readSessionEvents(sessionId, { beforeSeq, limit: pageLimit });
    if (page.length === 0) break;
    const first = page[0]!.seq;
    // 无进展护栏：读口若忽略游标会永远返回同一段 —— 停（最坏是少读，不是死循环）。
    if (beforeSeq !== undefined && first >= beforeSeq) break;
    out.unshift(...page.filter((event) => event.seq > afterSeq));
    if (page.length < pageLimit) break;
    beforeSeq = first;
    // 这一页已经够到边界（窗口里没有更早的事件了）→ 停。
    if (first <= afterSeq + 1) break;
  }
  return out;
}

/**
 * 取「覆盖边界之后最老的 count 条**原文**」—— 这一轮要折的那一段。
 *
 * 口径：
 *   - 只数**原文**（非 compressed 类型）：摘要事件不是原文，不占折叠名额；
 *   - 取**最老**的 count 条（seq 正序的头几条）；
 *   - 实际不足 count 条 → 就取那么多（调用方据此少折几条，不编造）。
 *
 * 走哪条路：
 *   - 快路（读口实现了 readSessionEventsAfter）：向前读，O(count + 途中穿过的摘要条数)；
 *   - 慢路（没实现）：窗口 + 向前翻页读整段再取头几条 —— 结果**一样**，只是读得多。
 *
 * why 要单独一个函数（而不是让调用方自己读）：折叠口径只有这一份 ——
 *   "折最老的那几条" 在两处各写一遍必然漂移（快路与慢路选出不同的段 = 折叠区间错乱）。
 */
export function readOldestRawsAfter(
  read: SessionEventReadLike,
  sessionId: string,
  afterSeq: number,
  count: number
): readonly RoutableSessionEvent[] {
  const want = Math.max(0, Math.floor(count));
  if (want === 0) return [];
  const fast = read.readSessionEventsAfter;
  if (!fast) {
    return readRegionAfter(read, sessionId, afterSeq).filter(
      (event) => event.type !== COMPRESSED_EVENT_TYPE
    ).slice(0, want);
  }
  const out: RoutableSessionEvent[] = [];
  let cursor = afterSeq;
  // 首屏只要「要折的条数 + 一点余量」：稳态下要折的原文紧挨着覆盖边界，首屏就够
  //   （不必一次拉 RAW_FETCH_PAGE 行 —— 那是几十倍的读放大）。不够再按整页续读。
  let pageLimit = Math.min(RAW_FETCH_PAGE, want + 1);
  for (;;) {
    const page = fast(sessionId, cursor, pageLimit);
    if (page.length === 0) break;
    for (const event of page) {
      if (event.type === COMPRESSED_EVENT_TYPE) continue;
      out.push(event);
      if (out.length >= want) break;
    }
    if (out.length >= want) break;
    const last = page[page.length - 1]!.seq;
    // 无进展护栏：读口若忽略游标会永远返回同一段 —— 停（最坏是少折，不是死循环）。
    if (last <= cursor) break;
    // 这一页没读满 = 后面没有了（读口按「不足 limit 即到底」的口径）。
    if (page.length < pageLimit) break;
    cursor = last;
    pageLimit = RAW_FETCH_PAGE;
  }
  return out.slice(0, want);
}

/**
 * 读**全量**事件流（按读口的分页口径向前翻页）。
 *
 * why 需要它：读路由要算折叠区间 → 得先看见**所有**摘要事件
 *   （只看一页就会把"更早还有摘要"漏掉 → 老原文被当成未折叠而重新露出来）。
 *
 * @param read 事件读口（窗口口径：缺省 beforeSeq = 最新 limit 条；给了 = 该游标之前的 limit 条）。
 * @param sessionId 会话 id。
 * @param pageLimit 单页条数（缺省 200 = DAO 的窗口上限）。
 */
export function readAllSessionEvents<T extends RoutableSessionEvent>(
  read: {
    readonly readSessionEvents: (
      sessionId: string,
      options: { readonly beforeSeq?: number; readonly limit: number }
    ) => readonly T[];
  },
  sessionId: string,
  pageLimit = 200
): readonly T[] {
  const out: T[] = [];
  let beforeSeq: number | undefined;
  for (;;) {
    const page =
      beforeSeq === undefined
        ? read.readSessionEvents(sessionId, { limit: pageLimit })
        : read.readSessionEvents(sessionId, { beforeSeq, limit: pageLimit });
    if (page.length === 0) break;
    const first = page[0]!.seq;
    // 无进展护栏：读口若忽略游标会永远返回同一段 —— 停（最坏是少读，不是死循环）。
    if (beforeSeq !== undefined && first >= beforeSeq) break;
    out.unshift(...page);
    if (page.length < pageLimit) break;
    beforeSeq = first;
  }
  return out;
}

/**
 * 读口形状（只取「读事件流」这一件事）—— 与 core/session/types.ts 的 SessionEventReadPort 同构。
 * why 单独声明：路由要能吃**两族**读口（core 的 SessionEventView / app 层的持久化行），
 *   故只取它们共有的最小形状。
 */
export interface SessionEventReadLike {
  readonly readSessionEvents: (
    sessionId: string,
    options: { readonly beforeSeq?: number; readonly limit: number }
  ) => readonly RoutableSessionEvent[];
  /**
   * **向前读**（可选）：取 seq **大于** afterSeq 的**最早** limit 条。
   * 缺省 = 不支持 → 调用方回退到「窗口 + 向前翻页」的慢路径（读面仍然正确）。
   */
  readonly readSessionEventsAfter?: (
    sessionId: string,
    afterSeq: number,
    limit: number
  ) => readonly RoutableSessionEvent[];
}

/** 路由扫描的单页条数（与存储层 DAO 的窗口上限同值）。 */
const ROUTE_SCAN_PAGE = 200;

/**
 * 向前读（折叠取料）的**续读**单页条数（@since v3.48 / task_106）。
 * why 不大：这一页是**向前**取的 —— 页里混着摘要事件（每次折叠追加一条），
 *   页太大就等于把整段历史又拉了一遍（读放大）。要折的原文通常只有一两条 → 页给够摘要缓冲即可。
 * why 是「续读」页：首屏按「要折的条数 + 1」取（稳态下就够了），首屏不够才续读本页。
 */
const RAW_FETCH_PAGE = 64;

/**
 * **读取路由（带 IO 的那一半）** —— 从读口取事件流，按「摘要 + 近期原文」路由。
 *
 * why 要有"带 IO"这一版：纯路由函数（routeSessionEvents）要求调用方**已经拿到**事件流；
 *   而读面要在 IO 这一侧就决定"取多少、翻到哪" —— 否则每个读口（MCP / REST / 抽屉）
 *   都要自己实现一遍摘要区间识别（两份真相 = 必然漂移）。
 *
 * 扫描策略（why 不全量读）：
 *   - 被折叠的原文恒为一段**前缀**（见文件头），而摘要事件是**累积**的
 *     （一条摘要描述的是"至今被折叠掉的全部历史"）；
 *   - 于是"最新一条摘要"就带着**完整**的覆盖区间 → 往回翻页翻到**覆盖边界**即可停
 *     （边界更早的原文全被盖住，默认视图看不见，不必读）；
 *   - includeRaw = true 时不一样：原段要能翻到 → 那一路的**条目**直接用读口的窗口口径取
 *     （最后 limit 条 / beforeSeq 之前），区间信息另扫一遍摘要即可。
 */
export function readRoutedSessionEvents(
  read: SessionEventReadLike,
  sessionId: string,
  options: SessionEventRouteOptions
): SessionEventRoute {
  const limit = Math.max(0, Math.floor(options.limit));
  const includeRaw = options.includeRaw === true;
  const beforeSeq = options.beforeSeq;

  if (includeRaw) {
    // 展开原段：全部事件都可见 → 读口的窗口口径（最后 limit 条 / beforeSeq 之前）就是答案。
    const window = read.readSessionEvents(sessionId, {
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      limit: Math.max(limit, 1),
    });
    const items = limit >= window.length ? window.slice() : window.slice(window.length - limit);
    // 扫一遍只为知道"摘要区间是否已完全可知"（覆盖区间另扫一遍 → ranges）。
    const { summaries } = scanSessionEvents(read, sessionId, ({ summaries: found }) =>
      coversWholePrefix(found)
    );
    const ranges = mergeCompressedRanges(collectCompressedRanges(summaries));
    return {
      items,
      total: items.length,
      // 更早还有原文 = 本页最早一条的 seq 不是 1（seq 会话内单调且连续）。
      hasMore: items.length > 0 && items[0]!.seq > 1,
      compressed: ranges.length > 0,
      ranges,
    };
  }

  // 默认视图：「摘要 + 近期原文」—— 往回翻页翻到覆盖边界就停（更早的原文看不见）。
  //   （摘要事件本身也在 events 里 —— 路由那一步负责"只露最后一条摘要"。）
  const { events } = scanSessionEvents(read, sessionId, ({ summaries: found, cursor }) => {
    const covered = coveredBoundary(found);
    return covered !== null && cursor <= covered + 1;
  });
  const full = routeSessionEvents(events, { limit: Number.MAX_SAFE_INTEGER });
  const visible = full.items.filter((event) => beforeSeq === undefined || event.seq < beforeSeq);
  const items = limit >= visible.length ? visible.slice() : visible.slice(visible.length - limit);
  return {
    items,
    total: visible.length,
    hasMore: visible.length > items.length,
    compressed: full.compressed,
    ranges: full.ranges,
  };
}

/**
 * 从最新往回翻页扫一遍会话事件（收集事件 + 摘要事件），直到 stop 判定可以停。
 *
 * why 往回翻：读口的窗口口径是"**最后** limit 条" —— 从最新起翻才与那个口径一致。
 */
function scanSessionEvents(
  read: SessionEventReadLike,
  sessionId: string,
  shouldStop: (state: {
    readonly page: readonly RoutableSessionEvent[];
    readonly summaries: readonly RoutableSessionEvent[];
    readonly cursor: number;
  }) => boolean
): {
  readonly events: readonly RoutableSessionEvent[];
  readonly summaries: readonly RoutableSessionEvent[];
} {
  const events: RoutableSessionEvent[] = [];
  const summaries: RoutableSessionEvent[] = [];
  let cursor: number | undefined;
  for (;;) {
    const page =
      cursor === undefined
        ? read.readSessionEvents(sessionId, { limit: ROUTE_SCAN_PAGE })
        : read.readSessionEvents(sessionId, { beforeSeq: cursor, limit: ROUTE_SCAN_PAGE });
    if (page.length === 0) break;
    events.unshift(...page);
    for (const event of page) {
      if (event.type === COMPRESSED_EVENT_TYPE) summaries.push(event);
    }
    const first = page[0]!.seq;
    cursor = first;
    if (shouldStop({ page, summaries, cursor: first })) break;
    // 翻完了（这一页没满 = 没有更早的了）→ 停。
    if (page.length < ROUTE_SCAN_PAGE) break;
  }
  return { events, summaries };
}

/** 摘要覆盖边界（各摘要区间的最大终点；没有摘要 → null = 还没折叠过）。 */
function coveredBoundary(summaries: readonly RoutableSessionEvent[]): number | null {
  let max: number | null = null;
  for (const event of summaries) {
    const payload = parseCompressPayload(event.payload);
    if (!payload) continue;
    if (max === null || payload.toSeq > max) max = payload.toSeq;
  }
  return max;
}

/** 是否有一条摘要从会话**第一条**开始覆盖（= 覆盖区间已完全可知）。 */
function coversWholePrefix(summaries: readonly RoutableSessionEvent[]): boolean {
  for (const event of summaries) {
    const payload = parseCompressPayload(event.payload);
    if (payload && payload.fromSeq <= 1) return true;
  }
  return false;
}

// ===== 内部工具（纯函数）=====

/** 载荷 → 记录（不是对象就返回 null：读面不校验形状）。 */
function asRecord(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

/** 载荷里的字符串字段（非串 / 缺省 → 空串）。 */
function payloadText(payload: unknown, key: string): string {
  const record = asRecord(payload);
  if (!record) return '';
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/** 有限整数（不是 → null）。 */
function toFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.floor(value);
}

/** 去重（保持首次出现顺序）。 */
function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** 截断到上限（超限截尾加省略号）。 */
function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** 是否是「中断 / 结论」类事件（进摘要的 keyEvents）。 */
function isKeyEventType(type: string): boolean {
  return (
    type === 'interrupt' ||
    type === 'completed' ||
    type === 'failed' ||
    type === 'closed' ||
    type === 'forked' ||
    type === 'resumed'
  );
}

/** 「中断 / 结论」事件 → 人话一行。 */
function describeKeyEvent(event: RoutableSessionEvent): string {
  switch (event.type) {
    case 'interrupt':
      return `中断：${payloadText(event.payload, 'reason') || '会话被中断'}`;
    case 'completed':
      return `完成：${payloadText(event.payload, 'summary') || '任务完成'}`;
    case 'failed':
      return `失败：${payloadText(event.payload, 'reason') || '任务失败'}`;
    case 'closed':
      return `收尾：${payloadText(event.payload, 'reason') || '会话结束'}`;
    case 'forked':
      return `分叉自 ${payloadText(event.payload, 'sourceSessionId') || '（未知来源）'}`;
    case 'resumed':
      return `恢复：${payloadText(event.payload, 'note') || '会话已恢复'}`;
    default:
      return '';
  }
}

/** 事件 → 一句话摘要（按事件类型取最有信息量的那段文本）。 */
function summarizeEvent(event: RoutableSessionEvent): string {
  switch (event.type) {
    case 'message':
      return cap(payloadText(event.payload, 'text'), MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'round':
      return cap(payloadText(event.payload, 'summary') || '一轮对话结束', MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'task_started':
      return cap(payloadText(event.payload, 'summary') || '任务开始', MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'step':
      return cap(payloadText(event.payload, 'label') || '关键节点', MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'output_tail':
      return cap(payloadText(event.payload, 'text'), MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'interrupt':
      return cap(`中断：${payloadText(event.payload, 'reason') || '会话被中断'}`, MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'completed':
      return cap(payloadText(event.payload, 'summary') || '任务完成', MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'failed':
      return cap(`失败：${payloadText(event.payload, 'reason') || '任务失败'}`, MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'closed':
      return cap(payloadText(event.payload, 'reason') || '会话结束', MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'created':
      return cap(`会话建立：${payloadText(event.payload, 'title') || '（无标题）'}`, MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'forked':
      return cap(`分叉自 ${payloadText(event.payload, 'sourceSessionId') || '（未知来源）'}`, MAX_SESSION_COMPRESS_SUMMARY_LEN);
    case 'resumed':
      return cap(payloadText(event.payload, 'note') || '会话已恢复', MAX_SESSION_COMPRESS_SUMMARY_LEN);
    default:
      return cap(`${event.type} 事件`, MAX_SESSION_COMPRESS_SUMMARY_LEN);
  }
}
