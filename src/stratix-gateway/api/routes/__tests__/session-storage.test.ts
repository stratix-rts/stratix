/**
 * 文件职责：会话读 API（/api/storage/sessions*）的单测 —— 验「只读门面」这一层：
 *   路由形状、过滤 / 分页参数的收紧与拒绝、坏输入的 400、以及**端口未附着时如实报 503**
 *   （不假装正常）。
 * 输入：真起一个 express 实例（随机端口）+ 一个假读口（只记调用参数，不碰数据库）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不打桩 HTTP 层 —— 这里要验的就是「请求进得来、响应出得去」；
 *   2. 不用真数据库 —— 数据库归 session-dao 单测（那里验真落库）；这里验路由层，别把两层搅在一起。
 */

import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import type { PersistedSessionRecord } from '../../../../app/services/persistence/session-dao';
import type { PersistedSessionEvent } from '../../../../app/services/persistence/session-event-dao';
import { createSessionStorageRoutes, type SessionReadPort } from '../session-storage';

interface CallLog {
  readonly readSessions: Array<{
    kind?: string;
    status?: string;
    limit: number;
    offset: number;
  }>;
  readonly readSessionEvents: Array<{
    sessionId: string;
    beforeSeq: number | undefined;
    limit: number;
  }>;
}

function fakeRecord(patch: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
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
    eventCount: 2,
    ...patch,
  };
}

function fakeEvent(patch: Partial<PersistedSessionEvent> = {}): PersistedSessionEvent {
  return {
    sessionId: 'session_peer_chat_1',
    seq: 1,
    type: 'message',
    payload: { author: 'a', text: '在吗' },
    createdAt: 1_000,
    ...patch,
  };
}

/** 造一个假读口：记调用参数 + 返回预置的读数。 */
function fakePort(
  sessions: PersistedSessionRecord[] = [],
  events: PersistedSessionEvent[] = []
): { port: SessionReadPort; calls: CallLog } {
  const calls: CallLog = { readSessions: [], readSessionEvents: [] };
  return {
    calls,
    port: {
      readSessions: (filter) => {
        calls.readSessions.push({
          ...(filter.kind ? { kind: filter.kind } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          limit: filter.limit,
          offset: filter.offset,
        });
        return sessions;
      },
      readSessionEvents: (sessionId, options) => {
        calls.readSessionEvents.push({
          sessionId,
          beforeSeq: options.beforeSeq,
          limit: options.limit,
        });
        return events;
      },
    },
  };
}

describe('会话读 API（/api/storage/sessions*）', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    // 先挂一个「端口未附着」的实例（503 口径），用例里各自替换。
    app.use('/api/storage', createSessionStorageRoutes(null));
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/storage`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** 起一个只挂指定读口的 express（随机端口），返回它的基址。 */
  async function serveWith(port: SessionReadPort): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const app = express();
    app.use('/api/storage', createSessionStorageRoutes(port));
    const listener = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = listener.address() as AddressInfo;
    return {
      baseUrl: `http://127.0.0.1:${address.port}/api/storage`,
      close: () => new Promise<void>((resolve) => listener.close(() => resolve())),
    };
  }

  it('端口未附着：如实报 503（不返回空态假装正常）', async () => {
    const listResponse = await fetch(`${baseUrl}/sessions`);
    expect(listResponse.status).toBe(503);
    const listBody = (await listResponse.json()) as { success?: boolean; error?: string };
    expect(listBody.success).toBe(false);
    expect(listBody.error).toBe('storage not attached');

    const eventsResponse = await fetch(`${baseUrl}/sessions/session_peer_chat_1/events`);
    expect(eventsResponse.status).toBe(503);
  });

  it('GET /sessions：返回会话摘要列表；过滤条件透传给读口', async () => {
    const { port, calls } = fakePort([fakeRecord()]);
    const served = await serveWith(port);
    try {
      const response = await fetch(`${served.baseUrl}/sessions?kind=peer_chat&status=active`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        success?: boolean;
        data?: { sessions?: PersistedSessionRecord[]; kind?: string; status?: string };
      };
      expect(body.success).toBe(true);
      expect(body.data?.sessions).toHaveLength(1);
      expect(body.data?.sessions?.[0]?.id).toBe('session_peer_chat_1');
      expect(calls.readSessions).toEqual([
        { kind: 'peer_chat', status: 'active', limit: 50, offset: 0 },
      ]);
    } finally {
      await served.close();
    }
  });

  it('GET /sessions：limit 收紧到 [1, 200]、offset 透传', async () => {
    const { port, calls } = fakePort([]);
    const served = await serveWith(port);
    try {
      await fetch(`${served.baseUrl}/sessions?limit=9999&offset=20`);
      expect(calls.readSessions).toEqual([{ limit: 200, offset: 20 }]);
    } finally {
      await served.close();
    }
  });

  it('坏输入：词表外的 kind / status、坏 offset 一律 400', async () => {
    const { port, calls } = fakePort([]);
    const served = await serveWith(port);
    try {
      expect((await fetch(`${served.baseUrl}/sessions?kind=ghost_kind`)).status).toBe(400);
      expect((await fetch(`${served.baseUrl}/sessions?status=ghost_status`)).status).toBe(400);
      expect((await fetch(`${served.baseUrl}/sessions?offset=-1`)).status).toBe(400);
      expect((await fetch(`${served.baseUrl}/sessions?offset=abc`)).status).toBe(400);
      // 坏输入一律不进读口（不带着坏参数去查库）。
      expect(calls.readSessions).toHaveLength(0);
    } finally {
      await served.close();
    }
  });

  it('GET /sessions/:id/events：返回事件流；读口按窗口口径读（游标缺省 = 最新一段）', async () => {
    const { port, calls } = fakePort([], [fakeEvent()]);
    const served = await serveWith(port);
    try {
      const response = await fetch(`${served.baseUrl}/sessions/session_peer_chat_1/events?beforeSeq=5&limit=10`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        success?: boolean;
        data?: { sessionId?: string; events?: PersistedSessionEvent[] };
      };
      expect(body.success).toBe(true);
      expect(body.data?.sessionId).toBe('session_peer_chat_1');
      expect(body.data?.events).toHaveLength(1);
      // 读取路由（@since v3.48，task_106）从**最新**往回翻页扫摘要区间，
      //   故第一页是「最新 limit 条」（不带游标）；beforeSeq 在路由层过滤。
      expect(calls.readSessionEvents).toEqual([
        { sessionId: 'session_peer_chat_1', beforeSeq: undefined, limit: 200 },
      ]);
    } finally {
      await served.close();
    }
  });

  it('GET /sessions/:id/events：includeRaw=1 → 展开原段，游标与条数透传给读口', async () => {
    const { port, calls } = fakePort([], [fakeEvent()]);
    const served = await serveWith(port);
    try {
      const response = await fetch(
        `${served.baseUrl}/sessions/session_peer_chat_1/events?includeRaw=1&beforeSeq=5&limit=10`
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        success?: boolean;
        data?: { events?: PersistedSessionEvent[]; includeRaw?: boolean };
      };
      expect(body.data?.includeRaw).toBe(true);
      expect(body.data?.events).toHaveLength(1);
      // 展开原段 = 全部事件都可见 → 直接用读口的窗口口径（游标 + 条数照传）。
      expect(calls.readSessionEvents).toContainEqual({
        sessionId: 'session_peer_chat_1',
        beforeSeq: 5,
        limit: 10,
      });
    } finally {
      await served.close();
    }
  });

  it('GET /sessions/:id/events：压缩过的会话 —— 默认给「摘要 + 近期原文」，includeRaw 给全量', async () => {
    // 造一条压缩过的会话：12 条事件（1..8 被摘要盖住，摘要本身是第 12 条）。
    const events: PersistedSessionEvent[] = [];
    for (let seq = 1; seq <= 11; seq += 1) {
      events.push(fakeEvent({ seq, type: 'message', payload: { author: 'a', text: `m${seq}` } }));
    }
    events.push(
      fakeEvent({
        seq: 12,
        type: 'compressed',
        payload: {
          fromSeq: 1,
          toSeq: 8,
          rounds: 0,
          participants: ['a'],
          firstSummary: 'm1',
          lastSummary: 'm8',
          keyEvents: [],
          foldedCount: 8,
        },
      })
    );
    // 窗口口径的读口（最后 limit 条 / beforeSeq 之前的那一段）。
    const port: SessionReadPort = {
      readSessions: () => [],
      readSessionEvents: (_sessionId, options) => {
        const hit = events
          .filter((event) => options.beforeSeq === undefined || event.seq < options.beforeSeq)
          .sort((a, b) => a.seq - b.seq);
        return hit.slice(Math.max(0, hit.length - options.limit));
      },
    };
    const served = await serveWith(port);
    try {
      const plain = (await (
        await fetch(`${served.baseUrl}/sessions/session_peer_chat_1/events?limit=50`)
      ).json()) as {
        data?: { events?: PersistedSessionEvent[]; compressed?: boolean; compressedRanges?: unknown[] };
      };
      // 默认视图：被盖住的 1..8 不露，保留窗里的原文 + 那条摘要。
      expect(plain.data?.events?.map((event) => event.seq)).toEqual([9, 10, 11, 12]);
      expect(plain.data?.compressed).toBe(true);
      expect(plain.data?.compressedRanges).toEqual([{ fromSeq: 1, toSeq: 8 }]);

      const raw = (await (
        await fetch(`${served.baseUrl}/sessions/session_peer_chat_1/events?limit=50&includeRaw=1`)
      ).json()) as { data?: { events?: PersistedSessionEvent[] } };
      // 展开原段：原文一条不少。
      expect(raw.data?.events?.map((event) => event.seq)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
    } finally {
      await served.close();
    }
  });

  it('GET /sessions/:id/events：不给 beforeSeq = 取最新一段（游标缺省）', async () => {
    const { port, calls } = fakePort([], []);
    const served = await serveWith(port);
    try {
      await fetch(`${served.baseUrl}/sessions/session_peer_chat_1/events`);
      expect(calls.readSessionEvents).toEqual([
        { sessionId: 'session_peer_chat_1', beforeSeq: undefined, limit: 200 },
      ]);
    } finally {
      await served.close();
    }
  });

  it('坏输入：坏游标 / 坏 includeRaw / 超长会话 id 一律 400', async () => {
    const { port, calls } = fakePort([], []);
    const served = await serveWith(port);
    try {
      expect((await fetch(`${served.baseUrl}/sessions/session_peer_chat_1/events?beforeSeq=0`)).status).toBe(400);
      expect((await fetch(`${served.baseUrl}/sessions/session_peer_chat_1/events?beforeSeq=abc`)).status).toBe(400);
      expect((await fetch(`${served.baseUrl}/sessions/session_peer_chat_1/events?includeRaw=maybe`)).status).toBe(400);
      expect((await fetch(`${served.baseUrl}/sessions/${'x'.repeat(201)}/events`)).status).toBe(400);
      expect(calls.readSessionEvents).toHaveLength(0);
    } finally {
      await served.close();
    }
  });

  it('读口抛错 → 500（如实报错，不返回假空态）', async () => {
    const port: SessionReadPort = {
      readSessions: () => {
        throw new Error('db exploded');
      },
      readSessionEvents: () => {
        throw new Error('db exploded');
      },
    };
    const served = await serveWith(port);
    try {
      const response = await fetch(`${served.baseUrl}/sessions`);
      expect(response.status).toBe(500);
      const body = (await response.json()) as { success?: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('db exploded');
    } finally {
      await served.close();
    }
  });
});
