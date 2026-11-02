/**
 * 集成测试：**@会话引用的两个入口接线**（task_107 / v3.2b-B8）。
 *
 * 覆盖验收口径「两入口（互聊 + 任务）均接线」：
 *   1. **互聊入口**（议题输入）：引用存在 → 注入块进**首轮**指令（双方各一次）；
 *      本场会话留痕一条 type=reference 事件（payload = 被引用的会话 id）；
 *   2. **互聊入口**：引用不存在 → **如实报错**（气泡说清哪一场不存在）+ 不进 transport
 *      + 不建会话（绝不"假装引用上了"）；
 *   3. **任务入口**（任务指令）：引用存在 → 注入块进任务 prompt（上下文头部）；
 *      task_run 会话留痕一条 type=reference 事件；
 *   4. **任务入口**：引用不存在 → 任务 failed（原因如实写进失败理由）+ 不进 transport。
 *
 * 用真 store + 真 SessionManager（事件信封截下来，不碰 SQLite）；transport 全打桩。
 */

import { resetBus } from '../../core/bus';
import { createTaskManager } from '../../core/task';
import { createSessionManager, type SessionEvent, type SessionRecord } from '../../core/session';
import { createStore } from '../../core/store';
import type { AgentKind, CharacterView, DetectedAgent, WorldState } from '../../core/types';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import {
  createAgentChatService,
  type AgentChatDrawerView,
} from '../services/agent-chat-service';
import { createSessionReferenceService } from '../services/session-reference';
import { createTaskService } from '../services/task-service';

// ============================================================================
// 夹具
// ============================================================================

const characterA: CharacterView = {
  id: 'ch-a',
  name: '阿尔法',
  persona: '冷静的战术分析师。',
  level: 1,
  experience: 0,
  agentKind: 'claude-code',
  skinId: null,
  externalSessionId: null,
};

const characterB: CharacterView = { ...characterA, id: 'ch-b', name: '贝塔', agentKind: 'kimi' };

const detectedClaude: DetectedAgent = {
  kind: 'claude-code',
  tier: 'T1',
  installed: true,
  status: 'installed',
  version: '2.1.0',
  path: '/usr/local/bin/claude',
};

const detectedKimi: DetectedAgent = {
  kind: 'kimi',
  tier: 'T2',
  installed: true,
  status: 'installed',
  version: '1.0.0',
  path: '/usr/local/bin/kimi',
};

interface SpawnRecord {
  readonly prompt: string;
}

/** 打桩 transport：每次 spawn 记一笔 prompt，吐一条固定回复。 */
function makeFactory(replies: readonly string[]): {
  factory: (kind: AgentKind) => {
    spawn: (prompt: string, options?: SpawnOptions) => AsyncIterable<TransportEvent>;
  };
  calls: SpawnRecord[];
} {
  const calls: SpawnRecord[] = [];
  let index = 0;
  const factory = (): {
    spawn: (prompt: string, options?: SpawnOptions) => AsyncIterable<TransportEvent>;
  } => ({
    spawn: (prompt: string): AsyncIterable<TransportEvent> => {
      calls.push({ prompt });
      const text = replies[Math.min(index, replies.length - 1)] ?? '好的';
      index += 1;
      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<TransportEvent> {
          yield { type: 'message', text };
          yield { type: 'done', exitCode: 0, text, sessionId: 'x' };
        },
      };
    },
  });
  return { factory, calls };
}

/** 会话域 + 事件日志 + 引用解析器（真 manager，事件截在内存里）。 */
function makeSessionDomain(): {
  readonly store: ReturnType<typeof createStore>;
  readonly manager: ReturnType<typeof createSessionManager>;
  readonly events: SessionEvent[];
  readonly references: ReturnType<typeof createSessionReferenceService>;
} {
  const store = createStore();
  const events: SessionEvent[] = [];
  const manager = createSessionManager({
    store,
    persist: {
      persistSession: () => undefined,
      persistEvent: (event) => {
        events.push(event);
      },
    },
  });
  const references = createSessionReferenceService({
    readSession: (sessionId) => store.getState().sessions?.find((item) => item.id === sessionId) ?? null,
    readSessionEvents: (sessionId, options) => {
      const limit = Math.min(Math.max(options.limit, 1), 200);
      const before = options.beforeSeq ?? Number.POSITIVE_INFINITY;
      return events
        .filter((event) => event.sessionId === sessionId && event.seq < before)
        .slice(-limit);
    },
  });
  return { store, manager, events, references };
}

/** 造一场"已被引用"的旧会话（带一条发言，引用时才有内容可注入）。 */
function seedSession(manager: ReturnType<typeof createSessionManager>): SessionRecord {
  const session = manager.createSession({
    kind: 'peer_chat',
    participants: ['ch-a', 'ch-b'],
    firstMessage: '先侦察还是先扩张',
  });
  const record = session!;
  manager.appendEvent(record.id, {
    type: 'message',
    payload: { author: '阿尔法', text: '我主张先侦察。' },
  });
  return record;
}

/** 互聊视图口（只记气泡与收束）。 */
function makeView(): { view: AgentChatDrawerView; messages: Array<{ role: string; text: string }>; ended: number[] } {
  const messages: Array<{ role: string; text: string }> = [];
  const ended: number[] = [];
  return {
    view: {
      addMessage(message): void {
        messages.push({ role: message.role, text: message.text });
      },
      appendPeerStream(): void {
        /* 桩：不关心流式 */
      },
      finalizePeerStream(): void {
        /* 桩：不关心收束 */
      },
      setPeerRound(): void {
        /* 桩：不关心轮次 */
      },
      endPeerChat(): void {
        ended.push(1);
      },
    },
    messages,
    ended,
  };
}

const flush = async (times = 24): Promise<void> => {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
};

beforeEach(() => {
  resetBus();
});

afterEach(() => {
  resetBus();
});

// ============================================================================
// 入口①：互聊
// ============================================================================

describe('互聊入口：@会话引用', () => {
  test('引用存在 → 注入块进首轮指令 + 本场会话留痕 reference 事件', async () => {
    const domain = makeSessionDomain();
    const target = seedSession(domain.manager);
    const { factory, calls } = makeFactory(['A1', 'B1']);
    const view = makeView();
    const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
      characters: [characterA, characterB],
      detectedAgents: [detectedClaude, detectedKimi],
      units: [],
    };
    const service = createAgentChatService({
      view: view.view,
      getState: () => state,
      createTransport: factory,
      persistSessionId: () => undefined,
      sessions: domain.manager,
      references: domain.references,
    });

    await service.start('ch-a', 'ch-b', `接着 @session_${target.id} 聊的那条线继续`, 1);
    await flush();

    // 注入块进了**首轮**指令（双方各一次 —— 各自 CLI 会话的第一次发言）。
    expect(calls).toHaveLength(2);
    expect(calls[0].prompt).toContain(`【引用会话 ${target.title}(${target.id})】`);
    expect(calls[0].prompt).toContain('阿尔法：我主张先侦察。');
    expect(calls[1].prompt).toContain('【引用会话');
    // 注入块在**头部**（指令之前）。
    expect(calls[0].prompt.indexOf('【引用会话')).toBeLessThan(calls[0].prompt.indexOf('讨论'));

    // 留痕：本场 peer_chat 会话里有一条 reference 事件（payload = 被引用的会话 id）。
    const peerSession = domain.store.getState().sessions!.find((item) => item.kind === 'peer_chat' && item.id !== target.id);
    expect(peerSession).toBeDefined();
    const references = domain.events.filter(
      (event) => event.sessionId === peerSession!.id && event.type === 'reference'
    );
    expect(references).toHaveLength(1);
    expect((references[0].payload as { targetSessionId: string }).targetSessionId).toBe(target.id);
  });

  test('引用不存在 → 如实报错、不进 transport、不建会话', async () => {
    const domain = makeSessionDomain();
    const { factory, calls } = makeFactory(['A1']);
    const view = makeView();
    const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
      characters: [characterA, characterB],
      detectedAgents: [detectedClaude, detectedKimi],
      units: [],
    };
    const service = createAgentChatService({
      view: view.view,
      getState: () => state,
      createTransport: factory,
      persistSessionId: () => undefined,
      sessions: domain.manager,
      references: domain.references,
    });

    await service.start('ch-a', 'ch-b', '接着 @session_session_not_exist 聊的那条线继续', 1);
    await flush();

    expect(calls).toHaveLength(0); // 不进 transport（没有上下文还开聊 = 答非所问）
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0].text).toContain('session_not_exist');
    expect(view.messages[0].text).toContain('不存在');
    expect(view.ended).toHaveLength(1);
    // 没有建会话（没开场就没有会话）。
    expect(domain.store.getState().sessions ?? []).toHaveLength(0);
    expect(domain.events).toHaveLength(0);
  });

  test('没有引用 → 老路径不受影响（不进注入块，也没有 reference 事件）', async () => {
    const domain = makeSessionDomain();
    const { factory, calls } = makeFactory(['A1', 'B1']);
    const view = makeView();
    const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
      characters: [characterA, characterB],
      detectedAgents: [detectedClaude, detectedKimi],
      units: [],
    };
    const service = createAgentChatService({
      view: view.view,
      getState: () => state,
      createTransport: factory,
      persistSessionId: () => undefined,
      sessions: domain.manager,
      references: domain.references,
    });

    await service.start('ch-a', 'ch-b', '普通议题', 1);
    await flush();

    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.prompt).not.toContain('【引用会话');
    expect(domain.events.filter((event) => event.type === 'reference')).toHaveLength(0);
  });
});

// ============================================================================
// 入口②：任务
// ============================================================================

describe('任务入口：@会话引用', () => {
  test('引用存在 → 注入块进任务 prompt + task_run 会话留痕 reference 事件', async () => {
    const domain = makeSessionDomain();
    const target = seedSession(domain.manager);
    const store = domain.store;
    store.setState((current) => ({
      ...current,
      characters: [characterA],
      detectedAgents: [detectedClaude],
      units: [],
    }));
    const { factory, calls } = makeFactory(['任务产出']);
    const taskManager = createTaskManager({
      store,
      now: () => 1234,
      createId: (prefix) => `${prefix}_${Math.floor(Math.random() * 1e6)}`,
    });
    const service = createTaskService({
      getState: () => store.getState(),
      createTransport: factory,
      taskManager,
      sessions: domain.manager,
      references: domain.references,
    });
    const stop = service.start();

    taskManager.assignTask({ characterId: 'ch-a', prompt: `接着 @session_${target.id} 的结论继续做` });
    await flush();

    // 注入块在任务 prompt 的**上下文头部**（角色设定之后、任务指令之前）。
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain(`【引用会话 ${target.title}(${target.id})】`);
    expect(calls[0].prompt).toContain('阿尔法：我主张先侦察。');
    expect(calls[0].prompt.indexOf('【引用会话')).toBeLessThan(calls[0].prompt.indexOf('【任务指令】'));
    expect(calls[0].prompt.indexOf('【引用会话')).toBeGreaterThan(calls[0].prompt.indexOf('【角色设定】'));

    // 留痕：task_run 会话里有一条 reference 事件。
    const taskSession = store.getState().sessions!.find((item) => item.kind === 'task_run');
    expect(taskSession).toBeDefined();
    const references = domain.events.filter(
      (event) => event.sessionId === taskSession!.id && event.type === 'reference'
    );
    expect(references).toHaveLength(1);
    expect((references[0].payload as { targetSessionId: string }).targetSessionId).toBe(target.id);
    stop();
  });

  test('引用不存在 → 任务 failed（原因如实写明）+ 不进 transport', async () => {
    const domain = makeSessionDomain();
    const store = domain.store;
    store.setState((current) => ({
      ...current,
      characters: [characterA],
      detectedAgents: [detectedClaude],
      units: [],
    }));
    const { factory, calls } = makeFactory(['任务产出']);
    const taskManager = createTaskManager({
      store,
      now: () => 1234,
      createId: (prefix) => `${prefix}_${Math.floor(Math.random() * 1e6)}`,
    });
    const service = createTaskService({
      getState: () => store.getState(),
      createTransport: factory,
      taskManager,
      sessions: domain.manager,
      references: domain.references,
    });
    const stop = service.start();

    taskManager.assignTask({ characterId: 'ch-a', prompt: '接着 @session_session_not_exist 的结论继续做' });
    await flush();

    expect(calls).toHaveLength(0); // 拿不到上下文还照跑 = 答非所问
    const task = store.getState().tasks![0];
    expect(task.status).toBe('failed');
    expect(task.output).toContain('session_not_exist');
    expect(task.output).toContain('不存在');
    stop();
  });
});
