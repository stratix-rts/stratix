/**
 * 文件职责：`stratix_registry` 的单测 —— 只读形状（agents / characters / units + 计数）、
 *   稳定排序、不回灌人设与凭据。
 * 输入：构造好的 WorldState 快照（通过 McpHost 注入）。
 * 输出：jest 断言。
 * 禁止事项：不落任何状态 —— 本工具只读，用例只验证"读出来的东西长什么样"。
 */

import { createStore, type CoreStore } from '../../../core/store';
import type { WorldState } from '../../../core/types';
import { registryTool } from '../tools/registry';
import type { McpHost } from '../types';

function makeStore(): CoreStore {
  return createStore({
    characters: [
      {
        id: 'ch_codex',
        name: 'Codex',
        persona: '一段不该被回灌的人设',
        level: 5,
        experience: 40,
        agentKind: 'codex',
        externalSessionId: 'sess_secret',
      },
      {
        id: 'ch_kimi',
        name: 'Kimi',
        persona: '另一段人设',
        level: 7,
        experience: 120,
        agentKind: 'kimi',
      },
    ],
    detectedAgents: [
      { kind: 'kimi', tier: 'T1', installed: true, status: 'installed', version: '1.0.0', path: '/bin/kimi' },
      { kind: 'claude-code', tier: 'T1', installed: true, status: 'installed', version: '2.1.0', path: '/bin/cc' },
    ],
    units: [
      {
        id: 'unit_codex',
        name: 'Codex',
        status: 'busy',
        missionId: 'mission_1',
        power: 0,
        characterId: 'ch_codex',
        online: true,
      },
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
    missions: [],
    tasks: [],
  });
}

interface RegistryData {
  agents: Array<{
    kind: string;
    tier: string;
    installed: boolean;
    status: string;
    version: string | null;
  }>;
  characters: Array<{
    id: string;
    name: string;
    agent_kind: string | null;
    level: number;
    online: boolean | null;
    unit_id: string | null;
  }>;
  units: Array<{
    id: string;
    name: string;
    character_id: string | null;
    status: string;
    online: boolean;
  }>;
  totals: { agents: number; characters: number; units: number };
}

async function callRegistry(store: CoreStore): Promise<RegistryData> {
  const dispatched: unknown[] = [];
  const host: McpHost = {
    getWorldState: () => store.getState(),
    dispatchCommand: (command) => {
      dispatched.push(command);
    },
  };
  const result = await registryTool.handler({}, host);
  const envelope = result.structuredContent as { ok: boolean; data: RegistryData };
  expect(envelope.ok).toBe(true);
  // 只读：一条命令都不该发。
  expect(dispatched).toEqual([]);
  return envelope.data;
}

describe('stratix_registry', () => {
  it('返回三段清单 + 计数，全部按 id 稳定排序', async () => {
    const data = await callRegistry(makeStore());

    expect(data.agents.map((agent) => agent.kind)).toEqual(['claude-code', 'kimi']);
    expect(data.characters.map((character) => character.id)).toEqual(['ch_codex', 'ch_kimi']);
    expect(data.units.map((unit) => unit.id)).toEqual(['unit_codex', 'unit_kimi']);
    expect(data.totals).toEqual({ agents: 2, characters: 2, units: 2 });
  });

  it('角色条目带绑定种类、等级、在线位与战场单位；不含人设与外部会话凭据', async () => {
    const data = await callRegistry(makeStore());

    expect(data.characters[0]).toEqual({
      id: 'ch_codex',
      name: 'Codex',
      agent_kind: 'codex',
      level: 5,
      online: true,
      unit_id: 'unit_codex',
    });
    expect(data.characters[1].online).toBe(false);

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('不该被回灌的人设');
    expect(serialized).not.toContain('sess_secret');
  });

  it('单位条目带关联角色与忙闲；没上场的角色在线位为 null（不编造）', async () => {
    const store = makeStore();
    store.setState((state) => ({
      ...state,
      units: state.units.filter((unit) => unit.id !== 'unit_kimi'),
    }));

    const data = await callRegistry(store);
    expect(data.characters.find((character) => character.id === 'ch_kimi')?.online).toBeNull();
    expect(data.characters.find((character) => character.id === 'ch_kimi')?.unit_id).toBeNull();
  });

  it('同一份状态两次读到的顺序一致（提示词缓存不能因顺序抖动失效）', async () => {
    const store = makeStore();
    const first = await callRegistry(store);
    const second = await callRegistry(store);
    expect(second).toEqual(first);
  });
});
