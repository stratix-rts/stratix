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
import type {
  AgentKind,
  CharacterTask,
  CharacterView,
  DetectedAgent,
  ExpSource,
  WorldEvent,
  WorldState,
} from '../../core/types';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import { DEFAULT_EXP_WEIGHTS } from '../services/exp-config';
import {
  buildResumedTaskPrompt,
  buildTaskPrompt,
  createTaskService,
  DEFAULT_TASK_TIMEOUT_MS,
  extractPlanDraft,
  guardTaskCharacter,
  TASK_APPROVAL_RESUME_PROMPT,
  TASK_MSG_NOT_INSTALLED,
  TASK_MSG_NO_PROFILE,
  TASK_MSG_RESUME_LOST,
  TASK_MSG_UNBOUND,
  TASK_PLAN_INSTRUCTION,
  taskErrorText,
  type TaskPersistRecord,
  type TaskService,
  type TaskTransportFactory,
} from '../services/task-service';
import { parseTaskArtifactsJson } from '../services/task-artifacts';

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

/** plan-first 人设（task_049 路径①：手写标记 —— personaPlanFirst 判定的词）。 */
const planFirstCharacter: CharacterView = {
  ...character,
  id: 'ch-3',
  name: '参谋长',
  persona: '严谨的参谋长。\n# 行为规则 RULES\n- 先出计划，经批准后再执行',
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
  /** 经验权重注入（task_039）；缺省走 exp-config 的临时常量（完成 50 / 失败 10 / 轮 5）。 */
  readonly expWeight?: (source: ExpSource) => number;
  /** 流式转发端口注入（task_046）；缺省不接（生产接 hud 任务输出面板）。 */
  readonly onTaskChunk?: (characterId: string, chunk: string) => void;
}

interface Harness {
  readonly service: ReturnType<typeof createTaskService>;
  readonly manager: ReturnType<typeof createTaskManager>;
  readonly store: CoreStore;
  readonly calls: SpawnRecord[];
  readonly persisted: TaskPersistRecord[];
  /** onTaskSettled 回调收到的终态记录（task_039；完成带全文 / 失败带原因）。 */
  readonly settled: TaskPersistRecord[];
  /** onTaskChunk 端口收到的 (characterId, chunk) 依次记录（task_046）。 */
  readonly chunks: Array<{ characterId: string; chunk: string }>;
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
  const settled: TaskPersistRecord[] = [];
  const chunks: Array<{ characterId: string; chunk: string }> = [];
  const service = createTaskService({
    getState: () => store.getState(),
    createTransport: factory,
    taskManager: manager,
    persistTask: (record) => persisted.push(record),
    onTaskSettled: (record) => settled.push(record),
    onTaskChunk: options.onTaskChunk ?? ((characterId, chunk) => chunks.push({ characterId, chunk })),
    expWeight: options.expWeight,
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
    settled,
    chunks,
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

// ============================================================================
// 取消的队列纪律（@since v3.23，task_047）
// ============================================================================

describe('取消的队列纪律（task_047）', () => {
  test('排队任务被取消：不进 transport（零 spawn）+ cancelled 快照落库 + 队列继续走下一条', async () => {
    const gate = gated([{ type: 'message', text: 'A 在跑' }], [
      { type: 'done', exitCode: 0, text: 'A done', sessionId: null },
    ]);
    const h = makeHarness({
      scripts: [gate.script, scripted({ type: 'done', exitCode: 0, text: 'B done', sessionId: null })],
    });

    assign(h, '任务 A');
    assign(h, '任务 B');
    const tasks = h.store.getState().tasks!;
    const taskB = tasks[tasks.length - 1];
    expect(taskB.status).toBe('queued'); // A 占着执行位，B 在排队

    // B 在排队（A 占着执行位）：取消 B → cancelled，队列剔除；release 后直接泵空，B 零 spawn。
    const outcome = h.manager.cancelTask(taskB.id);
    expect(outcome.ok).toBe(true);
    gate.release();
    await flush();

    expect(h.calls).toHaveLength(1); // 只有 A 进过 transport：cancelled 不进
    expect(h.calls[0].prompt).toContain('任务 A');
    const final = h.store.getState().tasks!;
    expect(final.find((t) => t.id === taskB.id)?.status).toBe('cancelled');
    expect(h.service.isBusy('ch-1')).toBe(false);
    expect(h.persisted.some((r) => r.id === taskB.id && r.status === 'cancelled')).toBe(true); // 审计可见
    expect(h.settled.some((r) => r.id === taskB.id)).toBe(false); // 没跑过：不回流报告
  });

  test('外部直发的 task.cancelled 事件同样剔除队列（取消相位真相源在总线，同帧竞态面）', async () => {
    const gate = gated([{ type: 'message', text: 'A' }], [{ type: 'done', exitCode: 0, text: 'A', sessionId: null }]);
    const h = makeHarness({ scripts: [gate.script] });

    assign(h, '任务 A');
    const queued = assign(h, '要被取消的任务');
    await flush();
    expect(h.service.queueLength('ch-1')).toBe(1);

    // 模拟另一路径（如未来总线直发）发出的取消事件：队列剔除必须生效，不依赖 manager 调用方。
    const cancelled: CharacterTask = { ...queued, status: 'cancelled', endedAt: 9999, output: '任务在排队时被取消' };
    emitWorldEvent({ type: 'task.cancelled', task: cancelled });
    expect(h.service.queueLength('ch-1')).toBe(0);

    gate.release();
    await flush();
    expect(h.calls).toHaveLength(1); // 只有 A 被执行
  });

  test('出队防御：队列里残留的非 queued 任务被跳过（不进 transport），后续任务照常', async () => {
    const gate = gated([{ type: 'message', text: 'A' }], [{ type: 'done', exitCode: 0, text: 'A', sessionId: null }]);
    const h = makeHarness({
      scripts: [gate.script, scripted({ type: 'done', exitCode: 0, text: 'C', sessionId: null })],
    });

    assign(h, '任务 A');
    const stale = assign(h, '僵尸任务（已被外部收尾）');
    assign(h, '任务 C');
    await flush();

    // 绕开 manager（模拟外部直改状态的同帧竞态）：把队列里那条任务直接改成 completed ——
    // task.cancelled 事件不会发（不是取消路径），出队防御必须自己拦住。
    h.store.setState((state) => ({
      ...state,
      tasks: (state.tasks ?? []).map((t) => (t.id === stale.id ? { ...t, status: 'completed' as const, endedAt: 1, output: 'x' } : t)),
    }));
    gate.release();
    await flush();

    expect(h.calls).toHaveLength(2); // A + C 各一轮；僵尸任务零 spawn
    expect(h.calls[0].prompt).toContain('任务 A');
    expect(h.calls[1].prompt).toContain('任务 C');
    expect(h.store.getState().tasks!.every((t) => t.status !== 'running')).toBe(true);
  });

  test('重派：failed 任务的 prompt 派新任务 → 新任务入库并照常执行（新 id，不复用旧任务）', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'error', message: 'no such file', code: 'spawn_failed' }),
        scripted(
          { type: 'message', text: '重派后干完了' },
          { type: 'done', exitCode: 0, text: '', sessionId: null }
        ),
      ],
    });

    const failed = assign(h, '重派测试任务');
    await flush();
    expect(h.store.getState().tasks![0].status).toBe('failed');

    // 重派 = UI 用原 prompt 构造 task.assign（同 buildTaskAssignCommand），新任务进队执行。
    const fresh = h.manager.assignTask({ characterId: 'ch-1', prompt: failed.prompt });
    expect(fresh?.id).not.toBe(failed.id); // 新任务：失败不自动重试，重派是显式动作
    await flush();

    const tasks = h.store.getState().tasks!;
    expect(tasks.find((t) => t.id === failed.id)?.status).toBe('failed'); // 历史不被改写
    expect(tasks.find((t) => t.id === fresh!.id)).toMatchObject({ status: 'completed', output: '重派后干完了' });
    expect(h.calls).toHaveLength(2); // 两轮各一次：失败轮 + 重派轮
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

// ============================================================================
// 终态副作用：结果回流回调 + exp.gained（task_039）
// ============================================================================

describe('终态副作用：onTaskSettled 回调 + exp.gained 发射（task_039）', () => {
  /** 订阅总线收集 exp 事件（结束后退订 —— 别把监听漏到后续用例）。 */
  function collectExp(): { events: WorldEvent[]; stop: () => void } {
    const events: WorldEvent[] = [];
    const off = onWorldEvent((event) => {
      if (event.type === 'exp.gained') events.push(event);
    });
    return { events, stop: off };
  }

  test('completed → 回调恰好一次且带全文（不是摘要）+ exp.gained(task_completed, 默认 50)', async () => {
    const full = '北门无敌情。'.repeat(600); // 3000 码点：状态里存摘要，回调必须拿全文
    const h = makeHarness({
      scripts: [scripted({ type: 'message', text: full }, { type: 'done', exitCode: 0, text: full, sessionId: null })],
    });
    const exp = collectExp();
    assign(h, '写一份详尽侦察报告');
    await flush();
    exp.stop();

    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({ id: 'task_1', characterId: 'ch-1', status: 'completed' });
    expect(h.settled[0].output).toBe(full); // 全文（与落库口径一致），状态里只是摘要
    expect(exp.events).toEqual([
      { type: 'exp.gained', characterId: 'ch-1', source: 'task_completed', amount: DEFAULT_EXP_WEIGHTS.task_completed },
    ]);
  });

  test('transport 报错 → failed 终态也回调 + 发 exp.gained(task_failed, 默认 10)；恰好各一次不双发', async () => {
    const h = makeHarness({
      scripts: [scripted({ type: 'error', message: '等了 600 秒', code: 'timeout' })],
    });
    const exp = collectExp();
    assign(h, '会失败的任务');
    await flush();
    exp.stop();

    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({ status: 'failed' });
    expect(h.settled[0].output).toBe('执行超时：等了 600 秒'); // 失败回调带原因
    expect(exp.events).toEqual([
      { type: 'exp.gained', characterId: 'ch-1', source: 'task_failed', amount: DEFAULT_EXP_WEIGHTS.task_failed },
    ]);
  });

  test('守门拦截（agent 未检出，没进 transport）→ 同样回调 + 发事件（做过就有收获）', async () => {
    const h = makeHarness({ detected: [], scripts: [scripted()] });
    const exp = collectExp();
    assign(h, '干活');
    await flush();
    exp.stop();

    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({ status: 'failed', output: TASK_MSG_NOT_INSTALLED });
    expect(exp.events).toEqual([
      { type: 'exp.gained', characterId: 'ch-1', source: 'task_failed', amount: DEFAULT_EXP_WEIGHTS.task_failed },
    ]);
  });

  test('注入 expWeight 换算 amount（task_040 接管口）；权重 0 → 该来源整类不发', async () => {
    const h = makeHarness({
      scripts: [scripted({ type: 'done', exitCode: 0, text: 'ok', sessionId: null })],
      expWeight: (source: ExpSource) => (source === 'task_completed' ? 77 : 0),
    });
    const exp = collectExp();
    assign(h, '自定义权重');
    await flush();
    exp.stop();

    expect(h.settled).toHaveLength(1); // 回调照常（权重只影响事件，不影响回流）
    expect(exp.events).toEqual([
      { type: 'exp.gained', characterId: 'ch-1', source: 'task_completed', amount: 77 },
    ]);

    // 权重 0 的失败来源：不发事件，但回流回调不受影响
    const h2 = makeHarness({
      scripts: [scripted({ type: 'error', message: 'boom', code: 'cli_error' })],
      expWeight: () => 0,
    });
    const exp2 = collectExp();
    assign(h2, '会被关掉经验的失败');
    await flush();
    exp2.stop();
    expect(h2.settled).toHaveLength(1);
    expect(exp2.events).toHaveLength(0);
  });

  test('回调抛错不绑架执行回路：任务照常收尾、队列继续、exp 照发', async () => {
    resetBus();
    const store = createStore();
    store.setState((state) => ({
      ...state,
      characters: [character],
      detectedAgents: [detectedClaude],
    }));
    let seq = 0;
    const manager = createTaskManager({ store, now: () => 1, createId: (p) => `${p}_${++seq}` });
    const { factory, calls } = makeFactory([
      scripted({ type: 'done', exitCode: 0, text: 'A ok', sessionId: null }),
      scripted({ type: 'done', exitCode: 0, text: 'B ok', sessionId: null }),
    ]);
    const service = createTaskService({
      getState: () => store.getState(),
      createTransport: factory,
      taskManager: manager,
      onTaskSettled: (): void => {
        throw new Error('回流接线炸了');
      },
      logger: (): void => {
        /* 缺省静默即可（本用例只验证不向外抛） */
      },
    });
    const stop = service.start();
    const exp = collectExp();
    manager.assignTask({ characterId: 'ch-1', prompt: '第一条' });
    manager.assignTask({ characterId: 'ch-1', prompt: '第二条' });
    await flush();
    exp.stop();
    stop();

    expect(store.getState().tasks!.map((t) => t.status)).toEqual(['completed', 'completed']); // 执行没被打断
    expect(calls).toHaveLength(2); // 队列继续走
    expect(exp.events).toHaveLength(2); // exp 照发（回调炸不炸它无感）
  });

  test('外部直发的 task.failed 事件也触发回调与事件（失败相位真相源在总线，不只在 runTask）', async () => {
    const h = makeHarness({ scripts: [scripted()] });
    const exp = collectExp();
    const task: CharacterTask = {
      id: 'task_ext_fail',
      characterId: 'ch-1',
      prompt: '外部任务',
      status: 'running',
      createdAt: 1,
      startedAt: 2,
      endedAt: null,
      output: '',
    };
    emitWorldEvent({ type: 'task.failed', task: { ...task, status: 'failed', endedAt: 3, output: '外部原因' } });
    await flush();
    exp.stop();

    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({ id: 'task_ext_fail', status: 'failed', output: '外部原因' });
    expect(exp.events).toEqual([
      { type: 'exp.gained', characterId: 'ch-1', source: 'task_failed', amount: DEFAULT_EXP_WEIGHTS.task_failed },
    ]);
  });
});

// ============================================================================
// 流式输出转发端口：onTaskChunk（task_046 —— hud 任务输出面板的实时 tail 视图）
// ============================================================================

describe('流式转发：onTaskChunk 端口（task_046）', () => {
  test('message 事件的 chunk 按到达顺序转发（与 output 拼接同一顺序）', async () => {
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'session', sessionId: 'one-shot' },
          { type: 'message', text: '第一段' },
          { type: 'message', text: '第二段' },
          { type: 'done', exitCode: 0, text: '第一段第二段', sessionId: null }
        ),
      ],
    });
    assign(h, '流式任务');
    await flush();

    expect(h.chunks).toEqual([
      { characterId: 'ch-1', chunk: '第一段' },
      { characterId: 'ch-1', chunk: '第二段' },
    ]);
    // 终态全文 = 转发 chunk 的拼接（同一份数据，两条出口）
    expect(h.settled[0]?.output).toBe(h.chunks.map((c) => c.chunk).join(''));
  });

  test('session / tool_use / tool_result 不转发（任务结果只收 message 文本）', async () => {
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'session', sessionId: 'one-shot' },
          { type: 'tool_use', tool: 'Bash', input: {}, id: 't1' },
          { type: 'tool_result', tool: 'Bash', text: '工具回执', id: 't1' },
          { type: 'message', text: '结论' },
          { type: 'done', exitCode: 0, text: '结论', sessionId: null }
        ),
      ],
    });
    assign(h, '带工具调用的任务');
    await flush();

    expect(h.chunks).toEqual([{ characterId: 'ch-1', chunk: '结论' }]);
  });

  test('多角色并行：chunk 各归各的 characterId（互不串台）', async () => {
    const h = makeHarness({
      scripts: [
        async function* script() {
          yield { type: 'message', text: '甲的流' } as TransportEvent;
          await new Promise((r) => setTimeout(r, 5)); // 微压栈，让两条执行交错
          yield { type: 'done', exitCode: 0, text: '甲的流', sessionId: null } as TransportEvent;
        },
        async function* script() {
          yield { type: 'message', text: '乙的流' } as TransportEvent;
          yield { type: 'done', exitCode: 0, text: '乙的流', sessionId: null } as TransportEvent;
        },
      ],
    });
    assign(h, '甲的任务', 'ch-1');
    assign(h, '乙的任务', 'ch-2');
    await flush();

    const byCharacter = new Map(h.chunks.map((c) => [c.characterId, c.chunk]));
    expect(byCharacter.get('ch-1')).toBe('甲的流');
    expect(byCharacter.get('ch-2')).toBe('乙的流');
  });

  test('回调抛错不绑架执行回路：任务照常 completed，后续 chunk 照常转发', async () => {
    const received: string[] = [];
    let calls = 0;
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'message', text: '第一段' },
          { type: 'message', text: '第二段' },
          { type: 'done', exitCode: 0, text: '第一段第二段', sessionId: null }
        ),
      ],
      onTaskChunk: (characterId, chunk) => {
        calls += 1;
        if (calls === 1) throw new Error('观察口炸了');
        received.push(chunk);
      },
    });
    assign(h, '抛错也要跑完');
    await flush();

    expect(calls).toBe(2); // 第一次抛了，第二次照转（fire-and-forget）
    expect(received).toEqual(['第二段']);
    expect(h.settled[0]).toMatchObject({ status: 'completed', output: '第一段第二段' });
  });

  test('守门拦截的任务（从未进 transport）零转发', async () => {
    const h = makeHarness({ detected: [] }); // agent 未检出 → 出队即 failed
    assign(h, '注定跑不起来的任务');
    await flush();

    expect(h.chunks).toEqual([]);
    expect(h.settled[0]).toMatchObject({ status: 'failed' });
  });
});

// ============================================================================
// 成果物解析落列（task_048）
// ============================================================================

describe('成果物解析落列：completed 才携带 artifacts（task_048）', () => {
  const DIFF_OUTPUT = [
    '我来处理这个任务。',
    '',
    'diff --git a/src/a.ts b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    '-old line',
    '+new line',
    '+extra line',
    '',
    '已完成修改，测试通过。',
  ].join('\n');

  test('done 全文可解析 → completed 落库记录与 settled 回调都带 artifacts JSON', async () => {
    const h = makeHarness({
      scripts: [scripted({ type: 'message', text: DIFF_OUTPUT }, { type: 'done', exitCode: 0, text: DIFF_OUTPUT, sessionId: null })],
    });
    assign(h, '改两个文件');
    await flush();

    const final = h.persisted.at(-1)!;
    expect(final.status).toBe('completed');
    const artifacts = parseTaskArtifactsJson(final.artifacts);
    expect(artifacts?.files).toEqual([{ path: 'src/a.ts', added: 2, removed: 1 }]);
    expect(artifacts?.summary).toBe('已完成修改，测试通过。');
    // settled 回调携带同一份序列化串（消费方 task-report / 面板各自反序列化）
    expect(h.settled[0].artifacts).toBe(final.artifacts);
  });

  test('前置快照（queued / running）不解析不带字段 —— 成果物只在 completed 有意义', async () => {
    // 挂起脚本：吐一段 message 后卡住（执行停在 running），此刻已落 queued + running 两段快照。
    const stuck = gated(
      [{ type: 'message', text: 'working' }],
      [{ type: 'done', exitCode: 0, text: '干完了', sessionId: null }]
    );
    const h = makeHarness({ scripts: [stuck.script] });
    assign(h, '干活');
    await flush();
    const statuses = h.persisted.map((r) => r.status);
    expect(statuses).toEqual(expect.arrayContaining(['queued', 'running']));
    for (const record of h.persisted) {
      if (record.status !== 'completed') expect(record.artifacts).toBeUndefined();
    }
  });

  test('纯叙述输出（解析不出文件）→ artifacts 缺省（空串不占字段，报告格式不变）', async () => {
    const h = makeHarness({
      scripts: [scripted({ type: 'done', exitCode: 0, text: '北门无敌情，一切正常。', sessionId: null })],
    });
    assign(h, '侦察北门');
    await flush();
    expect(h.persisted.at(-1)!.status).toBe('completed');
    expect(h.persisted.at(-1)!.artifacts).toBeUndefined();
  });

  test('failed 不带 artifacts（没产出，不是产出不明）', async () => {
    const h = makeHarness({ detected: [], scripts: [scripted()] });
    assign(h, '干活');
    await flush();
    expect(h.persisted.at(-1)!.status).toBe('failed');
    expect(h.persisted.at(-1)!.artifacts).toBeUndefined();
  });
});


// ============================================================================
// 审批门（task_049）：plan-first 挂起 / 批准续发 / 驳回落位
// ============================================================================

describe('buildTaskPrompt：plan-first 追加计划指令', () => {
  test('plan-first 人设 → 尾部追加【工作方式】节（含标记词与「单独一行」约束）', () => {
    const prompt = buildTaskPrompt(planFirstCharacter, '重构登录模块');
    expect(prompt).toContain('【任务指令】');
    expect(prompt.indexOf('【任务指令】')).toBeLessThan(prompt.indexOf('【工作方式】'));
    expect(prompt.endsWith(TASK_PLAN_INSTRUCTION)).toBe(true);
    expect(TASK_PLAN_INSTRUCTION).toContain('PLAN_WAIT');
    expect(TASK_PLAN_INSTRUCTION).toContain('单独一行');
  });

  test('普通人设不追加（没声明就不走门 —— 指令是协议义务，不能强加）', () => {
    const prompt = buildTaskPrompt(character, '干活');
    expect(prompt).not.toContain('PLAN_WAIT');
    expect(prompt).not.toContain('【工作方式】');
  });

  test('persona 空的 plan-first 退化为纯指令（空 persona 无从判定，也不内嵌）', () => {
    expect(buildTaskPrompt({ ...planFirstCharacter, persona: '   ' }, '干活')).toBe('干活');
  });
});

describe('extractPlanDraft：挂起检测与标记剥离（纯函数）', () => {
  test('独占一行的标记命中（容忍前后空白 / CRLF）；返回剥离后 trim 的计划草稿', () => {
    const output = '一、摸底\r\n二、动手\r\n  PLAN_WAIT  \r\n';
    expect(extractPlanDraft(output)).toBe('一、摸底\n二、动手');
  });

  test('多个标记行全部剥离；标记在中间也命中（后面的文本留在草稿里）', () => {
    expect(extractPlanDraft('PLAN_WAIT\n计划\nPLAN_WAIT')).toBe('计划');
    expect(extractPlanDraft('前半\nPLAN_WAIT\n后半')).toBe('前半\n后半');
  });

  test('空计划也挂起（空串草稿 —— 空卡自然会被驳回，检测不越权裁决）', () => {
    expect(extractPlanDraft('PLAN_WAIT\n')).toBe('');
  });

  test('没标记行 → null（普通收尾）；写进句子里的不算（必须是独占一行）', () => {
    expect(extractPlanDraft('计划如下：先 PLAN_WAIT 再继续')).toBeNull();
    expect(extractPlanDraft('正常输出，没有标记')).toBeNull();
    expect(extractPlanDraft('')).toBeNull();
  });
});

/** plan-first 标准计划轮脚本：session 事件 + 计划正文 + 标记行 + done（带 sessionId）。 */
function planRoundScript(): Script {
  return scripted(
    { type: 'session', sessionId: 'plan-sess-7' },
    { type: 'message', text: '一、摸底。\n二、动手。\nPLAN_WAIT\n' },
    { type: 'done', exitCode: 0, text: '一、摸底。\n二、动手。\nPLAN_WAIT\n', sessionId: 'plan-sess-7' }
  );
}

describe('审批门全链（plan-first：挂起 → 批准 → 同 session 续发 → 完成）', () => {
  test('计划轮结束 → awaiting_approval：plan 剥离标记存档、事件面、占位（队列不前进）', async () => {
    const h = makeHarness({ characters: [planFirstCharacter], scripts: [planRoundScript()] });
    const events: string[] = [];
    const off = onWorldEvent((event) => {
      if (event.type.startsWith('task.')) events.push(event.type);
    });

    const task = assign(h, '重构登录模块', 'ch-3');
    await flush();

    // 状态：awaiting_approval，plan 已剥离标记行
    const stored = h.store.getState().tasks![0];
    expect(stored).toMatchObject({ status: 'awaiting_approval' });
    expect(stored.plan).toBe('一、摸底。\n二、动手。');
    expect(stored.plan).not.toContain('PLAN_WAIT');
    expect(stored.output).toBe(''); // 挂起相位无摘要（计划全文在 plan 字段）

    // 事件面：三条生命周期事件齐发，没有 completed / failed（挂起不是终态）。
    // 顺序不锁：task.queued 的订阅回调里 pump 同步 startTask —— started 可能先于 queued
    // 落到本订阅者（总线是同步广播，订阅顺序决定次序；锁顺序等于锁实现细节）。
    expect(events).toEqual(expect.arrayContaining(['task.queued', 'task.started', 'task.awaiting_approval']));
    expect(events).not.toContain('task.completed');
    expect(events).not.toContain('task.failed');

    // 落库：queued → running → awaiting（output=计划全文，plan 列同存）
    expect(h.persisted.map((r) => r.status)).toEqual(['queued', 'running', 'awaiting_approval']);
    const awaitingRecord = h.persisted.at(-1)!;
    expect(awaitingRecord.output).toBe('一、摸底。\n二、动手。');
    expect(awaitingRecord.plan).toBe('一、摸底。\n二、动手。');

    // 不 settle（挂起不是终态：无回流、无 exp）
    expect(h.settled).toHaveLength(0);

    // 占位：再派一条 → 排队不动（审批门占着执行位，busy 不释放）
    const second = h.manager.assignTask({ characterId: 'ch-3', prompt: '下一件事' });
    expect(second).not.toBeNull();
    await flush();
    expect(h.calls).toHaveLength(1); // 只有计划轮一次 spawn
    expect(h.store.getState().tasks!.find((t) => t.id === second!.id)?.status).toBe('queued');
    off();
  });

  test('批准 → 同 session 续发短指令（不重嵌 persona）→ 完成收尾 + 队列续泵', async () => {
    const h = makeHarness({
      characters: [planFirstCharacter],
      scripts: [
        planRoundScript(),
        scripted(
          { type: 'session', sessionId: 'plan-sess-7' },
          { type: 'message', text: '按计划做完了。' },
          { type: 'done', exitCode: 0, text: '按计划做完了。', sessionId: 'plan-sess-7' }
        ),
        scripted({ type: 'done', exitCode: 0, text: '下一件事完成。', sessionId: null }),
      ],
    });
    const task = assign(h, '重构登录模块', 'ch-3');
    await flush();

    // 批准走命令同款落点（runtime 的 task.approve 就是调 manager.approveTask）
    h.manager.approveTask(task.id);
    await flush();

    // 续发：同 session + 短指令（persona / 计划都在会话上下文里，不重述）
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].options?.sessionId).toBe('plan-sess-7');
    expect(h.calls[1].prompt).toBe(TASK_APPROVAL_RESUME_PROMPT);
    expect(h.calls[1].prompt).not.toContain('角色设定');

    // 完成：状态摘要 + 全文落库 + plan 溯源存档 + settle 一次
    const stored = h.store.getState().tasks!.find((t) => t.id === task.id);
    expect(stored).toMatchObject({ status: 'completed', output: '按计划做完了。' });
    const finalRecord = h.persisted.filter((r) => r.id === task.id).at(-1)!;
    expect(finalRecord.status).toBe('completed');
    expect(finalRecord.output).toBe('按计划做完了。');
    expect(finalRecord.plan).toBe('一、摸底。\n二、动手。'); // 这单是按哪份计划做完的
    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({ id: task.id, status: 'completed' });

    // 队列续泵：占位期间排队的下一条已开跑
    const second = h.manager.assignTask({ characterId: 'ch-3', prompt: '下一件事' });
    await flush();
    expect(h.calls).toHaveLength(3);
    expect(second).not.toBeNull();
  });

  test('驳回 → failed(rejected)：output 写死、计划存档、占位释放 + 队列续泵', async () => {
    const h = makeHarness({
      characters: [planFirstCharacter],
      scripts: [planRoundScript(), scripted({ type: 'done', exitCode: 0, text: '下一件事完成。', sessionId: null })],
    });
    const task = assign(h, '重构登录模块', 'ch-3');
    await flush();
    expect(h.store.getState().tasks![0].status).toBe('awaiting_approval');

    const second = h.manager.assignTask({ characterId: 'ch-3', prompt: '下一件事' });
    h.manager.rejectTask(task.id);
    await flush();

    // 驳回落位：failed + 计划存档（task.plan 随失败快照留在库里可回看）
    const stored = h.store.getState().tasks!.find((t) => t.id === task.id)!;
    expect(stored).toMatchObject({ status: 'failed', output: '计划被驳回' });
    expect(stored.plan).toBe('一、摸底。\n二、动手。');
    const failedRecord = h.persisted.filter((r) => r.id === task.id).at(-1)!;
    expect(failedRecord).toMatchObject({ status: 'failed', output: '计划被驳回' });
    expect(failedRecord.plan).toBe('一、摸底。\n二、动手。');

    // settle 走 task_failed（计划轮也是跑过的产出，「做过就有收获」）；只看本任务的回流
    //（驳回释放占位后下一条已接力完成，也各有一条 —— FIFO 不因审批门停摆）
    const mine = h.settled.filter((r) => r.id === task.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'failed', output: '计划被驳回' });

    // 占位释放：排队的下一条已开跑
    expect(h.calls).toHaveLength(2);
    expect(second).not.toBeNull();
  });

  test('session 丢失（CLI 未回 / 无 session 事件）→ 续发退回首发拼装（persona + 计划全文重述）', async () => {
    const h = makeHarness({
      characters: [planFirstCharacter],
      scripts: [
        scripted(
          { type: 'message', text: '计划A\nPLAN_WAIT\n' },
          { type: 'done', exitCode: 0, text: '计划A\nPLAN_WAIT\n', sessionId: null }
        ),
        scripted({ type: 'done', exitCode: 0, text: '干完了。', sessionId: null }),
      ],
    });
    const task = assign(h, '干活', 'ch-3');
    await flush();
    expect(h.store.getState().tasks![0].status).toBe('awaiting_approval');

    h.manager.approveTask(task.id);
    await flush();

    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].options?.sessionId ?? null).toBeNull(); // 无会话可复用
    const stored = h.store.getState().tasks![0];
    // 退回首发语义：persona 内嵌 + 计划全文重述（与 035 会话延续的 fallback 同口径）
    expect(h.calls[1].prompt).toBe(buildResumedTaskPrompt(planFirstCharacter, stored, '计划A'));
    expect(h.calls[1].prompt).toContain('参谋长');
    expect(h.calls[1].prompt).toContain('计划A');
    expect(h.store.getState().tasks![0].status).toBe('completed');
  });

  test('普通人设碰巧输出标记行 → 不走门（没指令就没有协议义务），普通完成收尾', async () => {
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'message', text: '报告里提到了 PLAN_WAIT\n' },
          { type: 'done', exitCode: 0, text: '报告里提到了 PLAN_WAIT\n', sessionId: null }
        ),
      ],
    });
    assign(h, '写报告');
    await flush();
    expect(h.store.getState().tasks![0].status).toBe('completed');
    expect(h.store.getState().tasks![0].plan).toBeUndefined();
    expect(h.persisted.filter((r) => r.status === 'awaiting_approval')).toHaveLength(0);
  });

  test('重启丢失挂单（内存态）后被批准 → failed 兑底，不留无人驾驶的 running', async () => {
    const h = makeHarness({ characters: [planFirstCharacter], scripts: [planRoundScript()] });
    const task = assign(h, '重构登录模块', 'ch-3');
    await flush();
    expect(h.store.getState().tasks![0].status).toBe('awaiting_approval');

    // 模拟重启：停掉服务（挂单表随之消失，挂起快照已在库里），再起一个新服务实例
    harnessStops.splice(0).forEach((stop) => stop());
    const factory = makeFactory([scripted()]);
    const persisted: TaskPersistRecord[] = [];
    const settled: TaskPersistRecord[] = [];
    const restarted: TaskService = createTaskService({
      getState: () => h.store.getState(),
      createTransport: factory.factory,
      taskManager: h.manager,
      persistTask: (record) => persisted.push(record),
      onTaskSettled: (record) => settled.push(record),
      timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
    });
    harnessStops.push(restarted.start());

    h.manager.approveTask(task.id);
    await flush();

    // 找不到挂单 → failTask 兑底（诚实报错比挂着假装在跑好）
    const stored = h.store.getState().tasks!.find((t) => t.id === task.id);
    expect(stored).toMatchObject({ status: 'failed', output: TASK_MSG_RESUME_LOST });
    expect(settled).toHaveLength(1);
    expect(factory.calls).toHaveLength(0); // 没有人真的续发
  });
});
