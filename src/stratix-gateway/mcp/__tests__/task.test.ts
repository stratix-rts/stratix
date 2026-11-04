/**
 * 文件职责：`stratix_task_assign` / `stratix_task_status` / `stratix_task_cancel` 的单测 ——
 *   受理回执、origin 标注、守门前置、include_output 两档、排队取消的相位限制。
 * 输入：真实 core 运行时（createCoreRuntime + createStore）+ core 总线（emitCommand）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不打桩 core —— 派单必须真的过一遍 core 状态机（否则测的是"回执长得对"，不是"派单真的发生了"）；
 *   2. 不复用全局 worldStore —— 每个用例一份隔离的 store，跑完即弃。
 */

import { emitCommand } from '../../../core/bus';
import { createCoreRuntime } from '../../../core/runtime';
import { createStore, type CoreStore } from '../../../core/store';
import { createTaskManager } from '../../../core/task';
import type { WorldState } from '../../../core/types';
import { createCoreMcpHost, type CoreMcpHostOptions } from '../context';
import { McpToolError } from '../envelope';
import { taskAssignTool, taskCancelTool, taskStatusTool } from '../tools/task';
import type { McpHost } from '../types';

function makeStore(overrides: Partial<WorldState> = {}): CoreStore {
  return createStore({
    characters: [
      {
        id: 'ch_kimi',
        name: 'Kimi',
        persona: '你是 Kimi',
        level: 7,
        experience: 120,
        agentKind: 'kimi',
      },
    ],
    detectedAgents: [
      {
        kind: 'kimi',
        tier: 'T1',
        installed: true,
        status: 'installed',
        version: '1.0.0',
        path: '/usr/local/bin/kimi',
      },
    ],
    units: [
      {
        id: 'unit_kimi',
        name: 'Kimi',
        status: 'idle',
        missionId: null,
        power: 0,
        characterId: 'ch_kimi',
        online: true,
      },
    ],
    tasks: [],
    missions: [],
    ...overrides,
  });
}

interface AssignData {
  task_id: string;
  character: { id: string; name: string; agent_kind: string | null };
  status: string;
  mission_id: string | null;
  origin: string;
  timeout_ms: number;
  queued_at: number;
  poll: { tool: string; args: { task_id: string } };
}

interface StatusData {
  task_id: string;
  character: { id: string; name: string | null };
  status: string;
  mission_id: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  output: string;
  output_truncated: boolean;
  plan: string | null;
  poll: { tool: string; args: { task_id: string } };
}

interface CancelData {
  task_id: string;
  status: string;
  previous_status: string;
  output: string;
  poll: { tool: string; args: { task_id: string } };
}

async function callAssign(
  host: McpHost,
  args: Record<string, unknown>
): Promise<AssignData> {
  const result = await taskAssignTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: AssignData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

async function callStatus(
  host: McpHost,
  args: Record<string, unknown>
): Promise<StatusData> {
  const result = await taskStatusTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: StatusData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

async function callCancel(
  host: McpHost,
  args: Record<string, unknown>
): Promise<CancelData> {
  const result = await taskCancelTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: CancelData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

describe('stratix_task_assign / stratix_task_status', () => {
  let store: CoreStore;
  let stopRuntime: () => void;
  let fullOutputs: Map<string, string>;

  beforeEach(() => {
    store = makeStore();
    fullOutputs = new Map<string, string>();
    const runtime = createCoreRuntime({ store });
    stopRuntime = runtime.start();
  });

  afterEach(() => {
    stopRuntime();
  });

  const makeHost = (overrides: Partial<CoreMcpHostOptions> = {}): McpHost =>
    createCoreMcpHost({
      store,
      dispatch: emitCommand,
      readTaskOutput: async (taskId: string) => fullOutputs.get(taskId) ?? null,
      ...overrides,
    });

  it('派单落进 core 状态，回执含标识 + 角色 + 状态 + 查法', async () => {
    const host = makeHost();
    const data = await callAssign(host, { character: 'ch_kimi', prompt: '  补一条单测  ' });

    expect(data.task_id).toMatch(/^task_/);
    expect(data.status).toBe('queued');
    expect(data.character).toEqual({ id: 'ch_kimi', name: 'Kimi', agent_kind: 'kimi' });
    expect(data.mission_id).toBeNull();
    expect(data.timeout_ms).toBe(600000);
    expect(typeof data.queued_at).toBe('number');
    expect(data.poll).toEqual({
      tool: 'stratix_task_status',
      args: { task_id: data.task_id },
    });

    // 真的派出去了：任务落在 core 的世界态里（core 状态机裁决的结果，不是回执自说自话）。
    const tasks = store.getState().tasks ?? [];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: data.task_id,
      characterId: 'ch_kimi',
      status: 'queued',
      prompt: '补一条单测',
    });
  });

  it('origin 缺省记 mcp，显式传 agent 记 agent，显式传 ui 被拒', async () => {
    const host = makeHost();

    const defaulted = await callAssign(host, { character: 'ch_kimi', prompt: '单子 A' });
    expect(defaulted.origin).toBe('mcp');

    const explicit = await callAssign(host, {
      character: 'ch_kimi',
      prompt: '单子 B',
      origin: 'agent',
    });
    expect(explicit.origin).toBe('agent');

    await expect(
      callAssign(host, { character: 'ch_kimi', prompt: '单子 C', origin: 'ui' })
    ).rejects.toBeInstanceOf(McpToolError);

    try {
      await callAssign(host, { character: 'ch_kimi', prompt: '单子 D', origin: 'ui' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('invalid_arguments');
    }
  });

  it('origin 显式传 mcp 也合法（与缺省同义；schema 的 default 必须在 enum 内）', async () => {
    const host = makeHost();

    const explicit = await callAssign(host, {
      character: 'ch_kimi',
      prompt: '显式标 mcp 的单子',
      origin: 'mcp',
    });
    expect(explicit.origin).toBe('mcp');
  });

  it('角色不在档 → unknown_character；未绑 agent → character_unbound', async () => {
    const host = makeHost();

    await expect(
      callAssign(host, { character: 'ch_ghost', prompt: '干活' })
    ).rejects.toBeInstanceOf(McpToolError);

    try {
      await callAssign(host, { character: 'ch_ghost', prompt: '干活' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('unknown_character');
    }

    const unboundStore = makeStore({
      characters: [
        {
          id: 'ch_kimi',
          name: 'Kimi',
          persona: '',
          level: 1,
          experience: 0,
          agentKind: null,
        },
      ],
    });
    const unboundHost = createCoreMcpHost({
      store: unboundStore,
      dispatch: emitCommand,
    });
    try {
      await callAssign(unboundHost, { character: 'ch_kimi', prompt: '干活' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('character_unbound');
    }
  });

  it('角色离线 → character_offline（可重试），不落到任务里', async () => {
    const offlineStore = makeStore({
      units: [
        {
          id: 'unit_kimi',
          name: 'Kimi',
          status: 'idle',
          missionId: null,
          power: 0,
          characterId: 'ch_kimi',
          online: false,
        },
      ],
    });
    const host = createCoreMcpHost({ store: offlineStore, dispatch: emitCommand });

    try {
      await callAssign(host, { character: 'ch_kimi', prompt: '干活' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('character_offline');
      expect((error as McpToolError).retryable).toBe(true);
    }
    expect(offlineStore.getState().tasks ?? []).toHaveLength(0);
  });

  it('命令没人接管时如实报 internal_error，不假装派单成功', async () => {
    // dispatch 换成空实现 = 总线无人消费这条命令（模拟"本进程没挂 core 运行时"）。
    const host = makeHost({ dispatch: () => { /* 无人消费 */ } });

    try {
      await callAssign(host, { character: 'ch_kimi', prompt: '干活' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('internal_error');
    }
  });

  it('include_output=false 回摘要，true 回全文（全文不可得时回落摘要并标 truncated）', async () => {
    const host = makeHost();
    const assigned = await callAssign(host, { character: 'ch_kimi', prompt: '干活' });

    // 走 core 状态机把任务推到终态（queued → running → completed）。
    const manager = createTaskManager({ store });
    manager.startTask(assigned.task_id);
    manager.completeTask(assigned.task_id, '这是一次执行结果的摘要');

    const summaryView = await callStatus(host, { task_id: assigned.task_id });
    expect(summaryView.status).toBe('completed');
    expect(summaryView.output).toBe('这是一次执行结果的摘要');
    expect(summaryView.output_truncated).toBe(false);
    expect(summaryView.started_at).not.toBeNull();
    expect(summaryView.ended_at).not.toBeNull();
    expect(summaryView.poll).toEqual({
      tool: 'stratix_task_status',
      args: { task_id: assigned.task_id },
    });

    // 库里没有全文 → 回摘要并如实标出"这是截断的"。
    const missingFull = await callStatus(host, {
      task_id: assigned.task_id,
      include_output: true,
    });
    expect(missingFull.output).toBe('这是一次执行结果的摘要');
    expect(missingFull.output_truncated).toBe(true);

    // 库里有全文 → 回全文。
    fullOutputs.set(assigned.task_id, '全文：包含 SQLite 里才有的执行明细');
    const fullView = await callStatus(host, {
      task_id: assigned.task_id,
      include_output: true,
    });
    expect(fullView.output).toBe('全文：包含 SQLite 里才有的执行明细');
    expect(fullView.output_truncated).toBe(false);
  });

  it('任务不存在 → task_not_found', async () => {
    const host = makeHost();
    try {
      await callStatus(host, { task_id: 'task_ghost' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('task_not_found');
    }
  });

  // ── mission_id 存在性校验（@since v3.8 / task_143）──
  it('mission_id 不存在 → mission_not_found（不可重试 + hint 指路），零副作用', async () => {
    const host = makeHost();
    const before = store.getState().tasks ?? [];

    try {
      await callAssign(host, {
        character: 'ch_kimi',
        prompt: '挂在一个不存在的编组任务上',
        mission_id: 'mission_R1_ID',
      });
      throw new Error('应当抛错');
    } catch (error) {
      const failure = error as McpToolError;
      expect(failure.code).toBe('mission_not_found');
      expect(failure.retryable).toBe(false);
      // hint 必须指向"真 id 从哪来"（mission_create 回执 / snapshot），不是一句"参数错了"。
      expect(failure.hint).toContain('stratix_mission_create');
      expect(failure.hint).toContain('stratix_world_snapshot');
    }

    // 零副作用：一条单都没建（不建任务 = 不派 CLI）。
    expect(store.getState().tasks ?? []).toHaveLength(before.length);
  });

  it('mission_id 存在 → 派单落地，回执回显该 id（真链路不回归）', async () => {
    const withMission = makeStore({
      missions: [
        { id: 'mission_ok_1', title: '真编组', phase: 'running', unitIds: [], createdAt: 1 },
      ],
    });
    const runtime = createCoreRuntime({ store: withMission });
    const stop = runtime.start();
    try {
      const host = createCoreMcpHost({ store: withMission, dispatch: emitCommand });
      const data = await callAssign(host, {
        character: 'ch_kimi',
        prompt: '挂在真编组上的单',
        mission_id: 'mission_ok_1',
      });
      expect(data.mission_id).toBe('mission_ok_1');
      // 真的挂上去了（core 状态里的 missionId 与回执一致 —— 不是回执自说自话）。
      expect(withMission.getState().tasks?.find((task) => task.id === data.task_id)?.missionId).toBe(
        'mission_ok_1'
      );
    } finally {
      stop();
    }
  });

  it('prompt 为空 / 超长 → invalid_arguments', async () => {
    const host = makeHost();
    await expect(callAssign(host, { character: 'ch_kimi', prompt: '   ' })).rejects.toBeInstanceOf(
      McpToolError
    );
    await expect(
      callAssign(host, { character: 'ch_kimi', prompt: 'x'.repeat(20001) })
    ).rejects.toBeInstanceOf(McpToolError);
  });
});

describe('stratix_task_cancel', () => {
  let store: CoreStore;
  let stopRuntime: () => void;

  beforeEach(() => {
    store = makeStore();
    const runtime = createCoreRuntime({ store });
    stopRuntime = runtime.start();
  });

  afterEach(() => {
    stopRuntime();
  });

  const makeHost = (overrides: Partial<CoreMcpHostOptions> = {}): McpHost =>
    createCoreMcpHost({ store, dispatch: emitCommand, ...overrides });

  it('queued 相位可取消：回执带落点、前相位与查法', async () => {
    const host = makeHost();
    const assigned = await callAssign(host, { character: 'ch_kimi', prompt: '派错了的单' });

    const data = await callCancel(host, { task_id: assigned.task_id });
    expect(data.task_id).toBe(assigned.task_id);
    expect(data.status).toBe('cancelled');
    expect(data.previous_status).toBe('queued');
    expect(data.output).toBe('任务在排队时被取消');
    expect(data.poll).toEqual({
      tool: 'stratix_task_status',
      args: { task_id: assigned.task_id },
    });

    // 真的取消了：core 世界态里的相位是 cancelled。
    expect(store.getState().tasks?.find((task) => task.id === assigned.task_id)?.status).toBe(
      'cancelled'
    );
  });

  it('running 相位不可取消 → task_not_cancellable（不强杀在跑的任务）', async () => {
    const host = makeHost();
    const assigned = await callAssign(host, { character: 'ch_kimi', prompt: '在跑的单' });

    // 走 core 状态机把任务推到 running（queued → running）。
    const manager = createTaskManager({ store });
    manager.startTask(assigned.task_id);

    try {
      await callCancel(host, { task_id: assigned.task_id });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('task_not_cancellable');
      expect((error as McpToolError).retryable).toBe(false);
    }
    // 状态没被改写。
    expect(store.getState().tasks?.find((task) => task.id === assigned.task_id)?.status).toBe(
      'running'
    );
  });

  it('终态不可取消：重复取消被状态机拒绝（幂等要求）', async () => {
    const host = makeHost();
    const assigned = await callAssign(host, { character: 'ch_kimi', prompt: '取消两次的单' });
    await callCancel(host, { task_id: assigned.task_id });

    try {
      await callCancel(host, { task_id: assigned.task_id });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('task_not_cancellable');
    }
    // 不会造出第二个实体。
    expect(store.getState().tasks).toHaveLength(1);
  });

  it('任务不存在 → task_not_found', async () => {
    const host = makeHost();
    try {
      await callCancel(host, { task_id: 'task_ghost' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('task_not_found');
    }
  });

  it('命令没人接管时如实报 internal_error（不假装取消成功）', async () => {
    // 先用正常通道派一条单（真的落进状态），再换一条没人消费的通道去取消。
    const assigned = await callAssign(makeHost(), { character: 'ch_kimi', prompt: '没人接的单' });

    const deadHost = makeHost({ dispatch: () => { /* 无人消费 */ } });
    try {
      await callCancel(deadHost, { task_id: assigned.task_id });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('internal_error');
    }
    // 任务仍在排队（没被"假装"取消）。
    expect(store.getState().tasks?.find((task) => task.id === assigned.task_id)?.status).toBe(
      'queued'
    );
  });
});
