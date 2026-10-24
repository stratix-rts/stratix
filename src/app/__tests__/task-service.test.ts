/**
 * 集成测试：角色任务执行服务（app/services/task-service.ts，task_037）。
 * transport 全打桩（脚本化事件序列 / 可挂起的受控脚本），core 侧用真 store + 真 task manager，
 * 覆盖任务规格的六个面：
 *   1. 出队守门：agent 未检出 / 未绑 kind / 角色不在档 → 任务直接 failed（不进 transport）；
 *   2. 每角色 FIFO + 并发 1：排队按序执行，同一时刻一个角色只有一轮在跑；
 *   3. 会话隔离：spawn 恒不带 sessionId（不复用聊天会话）、session 事件不回写不透传；
 *   4. persona 内嵌：每轮任务指令都拼角色设定（任务无续发，每轮都是首发）；
 *   5. 相位回报与落库：queued/running 快照随事件落，completed 落全文（状态里只有摘要）；
 *   6. 失败不自动重试：error 事件 / transport 抛异常 → failed 即终态，队列继续走下一条。
 *
 * 总线隔离靠 resetBus()（service 直连 core/bus 单例，与 game-save-coordinator 同一手法）。
 */

import { emitWorldEvent, onWorldEvent, resetBus } from '../../core/bus';
import { createTaskManager } from '../../core/task';
import type { CoreStore } from '../../core/store';
import { createStore } from '../../core/store';
import type { AgentKind, CharacterTask, CharacterView, DetectedAgent, WorldEvent, WorldState } from '../../core/types';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import {
  buildTaskPrompt,
  createTaskService,
  DEFAULT_TASK_TIMEOUT_MS,
  guardTaskCharacter,
  TASK_MSG_NOT_INSTALLED,
  TASK_MSG_NO_PROFILE,
  TASK_MSG_UNBOUND,
  taskErrorText,
  type TaskPersistRecord,
  type TaskTransportFactory,
} from '../services/task-service';

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
  externalSessionId: 'chat-sess-1', // 故意带聊天会话 id：任务绝不能透传它（会话隔离断言点）
};

const otherCharacter: CharacterView = { ...character, id: 'ch-2', name: '贝塔' };

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

type Script = (record: SpawnRecord) => AsyncGenerator<TransportEvent>;

function scripted(...events: TransportEvent[]): Script {
  return async function* script(): AsyncGenerator<TransportEvent> {
    for (const event of events) yield event;
  };
}

/** 挂起脚本：先吐 events，等外部 release 再吐尾部（把执行「卡在半路」验并发纪律）。 */
function gated(events: TransportEvent[], tail: TransportEvent[] = []): {
  script: Script;
  release(): void;
} {
  let resolveRelease: () => void = () => { /* 占位，start 后替换 */ };
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

/** 打桩 transport 工厂：按调用次序消耗脚本（脚本用尽后复用最后一个）。 */
function makeFactory(scripts: Script[]): { factory: TaskTransportFactory; calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = [];
  let index = 0;
  const factory: TaskTransportFactory = (kind: AgentKind) => ({
    spawn: (prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent> => {
      const record: SpawnRecord = { prompt, options };
      calls.push(record);
      const script = scripts[Math.min(index, scripts.length - 1)];
      index += 1;
      const run = script(record);
      return { [Symbol.asyncIterator]: () => run };
    },
  });
  return { factory, calls };
}

interface HarnessOptions {
  readonly characters?: readonly CharacterView[];
  readonly detected?: readonly DetectedAgent[] | undefined;
  readonly scripts?: Script[];
  readonly timeoutMs?: number;
  readonly maxTasks?: number;
}

interface Harness {
  readonly service: ReturnType<typeof createTaskService>;
  readonly manager: ReturnType<typeof createTaskManager>;
  readonly store: CoreStore;
  readonly calls: SpawnRecord[];
  readonly persisted: TaskPersistRecord[];
  setState(patch: Partial<Pick<WorldState, 'characters' | 'detectedAgents'>>): void;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  resetBus();
  const store = createStore();
  const detected: readonly DetectedAgent[] | undefined =
    'detected' in options ? options.detected : [detectedClaude];
  store.setState((state) => ({
    ...state,
    characters: [...(options.characters ?? [character, otherCharacter])],
    detectedAgents: detected ? [...detected] : undefined,
  }));
  const manager = createTaskManager({
    store,
    now: () => 1234,
    createId: (prefix) => `${prefix}_${++idSeq}`,
    maxTasks: options.maxTasks,
  });
  const { factory, calls } = makeFactory(options.scripts ?? [scripted()]);
  const persisted: TaskPersistRecord[] = [];
  const service = createTaskService({
    getState: () => store.getState(),
    createTransport: factory,
    taskManager: manager,
    persistTask: (record) => persisted.push(record),
    timeoutMs: options.timeoutMs,
  });
  const stop = service.start();
  harnessStops.push(stop);
  return {
    service,
    manager,
    store,
    calls,
    persisted,
    setState: (patch) => store.setState((state) => ({ ...state, ...patch })),
  };
}

let idSeq = 0;
const harnessStops: Array<() => void> = [];

beforeEach(() => {
  idSeq = 0;
  resetBus();
  harnessStops.length = 0;
});

afterEach(() => {
  harnessStops.forEach((stop) => stop());
});

/** 等微任务跑几拍（fire-and-forget 的 runTask 只能靠微任务推进：每个事件约 2 跳，给足裕量）。 */
async function flush(times = 24): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/** 用 manager 造一条真任务（守门过 → 直接入队执行），返回任务 id。 */
function assign(h: Harness, prompt: string, characterId = 'ch-1'): CharacterTask {
  const task = h.manager.assignTask({ characterId, prompt });
  // assignTask 同步发 task.queued → service 的订阅是同步回调 → 已入队（可能已 pump）。
  expect(task).not.toBeNull();
  return task as CharacterTask;
}

// ============================================================================
// 纯函数
// ============================================================================

describe('guardTaskCharacter：出队守门', () => {
  const state = { characters: [character], detectedAgents: [detectedClaude] };

  test('三条全过 → ok（返回角色与 kind）', () => {
    const guard = guardTaskCharacter(state, 'ch-1');
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.kind).toBe('claude-code');
  });

  test('角色不在档 / 未绑 kind / 未检出 / 快照缺失 → 拒（与 chat-service 同三条，文案独立）', () => {
    expect(guardTaskCharacter(state, 'ghost')).toEqual({ ok: false, reason: TASK_MSG_NO_PROFILE });
    expect(guardTaskCharacter({ ...state, characters: [{ ...character, agentKind: null }] }, 'ch-1')).toEqual({
      ok: false,
      reason: TASK_MSG_UNBOUND,
    });
    expect(guardTaskCharacter({ ...state, detectedAgents: [] }, 'ch-1')).toEqual({
      ok: false,
      reason: TASK_MSG_NOT_INSTALLED,
    });
    expect(guardTaskCharacter({ characters: [character], detectedAgents: undefined }, 'ch-1')).toEqual({
      ok: false,
      reason: TASK_MSG_NOT_INSTALLED,
    });
  });
});

describe('buildTaskPrompt：persona 内嵌（任务语境）', () => {
  test('引导语 + 角色设定 + 任务指令；设定在前指令在后；persona 空则只发原文', () => {
    const prompt = buildTaskPrompt(character, '侦察北门');
    expect(prompt).toContain('阿尔法');
    expect(prompt).toContain('冷静的战术分析师');
    expect(prompt).toContain('侦察北门');
    expect(prompt.indexOf('角色设定')).toBeLessThan(prompt.indexOf('任务指令'));

    expect(buildTaskPrompt({ ...character, persona: '   ' }, '干活')).toBe('干活');
  });
});

describe('taskErrorText：错误码 → 人话原因', () => {
  test('带码带消息', () => {
    expect(taskErrorText('timeout', '等了 600 秒')).toBe('执行超时：等了 600 秒');
    expect(taskErrorText('spawn_failed', 'no such file')).toBe('CLI 拉起失败：no such file');
  });
});

// ============================================================================
// 出队与执行编排
// ============================================================================

describe('单任务执行：相位回报 + 全文落库 + 超时透传', () => {
  test('queued → running → completed；spawn 带 persona 且不带 sessionId；库里有全文', async () => {
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'session', sessionId: 'task-sess-9' }, // 任务的一次性会话 id：应被无视
          { type: 'message', text: '北门无敌情。' },
          { type: 'message', text: '一切正常。' },
          { type: 'done', exitCode: 0, text: '北门无敌情。一切正常。', sessionId: 'task-sess-9' }
        ),
      ],
    });
    assign(h, '侦察北门');
    await flush();

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].prompt).toBe(buildTaskPrompt(character, '侦察北门')); // persona 内嵌
    expect(h.calls[0].options?.sessionId ?? null).toBeNull(); // 会话隔离：不复用聊天 sessionRef
    expect(h.calls[0].options?.timeoutMs).toBe(DEFAULT_TASK_TIMEOUT_MS); // 10min 档

    const stored = h.store.getState().tasks![0];
    expect(stored).toMatchObject({ status: 'completed', startedAt: 1234, endedAt: 1234 });
    expect(stored.output).toBe('北门无敌情。一切正常。'); // 短输出摘要=全文

    // 落库三段：queued 快照 → running 快照 → completed 全文
    expect(h.persisted.map((r) => r.status)).toEqual(['queued', 'running', 'completed']);
    const final = h.persisted.at(-1)!;
    expect(final.output).toBe('北门无敌情。一切正常。'); // 全文（= 状态摘要，短文场景）
    // 角色档案的聊天会话 id 没被动过（任务不写档案）
    expect(h.store.getState().characters[0].externalSessionId).toBe('chat-sess-1');
  });

  test('超长输出：状态里是截断摘要，库里是全文', async () => {
    const full = 'x'.repeat(5000);
    const h = makeHarness({
      scripts: [scripted({ type: 'message', text: full }, { type: 'done', exitCode: 0, text: full, sessionId: null })],
    });
    assign(h, '写一篇长报告');
    await flush();

    const stored = h.store.getState().tasks![0];
    expect(stored.output.length).toBe(2001); // MAX_TASK_SUMMARY_LEN + 省略号
    expect(stored.output.endsWith('…')).toBe(true);
    expect(h.persisted.at(-1)!.output).toBe(full); // 库里全文
  });

  test('空输出 → 占位文案（completed 不静默）', async () => {
    const h = makeHarness({
      scripts: [scripted({ type: 'tool_use', tool: 'Bash', input: {}, id: 't1' }, { type: 'done', exitCode: 0, text: '', sessionId: null })],
    });
    assign(h, '跑个脚本');
    await flush();
    expect(h.store.getState().tasks![0].output).toBe('（任务完成，无文本输出）');
    expect(h.service.isBusy('ch-1')).toBe(false);
  });
});

describe('守门拦截：不进 transport，直接 failed', () => {
  test('agent 未检出 → 任务 failed 且原因可读；状态里看得见；transport 零调用', async () => {
    const h = makeHarness({ detected: [], scripts: [scripted()] });
    assign(h, '干活');
    await flush();

    const task = h.store.getState().tasks![0];
    expect(task).toMatchObject({ status: 'failed' });
    expect(task.output).toBe(TASK_MSG_NOT_INSTALLED);
    expect(task.startedAt).toBeNull(); // 没开过工（queued 直达 failed）
    expect(h.calls).toHaveLength(0);
    expect(h.persisted.map((r) => r.status)).toEqual(['queued', 'failed']);
  });

  test('未绑 kind 同口径；队列不被死任务堵死（第二条正常执行）', async () => {
    const h = makeHarness({ scripts: [scripted({ type: 'message', text: 'ok' }, { type: 'done', exitCode: 0, text: 'ok', sessionId: null })] });
    h.setState({ characters: [character, { ...otherCharacter, agentKind: null }] }); // ch-2 在档但未绑 kind
    assign(h, '第一条（未绑定）', 'ch-2');
    assign(h, '第二条', 'ch-1');
    await flush();

    const tasks = h.store.getState().tasks!;
    expect(tasks[0]).toMatchObject({ status: 'failed', characterId: 'ch-2' });
    expect(tasks[1]).toMatchObject({ status: 'completed', characterId: 'ch-1' });
    expect(h.calls).toHaveLength(1);
  });
});

describe('FIFO 与并发 1', () => {
  test('同一角色排两条：第一条跑完（release 之前）第二条不动；收尾后立刻接上', async () => {
    const gate1 = gated([{ type: 'message', text: 'A 在跑' }], [
      { type: 'done', exitCode: 0, text: 'A done', sessionId: null },
    ]);
    const h = makeHarness({ scripts: [gate1.script, scripted({ type: 'done', exitCode: 0, text: 'B done', sessionId: null })] });

    assign(h, '任务 A');
    assign(h, '任务 B');
    await flush();

    // A 在半路：只有 A 在跑，B 排队（并发 1）
    expect(h.service.isBusy('ch-1')).toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].prompt).toContain('任务 A');
    expect(h.store.getState().tasks!.map((t) => t.status)).toEqual(['running', 'queued']);
    expect(h.service.queueLength('ch-1')).toBe(1); // B 还在队列里

    gate1.release();
    await flush();

    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].prompt).toContain('任务 B');
    expect(h.store.getState().tasks!.map((t) => t.status)).toEqual(['completed', 'completed']);
    expect(h.service.isBusy('ch-1')).toBe(false);
  });

  test('不同角色互不阻塞：两角色各一条，同时各跑各的', async () => {
    const gate1 = gated([{ type: 'message', text: 'A' }], [{ type: 'done', exitCode: 0, text: 'A', sessionId: null }]);
    const gate2 = gated([{ type: 'message', text: 'B' }], [{ type: 'done', exitCode: 0, text: 'B', sessionId: null }]);
    const h = makeHarness({ scripts: [gate1.script, gate2.script] });

    assign(h, '任务 A', 'ch-1');
    assign(h, '任务 B', 'ch-2');
    await flush();

    expect(h.calls).toHaveLength(2); // 并发 1 是**每角色**的纪律，不是全局串行
    gate1.release();
    gate2.release();
    await flush();
    expect(h.store.getState().tasks!.every((t) => t.status === 'completed')).toBe(true);
  });

  test('失败不自动重试：error 事件 → failed 终态，下一条照常执行', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'error', message: '等了 600 秒', code: 'timeout' }),
        scripted({ type: 'done', exitCode: 0, text: 'B ok', sessionId: null }),
      ],
    });
    assign(h, '会失败的任务');
    assign(h, '接力任务');
    await flush();

    const tasks = h.store.getState().tasks!;
    expect(tasks[0]).toMatchObject({ status: 'failed' });
    expect(tasks[0].output).toBe('执行超时：等了 600 秒');
    expect(tasks[1]).toMatchObject({ status: 'completed' });
    expect(h.calls).toHaveLength(2); // 只跑了各一轮，没有重试轮
  });

  test('transport 抛异常 → failed 收尾（任务不会被吊死在 running）', async () => {
    const boom: Script = async function* script(): AsyncGenerator<TransportEvent> {
      yield { type: 'message', text: '半截' };
      throw new Error('适配器炸了');
    };
    const h = makeHarness({ scripts: [boom] });
    assign(h, '危险任务');
    await flush();

    const task = h.store.getState().tasks![0];
    expect(task.status).toBe('failed');
    expect(task.output).toBe('CLI 报错：适配器炸了');
  });

  test('流自然结束无 done → 防御性 failed（runtime 契约上不该发生，发生了也不吊死）', async () => {
    const streamEnd: Script = async function* script(): AsyncGenerator<TransportEvent> {
      yield { type: 'message', text: '话说到一半' };
    };
    const h = makeHarness({ scripts: [streamEnd] });
    assign(h, '怪任务');
    await flush();
    expect(h.store.getState().tasks![0].status).toBe('failed');
  });
});

describe('单位忙闲派生（经 service 全链路）', () => {
  test('running → 单位 busy；收尾 → idle；战场零改动即可读到（规格⑦）', async () => {
    const gate = gated([{ type: 'message', text: '干活中' }], [
      { type: 'done', exitCode: 0, text: '干完了', sessionId: null },
    ]);
    const h = makeHarness({ scripts: [gate.script] });
    const store = h.store;
    store.setState((state) => ({
      ...state,
      units: [
        { id: 'unit_ch-1', name: '阿尔法', status: 'idle', missionId: null, power: 0, characterId: 'ch-1', skinId: null, appearance: null },
      ],
    }));

    assign(h, '长活');
    await flush();
    expect(store.getState().units[0].status).toBe('busy'); // working 派生 → UnitView 的 busy

    gate.release();
    await flush();
    expect(store.getState().units[0].status).toBe('idle');
  });
});

describe('start/stop 与重复订阅', () => {
  test('stop 后不再消费新任务（订阅退订生效）；重复 start 只订一次', async () => {
    resetBus();
    const store = createStore();
    store.setState((state) => ({
      ...state,
      characters: [character],
      detectedAgents: [detectedClaude],
    }));
    let idSeq = 0;
    const manager = createTaskManager({ store, now: () => 1, createId: (p) => `${p}_${++idSeq}` });
    const { factory, calls } = makeFactory([scripted({ type: 'done', exitCode: 0, text: 'ok', sessionId: null })]);
    const service = createTaskService({
      getState: () => store.getState(),
      createTransport: factory,
      taskManager: manager,
    });

    const stop = service.start();
    manager.assignTask({ characterId: 'ch-1', prompt: '跑一条' });
    await flush();
    expect(calls).toHaveLength(1);

    stop();
    manager.assignTask({ characterId: 'ch-1', prompt: '停服后的任务' });
    await flush();
    expect(calls).toHaveLength(1); // 没再执行
    expect(store.getState().tasks![1].status).toBe('queued'); // 留在队列里，没被消费

    // 重复 start no-op：stop 后再 start 恢复消费，且不双订阅
    const stop2 = service.start();
    manager.assignTask({ characterId: 'ch-1', prompt: '恢复后的任务' });
    await flush();
    // 停服窗口里的派发：task.queued 事件没有订阅者 → service 从未见过它，留在 queued（文档化行为：
    // start 的 JSDoc —— 晚订阅只漏事件不回放）。恢复后新派的任务正常执行。
    expect(calls).toHaveLength(2);
    expect(store.getState().tasks!.map((t) => t.status)).toEqual(['completed', 'queued', 'completed']);
    stop2();
  });
});

describe('事件转发面：非 queued 生命周期事件也走落库', () => {
  test('外部（测试直发）的 task.started / task.failed 快照照样落库', async () => {
    const h = makeHarness({ scripts: [scripted()] });
    const probe: WorldEvent[] = [];
    const off = onWorldEvent((event) => probe.push(event));

    const task: CharacterTask = {
      id: 'task_ext',
      characterId: 'ch-1',
      prompt: '外部任务',
      status: 'queued',
      createdAt: 1,
      startedAt: null,
      endedAt: null,
      output: '',
    };
    emitWorldEvent({ type: 'task.started', task: { ...task, status: 'running', startedAt: 2 } });
    emitWorldEvent({ type: 'task.failed', task: { ...task, status: 'failed', endedAt: 3, output: '外部原因' } });
    await flush();

    expect(h.persisted.map((r) => [r.id, r.status])).toEqual([
      ['task_ext', 'running'],
      ['task_ext', 'failed'],
    ]);
    expect(h.calls).toHaveLength(0); // started/failed 不触发执行
    off();
  });
});
