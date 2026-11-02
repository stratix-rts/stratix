/**
 * 集成测试:互聊**续跑恢复**(@since v3.47,task_101 / v3.2b-B2)。
 *
 * 覆盖四条面:
 *   1. 回灌:被中断的会话恢复后,上文(话题 + 双方发言)进 prompt —— 模型接得上,不是重头再来;
 *   2. 状态:恢复后 status=active(而不是 closed / 还是 interrupted),新发言仍记在**同一条会话**下;
 *   3. 不降级:会话不存在 / kind 不对 / 状态不对 / **角色已不在场** —— 一律如实报错(code + 人话),
 *      绝不"另起一场新讨论"冒充续跑(transport 零调用);
 *   4. 单飞:已有一场讨论在跑时,恢复被拒(不并发跑两场)。
 *
 * 会话域用的是**真 store + 真 manager + 真事件日志**(app/services/session-event-log.ts)——
 * 事件源没接的话 core 会如实拒绝(没有上文可回灌),那种"拒绝"是假绿,测不出东西。
 */

import type { AgentKind, CharacterView, DetectedAgent, WorldState } from '../../core/types';
import { resetBus } from '../../core/bus';
import { createSessionManager } from '../../core/session';
import type { SessionEvent, SessionRecord } from '../../core/session/types';
import { createStore } from '../../core/store';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import {
  buildResumeContextBlock,
  createAgentChatService,
  PEER_MSG_RESUMED,
  PEER_SESSION_SYSTEM_AUTHOR,
  PEER_SESSION_USER_AUTHOR,
  type AgentChatDrawerView,
} from '../services/agent-chat-service';
import { createSessionEventLog } from '../services/session-event-log';
import type { ChatPersistedMessage, ChatTransportFactory } from '../services/chat-service';

// ============================================================================
// 夹具
// ============================================================================

const characterA: CharacterView = {
  id: 'ch-a',
  name: '阿尔法',
  persona: '冷静的战术分析师,回答简短。',
  level: 1,
  experience: 0,
  agentKind: 'claude-code',
  skinId: null,
  externalSessionId: null,
};

const characterB: CharacterView = {
  id: 'ch-b',
  name: '贝塔',
  persona: '热情的工程师,喜欢举例。',
  level: 2,
  experience: 10,
  agentKind: 'kimi',
  skinId: null,
  externalSessionId: null,
};

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

interface ViewHarness {
  readonly view: AgentChatDrawerView;
  readonly messages: Array<{ role: string; text: string }>;
}

function makeView(): ViewHarness {
  const messages: ViewHarness['messages'] = [];
  return {
    view: {
      addMessage(message): void {
        messages.push({ role: message.role, text: message.text });
      },
      appendPeerStream(): void { /* 续跑测试只关心落库与状态,不关心流式细节 */ },
      finalizePeerStream(): void { /* 同上 */ },
      setPeerRound(): void { /* 同上 */ },
      endPeerChat(): void { /* 同上 */ },
    },
    messages,
  };
}

interface SpawnRecord {
  readonly prompt: string;
  readonly sessionId: string | null;
}

type Script = (record: SpawnRecord) => AsyncGenerator<TransportEvent>;

function scripted(...events: TransportEvent[]): Script {
  return async function* script(): AsyncGenerator<TransportEvent> {
    for (const event of events) yield event;
  };
}

function turn(sessionId: string, text: string): Script {
  return scripted(
    { type: 'session', sessionId },
    { type: 'message', text },
    { type: 'done', exitCode: 0, text: null, sessionId }
  );
}

/** 挂起脚本:先吐 events,等外部 release 后补吐尾部(把回合「卡在半路」)。 */
function gated(events: TransportEvent[], tail: TransportEvent[] = []): {
  script: Script;
  release(): void;
} {
  let resolveRelease: () => void = () => { /* 占位,start 后替换 */ };
  const released = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const script: Script = async function* script(): AsyncGenerator<TransportEvent> {
    for (const event of events) yield event;
    await released;
    for (const event of tail) yield event;
  };
  return { script, release: () => resolveRelease() };
}

function makeFactory(scripts: Script[]): {
  factory: ChatTransportFactory;
  calls: SpawnRecord[];
} {
  const calls: SpawnRecord[] = [];
  let index = 0;
  const factory: ChatTransportFactory = (kind: AgentKind) => ({
    spawn: (prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent> => {
      calls.push({ prompt, sessionId: options?.sessionId ?? null });
      const script = scripts[index];
      index += 1;
      const run = script
        ? script(calls[calls.length - 1]!)
        : (async function* guard(): AsyncGenerator<TransportEvent> {
            yield { type: 'error', code: 'spawn_failed', message: `脚本未覆盖第 ${index} 次 spawn(${kind})` };
          })();
      return { [Symbol.asyncIterator]: () => run };
    },
  });
  return { factory, calls };
}

interface HarnessOptions {
  readonly characters?: readonly CharacterView[];
  readonly scripts?: Script[];
  readonly withoutSessions?: boolean;
}

interface ServiceHarness {
  readonly service: ReturnType<typeof createAgentChatService>;
  readonly view: ViewHarness;
  readonly calls: SpawnRecord[];
  readonly messages: ChatPersistedMessage[];
  readonly sessionManager: ReturnType<typeof createSessionManager>;
  readonly sessionRecords: () => SessionRecord[];
  readonly sessionEvents: () => SessionEvent[];
}

function makeHarness(options: HarnessOptions = {}): ServiceHarness {
  const view = makeView();
  const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
    characters: [...(options.characters ?? [characterA, characterB])],
    detectedAgents: [detectedClaude, detectedKimi],
    units: [],
  };
  const { factory, calls } = makeFactory(options.scripts ?? []);
  const messages: ChatPersistedMessage[] = [];
  // 会话域:真 store + 真 manager + 真事件日志(写口与读口同一份内存 —— 回灌要读得到)。
  const store = createStore();
  const log = createSessionEventLog();
  const sessionEvents: SessionEvent[] = [];
  const sessionManager = createSessionManager({
    store,
    persist: {
      persistSession: () => undefined,
      persistEvent: (event) => {
        sessionEvents.push(event);
        log.persist.persistEvent(event);
      },
    },
    read: log.read,
  });
  const service = createAgentChatService({
    view: view.view,
    getState: () => state,
    createTransport: factory,
    persistSessionId: () => undefined,
    persistMessage: (message) => {
      messages.push(message);
    },
    ...(options.withoutSessions ? {} : { sessions: sessionManager }),
  });
  return {
    service,
    view,
    calls,
    messages,
    sessionManager,
    sessionRecords: (): SessionRecord[] => store.getState().sessions ?? [],
    sessionEvents: (): SessionEvent[] => [...sessionEvents],
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 24; i += 1) await Promise.resolve();
};

/** message 事件(载荷收窄用;TS 5.3 没有 filter 的类型谓词推断,手写谓词)。 */
type MessageEvent = Extract<SessionEvent, { type: 'message' }>;

beforeEach(() => {
  resetBus();
});

afterEach(() => {
  resetBus();
});

// ============================================================================
// 纯函数:回灌上下文块
// ============================================================================

describe('回灌上下文块(纯函数)', () => {
  test('按署名逐行渲染;系统署名(恢复标记)不进上下文', () => {
    const block = buildResumeContextBlock([
      { seq: 1, role: 'user', author: PEER_SESSION_USER_AUTHOR, content: '先侦察还是先扩张', at: 1, kind: 'message' },
      { seq: 2, role: 'assistant', author: '阿尔法', content: 'A1', at: 2, kind: 'message' },
      { seq: 3, role: 'system', author: PEER_SESSION_SYSTEM_AUTHOR, content: PEER_MSG_RESUMED, at: 3, kind: 'message' },
    ]);
    expect(block).toContain('先侦察还是先扩张');
    expect(block).toContain('阿尔法：A1');
    expect(block).not.toContain(PEER_SESSION_SYSTEM_AUTHOR);
    expect(block).not.toContain(PEER_MSG_RESUMED);
  });

  test('空上文 → 空串(不塞一句编出来的话)', () => {
    expect(buildResumeContextBlock([])).toBe('');
  });

  test('条数超限:只留最近若干条,并如实说明丢了多少', () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      seq: index + 1,
      role: 'user' as const,
      author: '用户',
      content: `第${index + 1}条`,
      at: index + 1,
      kind: 'message' as const,
    }));
    const block = buildResumeContextBlock(messages, 3);
    expect(block).toContain('第10条');
    expect(block).not.toContain('第1条');
    expect(block).toContain('更早的 7 条上文未注入');
  });
});

// ============================================================================
// 合法恢复
// ============================================================================

describe('合法恢复:回灌上文 + 状态转 active + 同会话续记新消息', () => {
  test('被中断的互聊会话 → resume:上文进 prompt、状态 active、新发言记在同一条会话', async () => {
    // 第一场:正常聊一轮,B 的回合超时 → 会话 interrupted(修「超时即丢」)。
    const harness = makeHarness({
      scripts: [
        turn('sa', 'A1:先侦察。'),
        scripted({ type: 'error', code: 'timeout', message: '调用超时:120000ms 无输出' }),
      ],
    });
    await harness.service.start('ch-a', 'ch-b', '先侦察还是先扩张', 3);
    await flush();

    const record = harness.sessionRecords()[0];
    expect(record?.status).toBe('interrupted');
    const sessionId = record!.id;

    // 第二场:续跑(3 轮 = 6 个回合,脚本按序消耗)。
    //   每次 spawn 时采样会话状态 —— 恢复后应当是 active。
    const observedStatus: string[] = [];
    const resumeScripts: Script[] = Array.from({ length: 6 }, (_, index) => {
      return async function* script(): AsyncGenerator<TransportEvent> {
        observedStatus.push(harness.sessionRecords()[0]?.status ?? '-');
        yield { type: 'session', sessionId: `sx-${index}` };
        yield { type: 'message', text: `续${index + 1}` };
        yield { type: 'done', exitCode: 0, text: null, sessionId: `sx-${index}` };
      };
    });
    const resumed = makeFactory(resumeScripts);
    const service = createAgentChatService({
      view: harness.view.view,
      getState: () => ({
        characters: [characterA, characterB],
        detectedAgents: [detectedClaude, detectedKimi],
        units: [],
      }),
      createTransport: resumed.factory,
      persistSessionId: () => undefined,
      sessions: harness.sessionManager,
    });

    const outcome = await service.resume(sessionId);
    await flush();

    expect(outcome.ok).toBe(true);
    expect(outcome.sessionId).toBe(sessionId);
    expect(outcome.replayedMessages).toBeGreaterThan(0);
    // 恢复后状态是 active(而不是仍 interrupted / 直接 closed)。
    expect(observedStatus).toHaveLength(6);
    expect(new Set(observedStatus)).toEqual(new Set(['active']));

    // 上文真的进了 prompt(模型接得上,不是重头再来)。
    const firstPrompt = resumed.calls[0]?.prompt ?? '';
    expect(firstPrompt).toContain('本次续聊的上文');
    expect(firstPrompt).toContain('先侦察还是先扩张');
    expect(firstPrompt).toContain('A1:先侦察。');
    // 上一位是 A → 轮到 B 先说(不自问自答)。
    expect(firstPrompt).toContain('阿尔法 说：');

    // 「（续聊恢复）」留痕:事件流里有一条系统署名的事件。
    const resumedMarker = harness
      .sessionEvents()
      .filter((event): event is MessageEvent => event.type === 'message')
      .find((event) => event.payload.author === PEER_SESSION_SYSTEM_AUTHOR);
    expect(resumedMarker?.payload.text).toBe(PEER_MSG_RESUMED);

    // 新发言仍记在**同一条会话**下(不是另起一条)。
    const newMessages = harness
      .sessionEvents()
      .filter((event): event is MessageEvent => event.type === 'message')
      .filter((event) => event.payload.author !== PEER_SESSION_SYSTEM_AUTHOR);
    expect(newMessages.length).toBeGreaterThan(3); // 原有 2 条(议题 + A1)+ 续跑的 6 条
    const record2 = harness.sessionRecords()[0];
    expect(record2?.id).toBe(sessionId);
  });
});

// ============================================================================
// 不降级:准入不满足一律如实报错
// ============================================================================

describe('不降级:准入不满足一律如实报错(绝不另起一场)', () => {
  test('会话不存在 → not-found', async () => {
    const harness = makeHarness({ scripts: [] });
    const outcome = await harness.service.resume('session_不存在');
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('not-found');
    expect(harness.calls).toHaveLength(0);
  });

  test('kind 不对(character_chat)→ unsupported-kind', async () => {
    const harness = makeHarness({ scripts: [] });
    const created = harness.sessionManager.createSession({
      kind: 'character_chat',
      participants: ['ch-a'],
    });
    harness.sessionManager.interruptSession(created!.id, '测试');
    const outcome = await harness.service.resume(created!.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('unsupported-kind');
    // 不降级:没有起讨论、没有 transport 调用、状态原样(仍 interrupted)。
    expect(harness.calls).toHaveLength(0);
    expect(harness.sessionRecords()[0]?.status).toBe('interrupted');
  });

  test('状态不对(active)→ illegal-transition', async () => {
    const harness = makeHarness({ scripts: [] });
    const created = harness.sessionManager.createSession({
      kind: 'peer_chat',
      participants: ['ch-a', 'ch-b'],
    });
    const outcome = await harness.service.resume(created!.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('illegal-transition');
    expect(harness.calls).toHaveLength(0);
  });

  test('角色已不在场 → character-missing(如实报错,不换成一场新讨论)', async () => {
    const harness = makeHarness({ scripts: [] });
    const created = harness.sessionManager.createSession({
      kind: 'peer_chat',
      participants: ['ch-a', 'ch-b'],
    });
    harness.sessionManager.appendEvent(created!.id, {
      type: 'message',
      payload: { author: '阿尔法', text: 'A1' },
    });
    harness.sessionManager.interruptSession(created!.id, '测试');

    // 角色被删了(世界状态里只剩 A)—— 续跑的前提不成立。
    const service = createAgentChatService({
      view: harness.view.view,
      getState: () => ({
        characters: [characterA], // 贝塔不在了
        detectedAgents: [detectedClaude, detectedKimi],
        units: [],
      }),
      createTransport: makeFactory([]).factory,
      persistSessionId: () => undefined,
      sessions: harness.sessionManager,
    });
    const outcome = await service.resume(created!.id);

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('character-missing');
    expect(outcome.reason).toContain('ch-b');
    // 不降级:没有 transport 调用,状态没有被翻成 active。
    expect(harness.calls).toHaveLength(0);
    expect(harness.sessionRecords()[0]?.status).toBe('interrupted');
  });

  test('已有一场讨论在跑 → busy(单飞)', async () => {
    const hanging = gated(
      [{ type: 'session', sessionId: 'sx' }],
      [{ type: 'done', exitCode: 0, text: null, sessionId: 'sx' }]
    );
    const harness = makeHarness({
      scripts: [
        turn('sa', 'A1'),
        scripted({ type: 'error', code: 'timeout', message: '超时' }),
        hanging.script,
      ],
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 3);
    await flush();
    const sessionId = harness.sessionRecords()[0]!.id;

    // 起一场挂着的讨论(回合一直在飞,单飞锁被占着)。
    const running = harness.service.start('ch-a', 'ch-b', '另一场', 1);
    await flush();
    const outcome = await harness.service.resume(sessionId);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('busy');
    // 收尾:把那场挂着的讨论放行并停掉(不测它的内容)。
    hanging.release();
    harness.service.stop();
    await running;
    await flush();
  });

  test('未注入会话写入面 → no-session-port(端口缺席就说端口缺席)', async () => {
    const harness = makeHarness({ scripts: [], withoutSessions: true });
    const outcome = await harness.service.resume('session_x');
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('no-session-port');
  });
});
