/**
 * 文件职责：`stratix_character_edit` 的单测 —— 改档闭环（改名 + 改人设 + 切上下文开关，
 *   状态与战场单位名同步刷新）、受保护字段 / 未知字段的拒绝（说清原因）、幂等（同值不写库）。
 * 输入：真实 core 运行时（createCoreRuntime + createStore）+ core 总线（emitCommand）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不打桩 core —— 改档必须真的过一遍 core 的 character manager（否则测的是
 *      "回执长得对"，不是"角色真的改名了"）；
 *   2. 不复用全局 worldStore —— 每个用例一份隔离的 store，跑完即弃。
 */

import { emitCommand } from '../../../core/bus';
import { createCoreRuntime } from '../../../core/runtime';
import { createStore, type CoreStore } from '../../../core/store';
import type { WorldState } from '../../../core/types';
import { createCoreMcpHost, type CoreMcpHostOptions } from '../context';
import { McpToolError } from '../envelope';
import { buildToolRegistry } from '../registry';
import { DEFAULT_MCP_TOOLS } from '../server';
import { characterCreateTool, characterEditTool } from '../tools/character';
import type { McpHost } from '../types';

function makeStore(overrides: Partial<WorldState> = {}): CoreStore {
  return createStore({
    characters: [],
    detectedAgents: [],
    units: [],
    missions: [],
    tasks: [],
    sessions: [],
    ...overrides,
  });
}

interface EditData {
  character_id: string;
  changed: string[];
  unchanged: string[];
  character: {
    name: string;
    persona: string;
    context_enabled: boolean | null;
  };
}

/** 调工具并把抛出的业务失败收敛成 McpToolError（没抛就是用例失败）。 */
async function expectToolError(
  host: McpHost,
  args: Record<string, unknown>
): Promise<McpToolError> {
  try {
    await characterEditTool.handler(args, host);
  } catch (error) {
    expect(error).toBeInstanceOf(McpToolError);
    return error as McpToolError;
  }
  throw new Error('期望工具抛业务失败，但它成功了');
}

describe('stratix_character_edit', () => {
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

  /** 建一个角色（走真实的 character_create）。 */
  const createCharacter = async (
    host: McpHost,
    name: string
  ): Promise<{ character_id: string; unit_id: string | null }> => {
    const result = await characterCreateTool.handler({ name }, host);
    const envelope = result.structuredContent as {
      ok: boolean;
      data: { character_id: string; unit_id: string | null };
    };
    expect(envelope.ok).toBe(true);
    return { character_id: envelope.data.character_id, unit_id: envelope.data.unit_id };
  };

  it('改名 + 改人设 + 切上下文开关：一次改多项，状态与战场单位名同步刷新', async () => {
    const host = makeHost();
    const created = await createCharacter(host, 'Neo');

    const result = await characterEditTool.handler(
      {
        character_id: created.character_id,
        name: 'Neo改',
        persona: '你是负责重构的老手',
        context_enabled: false,
      },
      host
    );
    const envelope = result.structuredContent as { ok: boolean; data: EditData };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.changed).toEqual(['name', 'persona', 'context_enabled']);
    expect(envelope.data.unchanged).toEqual([]);
    expect(envelope.data.character.name).toBe('Neo改');
    expect(envelope.data.character.persona).toBe('你是负责重构的老手');
    expect(envelope.data.character.context_enabled).toBe(false);

    // 状态里的真相也跟着变了（不是只有回执变了）。
    const state = host.getWorldState();
    const character = state.characters[0];
    expect(character?.name).toBe('Neo改');
    expect(character?.persona).toBe('你是负责重构的老手');
    expect(character?.contextEnabled).toBe(false);
    // 战场单位名同步刷新（不改单位就会出现"名册改了、战场上还叫旧名"的漂移）。
    expect(state.units[0]?.name).toBe('Neo改');
  });

  it('只改人设：名字与其它字段不动', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '只改人设');

    const result = await characterEditTool.handler(
      { character_id: created.character_id, persona: '新的人设' },
      host
    );
    const envelope = result.structuredContent as { ok: boolean; data: EditData };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.changed).toEqual(['persona']);
    expect(envelope.data.character.name).toBe('只改人设');
    expect(envelope.data.character.persona).toBe('新的人设');
  });

  it('幂等：传与现值相同的字段 → 不写库不广播（状态引用不变），回执说清"没改"', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '幂等');
    const before = host.getWorldState();
    const originalPersona = before.characters[0]?.persona ?? '';

    const result = await characterEditTool.handler(
      { character_id: created.character_id, name: '幂等', persona: originalPersona },
      host
    );
    const envelope = result.structuredContent as { ok: boolean; data: EditData };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.changed).toEqual([]);
    expect(envelope.data.unchanged).toEqual(['name', 'persona']);
    // 状态引用未变 = 这次写入没有产生副作用（core 的"引用未变即不广播"约定）。
    expect(host.getWorldState()).toBe(before);
  });

  it('只改大小写算真改名（不是幂等 no-op）', async () => {
    const host = makeHost();
    const created = await createCharacter(host, 'Neo');

    const result = await characterEditTool.handler(
      { character_id: created.character_id, name: 'NEO' },
      host
    );
    const envelope = result.structuredContent as { ok: boolean; data: EditData };
    expect(envelope.data.changed).toEqual(['name']);
    expect(host.getWorldState().characters[0]?.name).toBe('NEO');
  });

  it('character_id 缺失 → invalid_arguments', async () => {
    const host = makeHost();
    const error = await expectToolError(host, { name: '没人' });
    expect(error.code).toBe('invalid_arguments');
  });

  it('一个可改字段都没给 → invalid_arguments（不静默成功）', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '原样');
    const error = await expectToolError(host, { character_id: created.character_id });
    expect(error.code).toBe('invalid_arguments');
    expect(error.message).toContain('没有要改的字段');
  });

  it('未知字段 → invalid_arguments（说清本工具认哪些字段）', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '未知字段');
    const error = await expectToolError(host, {
      character_id: created.character_id,
      nickname: '外号',
    });
    expect(error.code).toBe('invalid_arguments');
    expect(error.message).toContain('nickname');
    expect(error.hint).toContain('context_enabled');
  });

  it('受保护字段 → invalid_arguments 并说明原因（皮肤 / 绑定 CLI / 等级 / 经验 / 形象）', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '受保护');
    const cases: readonly [string, unknown][] = [
      ['skin_id', 'default'],
      ['archetype', 'codex'],
      ['agent_kind', 'codex'],
      ['level', '9'],
      ['experience', '999'],
      ['appearance', { bodyType: 'slim' }],
    ];
    for (const [field, value] of cases) {
      const error = await expectToolError(host, {
        character_id: created.character_id,
        [field]: value,
      });
      expect(error.code).toBe('invalid_arguments');
      expect(error.message).toContain(field);
      // 拒绝要"说清为什么"，不是只说一句"不行"。
      expect(error.message.length).toBeGreaterThan(20);
    }
    // 名册没被动过。
    expect(host.getWorldState().characters[0]?.name).toBe('受保护');
  });

  it('与其它角色重名 → invalid_arguments（重名按大小写不敏感判定）', async () => {
    const host = makeHost();
    await createCharacter(host, '甲');
    const second = await createCharacter(host, '乙');

    const error = await expectToolError(host, {
      character_id: second.character_id,
      name: '甲',
    });
    expect(error.code).toBe('invalid_arguments');
    expect(error.message).toContain('同名');
    expect(host.getWorldState().characters.map((c) => c.name)).toEqual(['甲', '乙']);
  });

  it('空名字 / 空人设 → invalid_arguments（不是"没给这一项"）', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '空值');
    const nameError = await expectToolError(host, {
      character_id: created.character_id,
      name: '   ',
    });
    expect(nameError.code).toBe('invalid_arguments');
    const personaError = await expectToolError(host, {
      character_id: created.character_id,
      persona: '',
    });
    expect(personaError.code).toBe('invalid_arguments');
  });

  it('改不存在的角色 → unknown_character', async () => {
    const host = makeHost();
    const error = await expectToolError(host, {
      character_id: 'character_查无此角色',
      name: '没人',
    });
    expect(error.code).toBe('unknown_character');
  });

  it('命令没人接管（core 运行时未起）→ internal_error（不假装改成功）', async () => {
    const orphan = makeStore({
      characters: [
        {
          id: 'character_孤儿',
          name: '孤儿',
          persona: 'p',
          level: 1,
          experience: 0,
        },
      ],
    });
    const host = createCoreMcpHost({ store: orphan, dispatch: () => undefined });
    const error = await expectToolError(host, {
      character_id: 'character_孤儿',
      name: '没改成',
    });
    expect(error.code).toBe('internal_error');
    expect(orphan.getState().characters[0]?.name).toBe('孤儿');
  });

  it('工具进 tools/list（19 件）且带四段式说明', () => {
    const registry = buildToolRegistry(DEFAULT_MCP_TOOLS);
    expect(registry.size).toBe(19);
    const tool = registry.getTool('stratix_character_edit');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('何时用：');
    expect(tool?.description).toContain('何时不用：');
    expect(tool?.description).toContain('边界：');
    expect(tool?.description).toContain('错误：');
  });
});
