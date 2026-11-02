/**
 * 文件职责：`stratix_session_list` / `stratix_session_get` 的单测 —— 列表（过滤 / 分页 / 排序）、
 *   单条读取（会话摘要 + 事件流 + before_seq 游标）、错误路径（不存在的 id → session_not_found；
 *   词表外 / 越界入参 → invalid_arguments；读口缺席 → internal_error）。
 * 输入：**真实的 sql.js 适配器**（生产同款）开临时文件库 + 真实的 DAO + 真实的读取口
 *   （app/services/persistence/session-reader.ts）—— 数据是**真写进去的行**，不是打桩的假数据。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. mock 掉 DAO / 读取口 —— 这两个工具的全部职责就是"把库里的会话读出来并如实回话"，
 *      mock 掉它们等于测"回执长得对"；
 *   2. 用 WorldState 造会话 —— 会话历史的真相在库（事件本体不入广播），测试也走同一条路。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import {
  upsertSessionRecord,
  type PersistedSessionRecord,
} from '../../../app/services/persistence/session-dao';
import { appendSessionEvent } from '../../../app/services/persistence/session-event-dao';
import { createSessionReader } from '../../../app/services/persistence/session-reader';
import { createStore } from '../../../core/store';
import { McpToolError } from '../envelope';
import { sessionGetTool, sessionListTool } from '../tools/session';
import type { McpHost } from '../types';

interface SessionItem {
  id: string;
  kind: string;
  title: string;
  status: string;
  participants: string[];
  ref_id: string | null;
  event_count: number;
  created_at: number;
  last_event_at: number;
}

interface ListData {
  sessions: {
    returned: number;
    total: number;
    truncated: boolean;
    items: SessionItem[];
  };
  limit: number;
  offset: number;
  next: { tool: string; args: Record<string, unknown>; hint: string };
}

interface EventItem {
  seq: number;
  type: string;
  payload: unknown;
  at: number;
}

interface GetData {
  session: SessionItem & { closed_at: number | null };
  events: {
    returned: number;
    total: number;
    limit: number;
    before_seq: number | null;
    has_more: boolean;
    items: EventItem[];
    /** 折叠后**可见**的事件条数（摘要 + 近期原文）；total 是全量条数。 */
    visible_total?: number;
    include_raw?: boolean;
    /** 这条会话是否折叠过（@since v3.48，task_106）。 */
    compressed?: boolean;
    compressed_ranges?: { from_seq: number; to_seq: number }[];
  };
  poll: { tool: string; args: Record<string, unknown> };
}

function session(patch: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
  return {
    id: 'session_peer_chat_1',
    kind: 'peer_chat',
    title: '互聊：侦察北门',
    participants: ['agent-a', 'agent-b'],
    status: 'active',
    refId: null,
    createdAt: 1_000,
    lastEventAt: 1_000,
    closedAt: null,
    eventCount: 1,
    ...patch,
  };
}

async function callList(host: McpHost, args: Record<string, unknown> = {}): Promise<ListData> {
  const result = await sessionListTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: ListData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

async function callGet(host: McpHost, args: Record<string, unknown>): Promise<GetData> {
  const result = await sessionGetTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: GetData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

/** 跑一个 handler 并取回错误码（工具抛的是 McpToolError —— 业务失败）。 */
async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(McpToolError);
    return (error as McpToolError).code;
  }
  throw new Error('应当抛错');
}

describe('stratix_session_list / stratix_session_get（真实 sql.js 适配器）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-mcp-session-')),
      'sessions.sqlite'
    );
    db = new Database(dbPath);
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  /** 往库里写真实的会话行与事件行（走真实的 DAO）。 */
  function seed(): void {
    upsertSessionRecord(
      db as unknown as Parameters<typeof upsertSessionRecord>[0],
      session({ id: 'session_peer_chat_1', createdAt: 1_000, eventCount: 3 })
    );
    upsertSessionRecord(
      db as unknown as Parameters<typeof upsertSessionRecord>[0],
      session({
        id: 'session_task_run_2',
        kind: 'task_run',
        title: '任务会话：重构路由层',
        participants: ['ch_kimi'],
        status: 'closed',
        refId: 'task_7',
        createdAt: 2_000,
        lastEventAt: 2_500,
        closedAt: 2_500,
        eventCount: 2,
      })
    );
    upsertSessionRecord(
      db as unknown as Parameters<typeof upsertSessionRecord>[0],
      session({
        id: 'session_character_chat_3',
        kind: 'character_chat',
        title: '聊天：Kimi',
        participants: ['ch_kimi'],
        status: 'interrupted',
        createdAt: 3_000,
        lastEventAt: 3_200,
        eventCount: 2,
      })
    );

    const append = (
      sessionId: string,
      seq: number,
      type: string,
      payload: unknown,
      createdAt: number
    ): void => {
      appendSessionEvent(db as unknown as Parameters<typeof appendSessionEvent>[0], {
        sessionId,
        seq,
        type,
        payload,
        createdAt,
      });
    };
    append('session_peer_chat_1', 1, 'created', { title: '互聊：侦察北门', participants: ['agent-a'] }, 1_000);
    append('session_peer_chat_1', 2, 'message', { author: 'agent-a', text: '北门有人' }, 1_100);
    append('session_peer_chat_1', 3, 'interrupt', { reason: '超时' }, 1_200);
    append('session_task_run_2', 1, 'created', { title: '任务会话：重构路由层' }, 2_000);
    append('session_task_run_2', 2, 'closed', { reason: '完成' }, 2_500);
    append('session_character_chat_3', 1, 'created', { title: '聊天：Kimi' }, 3_000);
    append('session_character_chat_3', 2, 'interrupt', { reason: '进程退出' }, 3_200);
  }

  /** 造一个带真实会话读口的主机（世界态是空的 —— 这两件工具不读世界态）。 */
  function makeHost(withReader = true): McpHost {
    const store = createStore({ characters: [], units: [], missions: [], tasks: [] });
    return {
      getWorldState: () => store.getState(),
      dispatchCommand: () => {
        throw new Error('只读工具不该派命令');
      },
      ...(withReader
        ? { readSessions: createSessionReader(db as unknown as Parameters<typeof createSessionReader>[0]) }
        : {}),
    };
  }

  describe('stratix_session_list', () => {
    it('列出全部会话：按创建时间倒序，带 returned / total / truncated', async () => {
      seed();
      const data = await callList(makeHost());

      expect(data.sessions.returned).toBe(3);
      expect(data.sessions.total).toBe(3);
      expect(data.sessions.truncated).toBe(false);
      expect(data.sessions.items.map((item) => item.id)).toEqual([
        'session_character_chat_3',
        'session_task_run_2',
        'session_peer_chat_1',
      ]);
      const first = data.sessions.items[0];
      expect(first).toMatchObject({
        kind: 'character_chat',
        status: 'interrupted',
        participants: ['ch_kimi'],
        ref_id: null,
        event_count: 2,
      });
    });

    it('kind 过滤：只回该种类的会话', async () => {
      seed();
      const data = await callList(makeHost(), { kind: 'peer_chat' });

      expect(data.sessions.returned).toBe(1);
      expect(data.sessions.total).toBe(1);
      expect(data.sessions.items[0].id).toBe('session_peer_chat_1');
    });

    it('status 过滤：只回该状态的会话', async () => {
      seed();
      const data = await callList(makeHost(), { status: 'closed' });

      expect(data.sessions.returned).toBe(1);
      expect(data.sessions.items[0].id).toBe('session_task_run_2');
    });

    it('kind + status 组合过滤：两者都命中才回', async () => {
      seed();
      const hit = await callList(makeHost(), { kind: 'task_run', status: 'closed' });
      expect(hit.sessions.items.map((item) => item.id)).toEqual(['session_task_run_2']);

      const miss = await callList(makeHost(), { kind: 'task_run', status: 'active' });
      expect(miss.sessions.returned).toBe(0);
      expect(miss.sessions.total).toBe(0);
    });

    it('分页：limit 截断时 truncated=true，offset 取到下一页', async () => {
      seed();
      const firstPage = await callList(makeHost(), { limit: 2 });
      expect(firstPage.sessions.returned).toBe(2);
      expect(firstPage.sessions.total).toBe(3);
      expect(firstPage.sessions.truncated).toBe(true);
      expect(firstPage.sessions.items.map((item) => item.id)).toEqual([
        'session_character_chat_3',
        'session_task_run_2',
      ]);

      const secondPage = await callList(makeHost(), { limit: 2, offset: 2 });
      expect(secondPage.sessions.returned).toBe(1);
      expect(secondPage.sessions.total).toBe(3);
      // 最后一页：后面没有别的会话了 —— 不得再报 truncated（否则模型会一直翻页）。
      expect(secondPage.sessions.truncated).toBe(false);
      expect(secondPage.sessions.items.map((item) => item.id)).toEqual(['session_peer_chat_1']);
    });

    it('查法引导指向 session_get', async () => {
      seed();
      const data = await callList(makeHost());
      expect(data.next.tool).toBe('stratix_session_get');
      expect(data.next.args).toEqual({ session_id: 'session_character_chat_3' });
    });

    it('kind / status 词表外、limit 越界、offset 为负 → invalid_arguments', async () => {
      seed();
      const host = makeHost();

      expect(await errorCode(callList(host, { kind: 'unknown_kind' }))).toBe('invalid_arguments');
      expect(await errorCode(callList(host, { status: 'unknown_status' }))).toBe('invalid_arguments');
      expect(await errorCode(callList(host, { limit: 0 }))).toBe('invalid_arguments');
      expect(await errorCode(callList(host, { limit: 101 }))).toBe('invalid_arguments');
      expect(await errorCode(callList(host, { offset: -1 }))).toBe('invalid_arguments');
    });

    it('读口缺席 → internal_error（不回空列表冒充"没有会话"）', async () => {
      seed();
      const host = makeHost(false);
      expect(await errorCode(callList(host))).toBe('internal_error');
    });
  });

  describe('stratix_session_get', () => {
    it('读一条会话：摘要 + 事件流（seq 正序，payload 原样透传）', async () => {
      seed();
      const data = await callGet(makeHost(), { session_id: 'session_peer_chat_1' });

      expect(data.session).toMatchObject({
        id: 'session_peer_chat_1',
        kind: 'peer_chat',
        title: '互聊：侦察北门',
        status: 'active',
        participants: ['agent-a', 'agent-b'],
        event_count: 3,
        created_at: 1_000,
        last_event_at: 1_000,
        closed_at: null,
      });
      expect(data.events.returned).toBe(3);
      expect(data.events.total).toBe(3);
      expect(data.events.has_more).toBe(false);
      expect(data.events.items.map((item) => item.seq)).toEqual([1, 2, 3]);
      expect(data.events.items[1]).toMatchObject({
        seq: 2,
        type: 'message',
        payload: { author: 'agent-a', text: '北门有人' },
      });
    });

    it('事件流分页：before_seq 取该序号之前的一段，has_more 如实报"前面还有"', async () => {
      seed();
      const host = makeHost();

      const older = await callGet(host, { session_id: 'session_peer_chat_1', before_seq: 3 });
      expect(older.events.items.map((item) => item.seq)).toEqual([1, 2]);
      expect(older.events.before_seq).toBe(3);
      expect(older.events.has_more).toBe(false);

      const window = await callGet(host, { session_id: 'session_peer_chat_1', limit: 1 });
      expect(window.events.items.map((item) => item.seq)).toEqual([3]);
      expect(window.events.has_more).toBe(true);
    });

    it('会话不存在 → session_not_found', async () => {
      seed();
      const host = makeHost();
      expect(await errorCode(callGet(host, { session_id: 'session_ghost' }))).toBe('session_not_found');
    });

    it('session_id 为空 / before_seq 非正整数 / limit 越界 → invalid_arguments', async () => {
      seed();
      const host = makeHost();

      expect(await errorCode(callGet(host, { session_id: '   ' }))).toBe('invalid_arguments');
      expect(await errorCode(callGet(host, { session_id: 'session_peer_chat_1', before_seq: 0 }))).toBe(
        'invalid_arguments'
      );
      expect(await errorCode(callGet(host, { session_id: 'session_peer_chat_1', limit: 0 }))).toBe(
        'invalid_arguments'
      );
      expect(await errorCode(callGet(host, { session_id: 'session_peer_chat_1', limit: 201 }))).toBe(
        'invalid_arguments'
      );
    });

    it('poll 链指向本工具（会话推进时再调一次就能看到新事件）', async () => {
      seed();
      const data = await callGet(makeHost(), { session_id: 'session_peer_chat_1' });
      expect(data.poll).toEqual({
        tool: 'stratix_session_get',
        args: { session_id: 'session_peer_chat_1' },
      });
    });

    it('读口缺席 → internal_error', async () => {
      seed();
      expect(await errorCode(callGet(makeHost(false), { session_id: 'session_peer_chat_1' }))).toBe(
        'internal_error'
      );
    });
  });

  /**
   * 长会话压缩（@since v3.48，task_106 / v3.2b-B7）——
   *   老段被折叠成**一条** 'compressed' 摘要事件后，MCP 读面默认给「摘要 + 近期原文」，
   *   include_raw=true 才展开原段。
   */
  describe('长会话压缩（task_106 / v3.2b-B7）', () => {
    /**
     * 造一条压缩过的会话：1..8 被摘要盖住（原文仍在库里 —— append-only 不删行），
     *   摘要本身是第 12 条事件。
     */
    function seedCompressed(): void {
      upsertSessionRecord(
        db as unknown as Parameters<typeof upsertSessionRecord>[0],
        session({ id: 'session_peer_chat_long', createdAt: 1_000, eventCount: 12 })
      );
      const append = (
        seq: number,
        type: string,
        payload: unknown,
        createdAt: number
      ): void => {
        appendSessionEvent(db as unknown as Parameters<typeof appendSessionEvent>[0], {
          sessionId: 'session_peer_chat_long',
          seq,
          type,
          payload,
          createdAt,
        });
      };
      for (let seq = 1; seq <= 11; seq += 1) {
        append(seq, 'message', { author: 'agent-a', text: `m${seq}` }, 1_000 + seq);
      }
      append(
        12,
        'compressed',
        {
          fromSeq: 1,
          toSeq: 8,
          rounds: 0,
          participants: ['agent-a'],
          firstSummary: 'm1',
          lastSummary: 'm8',
          keyEvents: [],
          foldedCount: 8,
        },
        1_012
      );
    }

    it('默认视图：被盖住的老原文不露，compressed / compressed_ranges 如实报', async () => {
      seedCompressed();
      const data = await callGet(makeHost(), { session_id: 'session_peer_chat_long' });

      // 可见 = 保留窗里的原文（9..11）+ 那条摘要（12）。
      expect(data.events.items.map((item) => item.seq)).toEqual([9, 10, 11, 12]);
      expect(data.events.visible_total).toBe(4);
      // total 是全量条数（含被折叠的老段）—— 与 visible_total 区分开。
      expect(data.events.total).toBe(12);
      expect(data.events.compressed).toBe(true);
      expect(data.events.compressed_ranges).toEqual([{ from_seq: 1, to_seq: 8 }]);
      expect(data.events.include_raw).toBe(false);
    });

    it('include_raw=true：展开原段，原文一条不少（append-only：不删行）', async () => {
      seedCompressed();
      const data = await callGet(makeHost(), {
        session_id: 'session_peer_chat_long',
        include_raw: true,
      });

      expect(data.events.items.map((item) => item.seq)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      expect(data.events.include_raw).toBe(true);
      // 折叠过这件事照样如实报（客户端据此提示"这里可以展开"）。
      expect(data.events.compressed).toBe(true);
      expect(data.events.compressed_ranges).toEqual([{ from_seq: 1, to_seq: 8 }]);
    });

    it('分页：按**可见**事件切；展开原段时能翻到被折叠的老原文', async () => {
      seedCompressed();
      const host = makeHost();

      // 默认视图翻页：游标之前那段（可见事件里更早的）。
      const older = await callGet(host, {
        session_id: 'session_peer_chat_long',
        before_seq: 11,
        limit: 2,
      });
      expect(older.events.items.map((item) => item.seq)).toEqual([9, 10]);
      expect(older.events.has_more).toBe(false);

      // 展开原段翻页：能翻到被折叠的老原文（默认视图翻不到 —— 它们已被摘要盖住）。
      const rawOlder = await callGet(host, {
        session_id: 'session_peer_chat_long',
        before_seq: 5,
        limit: 3,
        include_raw: true,
      });
      expect(rawOlder.events.items.map((item) => item.seq)).toEqual([2, 3, 4]);
    });

    it('include_raw 非布尔 → invalid_arguments', async () => {
      seedCompressed();
      expect(
        await errorCode(
          callGet(makeHost(), { session_id: 'session_peer_chat_long', include_raw: 'yes' })
        )
      ).toBe('invalid_arguments');
    });
  });
});
