/**
 * 文件职责：`stratix_session_list`（列会话）、`stratix_session_get`（读一条会话 + 事件流）、
 *   `stratix_session_interrupt`（中断一条在办会话）、`stratix_session_resume`（恢复一条被中断的
 *   互聊会话 = 续跑接线）、`stratix_session_fork`（从某条事件处分叉出一条新会话）
 *   —— 会话域的工具组：外部 agent 由此看见会话，
 *   并能叫停 / 恢复 / 分叉一场对话（docs/SESSION-PLAN.md §8 B4 与 2b 第一期）。
 * 输入：list = kind? / status? / limit? / offset?；get = session_id / before_seq? / limit?；
 *      interrupt = session_id；resume = session_id；fork = session_id / at_seq?。
 * 输出：会话摘要列表（带 returned / total / truncated）或单条会话摘要 + 事件流的一段，
 *      或一次中断 / 恢复 / 分叉的受理回执（id / 状态 / 查法 poll）。
 * 禁止事项：
 *   1. 在 MCP 侧自己维护一份会话 —— 会话真相在 core（WorldState.sessions）+ 库（sessions /
 *      session_events 两张表）；读面只**读**（读口是 core 的 SessionReadPort），
 *      写面只**发命令**（落点由 core runtime 裁决）；
 *   2. 回灌事件全文之外的东西 —— 事件按类型原样返回（payload 是事件本体），
 *      不做二次加工、不替模型总结（总结是模型自己的活）；
 *   3. 写面里的其它动作 —— **收尾**会话一律不做（close 是会话域内部的事，不对外开放）；
 *   4. 另造一份事件分页口径 —— before_seq 游标语义与 service 侧读 API
 *      （GET /api/storage/sessions/:id/events）同一口径，不各写一份；
 *   5. 在工具侧另写一套相位判定 —— 中断能不能成由 core 状态机裁决（core/session/machine.ts
 *      的 interrupt 分支），工具只读回结果（与 task_cancel 同一纪律）。
 *
 * why 读口走库而不走 WorldState：WorldState.sessions 只带**在办会话的摘要**
 *   （上限 MAX_SESSIONS = 200，且会裁掉已关闭的最旧会话），而事件本体**根本不入广播**
 *   （性能铁律：广播体积必须有界）。外部 agent 要看的是「发生过什么」，故读面以库为准
 *   （MCP 与 service 同进程 → 同进程直读，合法：见 mcp/context.ts 的 readSessionsFromDatabase）。
 *
 * why 写面反而看 WorldState：中断的**裁决与落点**在本进程的状态里（core/session 的 manager
 *   写的正是这份 WorldState.sessions）—— 库里那条会话本进程未必还在跑（服务重启后不在内存、
 *   已收尾被 FIFO 淘汰），对一条不在跑的会话发命令没有意义。
 */

import {
  PERSISTED_SESSION_KINDS,
  PERSISTED_SESSION_STATUSES,
} from '../../../app/services/persistence/session-dao';
import type { SessionEventView } from '../../../core/session/types';
import type { SessionKind } from '../../../core/types';
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
 * 可中断的会话种类（第一期只认**互聊**一种）。
 *
 * why 只认 `peer_chat`：中断的含义是"叫停一场正在进行的对话"，而互聊是唯一一种
 *   **会话记录与"正在跑的那场对话"一一对应**的 kind（agent-chat-service 开场建会话、
 *   超时 / 取消时把它转 interrupted —— 这正是"超时即丢"的解药）。
 * 其余四类不是"一场在跑的对话"，中断它们停不下任何东西，只会给出误导性的"已中断"：
 *   - `character_chat`：每角色一条**长生命周期**记录（历史在 chat_messages 表），
 *     它背后没有"一条正在跑的对局"可停；
 *   - `task_run` / `mission_run`：会话是任务 / 任务单**实体的生命周期镜像**（随实体终态自动收尾），
 *     中断它停不住任务（停任务是 stratix_task_cancel / mission 域的事）；
 *   - `shell_link`：会话是 agent-link **连接的投影**，中断它不会断开连接（那是 link 命令的事）。
 *
 * why 与 core 的 resume 口径一致（方案 §8 第一期只做 peer_chat）：会话写面第一期只覆盖互聊。
 * 放宽是**纯增量**（只加不删），将来别的 kind 真有"在跑的东西"时再放开即可。
 */
const INTERRUPTIBLE_SESSION_KINDS: readonly SessionKind[] = ['peer_chat'];

export const sessionInterruptTool: ToolSpec = {
  name: 'stratix_session_interrupt',
  domain: 'session',
  verb: 'interrupt',
  order: 12,
  description: [
    '中断一条会话：把进行中 / 空闲的会话显式转成 interrupted，并落一条中断标记事件（会话不再"悄悄没了"）。',
    '何时用：一场互聊卡住或超时了，想让它停下来并留下可见、可查的痕迹；想确认某条会话还活着、要不要叫停。',
    '何时不用：只是想知道有哪些会话、发生过什么 —— 用 stratix_session_list / stratix_session_get；',
    '要取消一条排队中的角色任务 —— 用 stratix_task_cancel（中断会话停不住任务）；',
    '要断开一条 agent 连接 —— 连接由 agent-link 命令管，MCP 不提供。',
    '边界：只认**互聊**会话（peer_chat）—— 其余四类一律 unsupported_kind：character_chat 是每角色一条长生命周期记录（背后没有在跑的对局可停），',
    'task_run / mission_run 是任务 / 任务单实体的生命周期镜像（随实体终态自动收尾，中断它停不住任务），shell_link 是 agent-link 连接的投影（中断它不断开连接）；',
    '只有 active / idle 可中断（已中断 / 已收尾的会话重复中断一律拒绝，历史不改写）；',
    '中断只改会话状态并记一条 interrupt 事件 —— 不杀进程、不回滚已经产生的消息；中断不等于恢复（续聊是另一件事，本工具不做）。',
    '错误：session_not_found（会话 id 不在本进程的状态里）/ unsupported_kind（该类会话不支持中断）/',
    'illegal_transition（会话已中断或已收尾）/ invalid_arguments（session_id 为空）/ internal_error（命令没人接管）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        minLength: 1,
        description: '会话 id（见 stratix_session_list）。',
      },
    },
    required: ['session_id'],
    additionalProperties: false,
  },
  errors: [
    'session_not_found',
    'unsupported_kind',
    'illegal_transition',
    'invalid_arguments',
    'internal_error',
  ],
  readOnly: false,
  handler: (args, host) => {
    const sessionId = requireString(args, 'session_id');

    // 存在性与当前相位取**本进程的状态**（WorldState.sessions）—— 中断的裁决与落点都在那里；
    // 库里那条会话本进程未必还在跑（服务重启后不在内存、已收尾被 FIFO 淘汰）。
    const before = (host.getWorldState().sessions ?? []).find((item) => item.id === sessionId);
    if (!before) {
      throw new McpToolError('session_not_found', `会话「${sessionId}」不在本进程的状态里`, {
        hint: '用 stratix_session_list 重列一遍会话，取一条正在跑的会话 id',
      });
    }
    if (!INTERRUPTIBLE_SESSION_KINDS.includes(before.kind)) {
      throw new McpToolError(
        'unsupported_kind',
        `会话「${sessionId}」是 ${before.kind} 类，不支持中断`,
        { hint: '只有互聊会话（peer_chat）可中断；任务与连接请用各自的工具' }
      );
    }

    const previousStatus = before.status;
    // active / idle 才可能中断 —— 但**不在工具侧判**：判据归 core 状态机（下面读回结果时说）。
    const wasInterruptible = previousStatus === 'active' || previousStatus === 'idle';

    // 相位裁决交给 core 状态机（core/session/machine.ts 的 interrupt 分支：只认 active / idle）——
    // 工具侧不另写一套判定，否则两套规则必然漂移。命令是同步的，投完就能读回结果。
    host.dispatchCommand({ type: 'session.interrupt', sessionId });

    const after = (host.getWorldState().sessions ?? []).find((item) => item.id === sessionId);
    if (!after) {
      throw new McpToolError('internal_error', '中断后会话从状态里消失了（不应发生）', {
        hint: '查服务端日志确认 core 运行时是否异常',
      });
    }
    if (wasInterruptible && after.status === 'interrupted') {
      return toToolResult({
        ok: true,
        data: {
          session_id: after.id,
          kind: after.kind,
          title: after.title,
          status: after.status,
          previous_status: previousStatus,
          event_count: after.eventCount,
          last_event_at: after.lastEventAt,
          // 查法：中断标记是事件流的最后一条 —— 用 session_get 看它的原文与时间。
          poll: {
            tool: 'stratix_session_get',
            args: { session_id: after.id },
          },
        },
      });
    }
    if (wasInterruptible && after.status === previousStatus) {
      // 可中断却纹丝未动 —— 只可能是命令没人接管（runtime 不在本进程）。
      throw new McpToolError(
        'internal_error',
        '中断未落地：本进程没有 core 运行时接管这条命令',
        { hint: '确认 Stratix 运行时在本进程已启动后再中断' }
      );
    }
    // 状态机拒了（已中断 / 已收尾）—— 如实回当前相位，历史不改写。
    throw new McpToolError(
      'illegal_transition',
      `会话「${sessionId}」当前是 ${after.status}，只有进行中 / 空闲的会话可中断`,
      { hint: '用 stratix_session_get 看这条会话发生了什么；已中断 / 已收尾的会话不可重复中断' }
    );
  },
};

/**
 * 可恢复的会话种类（第一期只认**互聊**一种）。
 *
 * why 与 INTERRUPTIBLE_SESSION_KINDS 同一口径（方案 docs/SESSION-PLAN.md §8：
 *   「resume 第一期只做 peer_chat」）：续跑的前提是"背后有一场能接着跑的对局"——
 *   互聊是唯一一种会话记录与"正在跑的那场对话"一一对应的 kind。
 * 其余四类恢复不了，也不该给模型"已恢复"的错觉：
 *   - `character_chat`：每角色一条长生命周期记录，背后没有"一场对局"可续；
 *   - `task_run` / `mission_run`：会话是任务实体的生命周期镜像，续跑 = 重跑任务（那是任务域的事）；
 *   - `shell_link`：会话是 agent-link 连接的投影，续跑 = 重连（那是 link 命令的事）。
 */
const RESUMABLE_SESSION_KINDS: readonly SessionKind[] = ['peer_chat'];

export const sessionResumeTool: ToolSpec = {
  name: 'stratix_session_resume',
  domain: 'session',
  verb: 'resume',
  order: 13,
  description: [
    '恢复一条被中断的互聊会话：把它转回 active，并把回灌的上文重新喂给参与者（续跑）。',
    '何时用：一场互聊超时 / 被中断了，想让它从断的地方接着聊；想确认这条被中断的会话还能不能续上。',
    '何时不用：只是想知道有哪些会话、发生过什么 —— 用 stratix_session_list / stratix_session_get；',
    '要重新开始一场**新**讨论 —— 恢复是接着原来的聊（带上下文），新开一场不是；',
    '要取消一条排队中的角色任务 —— 用 stratix_task_cancel（恢复会话停不住任务）。',
    '边界：只认**互聊**会话（peer_chat）—— 其余四类一律 unsupported_kind：character_chat 是每角色一条长生命周期记录（背后没有对局可续），',
    'task_run / mission_run 是任务实体的生命周期镜像（续跑 = 重跑任务），shell_link 是 agent-link 连接的投影（续跑 = 重连）；',
    '只有 interrupted 可恢复（active / idle / closed 一律拒绝，历史不改写）；',
    '恢复只改会话状态、回灌上文并重启轮转 —— 不回滚已经产生的消息，也不凭空补写没发生过的发言。',
    '错误：session_not_found（会话 id 不在本进程的状态里）/ unsupported_kind（该类会话不支持恢复）/',
    'illegal_transition（会话不是被中断的）/ invalid_arguments（session_id 为空）/ internal_error（命令没人接管）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        minLength: 1,
        description: '会话 id（见 stratix_session_list）。',
      },
    },
    required: ['session_id'],
    additionalProperties: false,
  },
  errors: [
    'session_not_found',
    'unsupported_kind',
    'illegal_transition',
    'invalid_arguments',
    'internal_error',
  ],
  readOnly: false,
  handler: (args, host) => {
    const sessionId = requireString(args, 'session_id');

    // 存在性与当前相位取**本进程的状态**（WorldState.sessions）—— 恢复的裁决与落点都在那里；
    // 库里那条会话本进程未必还在跑（服务重启后不在内存、已收尾被 FIFO 淘汰）。
    const before = (host.getWorldState().sessions ?? []).find((item) => item.id === sessionId);
    if (!before) {
      throw new McpToolError('session_not_found', `会话「${sessionId}」不在本进程的状态里`, {
        hint: '用 stratix_session_list 重列一遍会话，取一条被中断的会话 id',
      });
    }
    if (!RESUMABLE_SESSION_KINDS.includes(before.kind)) {
      throw new McpToolError(
        'unsupported_kind',
        `会话「${sessionId}」是 ${before.kind} 类，不支持恢复`,
        { hint: '只有互聊会话（peer_chat）可恢复；任务与连接请用各自的工具' }
      );
    }

    const previousStatus = before.status;
    // interrupted 才可能恢复 —— 但**不在工具侧判**：判据归 core 状态机（下面读回结果时说）。
    const wasResumable = previousStatus === 'interrupted';

    // 相位裁决交给 core（core/session 的 manager.resume：只认 peer_chat + interrupted，
    //   且要求事件源已附着 —— 没有上文可回灌就**如实拒绝**，不空转成"已恢复"）。
    host.dispatchCommand({ type: 'session.resume', sessionId });

    const after = (host.getWorldState().sessions ?? []).find((item) => item.id === sessionId);
    if (!after) {
      throw new McpToolError('internal_error', '恢复后会话从状态里消失了（不应发生）', {
        hint: '查服务端日志确认 core 运行时是否异常',
      });
    }
    if (wasResumable && after.status === 'active') {
      return toToolResult({
        ok: true,
        data: {
          session_id: after.id,
          kind: after.kind,
          title: after.title,
          status: after.status,
          previous_status: previousStatus,
          event_count: after.eventCount,
          last_event_at: after.lastEventAt,
          // 查法：恢复标记是事件流的最后一条 —— 用 session_get 看它的原文与时间。
          poll: {
            tool: 'stratix_session_get',
            args: { session_id: after.id },
          },
        },
      });
    }
    if (wasResumable && after.status === previousStatus) {
      // 可恢复却纹丝未动 —— 两种可能：本进程没有 core 运行时接管这条命令；
      //   或会话历史未接入、**回灌不出上文**（core 如实拒绝，不空转）。
      throw new McpToolError(
        'internal_error',
        '恢复未落地：本进程没有 core 运行时接管这条命令，或会话历史未接入、无法回灌上文',
        { hint: '确认 Stratix 运行时在本进程已启动，且这条会话的历史（事件流）已接入' }
      );
    }
    // 状态机拒了（不是 interrupted）—— 如实回当前相位，历史不改写。
    throw new McpToolError(
      'illegal_transition',
      `会话「${sessionId}」当前是 ${after.status}，只有被中断的会话可恢复`,
      { hint: '用 stratix_session_get 看这条会话发生了什么；进行中 / 已收尾的会话不可恢复' }
    );
  },
};

/**
 * 可分叉的会话种类（第一期只认**互聊**一种）。
 *
 * why 与 INTERRUPTIBLE / RESUMABLE 同一口径（方案 docs/SESSION-PLAN.md §8 第一期只做 peer_chat）：
 *   分叉复制的是**对话事实**（消息 / 轮次 / 中断标记 —— core/session/context-replay.ts 的复制口径），
 *   而只有互聊会话的事件流里有这些。其余四类复制过去的是空壳：
 *   - `character_chat`：消息本体在 chat_messages 表（不在会话事件流里）→ 复制 0 条；
 *   - `task_run` / `mission_run`：任务实体的生命周期镜像（事件是埋点，不是对话）→ 复制 0 条；
 *   - `shell_link`：agent-link 连接的投影 → 分叉连接没有意义。
 *   回一个"分叉成功但历史是空的"回执，比明说"这类会话不支持分叉"更伤 ——
 *   模型会以为上下文带过去了，其实没有。
 */
const FORKABLE_SESSION_KINDS: readonly SessionKind[] = ['peer_chat'];

export const sessionForkTool: ToolSpec = {
  name: 'stratix_session_fork',
  domain: 'session',
  verb: 'fork',
  order: 14,
  description: [
    '分叉一条会话：从它的某个事件处派生出一条**新会话**（复制到该处为止的对话历史，参与者继承）。',
    '何时用：一段对话聊岔了 / 想换个方向重来 —— 从某条消息之后另起一条会话接着走；',
    '想在不改动原会话的前提下留一条"另一种可能"的分支。',
    '何时不用：只是想知道有哪些会话、发生过什么 —— 用 stratix_session_list / stratix_session_get；',
    '要接着**被中断**的那场聊 —— 用 stratix_session_resume（恢复是接着原来的会话，分叉是另起一条）；',
    '要取消一条排队中的角色任务 —— 用 stratix_task_cancel（分叉会话停不住任务）。',
    '边界：只认**互聊**会话（peer_chat）—— 其余四类一律 unsupported_kind（分叉复制的是对话事实，',
    '只有互聊的事件流里有；别类复制过来的是空壳）。at_seq 是**截止的事件序号（含）**，缺省 = 全量复制；',
    '越界不是错误 —— 超过末尾按末尾算（= 全量）；0 = 起点之前（复制 0 条，只建一条不带历史的新会话）；',
    '新会话的标题 = 原标题加「（分叉）」标记、参与者继承、状态 active，源会话**一个字都不改**；',
    '分叉只新建会话 —— 不接着聊（对话轮转由持有互聊引擎的那一侧负责）、不回滚原会话的任何消息。',
    '错误：session_not_found（会话 id 不在本进程的状态里）/ unsupported_kind（该类会话不支持分叉）/',
    'invalid_arguments（session_id 为空 / at_seq 不是正整数）/ internal_error（命令没人接管，或会话历史未接入、复制不到内容）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        minLength: 1,
        description: '源会话 id（见 stratix_session_list）。',
      },
      at_seq: {
        type: 'integer',
        minimum: 0,
        description: '复制截止的事件序号（含）；缺省 = 全量复制。',
      },
    },
    required: ['session_id'],
    additionalProperties: false,
  },
  errors: [
    'session_not_found',
    'unsupported_kind',
    'invalid_arguments',
    'internal_error',
  ],
  readOnly: false,
  handler: (args, host) => {
    const sessionId = requireString(args, 'session_id');
    const atSeq = optionalInteger(args, 'at_seq', { min: 0 });

    // 存在性与当前相位取**本进程的状态**（WorldState.sessions）—— 分叉的裁决与落点都在那里；
    // 库里那条会话本进程未必还在跑（服务重启后不在内存、已收尾被 FIFO 淘汰）。
    const before = (host.getWorldState().sessions ?? []).find((item) => item.id === sessionId);
    if (!before) {
      throw new McpToolError('session_not_found', `会话「${sessionId}」不在本进程的状态里`, {
        hint: '用 stratix_session_list 重列一遍会话，取一条真实的会话 id',
      });
    }
    if (!FORKABLE_SESSION_KINDS.includes(before.kind)) {
      throw new McpToolError(
        'unsupported_kind',
        `会话「${sessionId}」是 ${before.kind} 类，不支持分叉`,
        { hint: '只有互聊会话（peer_chat）可分叉；分叉复制的是对话事实，别的类别复制过来是空壳' }
      );
    }

    // 分叉会**新建**一条会话 —— 记下投命令前的 id 集合，投完靠"多了哪条"认出分叉产物
    //   （新会话的 id 由 core 生成，MCP 侧无从预知；靠差集认，不靠猜）。
    const beforeIds = new Set((host.getWorldState().sessions ?? []).map((item) => item.id));

    // 裁决交给 core（core/session 的 manager.fork：读事件流 → 复制到 atSeq → 建新会话）。
    //   读不到事件流时 core **如实拒绝**（不造一条空壳分叉）。
    host.dispatchCommand({ type: 'session.fork', sessionId, ...(atSeq === undefined ? {} : { atSeq }) });

    const after = host.getWorldState().sessions ?? [];
    const created = after.find((item) => !beforeIds.has(item.id));
    if (!created) {
      throw new McpToolError(
        'internal_error',
        '分叉未落地：本进程没有 core 运行时接管这条命令，或会话历史未接入、复制不到内容',
        { hint: '确认 Stratix 运行时在本进程已启动，且这条会话的历史（事件流）已接入' }
      );
    }

    // 分叉标记事件里有**实际生效**的截止 seq 与复制条数（core 夹过的值）—— 如实回给模型，
    //   免得它以为 at_seq=999 就真的复制了 999 条。
    const forked = findForkedEvent(host, created.id);

    return toToolResult({
      ok: true,
      data: {
        session_id: created.id,
        kind: created.kind,
        title: created.title,
        status: created.status,
        participants: [...created.participants],
        source_session_id: sessionId,
        at_seq: forked?.atSeq ?? atSeq ?? null,
        copied_count: forked?.copiedCount ?? null,
        event_count: created.eventCount,
        created_at: created.createdAt,
        // 查法：分叉出来的是一条**新会话** —— 用 session_get 读它的事件流
        //   （前几条就是复制过来的历史，末尾一条是 forked 标记）。
        poll: {
          tool: 'stratix_session_get',
          args: { session_id: created.id },
        },
      },
    });
  },
};

/**
 * 找新会话的「forked」标记事件（源会话 id / 实际截止 seq / 复制条数）。
 *
 * why 要读回它：core 会把 atSeq **夹到合法区间**（越界按末尾算），
 *   MCP 侧只知道自己请求了什么 —— 不读回实际值就等于把"我请求的"当成"生效的"回给模型。
 * 读口缺席 / 读不到这条事件 → 返回 null（据实说"不知道"，不编）。
 */
function findForkedEvent(
  host: McpHost,
  sessionId: string
): { atSeq: number; copiedCount: number } | null {
  const reader = host.readSessions;
  if (!reader) return null;
  let events;
  try {
    events = reader.readSessionEvents(sessionId, { limit: 200 });
  } catch {
    return null;
  }
  const forked = events.find((event) => event.type === 'forked');
  if (!forked) return null;
  const payload = (forked.payload ?? {}) as Record<string, unknown>;
  const atSeq = typeof payload.atSeq === 'number' ? payload.atSeq : null;
  const copiedCount = typeof payload.copiedCount === 'number' ? payload.copiedCount : null;
  if (atSeq === null || copiedCount === null) return null;
  return { atSeq, copiedCount };
}

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
