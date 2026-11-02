/**
 * 文件职责：**会话读 API**（前后端分离 A3 / task_079 的同构延伸 + task_092）——
 *   service 侧 SQLite 的**只读**门面里的会话那半边。
 *   拓扑（docs/SERVICE-SPLIT-PLAN.md §2 目标拓扑 / 铁律 6）：SQLite 只由 service 进程打开写，
 *   其余进程（Electron 壳 / 浏览器 / 外部 client）经 HTTP 读 —— 本文件就是那条路的 HTTP 段。
 * 输入：service 侧的会话读口（SessionReadPort；缺省 = 端口未附着）。
 * 输出：两条 GET 路由（挂载点 /api/storage，与既有 storage 路由同前缀、不同路径）：
 *   ① GET /api/storage/sessions —— 会话摘要列表（过滤 kind / status + limit / offset 分页）；
 *   ② GET /api/storage/sessions/:id/events —— 某会话的事件流（beforeSeq 游标切片）。
 * 禁止事项：
 *   1. 在这里写库 —— 本文件**只读**。写入一律走 service 侧的会话持久化注入件
 *      （app/services/persistence/session-persister.ts，由 S3 的组合根挂到 SessionManager）；
 *   2. 在这里造第二条数据源 —— 每一行都从库里现读（不缓存、不预聚合）；
 *   3. 编造数据 —— 库里没有就是没有（列表为空数组），不返回假内容；
 *   4. 端口缺席时假装正常 —— 端口不在就 503 + 如实说明「存储未附着」（铁律 ④）；
 *   5. 挂写端点 —— 本文件只有 GET（REST 只读是本任务的硬要求）。
 *
 * 分页口径（与 storage.ts 的聊天分页同一口径）：
 *   limit 缺省 50（抽屉窗口口径），收紧到 [1, 200]；
 *   offset 是**位置**不是窗口 —— 负数 / 非数字 → 400（如实报错，不悄悄换个语义继续跑）；
 *   beforeSeq 是**位置**（取该 seq 之前的一段）—— 0 / 负数 / 非数字 → 400；
 *   kind / status 是词表 —— 词表外一律 400（不猜、不静默忽略过滤条件）。
 *
 * why 单独成文件而不是塞进 storage.ts：storage.ts 的读口类型面已经定型（两条读口），
 *   往里加方法会让既有的假读口（单测里手搓的实现）全部要改 —— 端口类型即契约，
 *   加法只该加在**新**的端口上，不该让旧契约被迫长大。
 *
 * @since v3.43（task_092）。
 */

import { Router, type Request, type Response } from 'express';

import {
  PERSISTED_SESSION_KINDS,
  PERSISTED_SESSION_STATUSES,
  type PersistedSessionRecord,
} from '../../../app/services/persistence/session-dao';
import type { PersistedSessionEvent } from '../../../app/services/persistence/session-event-dao';
import { readRoutedSessionEvents } from '../../../core/session';
import type { SessionKind, SessionStatus } from '../../../core/types';

/**
 * 会话读口（service 侧存储件的读半边）。
 * why 只声明读的那两个方法：写口不进本文件的类型面 —— 类型即契约，
 *   一个「什么都能做」的端口会诱使后来者在只读路由里写库。
 */
export interface SessionReadPort {
  /** 会话摘要列表（kind / status 过滤 + limit / offset 分页；创建时间倒序）。 */
  readonly readSessions: (filter: {
    readonly kind?: SessionKind;
    readonly status?: SessionStatus;
    readonly limit: number;
    readonly offset: number;
  }) => PersistedSessionRecord[];
  /** 某会话的事件流（seq 正序；beforeSeq 游标切片）。 */
  readonly readSessionEvents: (
    sessionId: string,
    options: { readonly beforeSeq?: number; readonly limit: number }
  ) => PersistedSessionEvent[];
}

/** 会话列表窗口的缺省条数（与聊天窗口同量级）。 */
export const STORAGE_SESSION_PAGE_LIMIT = 50;
/** 会话列表窗口的硬上限（不信任外部传入的任意值 —— 与 IPC 校验层同一纪律）。 */
const MAX_SESSION_PAGE_LIMIT = 200;
/** 会话 id 长度上限（会话 id 由 service 生成，形如 session_<kind>_<ts>_<n>）。 */
const MAX_SESSION_ID_LEN = 200;

/**
 * 取整并收紧到 [min, max]；非数字 / NaN 一律回落缺省值（外部输入不可信）。
 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

/**
 * 严格解析非负整数偏移；不是非负整数（负数 / 非数字 / 小数）→ null（= 坏偏移）。
 *
 * why 不用 clampInt 收紧偏移：偏移是**位置**不是**窗口** —— 把 -1 悄悄夹成 0 等于
 *   换个语义继续跑（客户端拿到的是「另一个窗口」却以为是自己要的）。
 *   偏移错了就该如实报错（400），让客户端重新取窗口。
 */
function parseOffset(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 0;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * 严格解析正整数游标；不是正整数（0 / 负数 / 非数字 / 小数）一律返回 null（= 坏游标）。
 *
 * why 严格：游标是**位置**不是**窗口** —— 把 0 悄悄夹成 1 等于换个语义继续跑
 *   （客户端拿到的是「另一个窗口」却以为是自己要的）。游标错了就该如实报错（400）。
 */
function parsePositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * 严格解析布尔查询值：'1' / 'true' = 真；'0' / 'false' = 假；缺省 = null（= 没给）。
 * 其它值 → null（= 坏值，路由据此 400 —— 不猜客户端的意图）。
 */
function parseBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim().toLowerCase();
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

/**
 * 造会话读路由。
 *
 * @param port 读取口；null = 存储未附着（路由会如实报 503，不返回空态假装正常）。
 */
export function createSessionStorageRoutes(port: SessionReadPort | null): Router {
  const router = Router();

  /**
   * GET /sessions —— 会话摘要列表。
   *
   * 查询参数：
   *   kind    —— 会话种类（词表外 → 400）；
   *   status  —— 会话状态（词表外 → 400）；
   *   limit   —— 条数（缺省 50，收紧到 [1, 200]）；
   *   offset  —— 偏移（缺省 0；坏值 → 400）。
   */
  router.get('/sessions', (req: Request, res: Response): void => {
    if (!port) {
      res.status(503).json({ success: false, error: 'storage not attached' });
      return;
    }
    const kind = parseKind(req.query.kind);
    if (kind === undefined) {
      res.status(400).json({ success: false, error: 'bad kind' });
      return;
    }
    const status = parseStatus(req.query.status);
    if (status === undefined) {
      res.status(400).json({ success: false, error: 'bad status' });
      return;
    }
    const offset = parseOffset(req.query.offset);
    if (offset === null) {
      res.status(400).json({ success: false, error: 'bad offset' });
      return;
    }
    const limit = clampInt(req.query.limit, 1, MAX_SESSION_PAGE_LIMIT, STORAGE_SESSION_PAGE_LIMIT);
    try {
      const sessions = port.readSessions({
        ...(kind ? { kind } : {}),
        ...(status ? { status } : {}),
        limit,
        offset,
      });
      res.json({ success: true, data: { sessions, kind: kind ?? null, status: status ?? null, limit, offset } });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'failed to read sessions',
      });
    }
  });

  /**
   * GET /sessions/:id/events —— 某会话的事件流（分页 + **压缩读取路由**）。
   *
   * 查询参数：
   *   limit     —— 条数（缺省 50，收紧到 [1, 200]）；
   *   beforeSeq —— 游标（取该 seq **之前**的一段；给了才翻页；坏值 → 400）；
   *   includeRaw —— 是否**展开被折叠的原段**（@since v3.48，task_106 / v3.2b-B7）。
   *     缺省 = 否 → 只给「压缩摘要 + 近期原文」（长会话的老段已被折叠成一条摘要）；
   *     给 1 / true → 展开原段（原文一条不少）；坏值 → 400。
   */
  router.get('/sessions/:id/events', (req: Request, res: Response): void => {
    if (!port) {
      res.status(503).json({ success: false, error: 'storage not attached' });
      return;
    }
    const sessionId = String(req.params.id ?? '');
    if (sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LEN) {
      res.status(400).json({ success: false, error: 'bad session id' });
      return;
    }
    const limit = clampInt(req.query.limit, 1, MAX_SESSION_PAGE_LIMIT, STORAGE_SESSION_PAGE_LIMIT);
    const rawBeforeSeq = req.query.beforeSeq;
    const beforeSeq = rawBeforeSeq === undefined ? null : parsePositiveInt(rawBeforeSeq);
    if (rawBeforeSeq !== undefined && beforeSeq === null) {
      res.status(400).json({ success: false, error: 'bad beforeSeq' });
      return;
    }
    const rawIncludeRaw = req.query.includeRaw;
    const includeRaw = parseBoolean(rawIncludeRaw);
    if (rawIncludeRaw !== undefined && rawIncludeRaw !== '' && includeRaw === null) {
      res.status(400).json({ success: false, error: 'bad includeRaw' });
      return;
    }
    try {
      // 读取路由（@since v3.48，task_106）：默认给「压缩摘要 + 近期原文」，
      //   includeRaw=1 时展开被折叠的原段（原文一条不少）。
      const route = readRoutedSessionEvents(port, sessionId, {
        limit,
        ...(beforeSeq === null ? {} : { beforeSeq }),
        ...(includeRaw === true ? { includeRaw: true } : {}),
      });
      res.json({
        success: true,
        data: {
          sessionId,
          events: route.items,
          limit,
          beforeSeq,
          includeRaw: includeRaw === true,
          // 该会话是否发生过压缩 + 被折叠的区间（客户端据此提示"这里可以展开原段"）。
          compressed: route.compressed,
          compressedRanges: route.ranges.map((range) => ({
            fromSeq: range.fromSeq,
            toSeq: range.toSeq,
          })),
        },
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'failed to read session events',
      });
    }
  });

  return router;
}

/**
 * 解析 kind 过滤值：缺省 = 不过滤（undefined 之外的 undefined 语义用 null 区分）。
 * 返回 undefined = 坏值（词表外）。
 */
function parseKind(value: unknown): SessionKind | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!(PERSISTED_SESSION_KINDS as readonly string[]).includes(raw)) return undefined;
  return raw as SessionKind;
}

/**
 * 解析 status 过滤值：缺省 = 不过滤；undefined = 坏值（词表外）。
 */
function parseStatus(value: unknown): SessionStatus | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!(PERSISTED_SESSION_STATUSES as readonly string[]).includes(raw)) return undefined;
  return raw as SessionStatus;
}

export default createSessionStorageRoutes;
