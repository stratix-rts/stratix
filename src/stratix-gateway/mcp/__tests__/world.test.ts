/**
 * 文件职责：`stratix_world_snapshot` 的单测 —— 摘要形状、过滤、截断标记、非法入参。
 * 输入：构造好的 WorldState 快照（通过 McpHost 注入）。
 * 输出：jest 断言。
 * 禁止事项：不落任何状态 —— 本工具只读，用例只验证"读出来的东西长什么样"。
 */

import type { WorldState } from '../../../core/types';
import { McpToolError } from '../envelope';
import { worldSnapshotTool } from '../tools/world';
import type { McpHost } from '../types';

function makeState(taskCount = 2): WorldState {
  return {
    units: [
      {
        id: 'unit_kimi',
        name: 'Kimi',
        status: 'busy',
        missionId: 'mission_1',
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
        online: false,
      },
    ],
    missions: [
      {
        id: 'mission_1',
        title: '重构路由层',
        phase: 'running',
        unitIds: ['unit_kimi'],
        createdAt: 1754000000000,
      },
    ],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [
      {
        id: 'ch_kimi',
        name: 'Kimi',
        persona: '一段很长的人设文本，不该被快照回灌',
        level: 7,
        experience: 120,
        agentKind: 'kimi',
      },
      {
        id: 'ch_codex',
        name: 'Codex',
        persona: '',
        level: 3,
        experience: 10,
        agentKind: 'codex',
      },
    ],
    notices: [],
    links: [],
    messages: [],
    detectedAgents: [],
    tasks: Array.from({ length: taskCount }, (_, index) => ({
      id: `task_${index}`,
      characterId: 'ch_kimi',
      prompt: `补一条单测覆盖第 ${index} 个分支`,
      status: 'running' as const,
      createdAt: 1754000000000 + index,
      startedAt: null,
      endedAt: null,
      output: '',
      missionId: null,
    })),
  };
}

function makeHost(state: WorldState): McpHost {
  return {
    getWorldState: () => state,
    dispatchCommand: () => {
      throw new Error('只读工具不该投递命令');
    },
  };
}

interface SnapshotData {
  taken_at: number;
  totals: Record<string, number>;
  units?: { returned: number; total: number; truncated: boolean; items: Array<Record<string, unknown>> };
  missions?: { returned: number; total: number; truncated: boolean; items: Array<Record<string, unknown>> };
  tasks?: { returned: number; total: number; truncated: boolean; items: Array<Record<string, unknown>> };
  characters?: {
    returned: number;
    total: number;
    truncated: boolean;
    items: Array<Record<string, unknown>>;
  };
}

async function callSnapshot(
  state: WorldState,
  args: Record<string, unknown> = {}
): Promise<SnapshotData> {
  const result = await worldSnapshotTool.handler(args, makeHost(state));
  const envelope = result.structuredContent as { ok: boolean; data: SnapshotData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

describe('stratix_world_snapshot', () => {
  it('默认回四段摘要：计数 + 精简条目 + 截断标记', async () => {
    const data = await callSnapshot(makeState());

    expect(data.totals).toEqual({ units: 2, missions: 1, tasks: 2, characters: 2 });
    expect(data.units).toMatchObject({ returned: 2, total: 2, truncated: false });
    expect(data.missions).toMatchObject({ returned: 1, total: 1, truncated: false });
    expect(data.tasks).toMatchObject({ returned: 2, total: 2, truncated: false });
    expect(data.characters).toMatchObject({ returned: 2, total: 2, truncated: false });
  });

  it('条目只带摘要字段，不带人设全文与输出全文', async () => {
    const data = await callSnapshot(makeState());

    const character = data.characters!.items[0];
    expect(character).toEqual({
      id: 'ch_kimi',
      name: 'Kimi',
      agent_kind: 'kimi',
      level: 7,
      online: true,
    });
    expect(JSON.stringify(data)).not.toContain('一段很长的人设文本');

    const task = data.tasks!.items[0];
    expect(Object.keys(task).sort()).toEqual(
      ['character_id', 'created_at', 'id', 'status', 'summary'].sort()
    );
  });

  it('单位条目带忙闲、在线位与归属角色', async () => {
    const data = await callSnapshot(makeState());

    expect(data.units!.items[0]).toEqual({
      id: 'unit_kimi',
      name: 'Kimi',
      status: 'busy',
      online: true,
      character_id: 'ch_kimi',
      mission_id: 'mission_1',
    });
    expect(data.units!.items[1]).toMatchObject({ id: 'unit_codex', status: 'idle', online: false });
  });

  it('超过 limit 时截断并标 truncated（returned < total）', async () => {
    const data = await callSnapshot(makeState(22));

    expect(data.tasks).toMatchObject({ returned: 20, total: 22, truncated: true });
    expect(data.tasks!.items).toHaveLength(20);
  });

  it('limit 可调小', async () => {
    const data = await callSnapshot(makeState(5), { filters: { limit: 2 } });
    expect(data.tasks).toMatchObject({ returned: 2, total: 5, truncated: true });
  });

  it('filters.domains 只回要的那几段', async () => {
    const data = await callSnapshot(makeState(), { filters: { domains: ['tasks'] } });

    expect(data.tasks).toBeDefined();
    expect(data.units).toBeUndefined();
    expect(data.missions).toBeUndefined();
    expect(data.characters).toBeUndefined();
    expect(data.totals).toEqual({ tasks: 2 });
  });

  it('filters 按状态筛单位与任务', async () => {
    const data = await callSnapshot(makeState(), {
      filters: { domains: ['units', 'tasks'], unit_status: ['busy'], task_status: ['running'] },
    });

    expect(data.units!.items.map((item) => item.id)).toEqual(['unit_kimi']);
    expect(data.tasks!.items).toHaveLength(2);
  });

  it('过滤器取值非法 → invalid_arguments', async () => {
    await expect(
      callSnapshot(makeState(), { filters: { unit_status: ['sleeping'] } })
    ).rejects.toBeInstanceOf(McpToolError);

    try {
      await callSnapshot(makeState(), { filters: { domains: ['unknown'] } });
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(McpToolError);
      expect((error as McpToolError).code).toBe('invalid_arguments');
    }
  });
});
