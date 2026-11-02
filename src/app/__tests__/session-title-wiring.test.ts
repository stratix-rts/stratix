/**
 * 集成测试：**自动起名的接线**（@since v3.47，task_104 / v3.2b-B5）——
 *   peer_chat 开场后起名、task_run 建会话后起名。
 *
 * 覆盖验收口径：
 *   1. **peer_chat**：首个用户消息（议题）之后起名，标题写回会话摘要并投影到 WorldState；
 *   2. **task_run**：建会话时起名（素材 = 任务指令），标题写回；
 *   3. **不阻塞主流程**：起名 promise 未决时，互聊/任务该走的路已经走完（起名是旁路）。
 *
 * transport 与视图全打桩（起名这件事与互聊内容无关）。
 */

import { resetBus } from '../../core/bus';
import { createSessionManager, type SessionManager, type TitleProvider } from '../../core/session';
import { createStore, type CoreStore } from '../../core/store';
import type { CharacterView, DetectedAgent, WorldState } from '../../core/types';
import { createAgentChatService, type AgentChatDrawerView } from '../services/agent-chat-service';
import type { ChatTransportFactory } from '../services/chat-service';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import { createSessionTitleService } from '../services/session-title';
import { createTaskSessionRecorder } from '../services/task-session-recorder';

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

const characterB: CharacterView = {
  id: 'ch-b',
  name: '贝塔',
  persona: '热情的工程师。',
  level: 2,
  experience: 10,
  agentKind: 'claude-code',
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

/** 视图口打桩：只记"发生过"，不关心渲染。 */
function makeView(): AgentChatDrawerView {
  return {
    addMessage: () => undefined,
    appendPeerStream: () => undefined,
    finalizePeerStream: () => undefined,
    setPeerRound: () => undefined,
    endPeerChat: () => undefined,
  };
}

/** transport 打桩：一回合吐 session + 文本 + done。 */
const transportFactory: ChatTransportFactory = () => ({
  spawn: (_prompt: string, _options?: SpawnOptions): AsyncIterable<TransportEvent> => {
    const run = async function* (): AsyncGenerator<TransportEvent> {
      yield { type: 'session', sessionId: 's1' };
      yield { type: 'message', text: '收到。' };
      yield { type: 'done', exitCode: 0, text: null, sessionId: 's1' };
    };
    return { [Symbol.asyncIterator]: () => run() };
  },
});

interface Harness {
  readonly store: CoreStore;
  readonly sessions: SessionManager;
}

function harness(): Harness {
  const store = createStore();
  let ids = 0;
  const sessions = createSessionManager({
    store,
    now: () => Date.now(),
    createId: (prefix: string) => `${prefix}_${++ids}`,
  });
  return { store, sessions };
}

/** 受控的起名实现：起名未决，直到外部放行。 */
function slowProvider(title: string): {
  provider: TitleProvider;
  release: () => void;
  pending: () => boolean;
} {
  let release: (t: string) => void = () => undefined;
  let settled = false;
  const provider: TitleProvider = {
    id: 'slow',
    generate: () =>
      new Promise<string>((resolve) => {
        release = (value: string) => {
          settled = true;
          resolve(value);
        };
      }),
  };
  return { provider, release: () => release(title), pending: () => !settled };
}

beforeEach(() => {
  resetBus();
});

afterEach(() => {
  resetBus();
});

// ============================================================================
// peer_chat
// ============================================================================

describe('peer_chat：开场后异步起名', () => {
  test('起名写回会话摘要（投影进 WorldState.sessions）', async () => {
    const { store, sessions } = harness();
    const service = createAgentChatService({
      view: makeView(),
      getState: () =>
        ({
          characters: [characterA, characterB],
          detectedAgents: [detectedClaude],
          units: [],
        }) as Pick<WorldState, 'characters' | 'detectedAgents' | 'units'>,
      createTransport: transportFactory,
      persistSessionId: () => undefined,
      sessions,
      titles: createSessionTitleService({
        sessions,
        provider: { id: 'fixed', generate: () => '北门加固方案讨论' },
      }),
    });

    await service.start('ch-a', 'ch-b', '先聊北门的加固方案', 1);

    const record = (store.getState().sessions ?? [])[0];
    expect(record?.kind).toBe('peer_chat');
    expect(record?.title).toBe('北门加固方案讨论');
  });

  test('起名未决时互聊已经跑完（起名不阻塞主流程）', async () => {
    const { store, sessions } = harness();
    const slow = slowProvider('慢慢起出来的标题');
    const service = createAgentChatService({
      view: makeView(),
      getState: () =>
        ({
          characters: [characterA, characterB],
          detectedAgents: [detectedClaude],
          units: [],
        }) as Pick<WorldState, 'characters' | 'detectedAgents' | 'units'>,
      createTransport: transportFactory,
      persistSessionId: () => undefined,
      sessions,
      titles: createSessionTitleService({ sessions, provider: slow.provider }),
    });

    await service.start('ch-a', 'ch-b', '议题', 1);

    // 互聊已收场，但标题还没起出来（起名未决 → 标题仍是规则版那条）
    expect(slow.pending()).toBe(true);
    const before = (store.getState().sessions ?? [])[0]?.title;
    expect(before).toContain('议题');

    slow.release();
    // 放行后让微任务跑完（起名 → 写回）
    for (let i = 0; i < 24; i += 1) await Promise.resolve();
    expect((store.getState().sessions ?? [])[0]?.title).toBe('慢慢起出来的标题');
  });
});

// ============================================================================
// task_run
// ============================================================================

describe('task_run：建会话后异步起名', () => {
  test('起名写回会话摘要（素材 = 任务指令）', async () => {
    const { store, sessions } = harness();
    const recorder = createTaskSessionRecorder({
      sessions,
      titles: createSessionTitleService({
        sessions,
        provider: { id: 'fixed', generate: () => '东门放哨记录' },
      }),
    });

    recorder.begin({
      taskId: 'task_1',
      characterId: 'ch-a',
      prompt: '去东门放哨并记录可疑动静',
    });
    // 起名是异步的（写回发生在微任务里）—— 让它跑完
    for (let i = 0; i < 24; i += 1) await Promise.resolve();

    const record = (store.getState().sessions ?? [])[0];
    expect(record?.kind).toBe('task_run');
    expect(record?.title).toBe('东门放哨记录');
  });

  test('起名未决时任务已经开工（起名不阻塞主流程）', async () => {
    const { store, sessions } = harness();
    const slow = slowProvider('任务起名');
    const recorder = createTaskSessionRecorder({
      sessions,
      titles: createSessionTitleService({ sessions, provider: slow.provider }),
    });

    recorder.begin({ taskId: 'task_1', characterId: 'ch-a', prompt: '去东门放哨' });

    // 任务会话已建（开工事件已落），标题还在起名中 → 仍是规则版那条
    expect((store.getState().sessions ?? [])[0]?.eventCount).toBeGreaterThan(1);
    expect((store.getState().sessions ?? [])[0]?.title).toContain('东门放哨');

    slow.release();
    for (let i = 0; i < 24; i += 1) await Promise.resolve();
    expect((store.getState().sessions ?? [])[0]?.title).toBe('任务起名');
  });
});
