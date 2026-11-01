/**
 * 文件职责：`stratix_mission_create` / `stratix_mission_status` 的单测 —— auto_confirm 合并语义、
 *   静默剔除单位、相位查询（单条 / 列表）。
 * 输入：真实 core 运行时（createCoreRuntime + createStore）+ core 总线（emitCommand）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不打桩 core —— 建任务必须真的过一遍 core 状态机（否则测的是"回执长得对"，
 *      不是"编组任务真的建出来并开工了"）；
 *   2. 不复用全局 worldStore —— 每个用例一份隔离的 store，跑完即弃。
 */

import { emitCommand } from '../../../core/bus';
import { createCoreRuntime } from '../../../core/runtime';
import { createStore, type CoreStore } from '../../../core/store';
import { MAX_MISSIONS, type WorldState } from '../../../core/types';
import { createCoreMcpHost, type CoreMcpHostOptions } from '../context';
import { McpToolError } from '../envelope';
import { missionCreateTool, missionStatusTool } from '../tools/mission';
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
      {
        id: 'ch_codex',
        name: 'Codex',
        persona: '你是 Codex',
        level: 5,
        experience: 40,
        agentKind: 'codex',
      },
    ],
    detectedAgents: [
      { kind: 'kimi', tier: 'T1', installed: true, status: 'installed', version: '1.0.0', path: '/bin/kimi' },
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
      {
        id: 'unit_codex',
        name: 'Codex',
        status: 'idle',
        missionId: null,
        power: 0,
        characterId: 'ch_codex',
        online: true,
      },
    ],
    missions: [],
    tasks: [],
    ...overrides,
  });
}

interface CreateData {
  mission_id: string;
  title: string;
  phase: string;
  auto_confirm_applied: boolean;
  units: Array<{ id: string; name: string | null }>;
  dropped_units: number;
  created_at: number;
  next: { tool: string; args: Record<string, unknown>; hint: string };
  poll: { tool: string; args: Record<string, unknown> };
}

interface StatusData {
  mission?: {
    id: string;
    title: string;
    phase: string;
    unit_count: number;
    created_at: number;
    units: Array<{ id: string; name: string | null }>;
  };
  tasks?: Array<{ id: string; character: { id: string; name: string | null }; status: string }>;
  task_totals?: { total: number; completed: number; running: number; failed: number };
  missions?: {
    returned: number;
    total: number;
    truncated: boolean;
    items: Array<{ id: string; title: string; phase: string; unit_count: number }>;
  };
}

async function callCreate(
  host: McpHost,
  args: Record<string, unknown>
): Promise<CreateData> {
  const result = await missionCreateTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: CreateData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

async function callStatus(
  host: McpHost,
  args: Record<string, unknown>
): Promise<StatusData> {
  const result = await missionStatusTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: StatusData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

describe('stratix_mission_create / stratix_mission_status', () => {
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

  it('auto_confirm=true：一次调用完成建任务→指派→接单开工，直接落到 running', async () => {
    const host = makeHost();
    const data = await callCreate(host, {
      title: '重构路由层',
      units: ['unit_kimi', 'unit_codex'],
    });

    expect(data.mission_id).toMatch(/^mission_/);
    expect(data.phase).toBe('running');
    expect(data.auto_confirm_applied).toBe(true);
    expect(data.dropped_units).toBe(0);
    expect(data.units).toEqual([
      { id: 'unit_kimi', name: 'Kimi' },
      { id: 'unit_codex', name: 'Codex' },
    ]);
    expect(data.next.tool).toBe('stratix_task_assign');
    expect(data.next.args).toEqual({ mission_id: data.mission_id });
    expect(data.poll).toEqual({
      tool: 'stratix_mission_status',
      args: { mission_id: data.mission_id },
    });

    // 真的建出来并开工了：编组任务落在 core 的世界态里（不是回执自说自话）。
    const mission = store.getState().missions.find((item) => item.id === data.mission_id);
    expect(mission).toMatchObject({ phase: 'running', title: '重构路由层' });
    expect(mission?.unitIds).toEqual(['unit_kimi', 'unit_codex']);
  });

  it('auto_confirm=false：任务停在 pending 待确认（不自己开工）', async () => {
    const host = makeHost();
    const data = await callCreate(host, {
      title: '待确认的编组',
      units: ['unit_kimi'],
      auto_confirm: false,
    });

    expect(data.phase).toBe('pending');
    expect(data.auto_confirm_applied).toBe(false);
    const mission = store.getState().missions.find((item) => item.id === data.mission_id);
    expect(mission?.phase).toBe('pending');
  });

  it('单位 id 不存在时静默剔除并在 dropped_units 里报数（不报错、不猜）', async () => {
    const host = makeHost();
    const data = await callCreate(host, {
      title: '带一个幽灵单位',
      units: ['unit_kimi', 'unit_ghost'],
    });

    expect(data.dropped_units).toBe(1);
    expect(data.units).toEqual([{ id: 'unit_kimi', name: 'Kimi' }]);
    expect(data.phase).toBe('running');
  });

  it('有效名单为空且 auto_confirm=true → illegal_transition（草稿任务不会自己开工）', async () => {
    const host = makeHost();
    try {
      await callCreate(host, { title: '全是不存在的单位', units: ['unit_ghost'] });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('illegal_transition');
      expect((error as McpToolError).retryable).toBe(false);
    }
  });

  it('title 为空 / 超长 → invalid_arguments', async () => {
    const host = makeHost();
    await expect(callCreate(host, { title: '   ' })).rejects.toBeInstanceOf(McpToolError);
    await expect(callCreate(host, { title: 'x'.repeat(201) })).rejects.toBeInstanceOf(McpToolError);

    try {
      await callCreate(host, { title: 'x'.repeat(201) });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('invalid_arguments');
    }
  });

  it('编组任务数已满 → mission_capacity_exceeded（可重试）', async () => {
    const full = makeStore({
      missions: Array.from({ length: MAX_MISSIONS }, (_, index) => ({
        id: `mission_old_${index}`,
        title: `老任务 ${index}`,
        phase: 'running' as const,
        unitIds: [],
        createdAt: 1754000000000 + index,
      })),
    });
    const host = createCoreMcpHost({ store: full, dispatch: emitCommand });

    try {
      await callCreate(host, { title: '再开一条', units: ['unit_kimi'] });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('mission_capacity_exceeded');
      expect((error as McpToolError).retryable).toBe(true);
    }
  });

  it('命令没人接管时如实报 internal_error，不假装建任务成功', async () => {
    const host = makeHost({ dispatch: () => { /* 无人消费 */ } });
    try {
      await callCreate(host, { title: '没人接的单', units: ['unit_kimi'] });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('internal_error');
    }
  });

  it('mission_status 单条模式：带回编组任务与其名下角色任务', async () => {
    const host = makeHost();
    const created = await callCreate(host, { title: '带角色任务的编组', units: ['unit_kimi'] });

    // 挂一条角色任务到这条编组任务上（core 侧的关联键 missionId）。
    host.dispatchCommand({
      type: 'task.assign',
      characterId: 'ch_kimi',
      prompt: '干一件事',
      missionId: created.mission_id,
    });

    const data = await callStatus(host, { mission_id: created.mission_id });
    expect(data.mission).toMatchObject({
      id: created.mission_id,
      title: '带角色任务的编组',
      phase: 'running',
      unit_count: 1,
    });
    expect(data.mission?.units).toEqual([{ id: 'unit_kimi', name: 'Kimi' }]);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks?.[0]).toMatchObject({
      character: { id: 'ch_kimi', name: 'Kimi' },
      status: 'queued',
    });
    expect(data.task_totals).toEqual({ total: 1, completed: 0, running: 0, failed: 0 });
  });

  it('mission_status 不存在 → mission_not_found', async () => {
    const host = makeHost();
    try {
      await callStatus(host, { mission_id: 'mission_ghost' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('mission_not_found');
    }
  });

  it('mission_status 列表模式：按创建时间倒序，带 returned/total/truncated', async () => {
    const host = makeHost();
    await callCreate(host, { title: '第一条', units: ['unit_kimi'] });
    await callCreate(host, { title: '第二条', units: ['unit_kimi'] });

    const all = await callStatus(host, {});
    expect(all.missions?.total).toBe(2);
    expect(all.missions?.returned).toBe(2);
    expect(all.missions?.truncated).toBe(false);

    const limited = await callStatus(host, { limit: 1 });
    expect(limited.missions?.returned).toBe(1);
    expect(limited.missions?.total).toBe(2);
    expect(limited.missions?.truncated).toBe(true);
    expect(limited.missions?.items).toHaveLength(1);
  });
});
