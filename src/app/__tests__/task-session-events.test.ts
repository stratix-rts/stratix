/**
 * 集成测试：**task_run 会话事件化**（@since v3.46，task_105 / v3.2b-B6）——
 *   任务执行路径的埋点（task_started / step / output_tail / completed / failed）。
 * 覆盖验收口径：
 *   1. 事件序列完整：一次任务执行 → session_events 出现
 *      created → task_started → step → output_tail → completed → closed；
 *   2. **每步限长**：output_tail 只留尾 500 字并标 truncated；步骤明细按上限收口；
 *   3. 失败路径：transport 报错 → failed 事件（含错误摘要）+ 会话收尾；
 *   4. 没跑起来的任务（守门拦截）：只有终态事件（没有 task_started —— 它没开工）；
 *   5. **事件频率节制**：同一 task 的事件数超上限后，中间事件停记，终态仍记。
 *
 * 总线隔离靠 resetBus()（service 直连 core/bus 单例，与 task-service.test.ts 同一手法）。
 */

import { resetBus } from '../../core/bus';
import { createSessionManager, type SessionEvent } from '../../core/session';
import { createTaskManager } from '../../core/task';
import { createStore, type CoreStore } from '../../core/store';
import type { CharacterView, DetectedAgent } from '../../core/types';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import {
  createTaskSessionRecorder,
  DEFAULT_TASK_EVENT_CAP,
  resolveTaskEventCap,
  TASK_EVENT_CAP_ENV,
} from '../services/task-session-recorder';
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

/** 打桩 transport：吐出给定的脚本事件序列。 */
function scriptedFactory(events: TransportEvent[]): TaskTransportFactory {
  return () => ({
    spawn: (_prompt: string, _options?: SpawnOptions): AsyncIterable<TransportEvent> => {
      const run = async function* (): AsyncGenerator<TransportEvent> {
        for (const event of events) yield event;
      };
      return { [Symbol.asyncIterator]: () => run() };
    },
  });
}

interface Harness {
  readonly store: CoreStore;
  readonly events: SessionEvent[];
  readonly service: ReturnType<typeof createTaskService>;
  readonly manager: ReturnType<typeof createTaskManager>;
  readonly sessions: ReturnType<typeof createSessionManager>;
}

let idSeq = 0;
let sessionSeq = 0;
const stops: Array<() => void> = [];

function makeHarness(options: {
  readonly script?: TransportEvent[];
  readonly characters?: readonly CharacterView[];
  readonly detected?: readonly DetectedAgent[];
  readonly eventCap?: number;
} = {}): Harness {
  resetBus();
  idSeq = 0;
  sessionSeq = 0;
  const store = createStore();
  store.setState((state) => ({
    ...state,
    characters: [...(options.characters ?? [character])],
    detectedAgents: [...(options.detected ?? [detectedClaude])],
    units: [],
  }));
  // 会话事件落"库"（这里用内存数组模拟 session_events 表 —— 事件本体只进库，不进广播）。
  const events: SessionEvent[] = [];
  const sessions = createSessionManager({
    store,
    now: () => 1_700_000_000_000,
    createId: (prefix) => `${prefix}_${++sessionSeq}`,
    persist: {
      persistSession: () => undefined,
      persistEvent: (event) => {
        events.push(event);
      },
    },
  });
  const manager = createTaskManager({
    store,
    now: () => 1_700_000_000_000,
    createId: (prefix) => `${prefix}_${++idSeq}`,
  });
  const service = createTaskService({
    getState: () => store.getState(),
    createTransport: scriptedFactory(options.script ?? []),
    taskManager: manager,
    sessions,
    ...(options.eventCap === undefined ? {} : { taskEventCap: options.eventCap }),
  });
  stops.push(service.start());
  return { store, events, service, manager, sessions };
}

/** 等微任务跑几拍（runTask 是 fire-and-forget 的 async 链，只能靠微任务推进）。 */
async function flush(times = 32): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/** 事件类型序列（断言用）。 */
function types(events: readonly SessionEvent[]): string[] {
  return events.map((event) => event.type);
}

/** 取某类型的第一条事件（断言用；没有则 null）。 */
function firstOfType<T extends SessionEvent['type']>(
  events: readonly SessionEvent[],
  type: T
): Extract<SessionEvent, { type: T }> | null {
  const hit = events.find((event) => event.type === type);
  return (hit as Extract<SessionEvent, { type: T }> | undefined) ?? null;
}

beforeEach(() => {
  stops.length = 0;
  resetBus();
});

afterEach(() => {
  stops.forEach((stop) => stop());
  stops.length = 0;
});

// ============================================================================
// 用例
// ============================================================================

describe('task_run 会话事件化：成功路径的事件序列', () => {
  test('一次执行 → created → task_started → step → output_tail → completed → closed', async () => {
    const h = makeHarness({
      script: [
        { type: 'message', text: '北门发现敌军' },
        { type: 'done', exitCode: 0, text: 'ok', sessionId: 'cli-1' },
      ],
    });

    const task = h.manager.assignTask({ characterId: 'ch-1', prompt: '侦察北门' });
    expect(task).not.toBeNull();
    await flush();

    expect(types(h.events)).toEqual([
      'created',
      'task_started',
      'step',
      'output_tail',
      'completed',
      'closed',
    ]);
    // 会话摘要：kind=task_run、关联 taskId、终态 closed。
    const session = h.store.getState().sessions?.[0];
    expect(session?.kind).toBe('task_run');
    expect(session?.refId).toBe(task?.id);
    expect(session?.status).toBe('closed');
  });

  test('task_started 带 taskId 与描述摘要；step 带关键节点名', async () => {
    const h = makeHarness({
      script: [{ type: 'message', text: 'ok' }, { type: 'done', exitCode: 0, text: 'ok', sessionId: 'cli-1' }],
    });
    const task = h.manager.assignTask({ characterId: 'ch-1', prompt: '侦察北门' });
    await flush();

    const started = firstOfType(h.events, 'task_started');
    expect(started?.payload.taskId).toBe(task?.id);
    expect(started?.payload.summary).toContain('侦察北门');

    const step = firstOfType(h.events, 'step');
    expect(step?.payload.label).toBe('执行开始');
  });

  test('输出尾部只留尾 500 字并标 truncated（每步限长）', async () => {
    const long = 'A'.repeat(600) + '结论在最末尾';
    const h = makeHarness({
      script: [{ type: 'message', text: long }, { type: 'done', exitCode: 0, text: 'ok', sessionId: 'cli-1' }],
    });
    h.manager.assignTask({ characterId: 'ch-1', prompt: '长报告' });
    await flush();

    const tail = firstOfType(h.events, 'output_tail');
    expect(tail).not.toBeNull();
    expect(tail?.payload.text.length).toBe(500);
    expect(tail?.payload.truncated).toBe(true);
    // 留的是**尾部**（结论在末尾，截头就只剩铺垫了）。
    expect(tail?.payload.text.endsWith('结论在最末尾')).toBe(true);
  });

  test('短输出不标 truncated', async () => {
    const h = makeHarness({
      script: [{ type: 'message', text: '短报告' }, { type: 'done', exitCode: 0, text: 'ok', sessionId: 'cli-1' }],
    });
    h.manager.assignTask({ characterId: 'ch-1', prompt: '短报告' });
    await flush();

    const tail = firstOfType(h.events, 'output_tail');
    expect(tail?.payload.text).toBe('短报告');
    expect(tail?.payload.truncated).toBe(false);
  });
});

describe('task_run 会话事件化：失败与未开工', () => {
  test('transport 报错 → failed 事件（含错误摘要）+ 会话收尾', async () => {
    const h = makeHarness({
      script: [{ type: 'error', code: 'timeout', message: '等了 600 秒' }],
    });
    h.manager.assignTask({ characterId: 'ch-1', prompt: '侦察北门' });
    await flush();

    expect(types(h.events)).toEqual(['created', 'task_started', 'step', 'failed', 'closed']);
    const failed = firstOfType(h.events, 'failed');
    expect(failed?.payload.reason).toContain('超时');
    expect(h.store.getState().sessions?.[0]?.status).toBe('closed');
  });

  test('守门拦截（没开工）→ 只有终态事件，没有 task_started', async () => {
    // detectedAgents 为空 → 守门拦截，任务压根没进 transport。
    const h = makeHarness({ script: [], detected: [] });
    h.manager.assignTask({ characterId: 'ch-1', prompt: '侦察北门' });
    await flush();

    expect(types(h.events)).toEqual(['created', 'failed', 'closed']);
    expect(firstOfType(h.events, 'task_started')).toBeNull();
  });
});

describe('task_run 会话事件化：事件频率节制', () => {
  test('同一 task 的事件数超上限后，中间事件停记，终态仍记', async () => {
    const h = makeHarness({ script: [], eventCap: 5 });
    const recorder = createTaskSessionRecorder({
      sessions: h.sessions,
      eventCap: 5,
    });
    recorder.begin({ taskId: 'task-x', characterId: 'ch-1', prompt: '长任务' });
    for (let i = 0; i < 20; i += 1) recorder.step('task-x', `步骤${i}`);
    recorder.outputTail('task-x', '产出');
    recorder.finish({
      taskId: 'task-x',
      characterId: 'ch-1',
      prompt: '长任务',
      outcome: 'completed',
      summary: '做完了',
    });

    const typesSeen = types(h.events);
    // created + task_started + 3 条 step（上限 5）→ 中间事件到此为止。
    expect(typesSeen.filter((type) => type === 'step').length).toBe(3);
    // 超限后 output_tail 不再记。
    expect(typesSeen).not.toContain('output_tail');
    // 终态必须留痕（会话存在的理由就是"这单跑过没有、成了没有"）。
    expect(typesSeen).toContain('completed');
    expect(typesSeen[typesSeen.length - 1]).toBe('closed');
  });

  test('env SX_TASK_EVENT_CAP 解析：缺省 50；非法值回落 50', () => {
    expect(resolveTaskEventCap({})).toBe(DEFAULT_TASK_EVENT_CAP);
    expect(resolveTaskEventCap({ [TASK_EVENT_CAP_ENV]: '12' })).toBe(12);
    expect(resolveTaskEventCap({ [TASK_EVENT_CAP_ENV]: 'abc' })).toBe(DEFAULT_TASK_EVENT_CAP);
    expect(resolveTaskEventCap({ [TASK_EVENT_CAP_ENV]: '0' })).toBe(DEFAULT_TASK_EVENT_CAP);
    expect(resolveTaskEventCap({ [TASK_EVENT_CAP_ENV]: '-3' })).toBe(DEFAULT_TASK_EVENT_CAP);
  });
});

describe('task_run 会话事件化：埋点器自身的边界', () => {
  test('没开工就收尾 → 补建会话并记终态（这单"没跑起来"也要留痕）', () => {
    const h = makeHarness({ script: [] });
    const recorder = createTaskSessionRecorder({ sessions: h.sessions });
    recorder.finish({
      taskId: 'task-y',
      characterId: 'ch-1',
      prompt: '没跑起来',
      outcome: 'failed',
      summary: 'CLI 未安装',
    });

    expect(types(h.events)).toEqual(['created', 'failed', 'closed']);
    const failed = firstOfType(h.events, 'failed');
    expect(failed?.payload.reason).toBe('CLI 未安装');
  });

  test('重复收尾只记一遍（终态幂等）', () => {
    const h = makeHarness({ script: [] });
    const recorder = createTaskSessionRecorder({ sessions: h.sessions });
    recorder.begin({ taskId: 'task-z', characterId: 'ch-1', prompt: '幂等' });
    recorder.finish({
      taskId: 'task-z',
      characterId: 'ch-1',
      prompt: '幂等',
      outcome: 'completed',
      summary: '好了',
    });
    recorder.finish({
      taskId: 'task-z',
      characterId: 'ch-1',
      prompt: '幂等',
      outcome: 'completed',
      summary: '好了',
    });

    expect(types(h.events).filter((type) => type === 'completed').length).toBe(1);
    expect(types(h.events).filter((type) => type === 'closed').length).toBe(1);
  });

  test('没有会话域（端口缺席）→ 全部动作是 no-op，不抛', () => {
    const recorder = createTaskSessionRecorder({});
    expect(() => {
      recorder.begin({ taskId: 'task-n', characterId: 'ch-1', prompt: '无会话域' });
      recorder.step('task-n', '一步');
      recorder.outputTail('task-n', '产出');
      recorder.finish({
        taskId: 'task-n',
        characterId: 'ch-1',
        prompt: '无会话域',
        outcome: 'completed',
        summary: '好了',
      });
    }).not.toThrow();
  });
});
