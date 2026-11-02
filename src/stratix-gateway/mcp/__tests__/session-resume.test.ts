/**
 * 文件职责：`stratix_session_resume` 的单测 —— 恢复一条被中断的互聊会话（状态转 active +
 * 落一条 resumed 标记事件），以及各条错误路径（会话不存在 / 种类不支持 / 状态不对 /
 * 入参非法 / 命令没人接管 / 没有事件源回灌不出上文）。
 * 输入：**真链路** —— 真总线（core/bus）→ 真 runtime（带真恢复端口）→ 真 session manager
 *   （带真持久化注入件 + 真事件读口）→ 真 store；落库走**真实 sql.js 适配器** + 真 DAO。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. mock 掉总线 / runtime / manager —— 这件工具的全部职责就是"把恢复命令投出去、读回结果"；
 *   2. 只断言 store 不断言库 —— 事件本体不进广播，只看 store 等于漏验一半。
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
import { sessionResumeTool } from '../tools/session';
import type { McpHost } from '../types';

interface ResumeData {
  session_id: string;
  kind: string;
  title: string;
  status: string;
  previous_status: string;
  event_count: number;
  last_event_at: number;
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
 * withEventSource=false = 模拟"没有事件源"（回灌不出上文 → core 如实拒绝）。
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
  // 恢复端口 = core 级恢复（翻状态位 + 建回灌快照）—— 与 service 侧组合根同一口径。
  const runtime = createCoreRuntime({
    store,
    session,
    sessionResume: (sessionId: string): void => {
      session.resume(sessionId);
    },
  });
  const stop = withRuntime ? runtime.start() : (): void => undefined;

  const host: McpHost = {
    getWorldState: () => store.getState(),
    // 真总线：与 HUD 面板发的是同一条通道（core/bus 的 emitCommand）。
    dispatchCommand: (command) => emitCommand(command),
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

async function callResume(host: McpHost, args: Record<string, unknown>): Promise<ResumeData> {
  const result = await sessionResumeTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: ResumeData };
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

describe('stratix_session_resume（真总线 + 真 runtime + 真 sql.js 库）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-mcp-resume-')),
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

  /** 造一条"聊过、被中断"的互聊会话（事件流里有上文可回灌）。 */
  function interruptedPeerChat(session: SessionManager): string {
    const created = session.createSession({ kind: 'peer_chat', participants: ['agent-a', 'agent-b'] });
    session.appendEvent(created!.id, {
      type: 'message',
      payload: { author: '用户', text: '先侦察还是先扩张' },
    });
    session.appendEvent(created!.id, {
      type: 'message',
      payload: { author: 'agent-a', text: '先侦察。' },
    });
    session.interruptSession(created!.id, '超时');
    return created!.id;
  }

  it('已注册在默认工具面里，且排在 session_interrupt 之后（清单位次）', () => {
    const names = DEFAULT_MCP_TOOLS.map((tool) => tool.name);
    expect(names).toContain('stratix_session_resume');
    expect(names.indexOf('stratix_session_resume')).toBe(
      names.indexOf('stratix_session_interrupt') + 1
    );
  });

  it('恢复一条被中断的互聊会话：状态转 active，且落一条 resumed 事件', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const sessionId = interruptedPeerChat(session);

    const data = await callResume(host, { session_id: sessionId });

    expect(data).toMatchObject({
      session_id: sessionId,
      kind: 'peer_chat',
      status: 'active',
      previous_status: 'interrupted',
    });
    // 回执带查法（写工具必须给"下一步怎么查"）。
    expect(data.poll).toEqual({
      tool: 'stratix_session_get',
      args: { session_id: sessionId },
    });

    // ① 状态：WorldState.sessions 里那条转回 active。
    const after = (host.getWorldState().sessions ?? []).find((item) => item.id === sessionId);
    expect(after?.status).toBe('active');
    expect(after?.closedAt).toBeNull(); // 恢复不是收尾（终态），历史还能查

    // ② 事件：恢复标记落在库里（事件本体不进广播，只在库）。
    const events = reader().readSessionEvents(sessionId, { limit: 20 });
    expect(events.map((event) => event.type)).toEqual([
      'created',
      'message',
      'message',
      'interrupt',
      'resumed',
    ]);
    // 回灌条数如实记在 resumed 事件里（回了多少条上文）。
    expect(events[4]?.payload).toMatchObject({ note: expect.stringContaining('上下文回灌') });

    // ③ 摘要快照也落库了（status='active'）。
    expect(reader().readSession(sessionId)?.status).toBe('active');
  });

  it('会话不在本进程的状态里 → session_not_found', async () => {
    const { host, stop } = harness(db);
    cleanups.push(stop);

    expect(await errorCode(callResume(host, { session_id: 'session_不存在' }))).toBe(
      'session_not_found'
    );
  });

  it('会话种类不支持恢复（character_chat / task_run / mission_run / shell_link）→ unsupported_kind，且不发命令', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const characterChat = session.createSession({ kind: 'character_chat', participants: ['ch_kimi'] });
    const taskRun = session.createSession({ kind: 'task_run', refId: 'task_7' });
    const missionRun = session.createSession({ kind: 'mission_run' });
    const shellLink = session.createSession({ kind: 'shell_link', participants: ['claude-code'] });

    for (const id of [characterChat!.id, taskRun!.id, missionRun!.id, shellLink!.id]) {
      expect(await errorCode(callResume(host, { session_id: id }))).toBe('unsupported_kind');
    }

    // 被拒的会话状态未被改动（事件计数没涨 —— 没发命令出去）。
    const after = host.getWorldState().sessions ?? [];
    for (const id of [characterChat!.id, taskRun!.id, missionRun!.id, shellLink!.id]) {
      expect(after.find((item) => item.id === id)?.status).toBe('active');
      expect(after.find((item) => item.id === id)?.eventCount).toBe(1);
    }
  });

  it('不是被中断的会话（active）→ illegal_transition，历史不改写', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const created = session.createSession({ kind: 'peer_chat', participants: ['agent-a'] });

    expect(await errorCode(callResume(host, { session_id: created!.id }))).toBe(
      'illegal_transition'
    );
    // 没记事件（事件流仍只有 created 一条）。
    expect(reader().readSessionEvents(created!.id, { limit: 10 }).map((e) => e.type)).toEqual([
      'created',
    ]);
  });

  it('session_id 为空 → invalid_arguments', async () => {
    const { host, stop } = harness(db);
    cleanups.push(stop);

    expect(await errorCode(callResume(host, { session_id: '   ' }))).toBe('invalid_arguments');
  });

  it('命令没人接管（本进程没有 core 运行时）→ internal_error（不假装成功）', async () => {
    const { session, host } = harness(db, false);

    const sessionId = interruptedPeerChat(session);

    expect(await errorCode(callResume(host, { session_id: sessionId }))).toBe('internal_error');
    // 状态没变（确实没恢复成）。
    expect(
      (host.getWorldState().sessions ?? []).find((item) => item.id === sessionId)?.status
    ).toBe('interrupted');
  });

  it('没有事件源（回灌不出上文）→ internal_error（如实拒绝，不空转成「已恢复」）', async () => {
    const { session, host, stop } = harness(db, true, false);
    cleanups.push(stop);

    const sessionId = interruptedPeerChat(session);

    expect(await errorCode(callResume(host, { session_id: sessionId }))).toBe('internal_error');
    // 状态没变：core 拒绝恢复时一个字节都不改。
    expect(
      (host.getWorldState().sessions ?? []).find((item) => item.id === sessionId)?.status
    ).toBe('interrupted');
  });
});
