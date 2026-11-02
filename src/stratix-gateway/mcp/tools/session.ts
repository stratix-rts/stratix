/**
 * 文件职责：`stratix_session_list`（列会话）、`stratix_session_get`（读一条会话 + 事件流）
 *   —— 会话域的**只读**工具组：外部 agent 由此看见会话。
 * 输入：list = kind? / status? / limit? / offset?；get = session_id / before_seq? / limit?。
 * 输出：会话摘要列表（带 returned / total / truncated）或单条会话摘要 + 事件流的一段。
 * 禁止事项：
 *   1. 在 MCP 侧自己维护一份会话 —— 会话真相在 core（WorldState.sessions）+ 库（sessions /
 *      session_events 两张表）；这里只**读**，读口是 core 的 SessionReadPort；
 *   2. 回灌事件全文之外的东西 —— 事件按类型原样返回（payload 是事件本体），
 *      不做二次加工、不替模型总结（总结是模型自己的活）；
 *   3. 写面 —— 中断 / 恢复 / 收尾会话一律不做（session_interrupt 属 2b，
 *      见 docs/SESSION-PLAN.md §4 与 §7）；
 *   4. 另造一份事件分页口径 —— before_seq 游标语义与 service 侧读 API
 *      （GET /api/storage/sessions/:id/events）同一口径，不各写一份。
 *
 * why 读口走库而不走 WorldState：WorldState.sessions 只带**在办会话的摘要**
 *   （上限 MAX_SESSIONS = 200，且会裁掉已关闭的最旧会话），而事件本体**根本不入广播**
 *   （性能铁律：广播体积必须有界）。外部 agent 要看的是「发生过什么」，故读面以库为准
 *   （MCP 与 service 同进程 → 同进程直读，合法：见 mcp/context.ts 的 readSessionsFromDatabase）。
 */

import {
  PERSISTED_SESSION_KINDS,
  PERSISTED_SESSION_STATUSES,
} from '../../../app/services/persistence/session-dao';
import type { SessionEventView } from '../../../core/session/types';
import { optionalEnum, optionalInteger, requireString } from '../args';
import { McpToolError, toToolResult } from '../envelope';
import type { McpHost, ToolSpec } from '../types';

/** 列表模式默认返回条数（与 schema 同值；此处是代码侧兜底）。 */
const DEFAULT_LIST_LIMIT = 20;
/** 列表模式单页上限（与 schema 同值）。 */
const MAX_LIST_LIMIT = 100;
/** 事件流默认条数（与 schema 同值）。 */
const DEFAULT_EVENT_LIMIT = 50;
/** 事件流单页上限（与 schema 同值）。 */
const MAX_EVENT_LIMIT = 200;

export const sessionListTool: ToolSpec = {
  name: 'stratix_session_list',
  domain: 'session',
  verb: 'list',
  // 清单位次（§2 的条目号只作文档锚点，见 docs/MCP-SPEC.md §2.0）：
  // session 域是新域 —— 两件工具排在既有九件之后（既有工具之间的相对次序不变）。
  order: 10,
  description: [
    '列出工作台上的会话（会话域摘要）—— 按种类 / 状态过滤，分页取一段。',
    '何时用：想看"最近发生过哪些会话" —— 哪场互聊卡住了、哪条会话被中断了、哪条任务会话跑完了；',
    '想拿到一个会话 id 再去拉它的明细。',
    '何时不用：查任务本身的进展与产出 —— 用 stratix_task_status；查编组任务 —— 用 stratix_mission_status；',
    '拉某条会话的事件明细 —— 用 stratix_session_get。',
    '边界：只读，不改变任何状态。kind 五选一（character_chat 聊天 / peer_chat 互聊 / task_run 任务 /',
    'mission_run 编队 / shell_link 连接）、status 四选一（active / idle / interrupted / closed）；',
    '都不给 = 不过滤。按创建时间倒序（最新的在前）；limit 默认 20、上限 100；',
    'offset 是**位置**（从第几条开始，0 起），给了负数按 invalid_arguments 报错而不是悄悄夹成 0。',
    '这里只给摘要 —— 事件正文（消息 / 轮次 / 中断原因）不在列表里，要明细用 stratix_session_get。',
    '错误：invalid_arguments（kind / status 词表外 / limit 越界 / offset 为负）/ internal_error。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: [...PERSISTED_SESSION_KINDS],
        description: '只看这一类会话；缺省 = 全部五类。',
      },
      status: {
        type: 'string',
        enum: [...PERSISTED_SESSION_STATUSES],
        description: '只看这一种状态的会话；缺省 = 不按状态过滤。',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIST_LIMIT,
        default: DEFAULT_LIST_LIMIT,
        description: '本页最多返回几条（默认 20，上限 100）。',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        default: 0,
        description: '从第几条开始（0 起；是位置，不是窗口 —— 负数报错）。',
      },
    },
    additionalProperties: false,
  },
  errors: ['invalid_arguments', 'internal_error'],
  readOnly: true,
  handler: (args, host) => {
    const kind = optionalEnum(args, 'kind', PERSISTED_SESSION_KINDS);
    const status = optionalEnum(args, 'status', PERSISTED_SESSION_STATUSES);
    const limit = optionalInteger(args, 'limit', { min: 1, max: MAX_LIST_LIMIT }) ?? DEFAULT_LIST_LIMIT;
    const offset = optionalInteger(args, 'offset', { min: 0 }) ?? 0;

    const reader = requireSessionReader(host);
    const page = reader.readSessions({
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      limit,
      offset,
    });

    const items = page.items.map((record) => ({
      id: record.id,
      kind: record.kind,
      title: record.title,
      status: record.status,
      participants: [...record.participants],
      ref_id: record.refId ?? null,
      event_count: record.eventCount,
      created_at: record.createdAt,
      last_event_at: record.lastEventAt,
    }));

    return toToolResult({
      ok: true,
      data: {
        sessions: {
          returned: items.length,
          total: page.total,
          // 本页之后**还有**别的会话（offset 之后仍有剩余）才算截断 ——
          // 只看"本页条数 < 总数"会把翻到最后一页也说成"还有更多"（骗模型的翻页判断）。
          truncated: page.total > offset + items.length,
          items,
        },
        limit,
        offset,
        // 查法引导：列表只给摘要 —— 要事件明细指向 session_get。
        next:
          items.length > 0
            ? {
                tool: 'stratix_session_get',
                args: { session_id: items[0].id },
                hint: '拉这条会话的详情与事件流；要另一条就把 session_id 换成列表里的 id',
              }
            : {
                tool: 'stratix_session_list',
                args: {},
                hint: '当前过滤条件下没有会话 —— 放宽 kind / status 再列一次',
              },
      },
    });
  },
};

export const sessionGetTool: ToolSpec = {
  name: 'stratix_session_get',
  domain: 'session',
  verb: 'get',
  order: 11,
  description: [
    '读一条会话：会话摘要 + 事件流的一段（按 seq 正序，从旧到新）。',
    '何时用：想看某场互聊 / 某条会话"到底发生了什么"；查它被中断的原因；往前翻更早的事件。',
    '何时不用：只想知道有哪些会话 —— 用 stratix_session_list；查任务的产出全文 —— 用 stratix_task_status；',
    '查角色档案 —— 用 stratix_registry。',
    '边界：只读，不改变任何状态。事件按 seq 正序返回（seq 会话内单调，从 1 起）；',
    'limit 默认 50、上限 200；before_seq 是**游标**（取该序号**之前**的一段，用于往前翻页 ——',
    '把返回的最早一条的 seq 再传回来即可继续往前翻）；会话里更早还有事件时 has_more=true。',
    '事件正文按事件类型原样返回（message 事件带 author / text，interrupt 事件带 reason），MCP 不做总结。',
    '错误：session_not_found（会话 id 不存在）/ invalid_arguments（session_id 为空 / before_seq 非正整数 /',
    'limit 越界）/ internal_error。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        minLength: 1,
        description: '会话 id（见 stratix_session_list）。',
      },
      before_seq: {
        type: 'integer',
        minimum: 1,
        description: '游标：只取 seq 小于它的那些事件；缺省 = 取最新的一段。',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_EVENT_LIMIT,
        default: DEFAULT_EVENT_LIMIT,
        description: '本页最多返回几条事件（默认 50，上限 200）。',
      },
    },
    required: ['session_id'],
    additionalProperties: false,
  },
  errors: ['session_not_found', 'invalid_arguments', 'internal_error'],
  readOnly: true,
  handler: (args, host) => {
    const sessionId = requireString(args, 'session_id');
    const beforeSeq = optionalInteger(args, 'before_seq', { min: 1 });
    const limit = optionalInteger(args, 'limit', { min: 1, max: MAX_EVENT_LIMIT }) ?? DEFAULT_EVENT_LIMIT;

    const reader = requireSessionReader(host);
    const record = reader.readSession(sessionId);
    if (!record) {
      throw new McpToolError('session_not_found', `会话「${sessionId}」不存在`, {
        hint: '用 stratix_session_list 列一遍会话，取一个真实的会话 id',
      });
    }

    const events = reader.readSessionEvents(sessionId, {
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      limit,
    });

    return toToolResult({
      ok: true,
      data: {
        session: {
          id: record.id,
          kind: record.kind,
          title: record.title,
          status: record.status,
          participants: [...record.participants],
          ref_id: record.refId ?? null,
          event_count: record.eventCount,
          created_at: record.createdAt,
          last_event_at: record.lastEventAt,
          closed_at: record.closedAt,
        },
        events: {
          returned: events.length,
          // 总数取摘要计数（会话域的权威计数）；本页条数是实际取回的那一段。
          total: record.eventCount,
          limit,
          before_seq: beforeSeq ?? null,
          // 更早还有事件 = 本页最早一条的 seq 不是 1（seq 会话内单调且连续）。
          has_more: events.length > 0 && events[0].seq > 1,
          items: events.map(presentEvent),
        },
        // 会话在推进时，再调一次就能看到新事件（读面的"查法"）。
        poll: {
          tool: 'stratix_session_get',
          args: { session_id: record.id },
        },
      },
    });
  },
};

/**
 * 会话读口（core 的 SessionReadPort）—— 端口缺席就是"本进程读不到会话"。
 *
 * why 报 internal_error 而不是回空列表：空列表说的是"这里没有会话"，而端口缺席说的是
 * "本进程读不到会话" —— 两句话意思完全不同，混成前者会让模型断言"什么都没发生"。
 */
function requireSessionReader(host: McpHost): NonNullable<McpHost['readSessions']> {
  const reader = host.readSessions;
  if (!reader) {
    throw new McpToolError('internal_error', '本进程没有会话读口（未接 readSessions 端口）', {
      hint: '会话读口由 service 侧的 SQLite 提供；请确认 Stratix service 已在本进程启动',
    });
  }
  return reader;
}

/** 事件 → 工具返回里的一条（payload 原样透传 —— 不加工、不总结）。 */
function presentEvent(event: SessionEventView): {
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly at: number;
} {
  return {
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    at: event.createdAt,
  };
}
