/**
 * 单测：**会话域在 service 组合根的接线**（@since v3.43，task_093 / v3.2a S3）——
 *   验四件事：
 *     ① 持久化口的缺省范式（对齐 exp_events persister 的缺省注入）：
 *        存储件在 → 组合根自动接管落库口；显式给了 persistSession → 以显式为准；
 *        两者皆缺 → **不落库**（会话只活在 WorldState 里，不假装落库成功）；
 *     ② 双侧可见：内存态（WorldState.sessions）与 SQLite（sessions / session_events 两张表）
 *        看到的是同一条会话、同一串事件；
 *     ③ 接线：task_run（自 task_105 起为**全量事件化**：执行路径埋点）与 mission_run（LITE 两事件）
 *        两条由 task-service 的终态收尾触发；
 *     ④ world-sync 快照含 sessions 键（会话随快照走 —— 协议不用改）。
 * 输入：无（自足单测；真 SQLite 文件库建在临时目录里，跑完删掉）。
 * 输出：断言失败即红。
 * 禁止事项：
 *   1. mock 掉数据库 —— 这里验的就是「真落库」，mock 掉就什么都没验；
 *   2. 用内存假库代替文件库 —— 落盘语义由冒烟脚本验，单测只管语义。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resetBus } from '../../../core/bus';
import type { TransportEvent } from '../../../app/services/cli-transport/transport';
import { createStore } from '../../../core/store';
import type { SessionRecord } from '../../../core/session/types';
import { destroyDatabase, getDatabase } from '../../../stratix-database';
import { createSnapshotMessage } from '../../api/websocket/world-sync/protocol';
import { createStratixService, type StratixService } from '../stratix-service';
import { createServiceStorage, type ServiceStorage } from '../storage';

/** 读一张表的行数（自报家门：直接从库里数 —— 证明落的是库，不是内存假象）。 */
function countRows(table: string): number {
  const row = getDatabase()
    .getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .get() as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

function sessionsOf(service: StratixService): SessionRecord[] {
  return service.store.getState().sessions ?? [];
}

/** 等条件成立（执行环是 fire-and-forget 的异步链路，只能靠条件轮询推进）。 */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

// ============================================================================
// 夹具
// ============================================================================

describe('service 组合根的会话域接线（task_093）', () => {
  let dir: string;
  let storage: ServiceStorage;
  let services: StratixService[] = [];

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-session-wiring-'));
    storage = await createServiceStorage({ dataDir: dir });
  });

  afterAll(() => {
    destroyDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetBus();
  });

  afterEach(() => {
    services.forEach((service) => service.stop());
    services = [];
    resetBus();
  });

  function boot(options: Parameters<typeof createStratixService>[0] = {}): StratixService {
    const service = createStratixService({ store: createStore(), ...options });
    services.push(service);
    return service;
  }

  // --------------------------------------------------------------------------
  // ① 持久化口的缺省范式
  // --------------------------------------------------------------------------

  it('存储件在 → 组合根自动接管落库口（会话摘要与事件随写随落）', () => {
    const service = boot({ storage });

    const created = service.session.createSession({
      kind: 'shell_link',
      participants: ['link-1'],
      title: '命令行会话',
    });
    expect(created).not.toBeNull();

    const rows = storage.readSessions({ kind: 'shell_link' });
    const row = rows.find((item) => item.id === created!.id);
    expect(row).toBeDefined();
    expect(row?.status).toBe('active');
    expect(row?.title).toBe('命令行会话');
    // 建会话事件也在库里（事件本体只进库，不进广播）。
    const events = storage.readSessionEvents(created!.id, {});
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ seq: 1, type: 'created' });
  });

  it('显式 persistSession 覆盖缺省（显式优先于存储件接管）', () => {
    const calls: string[] = [];
    const service = boot({
      storage,
      persistSession: {
        persistSession: (record) => calls.push(`record:${record.id}`),
        persistEvent: (event) => calls.push(`event:${event.sessionId}#${event.seq}`),
      },
    });

    const created = service.session.createSession({ kind: 'shell_link', participants: ['link-2'] });
    expect(created).not.toBeNull();

    // 显式口被调用了。
    expect(calls).toContain(`record:${created!.id}`);
    expect(calls).toContain(`event:${created!.id}#1`);
    // 存储件**没有**被接管（显式覆盖缺省）：库里查不到这条会话。
    expect(storage.readSessions({}).some((item) => item.id === created!.id)).toBe(false);
  });

  it('两者皆缺 = 不落库（会话只活在 WorldState 里，不假装落库成功）', () => {
    const before = countRows('sessions');
    const service = boot();

    const created = service.session.createSession({ kind: 'shell_link', participants: ['link-3'] });
    expect(created).not.toBeNull();
    // 内存态照常可见。
    expect(sessionsOf(service).some((item) => item.id === created!.id)).toBe(true);
    // 库里没有多出这条（不落库 ≠ 假装落了）。
    expect(countRows('sessions')).toBe(before);
  });

  // --------------------------------------------------------------------------
  // ② 双侧可见 + ③ LITE 接线
  // --------------------------------------------------------------------------

  it('接线：任务收尾记 task_run（全量事件）/ mission_run（LITE 两事件）两条会话，双侧可见', async () => {
    const service = boot({
      storage,
      taskExecution: {
        createTransport: () => ({
          spawn: (prompt: string): AsyncIterable<TransportEvent> => {
            const run = (async function* (): AsyncGenerator<TransportEvent> {
              yield { type: 'message', text: `echo:${prompt}` };
              yield { type: 'done', exitCode: 0, text: `echo:${prompt}`, sessionId: null };
            })();
            return { [Symbol.asyncIterator]: () => run };
          },
        }),
      },
    });

    const created = service.character.createCharacter({
      name: '阿尔法',
      agentKind: 'claude-code',
      skinId: 'skin-default',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(`建档失败：${created.code}`);
    const characterId = created.character.id;
    service.store.setDetectedAgents([
      { kind: 'claude-code', tier: 'T1', installed: true, status: 'installed', version: null, path: null },
    ]);

    const task = service.task.assignTask({
      characterId,
      prompt: '跑一单',
      missionId: 'mission-1',
    });
    expect(task).not.toBeNull();
    await waitFor(
      () => (service.store.getState().tasks ?? []).some((item) => item.id === task!.id && item.status === 'completed'),
      '任务跑完'
    );

    // 内存态：task_run 与 mission_run 各一条，且都已收尾。
    // task_run 自 task_105 起是**全量事件化**（执行路径埋点）；mission_run 仍是 LITE 两事件。
    const taskRun = sessionsOf(service).filter((item) => item.kind === 'task_run');
    const missionRun = sessionsOf(service).filter((item) => item.kind === 'mission_run');
    expect(taskRun).toHaveLength(1);
    expect(missionRun).toHaveLength(1);
    expect(taskRun[0]?.status).toBe('closed');
    expect(missionRun[0]?.status).toBe('closed');
    expect(taskRun[0]?.eventCount).toBe(6);
    expect(missionRun[0]?.eventCount).toBe(2);
    expect(taskRun[0]?.refId).toBe(task!.id);
    expect(missionRun[0]?.refId).toBe('mission-1');

    // SQLite 侧：同样的两条会话、同样的事件序列（双侧可见）。
    const dbTaskRun = storage.readSessions({ kind: 'task_run' });
    const dbMissionRun = storage.readSessions({ kind: 'mission_run' });
    expect(dbTaskRun.map((item) => item.id)).toContain(taskRun[0]!.id);
    expect(dbMissionRun.map((item) => item.id)).toContain(missionRun[0]!.id);
    expect(dbTaskRun.find((item) => item.id === taskRun[0]!.id)?.status).toBe('closed');
    expect(storage.readSessionEvents(taskRun[0]!.id, {}).map((event) => event.type)).toEqual([
      'created',
      'task_started',
      'step',
      'output_tail',
      'completed',
      'closed',
    ]);
    expect(storage.readSessionEvents(missionRun[0]!.id, {}).map((event) => event.type)).toEqual([
      'created',
      'closed',
    ]);
  });

  // --------------------------------------------------------------------------
  // ④ world-sync 快照
  // --------------------------------------------------------------------------

  it('world-sync 快照含 sessions 键（会话随快照走，协议无需改动）', () => {
    const service = boot({ storage });
    const created = service.session.createSession({
      kind: 'shell_link',
      participants: ['link-4'],
      title: '快照会话',
    });

    const snapshot = createSnapshotMessage(1, service.store.getState());
    expect(Array.isArray(snapshot.state.sessions)).toBe(true);
    expect((snapshot.state.sessions ?? []).some((item) => item.id === created!.id)).toBe(true);
  });
});
