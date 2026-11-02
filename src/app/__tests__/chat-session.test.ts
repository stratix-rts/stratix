/**
 * 单测：**character_chat 会话的 LITE 接线**（@since v3.43，task_093 / v3.2a S3）——
 *   对话**首**建会话、对话**尾**追加一条空的 'round' 事件（只推进计数 / lastEventAt）。
 *
 * why LITE（不搬消息本体）：消息真相在 chat_messages 表（既有落库口）；
 *   把消息再抄一份进 session_events 就是两份真相 —— 方案 docs/SESSION-PLAN.md §2
 *   接线表 character_chat 行的口径：会话只回答「这段对话发生过没有、什么时候发生的」。
 *
 * 隔离：会话写入面用真 store（createStore()）；transport 打桩（脚本化事件序列）。
 */

import { resetBus } from '../../core/bus';
import { createSessionManager, type SessionManager } from '../../core/session';
import { createStore, type CoreStore } from '../../core/store';
import type { SessionEvent, SessionRecord } from '../../core/session/types';
import type { CharacterView, DetectedAgent, WorldState } from '../../core/types';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import { createChatService, type ChatDrawerView, type ChatTransportFactory } from '../services/chat-service';

const character: CharacterView = {
  id: 'ch-1',
  name: '阿尔法',
  persona: '冷静的战术分析师。',
  level: 1,
  experience: 0,
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

/** 视图口打桩：只记调用，不渲染。 */
function makeView(): ChatDrawerView {
  return {
    addMessage(): void {
      /* noop */
    },
    appendStream(): void {
      /* noop */
    },
    finalizeStream(): void {
      /* noop */
    },
    setSending(): void {
      /* noop */
    },
  };
}

/** transport 打桩：吐固定事件序列后收尾。 */
function makeFactory(events: TransportEvent[]): ChatTransportFactory {
  return () => ({
    spawn: (_prompt: string, _options?: SpawnOptions): AsyncIterable<TransportEvent> => {
      const run = (async function* (): AsyncGenerator<TransportEvent> {
        for (const event of events) yield event;
      })();
      return { [Symbol.asyncIterator]: () => run };
    },
  });
}

interface Harness {
  readonly service: ReturnType<typeof createChatService>;
  readonly store: CoreStore;
  readonly session: SessionManager;
  sessions(): SessionRecord[];
}

function harness(options: { readonly events?: TransportEvent[]; readonly captured?: SessionEvent[] } = {}): Harness {
  const store = createStore();
  // 持久化口：把事件信封截下来（只验内容边界，不落库 —— 单测不碰 SQLite）。
  const session = createSessionManager({
    store,
    persist: {
      persistSession: () => undefined,
      persistEvent: (event) => {
        options.captured?.push(event);
      },
    },
  });
  const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
    characters: [character],
    detectedAgents: [detectedClaude],
    units: [],
  };
  const service = createChatService({
    view: makeView(),
    getState: () => state,
    createTransport: makeFactory(
      options.events ?? [
        { type: 'message', text: '收到' },
        { type: 'done', exitCode: 0, text: '收到', sessionId: null },
      ]
    ),
    persistSessionId: () => undefined,
    sessions: session,
  });
  return { service, store, session, sessions: (): SessionRecord[] => store.getState().sessions ?? [] };
}

beforeEach(() => {
  resetBus();
});

afterEach(() => {
  resetBus();
});

describe('character_chat 会话（LITE：首建 + 尾记空 round）', () => {
  test('首轮建会话（kind=character_chat），本轮末追加一条 round 事件', async () => {
    const { service, sessions } = harness();

    await service.send('ch-1', '你好');

    const list = sessions();
    expect(list).toHaveLength(1);
    expect(list[0]?.kind).toBe('character_chat');
    expect(list[0]?.participants).toEqual(['ch-1']);
    expect(list[0]?.status).toBe('active');
    expect(list[0]?.eventCount).toBe(2); // created + round
  });

  test('后续轮次复用同一条会话（不重复建），每轮各记一条 round', async () => {
    const { service, sessions } = harness();

    await service.send('ch-1', '第一句');
    const firstId = sessions()[0]?.id;
    await service.send('ch-1', '第二句');

    const list = sessions();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(firstId);
    expect(list[0]?.eventCount).toBe(3); // created + round + round
  });

  test('会话事件里没有消息本体（消息真相仍在 chat_messages 表）', async () => {
    const events: SessionEvent[] = [];
    const { service, sessions } = harness({ captured: events });

    await service.send('ch-1', '这句不该抄进会话事件流');

    // 事件流里只有 created 与 round，且 round 的载荷是空的 —— 没有 message 事件，也没有正文。
    expect(events.map((event) => event.type)).toEqual(['created', 'round']);
    const round = events[1];
    expect(round?.payload).toEqual({});
    expect(JSON.stringify(round?.payload)).not.toContain('这句不该抄进会话事件流');
    expect(sessions()).toHaveLength(1);
  });

  test('对话失败（transport 报错）也记 round（finally 路径统一收）', async () => {
    const { service, sessions } = harness({
      events: [{ type: 'error', message: 'CLI 崩了', code: 'cli_error' }],
    });

    await service.send('ch-1', '会失败的一句');

    const list = sessions();
    expect(list).toHaveLength(1);
    expect(list[0]?.eventCount).toBe(2); // created + round
  });
});
