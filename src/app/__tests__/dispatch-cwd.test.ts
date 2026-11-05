/**
 * 单测：**派发链 cwd 的接线**（@since v3.44，task_166 / docs/DESIGN-workspace.md §8 M0-02）。
 *
 * 覆盖 §8 M0-02 行的三条验收要点：
 *   1. 派发路径上 cwd 有**唯一取值点**（task-service / chat-service 都从同一个供给口取值，
 *      取值规则只有一份 —— dispatch-cwd.ts 的 resolveDispatchCwd）；
 *   2. M0 下 cwd 仍为 `undefined`（供给口缺省恒 undefined ⇒ 行为与今天逐字节一致）；
 *   3. 现有派发测试不破（既有 task-service / chat-service 单测照跑，见任务验证记录）。
 *
 * transport 全打桩（记录 spawn 的 SpawnOptions），不真调外部二进制。
 */

import { resetBus } from '../../core/bus';
import { createTaskManager } from '../../core/task';
import { createStore } from '../../core/store';
import type { AgentKind, CharacterView, DetectedAgent, WorldState } from '../../core/types';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import {
  defaultDispatchCwdProvider,
  resolveDispatchCwd,
  type DispatchCwdProvider,
} from '../services/dispatch-cwd';
import { createChatService, type ChatDrawerView, type ChatTransportFactory } from '../services/chat-service';
import { createTaskService, type TaskTransportFactory } from '../services/task-service';

// ============================================================================
// 夹具
// ============================================================================

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

/** 一次 spawn 的记账。 */
interface SpawnRecord {
  readonly prompt: string;
  readonly options: SpawnOptions | undefined;
}

/** 打桩 transport 工厂：记录每次 spawn 的选项，产出固定事件流。 */
function makeFactory(): { factory: TaskTransportFactory & ChatTransportFactory; calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = [];
  const factory = (kind: AgentKind) => ({
    spawn: (prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent> => {
      calls.push({ prompt, options });
      return {
        [Symbol.asyncIterator]: async function* script(): AsyncGenerator<TransportEvent> {
          yield { type: 'message', text: '收到' };
          yield { type: 'done', exitCode: 0, text: '收到', sessionId: 'sess-1' };
        },
      };
    },
  });
  return { factory, calls };
}

/** 抽屉视图口打桩（chat-service 只用它回话）。 */
function makeView(): ChatDrawerView {
  return {
    addMessage: (): void => { /* 忽略 */ },
    appendStream: (): void => { /* 忽略 */ },
    finalizeStream: (): void => { /* 忽略 */ },
    setSending: (): void => { /* 忽略 */ },
  };
}

/** 等微任务跑几拍（task-service 的派发是 fire-and-forget，只能靠微任务推进）。 */
async function flush(times = 24): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

// ============================================================================
// 1. 纯模块：唯一取值点
// ============================================================================

describe('dispatch-cwd：取值点', () => {
  test('缺省供给口恒返回 undefined（M0 行为不变）', () => {
    expect(defaultDispatchCwdProvider()).toBeUndefined();
  });

  test('resolveDispatchCwd 返回供给口给的值', () => {
    expect(resolveDispatchCwd(() => '/tmp/instance-root')).toBe('/tmp/instance-root');
  });

  test('供给口抛错 ⇒ 降级为 undefined（不炸，派发照旧）', () => {
    const lines: string[] = [];
    const value = resolveDispatchCwd(
      (): string => {
        throw new Error('供给口坏了');
      },
      (line) => lines.push(line)
    );
    expect(value).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('供给口坏了');
  });
});

// ============================================================================
// 2. task-service 派发时填 cwd
// ============================================================================

describe('task-service：派发填 cwd', () => {
  beforeEach(() => {
    resetBus();
  });

  /** 起一个 task-service，派发一条任务，返回 spawn 记账。 */
  async function dispatchOnce(cwdProvider?: DispatchCwdProvider): Promise<SpawnRecord[]> {
    const store = createStore();
    store.setState((state) => ({
      ...state,
      characters: [character],
      detectedAgents: [detectedClaude],
      units: [],
    }));
    const manager = createTaskManager({
      store,
      now: () => 1234,
      createId: (prefix) => `${prefix}_x`,
    });
    const { factory, calls } = makeFactory();
    const service = createTaskService({
      getState: () => store.getState(),
      createTransport: factory,
      taskManager: manager,
      cwdProvider,
    });
    const stop = service.start();
    try {
      manager.assignTask({ characterId: 'ch-1', prompt: '侦察北门' });
      await flush();
      return calls;
    } finally {
      stop();
    }
  }

  test('注入供给口 ⇒ spawn 的 cwd 是活跃实例的项目根', async () => {
    const calls = await dispatchOnce(() => '/tmp/instance-root');
    expect(calls).toHaveLength(1);
    expect(calls[0].options?.cwd).toBe('/tmp/instance-root');
  });

  test('不注入供给口 ⇒ cwd 仍是 undefined（M0 行为不变）', async () => {
    const calls = await dispatchOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0].options?.cwd).toBeUndefined();
  });

  test('供给口抛错 ⇒ cwd 回落 undefined，这一轮照常跑完', async () => {
    const calls = await dispatchOnce((): string => {
      throw new Error('供给口坏了');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].options?.cwd).toBeUndefined();
  });
});

// ============================================================================
// 3. chat-service 派发时填 cwd
// ============================================================================

describe('chat-service：派发填 cwd', () => {
  beforeEach(() => {
    resetBus();
  });

  /** 起一个 chat-service，发一轮对话，返回 spawn 记账。 */
  async function sendOnce(cwdProvider?: DispatchCwdProvider): Promise<SpawnRecord[]> {
    const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
      characters: [character],
      detectedAgents: [detectedClaude],
      units: [],
    };
    const { factory, calls } = makeFactory();
    const service = createChatService({
      view: makeView(),
      getState: () => state,
      createTransport: factory,
      persistSessionId: (): void => { /* 忽略 */ },
      cwdProvider,
    });
    await service.send('ch-1', '在哪儿跑？');
    return calls;
  }

  test('注入供给口 ⇒ spawn 的 cwd 是活跃实例的项目根', async () => {
    const calls = await sendOnce(() => '/tmp/instance-root');
    expect(calls).toHaveLength(1);
    expect(calls[0].options?.cwd).toBe('/tmp/instance-root');
  });

  test('不注入供给口 ⇒ cwd 仍是 undefined（M0 行为不变）', async () => {
    const calls = await sendOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0].options?.cwd).toBeUndefined();
  });

  test('供给口抛错 ⇒ cwd 回落 undefined，这一轮照常跑完', async () => {
    const calls = await sendOnce((): string => {
      throw new Error('供给口坏了');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].options?.cwd).toBeUndefined();
  });
});

// ============================================================================
// 4. 唯一取值点：两个 service 取的是同一个供给口
// ============================================================================

describe('派发链：cwd 取值点唯一', () => {
  beforeEach(() => {
    resetBus();
  });

  test('task-service 与 chat-service 从同一供给口取到同一个值', async () => {
    const asked: string[] = [];
    const provider: DispatchCwdProvider = (): string => {
      asked.push('cwd');
      return '/tmp/instance-root';
    };

    // chat-service 一轮
    const chatState: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
      characters: [character],
      detectedAgents: [detectedClaude],
      units: [],
    };
    const chat = makeFactory();
    const chatService = createChatService({
      view: makeView(),
      getState: () => chatState,
      createTransport: chat.factory,
      persistSessionId: (): void => { /* 忽略 */ },
      cwdProvider: provider,
    });
    await chatService.send('ch-1', '在哪儿跑？');

    // task-service 一轮
    const store = createStore();
    store.setState((state) => ({
      ...state,
      characters: [character],
      detectedAgents: [detectedClaude],
      units: [],
    }));
    const manager = createTaskManager({
      store,
      now: () => 1234,
      createId: (prefix) => `${prefix}_x`,
    });
    const task = makeFactory();
    const taskService = createTaskService({
      getState: () => store.getState(),
      createTransport: task.factory,
      taskManager: manager,
      cwdProvider: provider,
    });
    const stop = taskService.start();
    try {
      manager.assignTask({ characterId: 'ch-1', prompt: '侦察北门' });
      await flush();
    } finally {
      stop();
    }

    expect(chat.calls[0].options?.cwd).toBe('/tmp/instance-root');
    expect(task.calls[0].options?.cwd).toBe('/tmp/instance-root');
    // 每轮派发各问一次供给口（活跃实例可换 ⇒ 不能缓存）。
    expect(asked).toHaveLength(2);
  });
});
