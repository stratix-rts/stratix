/**
 * 文件职责：`stratix_session_interrupt` 的单测 —— 中断一条在办会话（状态转 interrupted +
 * 落一条 interrupt 标记事件），以及各条错误路径（会话不存在 / 种类不支持 / 重复中断 /
 * 已收尾 / 入参非法 / 命令没人接管）。
 * 输入：**真链路** —— 真总线（core/bus）→ 真 runtime → 真 session manager → 真 store；
 *   落库走**真实 sql.js 适配器** + 真 DAO（事件本体只进库，不进广播）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. mock 掉总线 / runtime / manager —— 这件工具的全部职责就是"把中断命令投出去、读回结果"，
 *      mock 掉它们等于测"回执长得对"；
 *   2. 只断言 store 不断言库 —— 验收项是"状态转 interrupted **且**事件落中断标记"，
 *      事件本体不在广播里，只看 store 等于漏验一半。
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
import { sessionInterruptTool } from '../tools/session';
import type { McpHost } from '../types';

interface InterruptData {
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
 * 起一套真链路：真 store + 真 session manager（带真持久化注入件）+ 真 runtime（接总线）。
 * withRuntime=false = 模拟"本进程没有 core 运行时接管命令"。
 */
function harness(db: Database, withRuntime = true): Harness {
  const store = createStore();
  const persister = createSessionPersister(
    createSessionPersistenceDao(db as unknown as SqliteDatabaseLike)
  );
  const session = createSessionManager({ store, persist: persister });
  const runtime = createCoreRuntime({ store, session });
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

async function callInterrupt(
  host: McpHost,
  args: Record<string, unknown>
): Promise<InterruptData> {
  const result = await sessionInterruptTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: InterruptData };
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

describe('stratix_session_interrupt（真总线 + 真 runtime + 真 sql.js 库）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-mcp-interrupt-')),
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

  it('已注册在默认工具面里，且排在 session_get 之后（清单位次）', () => {
    const names = DEFAULT_MCP_TOOLS.map((tool) => tool.name);
    expect(names).toContain('stratix_session_interrupt');
    expect(names.indexOf('stratix_session_interrupt')).toBe(
      names.indexOf('stratix_session_get') + 1
    );
  });

  it('中断一条进行中的会话：状态转 interrupted，且落一条 interrupt 事件', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const created = session.createSession({ kind: 'peer_chat', participants: ['agent-a', 'agent-b'] });
    expect(created).not.toBeNull();

    const data = await callInterrupt(host, { session_id: created!.id });

    expect(data).toMatchObject({
      session_id: created!.id,
      kind: 'peer_chat',
      status: 'interrupted',
      previous_status: 'active',
    });
    // 回执带查法（写工具必须给"下一步怎么查"）。
    expect(data.poll).toEqual({
      tool: 'stratix_session_get',
      args: { session_id: created!.id },
    });

    // ① 状态：WorldState.sessions 里的那条转成 interrupted，事件计数 +1（created → interrupt）。
    const after = (host.getWorldState().sessions ?? []).find((item) => item.id === created!.id);
    expect(after?.status).toBe('interrupted');
    expect(after?.eventCount).toBe(2);

    // ② 事件：中断标记落在库里（事件本体不进广播，只在库）。
    const events = reader().readSessionEvents(created!.id, { limit: 10 });
    expect(events.map((event) => event.type)).toEqual(['created', 'interrupt']);
    expect(events[1]?.seq).toBe(2);
    expect(events[1]?.payload).toMatchObject({ reason: '会话被中断' });

    // ③ 摘要快照也落库了（status='interrupted'）。
    expect(reader().readSession(created!.id)?.status).toBe('interrupted');
  });

  it('空闲（idle）的会话也能中断（回执回显 previous_status=idle）', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const created = session.createSession({ kind: 'peer_chat', participants: ['agent-a'] });
    session.idleSession(created!.id);

    const data = await callInterrupt(host, { session_id: created!.id });
    expect(data.previous_status).toBe('idle');
    expect(data.status).toBe('interrupted');
  });

  it('会话不在本进程的状态里 → session_not_found', async () => {
    const { host, stop } = harness(db);
    cleanups.push(stop);

    expect(await errorCode(callInterrupt(host, { session_id: 'session_不存在' }))).toBe(
      'session_not_found'
    );
  });

  it('会话种类不支持中断（character_chat / task_run / mission_run / shell_link）→ unsupported_kind，且不发命令', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const characterChat = session.createSession({ kind: 'character_chat', participants: ['ch_kimi'] });
    const taskRun = session.createSession({ kind: 'task_run', refId: 'task_7' });
    const missionRun = session.createSession({ kind: 'mission_run' });
    const shellLink = session.createSession({ kind: 'shell_link', participants: ['claude-code'] });

    for (const id of [characterChat!.id, taskRun!.id, missionRun!.id, shellLink!.id]) {
      expect(await errorCode(callInterrupt(host, { session_id: id }))).toBe('unsupported_kind');
    }

    // 被拒的会话状态未被改动（事件计数没涨 —— 没发命令出去）。
    const after = host.getWorldState().sessions ?? [];
    for (const id of [characterChat!.id, taskRun!.id, missionRun!.id, shellLink!.id]) {
      expect(after.find((item) => item.id === id)?.status).toBe('active');
      expect(after.find((item) => item.id === id)?.eventCount).toBe(1);
    }
  });

  it('重复中断（已中断的会话）→ illegal_transition，历史不改写', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const created = session.createSession({ kind: 'peer_chat', participants: ['agent-a'] });
    await callInterrupt(host, { session_id: created!.id });

    expect(await errorCode(callInterrupt(host, { session_id: created!.id }))).toBe(
      'illegal_transition'
    );

    // 第二次没记事件（事件流仍是 created + interrupt 两条）。
    expect(reader().readSessionEvents(created!.id, { limit: 10 }).map((e) => e.type)).toEqual([
      'created',
      'interrupt',
    ]);
  });

  it('已收尾的会话 → illegal_transition', async () => {
    const { session, host, stop } = harness(db);
    cleanups.push(stop);

    const created = session.createSession({ kind: 'peer_chat', participants: ['agent-a'] });
    session.closeSession(created!.id, '收尾');

    expect(await errorCode(callInterrupt(host, { session_id: created!.id }))).toBe(
      'illegal_transition'
    );
  });

  it('session_id 为空 → invalid_arguments', async () => {
    const { host, stop } = harness(db);
    cleanups.push(stop);

    expect(await errorCode(callInterrupt(host, { session_id: '   ' }))).toBe('invalid_arguments');
  });

  it('命令没人接管（本进程没有 core 运行时）→ internal_error（不假装成功）', async () => {
    const { session, host } = harness(db, false);

    const created = session.createSession({ kind: 'peer_chat', participants: ['agent-a'] });

    expect(await errorCode(callInterrupt(host, { session_id: created!.id }))).toBe(
      'internal_error'
    );
    // 状态没变（确实没中断成）。
    expect(
      (host.getWorldState().sessions ?? []).find((item) => item.id === created!.id)?.status
    ).toBe('active');
  });
});
