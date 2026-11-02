/**
 * 文件职责：**当日回放的读取口**（app 层实现，task_082 / DEMO-PLAN.md §9）——
 *   把「今天跑过的 task_run 会话事件流」读成一条时间轴条目列表（DayReplayEntry[]）。
 *   数据真相在 service 进程的 SQLite（sessions / session_events 两张表，由 service 独占写），
 *   渲染层**只读**：经 gateway 的只读 REST 读（GET /api/storage/sessions + …/events）——
 *   与会话面板「历史抽屉」同一口径（见 app/services/session-history/session-history.ts）。
 * 输入：service 的 HTTP 基址 + fetch 实现（单测注入假 fetch）。
 * 输出：与 hud 侧契约**结构同形**的读取口（DayReplayPort）。
 * 禁止事项：
 *   1. 在这里写库 —— 存储件独占写是铁律 6；本文件只读；
 *   2. 编造数据 —— 库里没有就是没有（空数组 → 空态），绝不返回占位条目；
 *   3. import hud —— 依赖方向不倒挂（两边各写各的形状，结构同形，组合根接线时由类型系统对齐）；
 *   4. 在这里跑轮询 / 定时器 —— 读一次当日快照是一次性动作（用户点「看完今天」才读）；
 *   5. 无上限地翻页 / 并发拉全量 —— 会话列表与事件流都分页，事件拉取并发有硬顶（perf）。
 *
 * ============ 「今天」的口径 ============
 *   本地日历日（00:00-24:00，本地时区）。why 不用 UTC：回放给观众看的是「我们这边的今天」。
 *   判定落在**事件时刻**上（createdAt），不是会话创建时刻 —— 一个昨天开的会话，
 *   今天还在跑，它的 step / completed 就该出现在今天的回放里。
 *
 * @since v3.3（task_082）。
 */

import type { DayReplayEntry, DayReplayPort } from '../../hud/components/replay/replay-catalog';

import {
  DEFAULT_SESSION_HISTORY_BASE_URL,
  httpBaseFromWorldSyncUrl,
} from './session-history/session-history';

/** service 的 HTTP 基址缺省值（本机 gateway；dev 下 PORT=7524）。 */
export const DEFAULT_DAY_REPLAY_BASE_URL = DEFAULT_SESSION_HISTORY_BASE_URL;

/** 会话列表单页条数（与服务端 limit 上限 200 对齐 —— 一次一页，不多拉）。 */
const SESSION_PAGE_LIMIT = 200;
/** 最多翻几页会话列表（防御：一台机器上可能攒了很多天）。 */
const MAX_SESSION_PAGES = 5;
/** 单个会话最多取多少条事件（服务端 limit 上限 200）。 */
const EVENT_PAGE_LIMIT = 200;
/** 同时拉取会话事件的最大并发数（perf：不把 service 打爆）。 */
const MAX_EVENT_CONCURRENCY = 4;
/** 单条标签的最大长度（短句进 UI，太长的原文会撑爆时间轴）。 */
const MAX_LABEL_LEN = 40;

/** REST 会话摘要行（与 app/services/persistence/session-dao 的记录同构）。 */
interface SessionRow {
  readonly id: string;
  readonly kind: string;
  readonly title?: string;
  readonly participants?: readonly string[];
  readonly status?: string;
  readonly refId?: string | null;
  readonly createdAt: number;
  readonly lastEventAt?: number;
  readonly closedAt?: number | null;
  readonly eventCount?: number;
}

/** REST 事件行（与 session-event-dao 的 PersistedSessionEvent 同构）。 */
interface EventRow {
  readonly sessionId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: number;
}

/** 造读取口时的可选项。 */
export interface DayReplayPortOptions {
  /** service 的 HTTP 基址（读 API 挂在这里）；缺省 = 本机 gateway。 */
  readonly baseUrl?: string;
  /** fetch 实现（单测注入假 fetch；缺省 = 全局 fetch）。 */
  readonly fetchImpl?: typeof fetch;
}

/**
 * 事件类型 → 回放分级。
 * why 只认这四种：其余事件类型（created / reference / closed）对"今天干了什么"没有增量
 *   （建会话、引用、收尾都是过程痕迹，不是工作本身）—— 收了只会让时间轴变成噪声。
 */
const EVENT_KIND: Readonly<Record<string, DayReplayEntry['kind']>> = Object.freeze({
  task_started: 'spawn',
  step: 'work',
  output_tail: 'work',
  completed: 'done',
  failed: 'error',
});

/** 截断短句（超长原文会撑爆时间轴与气泡）。 */
function truncate(text: string, max: number = MAX_LABEL_LEN): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** 载荷取字符串字段（非字符串 → 空串）。 */
function payloadText(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object') return '';
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

/**
 * 事件行 → 回放条目（读面翻译：**事件 → 一拍**）。
 * 返回 null = 这条事件不进回放（词表外的事件类型）。
 */
export function sessionEventToReplayEntry(
  event: EventRow,
  session: { readonly characterId: string; readonly taskId: string }
): DayReplayEntry | null {
  const kind = EVENT_KIND[event.type];
  if (!kind) return null;
  const payload = event.payload;
  let label = '';
  switch (event.type) {
    case 'task_started':
      label = payloadText(payload, 'summary');
      break;
    case 'step': {
      const stepLabel = payloadText(payload, 'label');
      const detail = payloadText(payload, 'detail');
      label = detail ? `${stepLabel}：${detail}` : stepLabel;
      break;
    }
    case 'output_tail':
      label = payloadText(payload, 'text');
      break;
    case 'completed':
      label = payloadText(payload, 'summary');
      break;
    case 'failed':
      label = payloadText(payload, 'reason');
      break;
    default:
      break;
  }
  return {
    at: event.createdAt,
    kind,
    characterId: session.characterId,
    taskId: session.taskId,
    label: truncate(label),
    sessionId: event.sessionId,
  };
}

/** 本地日历日的 [起, 止) 区间。 */
export function localDayRange(day: Date): { readonly from: number; readonly to: number } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0, 0);
  return { from: start.getTime(), to: end.getTime() };
}

/** 并发受限的 map（perf：一次只打 MAX_EVENT_CONCURRENCY 个请求）。 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 造当日回放读取口。
 *
 * why 读会话列表而不是只读事件表：事件表没有"哪一天"这一列（只有 createdAt，
 *   要按时间倒着翻到那一天为止 —— 那是全表扫描）。会话摘要有 createdAt / lastEventAt，
 *   可以先按日期把候选会话圈小，再逐个取事件。
 */
export function createDayReplayPort(options: DayReplayPortOptions = {}): DayReplayPort {
  const baseUrl = (options.baseUrl ?? DEFAULT_DAY_REPLAY_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  const readJson = async (url: string): Promise<Record<string, unknown>> => {
    const response = await fetchImpl(url, { method: 'GET' });
    if (!response.ok) throw new Error(`读取当日回放失败（HTTP ${response.status}）`);
    const body = (await response.json()) as {
      readonly success?: boolean;
      readonly error?: string;
      readonly data?: { readonly sessions?: readonly SessionRow[]; readonly events?: readonly EventRow[] };
    };
    if (body.success === false) throw new Error(body.error || '读取当日回放失败');
    return (body.data ?? {}) as Record<string, unknown>;
  };

  /** 读一页会话摘要（kind=task_run；创建时间倒序 —— 服务端口径）。 */
  const readSessionPage = async (offset: number): Promise<SessionRow[]> => {
    const url = new URL(`${baseUrl}/api/storage/sessions`);
    url.searchParams.set('kind', 'task_run');
    url.searchParams.set('limit', String(SESSION_PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));
    const data = await readJson(url.toString());
    return (data.sessions ?? []) as SessionRow[];
  };

  /** 读某会话的事件流（includeRaw=1：展开被折叠的原段 —— 回放要的是完整故事线）。 */
  const readSessionEvents = async (sessionId: string): Promise<EventRow[]> => {
    const url = new URL(`${baseUrl}/api/storage/sessions/${encodeURIComponent(sessionId)}/events`);
    url.searchParams.set('limit', String(EVENT_PAGE_LIMIT));
    url.searchParams.set('includeRaw', '1');
    const data = await readJson(url.toString());
    return (data.events ?? []) as EventRow[];
  };

  return {
    async loadDay(options2?: { readonly day?: Date }): Promise<readonly DayReplayEntry[]> {
      const day = options2?.day ?? new Date();
      const { from, to } = localDayRange(day);

      // ① 圈候选会话：会话摘要按创建时间倒序 —— 翻页直到某整页都没有今天的动静
      //    （更早的页只会更旧，见 lastEventAt 口径：昨天开的会话今天可能还在跑，
      //    所以判据是 lastEventAt 而不是 createdAt）。
      const candidates: SessionRow[] = [];
      for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
        const rows = await readSessionPage(page * SESSION_PAGE_LIMIT);
        if (rows.length === 0) break;
        let anyToday = false;
        for (const row of rows) {
          const lastAt = row.lastEventAt ?? row.createdAt;
          if (lastAt < from) continue;
          candidates.push(row);
          anyToday = true;
        }
        if (!anyToday) break;
        if (rows.length < SESSION_PAGE_LIMIT) break;
      }

      if (candidates.length === 0) return [];

      // ② 逐会话取事件（并发有顶）→ 翻译成条目 → 按当天区间过滤。
      const perSession = await mapWithLimit(candidates, MAX_EVENT_CONCURRENCY, async (row) => {
        const events = await readSessionEvents(row.id);
        const characterId = row.participants?.[0] ?? '';
        const taskId = row.refId ?? '';
        const entries: DayReplayEntry[] = [];
        for (const event of events) {
          if (event.createdAt < from || event.createdAt >= to) continue;
          const entry = sessionEventToReplayEntry(event, { characterId, taskId });
          if (entry) entries.push(entry);
        }
        return entries;
      });

      const all = perSession.flat();
      if (all.length === 0) return [];
      return all.sort((a, b) => a.at - b.at);
    },
  };
}

export { httpBaseFromWorldSyncUrl };
