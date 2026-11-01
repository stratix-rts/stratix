/**
 * 文件职责：service 进程侧任务执行环（service-split A2 / task_078）的单测 —— 覆盖验收要求的
 *   三条路径 + 一条全链集成：
 *   ① 出队顺序 —— 同一角色的多条任务按 FIFO 依次出队；
 *   ② 并发 1 —— 同一角色同一时刻只有一轮在跑（后一条排队等着）；
 *   ③ 终态回报 —— completed 落状态 + 回流回调带全文 + exp.gained 发出；
 *   ④ 集成 —— fake CLI adapter（echo 型测试替身）跑通 assign → queued → running → completed，
 *      全程在 service 进程内：**子进程由 cli-transport 的 node-process 工厂直接拉起**
 *      （echo 输出里带 ppid —— 断言它就是本进程，证明没有中间一跳的 IPC 链路）。
 * 输入：无（自足单测；store 用 createStore() 隔离世界态，总线用 resetBus() 隔离订阅）。
 * 输出：断言失败即红。
 * 禁止事项：
 *   1. 引入渲染层 / Electron 依赖 —— 被测链路必须能脱离渲染进程跑；
 *   2. 直接改 store 来"造"任务状态 —— 任务必须经 manager.assignTask 落地（真实通路）；
 *   3. 用真 CLI（claude / codex …）跑测试 —— 用 echo 型 fake adapter 代替（任务明确允许的测试替身）。
 */

import { onWorldEvent, resetBus } from '../../../core/bus';
import { createStore, type CoreStore } from '../../../core/store';
import type { CharacterTask, ExpSource, WorldEvent } from '../../../core/types';
import { createCliTransport } from '../../../app/services/cli-transport/runtime';
import { createNodeProcessFactory } from '../../../app/services/cli-transport/node-process';
import type { CliAdapter, TransportEvent } from '../../../app/services/cli-transport/transport';
import type { TaskPersistRecord, TaskTransportFactory } from '../../../app/services/task-service';
import { createStratixService, type StratixService } from '../stratix-service';

// ============================================================================
// 夹具
// ============================================================================

/** 一次 spawn 的记账（prompt = 执行环拼装后的完整指令）。 */
interface SpawnRecord {
  readonly prompt: string;
}

/** spawn 脚本：按 prompt 产出一条事件流。 */
type SpawnScript = (prompt: string) => AsyncGenerator<TransportEvent>;

/** echo 型脚本：把 prompt 原样吐回来，然后收尾。 */
async function* echoScript(prompt: string): AsyncGenerator<TransportEvent> {
  yield { type: 'message', text: `echo:${prompt}` };
  yield { type: 'done', exitCode: 0, text: `echo:${prompt}`, sessionId: null };
}

/**
 * 挂起脚本：吐一条 message 后**卡住**，等外部 release 才收尾 —— 用来把执行「钉在半路」
 * 验并发纪律（同一角色不该有第二轮在跑）。
 */
function gatedScript(): { script: SpawnScript; release: () => void } {
  let resolveRelease: () => void = () => { /* 占位（构造时立刻被替换） */ };
  const released = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const script: SpawnScript = async function* (prompt: string): AsyncGenerator<TransportEvent> {
    yield { type: 'message', text: `echo:${prompt}` };
    await released;
    yield { type: 'done', exitCode: 0, text: `echo:${prompt}`, sessionId: null };
  };
  return { script, release: () => resolveRelease() };
}

/** 打桩 transport 工厂：记下每次 spawn 的 prompt，按脚本吐事件。 */
function makeFactory(script: SpawnScript): { factory: TaskTransportFactory; calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = [];
  const factory: TaskTransportFactory = () => ({
    spawn: (prompt: string): AsyncIterable<TransportEvent> => {
      calls.push({ prompt });
      const run = script(prompt);
      return { [Symbol.asyncIterator]: () => run };
    },
  });
  return { factory, calls };
}

interface Harness {
  readonly service: StratixService;
  readonly store: CoreStore;
  readonly characterId: string;
  readonly calls: SpawnRecord[];
  /** 终态回流记录（onTaskSettled 收到的，带全文输出）。 */
  readonly settled: TaskPersistRecord[];
  /** 经验事件（exp.gained）记账。 */
  readonly exps: Array<{ characterId: string; source: ExpSource; amount: number }>;
  /** 总线上看到的任务生命周期事件类型（queued / started / completed ...）。 */
  readonly events: WorldEvent[];
  assign(prompt: string): CharacterTask;
}

interface HarnessOptions {
  readonly script?: SpawnScript;
  /** transport 工厂覆盖（集成测用真 node-process 工厂 + echo adapter）。 */
  readonly createTransport?: TaskTransportFactory;
}

/** 起一个 service（执行环已接）+ 一个在档角色 + 一条「已装 claude-code」的检出记录。 */
function makeHarness(options: HarnessOptions = {}): Harness {
  const store = createStore();
  const { factory, calls } = makeFactory(options.script ?? echoScript);
  const settled: TaskPersistRecord[] = [];
  const exps: Array<{ characterId: string; source: ExpSource; amount: number }> = [];
  const events: WorldEvent[] = [];

  const off = onWorldEvent((event) => {
    events.push(event);
    if (event.type === 'exp.gained') {
      exps.push({ characterId: event.characterId, source: event.source, amount: event.amount });
    }
  });

  const service = createStratixService({
    store,
    taskExecution: {
      createTransport: options.createTransport ?? factory,
      onTaskSettled: (record) => settled.push(record),
    },
  });

  const created = service.character.createCharacter({
    name: '阿尔法',
    agentKind: 'claude-code',
    skinId: 'skin-default',
    persona: '冷静的战术分析师。',
  });
  if (!created.ok) throw new Error(`建档失败：${created.code}`);
  const characterId = created.character.id;

  // 出队守门读 WorldState.detectedAgents（真相源 = store）。生产里由探测器写入
  // （service 侧的探测接线归 A4），这里直接写「已装」这一条 —— 走的是真实写入口。
  store.setDetectedAgents([
    { kind: 'claude-code', tier: 'T1', installed: true, status: 'installed', version: null, path: null },
  ]);

  return {
    service,
    store,
    characterId,
    calls,
    settled,
    exps,
    events,
    assign: (prompt: string): CharacterTask => {
      const task = service.task.assignTask({ characterId, prompt });
      if (!task) throw new Error('派发失败');
      return task;
    },
  };
}

/** 等条件成立（执行环是 fire-and-forget 的异步链路，只能靠条件轮询推进）。 */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** 让微任务跑几拍（纯微任务链路用；真实子进程那侧用 waitFor）。 */
async function flush(times = 24): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

// ============================================================================
// 用例
// ============================================================================

describe('service 侧任务执行环（service-split A2）', () => {
  let stops: Array<() => void> = [];

  beforeEach(() => {
    resetBus();
    stops = [];
  });

  afterEach(() => {
    stops.forEach((stop) => stop());
    resetBus();
  });

  it('出队顺序：同一角色的多条任务按 FIFO 依次出队', async () => {
    const h = makeHarness();
    stops.push(() => h.service.stop());

    h.assign('任务甲');
    h.assign('任务乙');
    h.assign('任务丙');

    await waitFor(() => h.calls.length === 3, '三条任务都出过队');

    expect(h.calls[0]?.prompt).toContain('任务甲');
    expect(h.calls[1]?.prompt).toContain('任务乙');
    expect(h.calls[2]?.prompt).toContain('任务丙');
  });

  it('并发 1：同一角色同时只有一轮在跑（后一条排队等着）', async () => {
    const gated = gatedScript();
    const h = makeHarness({ script: gated.script });
    stops.push(() => h.service.stop());

    h.assign('第一条');
    h.assign('第二条');
    await flush();

    // 第一条还卡在半路 —— 第二条不许出队（busy 未释放）。
    expect(h.calls).toHaveLength(1);
    expect(h.service.taskService?.isBusy(h.characterId)).toBe(true);
    expect(h.service.taskService?.queueLength(h.characterId)).toBe(1);

    gated.release();
    await waitFor(() => h.calls.length === 2, '第一条收尾后第二条出队');

    expect(h.calls[1]?.prompt).toContain('第二条');
  });

  it('终态回报：completed 落状态 + 回流回调带全文 + exp.gained 发出', async () => {
    const h = makeHarness();
    stops.push(() => h.service.stop());

    const task = h.assign('把仓库理一理');

    await waitFor(() => h.settled.length === 1, '任务收尾');

    // 状态：completed（状态里只有摘要）。
    const stored = (h.store.getState().tasks ?? []).find((item) => item.id === task.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.output).toContain('echo:');

    // 回流：带**全文**输出（库里存全文，状态里只存摘要 —— 口径与渲染侧一致）。
    expect(h.settled[0]?.status).toBe('completed');
    expect(h.settled[0]?.output).toContain('把仓库理一理');

    // 经验：完成也发（"做过就有收获"）。
    expect(h.exps).toEqual([
      { characterId: h.characterId, source: 'task_completed', amount: expect.any(Number) },
    ]);
  });

  it('集成：echo 型 fake adapter 跑通 assign → queued → running → completed（service 进程内直连，无 IPC）', async () => {
    // echo adapter：真 adapter 形状（拼参数 + 解析），但二进制换成本进程自己（node）。
    // 走的是**真的** node-process 工厂 —— 子进程由 service 进程直接拉起，不是经某个 IPC 桥。
    const echoAdapter: CliAdapter = {
      kind: 'claude-code',
      binary: process.execPath,
      outputMode: 'text',
      buildArgs: (prompt: string) => [
        '-e',
        `process.stdout.write(${JSON.stringify(`echo:${prompt}`)} + '|ppid:' + process.ppid)`,
      ],
      parseLine: () => [],
    };
    const createTransport: TaskTransportFactory = () =>
      createCliTransport(echoAdapter, { factory: createNodeProcessFactory() });

    const h = makeHarness({ createTransport });
    stops.push(() => h.service.stop());

    const task = h.assign('在 service 进程里干活');

    await waitFor(() => h.settled.length === 1, '任务跑完', 15000);

    // 全链事件（queued → started → completed 都在总线上过了一遍）。
    const types = h.events.map((event) => event.type);
    expect(types).toContain('task.queued');
    expect(types).toContain('task.started');
    expect(types).toContain('task.completed');

    // 终态：状态落 completed，回流带全文。
    const stored = (h.store.getState().tasks ?? []).find((item) => item.id === task.id);
    expect(stored?.status).toBe('completed');
    expect(h.settled[0]?.status).toBe('completed');
    expect(h.settled[0]?.output).toContain('在 service 进程里干活');

    // 子进程的父进程 = 本进程（测试进程）—— 没有中间一跳（Electron main / IPC 桥）。
    expect(h.settled[0]?.output).toContain(`|ppid:${process.pid}`);
  });

  it('未接执行环时：任务只落 queued（不假装有人在执行）', async () => {
    const store = createStore();
    const warnings: string[] = [];
    const service = createStratixService({
      store,
      logger: (line) => warnings.push(line),
    });
    stops.push(() => service.stop());

    const created = service.character.createCharacter({
      name: '贝塔',
      agentKind: 'claude-code',
      skinId: 'skin-default',
    });
    if (!created.ok) throw new Error(`建档失败：${created.code}`);
    store.setDetectedAgents([
      { kind: 'claude-code', tier: 'T1', installed: true, status: 'installed', version: null, path: null },
    ]);

    const task = service.task.assignTask({ characterId: created.character.id, prompt: '没人跑' });

    expect(task?.status).toBe('queued');
    expect(service.taskService).toBeNull();
    expect(warnings.some((line) => line.includes('未接任务执行环'))).toBe(true);
  });
});
