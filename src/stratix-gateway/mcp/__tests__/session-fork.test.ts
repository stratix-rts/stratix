/**
 * 文件职责：`stratix_session_fork` 的单测 —— 从一条会话的某个事件处分叉出一条新会话
 *   （复制到该处为止的对话历史 + forked 标记），以及各条错误路径
 *   （会话不存在 / 种类不支持 / 入参非法 / 命令没人接管 / 没有事件源复制不到内容）。
 * 输入：**真链路** —— 真总线（core/bus）→ 真 runtime → 真 session manager
 *   （带真持久化注入件 + 真事件读口）→ 真 store；落库走**真实 sql.js 适配器** + 真 DAO。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. mock 掉总线 / runtime / manager —— 这件工具的全部职责就是"把分叉命令投出去、读回结果"；
 *   2. 只断言 store 不断言库 —— 事件本体不进广播，只看 store 等于漏验一半；
 *   3. 只断言"多了一条会话"不断言事件条数 —— 复制了几条历史才是分叉的**本体**。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import type { SqliteDatabaseLike } from '../../../app/services/persistence/game-save-dao';
import {
  createSessionPersistenceDao,
  createSessionPersister,
} from '../../../app/services/persistence/session-persister';
import { createSessionReader } from '../../../app/services/persistence/session-reader';
import { emitCommand, resetBus } from '../../../core/bus';
import { createCoreRuntime } from '../../../core/runtime';
import { createSessionManager, type SessionManager } from '../../../core/session';
import { createStore, type CoreStore } from '../../../core/store';
import { McpToolError } from '../envelope';
import { DEFAULT_MCP_TOOLS } from '../server';
import { sessionForkTool, sessionListTool } from '../tools/session';
import type { McpHost } from '../types';

interface ForkData {
  session_id: string;
  kind: string;
  title: string;
  status: string;
  participants: string[];
  source_session_id: string;
  at_seq: number | null;
  copied_count: number | null;
  event_count: number;
  poll: { tool: string; args: Record<string, unknown> };
}

interface Harness {
  readonly store: CoreStore;
  /** 会话写入面（建会话 + 记账，与 runtime 共用同一实例）。 */
  readonly session: SessionManager;
  readonly host: McpHost;
  readonly stop: () => void;
}

/**
 * 起一套真链路：真 store + 真 session manager（真持久化 + 真事件读口）+ 真 runtime（接总线）。
 * withRuntime=false = 模拟"本进程没有 core 运行时接管命令"。
 * withEventSource=false = 模拟"没有事件源"（复制不到内容 → core 如实拒绝）。
 */
function harness(db: Database, withRuntime = true, withEventSource = true): Harness {
  const store = createStore();
  const persister = createSessionPersister(
    createSessionPersistenceDao(db as unknown as SqliteDatabaseLike)
  );
  const reader = createSessionReader(db as unknown as SqliteDatabaseLike);
  const session = createSessionManager({
    store,
    persist: persister,
    ...(withEventSource ? { read: reader } : {}),
  });
  const runtime = createCoreRuntime({ store, session });
  const stop = withRuntime ? runtime.start() : (): void => undefined;

  const host: McpHost = {
    getWorldState: () => store.getState(),
    // 真总线：与 HUD 面板发的是同一条通道（core/bus 的 emitCommand）。
    dispatchCommand: (command) => emitCommand(command),
    // 读口：与生产组合根同一份（读库里的摘要与事件流）。
    readSessions: reader,
  };
  return { store, session, host, stop };
}

/** 跑一次 handler 并取回错误码（工具抛的是 McpToolError —— 业务失败）。 */
async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(McpToolError);
    return (error as McpToolError).code;
  }
  throw new Error('应当抛错');
}

async function callFork(
  host: McpHost,
  args: Record<string, unknown>
): Promise<ForkData> {
  const result = await sessionForkTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: ForkData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

let cleanups: Array<() => void> = [];

beforeEach(() => {
  resetBus();
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  resetBus();
});

describe('stratix_session_fork（真总线 + 真 runtime + 真 sql.js 库）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-mcp-fork-')),
      'sessions.sqlite'
    );
    db = new Database(dbPath);
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  /** 会话读口（读库里的摘要与事件流）。 */
  function reader(): ReturnType<typeof createSessionReader> {
    return createSessionReader(db as unknown as SqliteDatabaseLike);
  }

  /**
   * 造一条"聊过一轮"的互聊会话（事件流：created / message / message / round）。
   */
  function peerChat(session: SessionManager): string {
    const created = session.createSession({ kind: 'peer_chat', participants: ['agent-a', 'agent-b'] });
    session.appendEvent(created!.id, {
      type: 'message',
      payload: { author: '用户', text: '先侦察还是先扩张' },
    });
    session.appendEvent(created!.id, {
      type: 'message',
      payload: { author: 'agent-a', text: '先侦察。' },
    });
    session.appendEvent(created!.id, { type: 'round', payload: { summary: '先侦察' } });
    return created!.id;
  }

  it('已注册在默认工具面里，且排在 session_resume 之后（清单位次）', () => {
    const names = DEFAULT_MCP_TOOLS.map((tool) => tool.name);
    expect(names).toContain('stratix_session_fork');
    expect(names.indexOf('stratix_session_fork')).toBe(
      names.indexOf('stratix_session_resume') + 1
    );
  });

  it('分叉一条互聊会话：新会话可见、复制了对话历史、末尾一条 forked 标记', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const sessionId = peerChat(session);

    const data = await callFork(host, { session_id: sessionId });

    // 回执：给出新会话的标识与查法（写工具必须给"下一步怎么查"）。
    expect(data.source_session_id).toBe(sessionId);
    expect(data.session_id).not.toBe(sessionId);
    expect(data.kind).toBe('peer_chat');
    expect(data.status).toBe('active');
    expect(data.participants).toEqual(['agent-a', 'agent-b']);
    expect(data.poll).toEqual({
      tool: 'stratix_session_get',
      args: { session_id: data.session_id },
    });

    // ① 事件：复制过来的对话事件 + 新会话自己的 created + forked。
    const events = reader().readSessionEvents(data.session_id, { limit: 20 });
    expect(events.map((event) => event.type)).toEqual([
      'created',
      'message',
      'message',
      'round',
      'forked',
    ]);
    // 复制来的消息内容原样（换 sessionId + seq 重排，载荷不动）。
    expect(events[1]?.payload).toMatchObject({ author: '用户', text: '先侦察还是先扩张' });

    // ② forked 标记记着来源与实际生效的截止 seq。
    expect(events[4]?.payload).toMatchObject({
      sourceSessionId: sessionId,
      atSeq: 4,
      copiedCount: 3,
    });

    // ③ 摘要：事件数 = 复制条数 + created + forked。
    expect(reader().readSession(data.session_id)?.eventCount).toBe(5);

    // ④ 新会话在 session_list 里可见（事件数正确）。
    const listResult = await sessionListTool.handler({}, host);
    const listEnvelope = listResult.structuredContent as {
      ok: boolean;
      data: { sessions: { items: Array<{ id: string; event_count: number }> } };
    };
    const listed = listEnvelope.data.sessions.items.find((item) => item.id === data.session_id);
    expect(listed?.event_count).toBe(5);

    // ⑤ 源会话一个字都没改。
    const source = reader().readSession(sessionId);
    expect(source?.eventCount).toBe(4);
    expect(reader().readSessionEvents(sessionId, { limit: 20 }).map((e) => e.type)).toEqual([
      'created',
      'message',
      'message',
      'round',
    ]);
  });

  it('at_seq=0：复制 0 条对话事件（分叉在起点之前）', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const sessionId = peerChat(session);

    const data = await callFork(host, { session_id: sessionId, at_seq: 0 });

    expect(data.copied_count).toBe(0);
    expect(data.at_seq).toBe(0);
    expect(data.event_count).toBe(2); // created + forked
    const events = reader().readSessionEvents(data.session_id, { limit: 20 });
    expect(events.map((event) => event.type)).toEqual(['created', 'forked']);
  });

  it('at_seq=中间：只复制到该 seq（含）', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const sessionId = peerChat(session);

    const data = await callFork(host, { session_id: sessionId, at_seq: 3 });

    expect(data.copied_count).toBe(2); // 两条 message
    expect(data.at_seq).toBe(3);
    const events = reader().readSessionEvents(data.session_id, { limit: 20 });
    expect(events.map((event) => event.type)).toEqual(['created', 'message', 'message', 'forked']);
  });

  it('at_seq 越界（大于末尾）→ 夹到末尾（如实回实际生效的值）', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const sessionId = peerChat(session);

    const data = await callFork(host, { session_id: sessionId, at_seq: 999 });

    expect(data.at_seq).toBe(4); // 源会话最大 seq
    expect(data.copied_count).toBe(3);
  });

  it('会话不在本进程的状态里 → session_not_found', async () => {
    const { host, stop } = harness(db);
    cleanups.push(stop);

    expect(await errorCode(callFork(host, { session_id: 'session_不存在' }))).toBe(
      'session_not_found'
    );
  });

  it('会话种类不支持分叉（character_chat / task_run / mission_run / shell_link）→ unsupported_kind，且不发命令', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const characterChat = session.createSession({ kind: 'character_chat', participants: ['ch_kimi'] });
    const taskRun = session.createSession({ kind: 'task_run', refId: 'task_7' });
    const missionRun = session.createSession({ kind: 'mission_run' });
    const shellLink = session.createSession({ kind: 'shell_link', participants: ['claude-code'] });

    for (const id of [characterChat!.id, taskRun!.id, missionRun!.id, shellLink!.id]) {
      expect(await errorCode(callFork(host, { session_id: id }))).toBe('unsupported_kind');
    }

    // 被拒的会话状态未被改动（没多出新会话 —— 命令没发出去）。
    expect(host.getWorldState().sessions ?? []).toHaveLength(4);
  });

  it('session_id 为空 → invalid_arguments', async () => {
    const { host, stop } = harness(db);
    cleanups.push(stop);

    expect(await errorCode(callFork(host, { session_id: '   ' }))).toBe('invalid_arguments');
  });

  it('at_seq 非法（负数 / 非整数）→ invalid_arguments', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const sessionId = peerChat(session);

    expect(await errorCode(callFork(host, { session_id: sessionId, at_seq: -1 }))).toBe(
      'invalid_arguments'
    );
    expect(await errorCode(callFork(host, { session_id: sessionId, at_seq: 1.5 }))).toBe(
      'invalid_arguments'
    );
  });

  it('命令没人接管（本进程没有 core 运行时）→ internal_error（不假装成功）', async () => {
    const { session, host } = harness(db, false);

    const sessionId = peerChat(session);

    expect(await errorCode(callFork(host, { session_id: sessionId }))).toBe('internal_error');
    // 没有新会话（确实没分叉出来）。
    expect(host.getWorldState().sessions ?? []).toHaveLength(1);
  });

  it('没有事件源（复制不到内容）→ internal_error（如实拒绝，不空转成「已分叉」）', async () => {
    const { session, host } = harness(db, true, false);

    const sessionId = peerChat(session);

    expect(await errorCode(callFork(host, { session_id: sessionId }))).toBe('internal_error');
    expect(host.getWorldState().sessions ?? []).toHaveLength(1);
  });
});
