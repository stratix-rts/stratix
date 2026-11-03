/**
 * 文件职责：`stratix_character_create` 的单测 —— 建档闭环（建档即上场）、缺省值、
 *   名册准入（重名 / 上限 / 参数形状）与"命令没人接管"这三条错误路径。
 * 输入：真实 core 运行时（createCoreRuntime + createStore）+ core 总线（emitCommand）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不打桩 core —— 建档必须真的过一遍 core 的 character manager（否则测的是
 *      "回执长得对"，不是"角色真的建出来并上了战场"）；
 *   2. 不复用全局 worldStore —— 每个用例一份隔离的 store，跑完即弃。
 */

import { emitCommand } from '../../../core/bus';
import { createCoreRuntime } from '../../../core/runtime';
import { createStore, type CoreStore } from '../../../core/store';
import { DEFAULT_PERSONA_TEMPLATE } from '../../../core/character/profile';
import { MAX_CHARACTERS, type WorldState } from '../../../core/types';
import { createCoreMcpHost, type CoreMcpHostOptions } from '../context';
import { McpToolError } from '../envelope';
import { characterCreateTool } from '../tools/character';
import { missionCreateTool } from '../tools/mission';
import type { McpHost } from '../types';

function makeStore(overrides: Partial<WorldState> = {}): CoreStore {
  return createStore({
    characters: [],
    detectedAgents: [],
    units: [],
    missions: [],
    tasks: [],
    ...overrides,
  });
}

interface CreateData {
  character_id: string;
  unit_id: string | null;
  character: {
    id: string;
    name: string;
    persona: string;
    level: number;
    experience: number;
    agent_kind: string | null;
    skin_id: string | null;
    external_session_id: string | null;
    appearance: unknown;
    context_enabled: boolean | null;
  };
  next: { tool: string; args: Record<string, unknown>; hint: string };
  poll: { tool: string; args: Record<string, unknown> };
}

async function callCreate(host: McpHost, args: Record<string, unknown>): Promise<CreateData> {
  const result = await characterCreateTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: CreateData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

/** 调工具并把抛出的业务失败收敛成 McpToolError（没抛就是用例失败）。 */
async function expectToolError(
  host: McpHost,
  args: Record<string, unknown>
): Promise<McpToolError> {
  try {
    await characterCreateTool.handler(args, host);
  } catch (error) {
    expect(error).toBeInstanceOf(McpToolError);
    return error as McpToolError;
  }
  throw new Error('期望工具抛业务失败，但它成功了');
}

describe('stratix_character_create', () => {
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

  it('建档成功：角色进名册，且同一次落库里上了战场（单位随角色一起来）', async () => {
    const host = makeHost();
    const data = await callCreate(host, { name: 'Neo' });

    expect(data.character.name).toBe('Neo');
    expect(data.character_id).toBe(data.character.id);
    // 建档即上场：战场单位 id = unit_<角色 id>（core/character/unit-projection.ts）。
    expect(data.unit_id).toBe(`unit_${data.character_id}`);

    const state = host.getWorldState();
    expect(state.characters.map((c) => c.name)).toEqual(['Neo']);
    expect(state.units.map((u) => u.id)).toEqual([`unit_${data.character_id}`]);
    expect(state.units[0]?.characterId).toBe(data.character_id);
  });

  it('缺省值：原型 claude-code、皮肤 default、人设套 core 默认模板、等级 1 / 经验 0', async () => {
    const host = makeHost();
    const data = await callCreate(host, { name: 'Trinity' });

    expect(data.character.agent_kind).toBe('claude-code');
    expect(data.character.skin_id).toBe('default');
    expect(data.character.persona).toBe(DEFAULT_PERSONA_TEMPLATE);
    expect(data.character.level).toBe(1);
    expect(data.character.experience).toBe(0);
  });

  it('显式给 archetype / persona / skin_id 时按给的来', async () => {
    const host = makeHost();
    const data = await callCreate(host, {
      name: 'Morpheus',
      archetype: 'codex',
      persona: '你是负责重构的老手',
      skin_id: 'pixel',
    });

    expect(data.character.agent_kind).toBe('codex');
    expect(data.character.persona).toBe('你是负责重构的老手');
    expect(data.character.skin_id).toBe('pixel');
  });

  it('名字必填：缺失 → invalid_arguments（且名册不变）', async () => {
    const host = makeHost();
    const error = await expectToolError(host, {});
    expect(error.code).toBe('invalid_arguments');
    expect(host.getWorldState().characters).toHaveLength(0);
  });

  it('名字超长（> 24 码点）→ invalid_arguments', async () => {
    const host = makeHost();
    const error = await expectToolError(host, { name: 'x'.repeat(25) });
    expect(error.code).toBe('invalid_arguments');
    expect(host.getWorldState().characters).toHaveLength(0);
  });

  it('重名拒绝（大小写不敏感）：invalid_arguments，且名册不变', async () => {
    const host = makeHost();
    await callCreate(host, { name: 'Neo' });
    const error = await expectToolError(host, { name: 'neo' });
    expect(error.code).toBe('invalid_arguments');
    expect(host.getWorldState().characters).toHaveLength(1);
  });

  it('名册已满 → invalid_arguments（不静默挤掉已有角色）', async () => {
    const characters = Array.from({ length: MAX_CHARACTERS }, (_, index) => ({
      id: `ch_${index}`,
      name: `角色${index}`,
      persona: 'p',
      level: 1,
      experience: 0,
    }));
    const full = makeStore({ characters });
    const runtime = createCoreRuntime({ store: full });
    const stop = runtime.start();
    try {
      const host = createCoreMcpHost({ store: full, dispatch: emitCommand });
      const error = await expectToolError(host, { name: '新来的' });
      expect(error.code).toBe('invalid_arguments');
      expect(full.getState().characters).toHaveLength(MAX_CHARACTERS);
    } finally {
      stop();
    }
  });

  it('原型 / 皮肤取值非法 → invalid_arguments', async () => {
    const host = makeHost();
    expect((await expectToolError(host, { name: 'A', archetype: 'not-an-agent' })).code).toBe(
      'invalid_arguments'
    );
    expect((await expectToolError(host, { name: 'B', skin_id: 'not-a-skin' })).code).toBe(
      'invalid_arguments'
    );
  });

  it('闭环：character_create → mission_create(auto_confirm) → 编组真的开到 running', async () => {
    const host = makeHost();
    const created = await callCreate(host, { name: 'Trinity' });
    expect(created.unit_id).not.toBeNull();

    const result = await missionCreateTool.handler(
      { title: 'MCP 闭环探针', units: [created.unit_id as string], auto_confirm: true },
      host
    );
    const envelope = result.structuredContent as {
      ok: boolean;
      data: { mission_id: string; phase: string; units: Array<{ id: string }> };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.phase).toBe('running');
    expect(envelope.data.units.map((u) => u.id)).toEqual([created.unit_id]);
  });

  it('命令没人接管（core 运行时未起）→ internal_error（不假装建成功）', async () => {
    // 另起一份 store 且**不**启动 runtime —— 总线上无人消费这条命令。
    const orphan = makeStore();
    const host = createCoreMcpHost({ store: orphan, dispatch: () => undefined });
    const error = await expectToolError(host, { name: '孤儿' });
    expect(error.code).toBe('internal_error');
    expect(orphan.getState().characters).toHaveLength(0);
  });
});
