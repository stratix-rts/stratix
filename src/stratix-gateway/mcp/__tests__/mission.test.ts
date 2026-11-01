/**
 * 文件职责：`stratix_mission_create` / `stratix_mission_status` / `stratix_mission_checkpoint`
 *   的单测 —— auto_confirm 合并语义、静默剔除单位、相位查询（单条 / 列表）、
 *   brief / depends_on 透传与依赖守门、检查点记账（含终态拒绝）。
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
import { MAX_MISSIONS, type HudCommand, type WorldState } from '../../../core/types';
import { createCoreMcpHost, type CoreMcpHostOptions } from '../context';
import { McpToolError } from '../envelope';
import { missionCheckpointTool, missionCreateTool, missionStatusTool } from '../tools/mission';
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
  brief_fields?: string[];
  depends_on?: string[];
  blocked_by_dependencies?: string[];
  next: { tool: string; args: Record<string, unknown>; hint: string };
  poll: { tool: string; args: Record<string, unknown> };
}

interface CheckpointData {
  mission_id: string;
  title: string;
  phase: string;
  note: string;
  at: number;
  checkpoint_count: number;
  checkpoint_limit: number;
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

async function callCheckpoint(
  host: McpHost,
  args: Record<string, unknown>
): Promise<CheckpointData> {
  const result = await missionCheckpointTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: CheckpointData };
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

/**
 * brief / depends_on 透传与依赖守门（方案B·3/3）。
 * 独立 describe：这一组共用"先造一条前置任务"的夹具，混进上面那组会让用例互相干扰。
 */
describe('stratix_mission_create：brief / depends_on', () => {
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

  it('brief 与 depends_on 透传到 mission.create 命令载荷', async () => {
    const dispatched: HudCommand[] = [];
    const host = createCoreMcpHost({
      store,
      dispatch: (command) => {
        dispatched.push(command);
        emitCommand(command);
      },
    });

    await callCreate(host, {
      title: '带正文与依赖的编组',
      units: ['unit_kimi'],
      brief: {
        requirements: '拆掉旧总线',
        acceptance: '单测全绿',
        deliverables: '一份迁移说明',
        constraints: '不碰 core',
      },
      depends_on: ['mission_prev'],
    });

    const create = dispatched.find((command) => command.type === 'mission.create');
    expect(create).toMatchObject({
      type: 'mission.create',
      title: '带正文与依赖的编组',
      brief: {
        requirements: '拆掉旧总线',
        acceptance: '单测全绿',
        deliverables: '一份迁移说明',
        constraints: '不碰 core',
      },
      dependsOn: ['mission_prev'],
    });
  });

  it('brief 四段落到 MissionView.brief，回执只报段名（不重复回灌正文）', async () => {
    const host = makeHost();
    const data = await callCreate(host, {
      title: '重构路由层',
      units: ['unit_kimi'],
      brief: {
        requirements: '拆掉旧总线',
        acceptance: '单测全绿',
        deliverables: '一份迁移说明',
        constraints: '不碰 core',
      },
    });

    expect(data.brief_fields).toEqual(['requirements', 'acceptance', 'deliverables', 'constraints']);
    const mission = store.getState().missions.find((item) => item.id === data.mission_id);
    expect(mission?.brief).toEqual({
      requirements: '拆掉旧总线',
      acceptance: '单测全绿',
      deliverables: '一份迁移说明',
      constraints: '不碰 core',
    });
  });

  it('depends_on 未满足：confirm 被 core 拒绝 → 任务停在 pending，回执报出还差哪几个', async () => {
    const host = makeHost();
    const first = await callCreate(host, { title: '前置：加固城墙', units: ['unit_kimi'] });
    const second = await callCreate(host, {
      title: '后置：进攻北门',
      units: ['unit_codex'],
      depends_on: [first.mission_id],
    });

    // 任务确实建出来了（只是还没到能开工的时候）—— 不该被当成失败。
    expect(second.phase).toBe('pending');
    expect(second.auto_confirm_applied).toBe(false);
    expect(second.blocked_by_dependencies).toEqual([first.mission_id]);
    const mission = store.getState().missions.find((item) => item.id === second.mission_id);
    expect(mission?.phase).toBe('pending');
    expect(mission?.dependsOn).toEqual([first.mission_id]);
  });

  it('depends_on 已满足（前置进终态）：confirm 通过，直接进入 running', async () => {
    const host = makeHost();
    const first = await callCreate(host, { title: '前置：加固城墙', units: ['unit_kimi'] });
    host.dispatchCommand({ type: 'mission.cancel', missionId: first.mission_id });

    const second = await callCreate(host, {
      title: '后置：进攻北门',
      units: ['unit_codex'],
      depends_on: [first.mission_id],
    });

    expect(second.phase).toBe('running');
    expect(second.auto_confirm_applied).toBe(true);
    expect(second.blocked_by_dependencies).toBeUndefined();
  });

  it('brief 段名非法 / 段非字符串 / 段超长 → invalid_arguments（不静默透传）', async () => {
    const host = makeHost();

    for (const badBrief of [
      { foo: '不认识的一段' },
      { requirements: 123 },
      { acceptance: 'x'.repeat(501) },
    ]) {
      try {
        await callCreate(host, { title: '坏 brief', units: ['unit_kimi'], brief: badBrief });
        throw new Error('应当抛错');
      } catch (error) {
        expect((error as McpToolError).code).toBe('invalid_arguments');
      }
    }
  });

  it('depends_on 超过 32 条 → invalid_arguments（不静默截断依赖链）', async () => {
    const host = makeHost();
    const dependsOn = Array.from({ length: 33 }, (_, index) => `mission_${index}`);
    try {
      await callCreate(host, { title: '依赖太多', units: ['unit_kimi'], depends_on: dependsOn });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('invalid_arguments');
    }
  });
});

describe('stratix_mission_checkpoint', () => {
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

  it('记账成功：追加一条检查点，回执带 mission_id 与计数（状态里真的多了一条）', async () => {
    const host = makeHost();
    const created = await callCreate(host, { title: '长任务', units: ['unit_kimi'] });

    const data = await callCheckpoint(host, {
      mission_id: created.mission_id,
      note: '派两人出门，先探北门',
    });

    expect(data.mission_id).toBe(created.mission_id);
    expect(data.note).toBe('派两人出门，先探北门');
    expect(data.checkpoint_count).toBe(1);
    expect(data.checkpoint_limit).toBe(64);
    expect(typeof data.at).toBe('number');
    expect(data.poll).toEqual({
      tool: 'stratix_mission_status',
      args: { mission_id: created.mission_id },
    });

    const mission = store.getState().missions.find((item) => item.id === created.mission_id);
    expect(mission?.checkpoints).toHaveLength(1);
    expect(mission?.checkpoints?.[0]).toMatchObject({ note: '派两人出门，先探北门' });
  });

  it('连记多条：计数递增，顺序保持（append-only）', async () => {
    const host = makeHost();
    const created = await callCreate(host, { title: '多步长任务', units: ['unit_kimi'] });

    await callCheckpoint(host, { mission_id: created.mission_id, note: '第一步' });
    const second = await callCheckpoint(host, { mission_id: created.mission_id, note: '第二步' });

    expect(second.checkpoint_count).toBe(2);
    const mission = store.getState().missions.find((item) => item.id === created.mission_id);
    expect(mission?.checkpoints?.map((checkpoint) => checkpoint.note)).toEqual(['第一步', '第二步']);
  });

  it('终态任务 → mission_terminal（终态不改写历史，一条都记不上）', async () => {
    const host = makeHost();
    const created = await callCreate(host, { title: '要收尾的', units: ['unit_kimi'] });
    host.dispatchCommand({ type: 'mission.cancel', missionId: created.mission_id });

    try {
      await callCheckpoint(host, { mission_id: created.mission_id, note: '收尾后再记一笔' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('mission_terminal');
      expect((error as McpToolError).retryable).toBe(false);
    }

    const mission = store.getState().missions.find((item) => item.id === created.mission_id);
    expect(mission?.checkpoints ?? []).toHaveLength(0);
  });

  it('任务不存在 → mission_not_found', async () => {
    const host = makeHost();
    try {
      await callCheckpoint(host, { mission_id: 'mission_ghost', note: '记一笔' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('mission_not_found');
    }
  });

  it('note 为空 / 超长 → invalid_arguments', async () => {
    const host = makeHost();
    const created = await callCreate(host, { title: '长任务', units: ['unit_kimi'] });

    for (const note of ['   ', 'x'.repeat(501)]) {
      try {
        await callCheckpoint(host, { mission_id: created.mission_id, note });
        throw new Error('应当抛错');
      } catch (error) {
        expect((error as McpToolError).code).toBe('invalid_arguments');
      }
    }
  });

  it('命令没人接管时如实报 internal_error，不假装记上了', async () => {
    const host = makeHost();
    const created = await callCreate(host, { title: '长任务', units: ['unit_kimi'] });
    const offline = createCoreMcpHost({ store, dispatch: () => { /* 无人消费 */ } });

    try {
      await callCheckpoint(offline, { mission_id: created.mission_id, note: '记一笔' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('internal_error');
    }
  });
});
