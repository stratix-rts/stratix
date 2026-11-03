/**
 * 文件职责：`stratix_character_delete` 的单测 —— 删除闭环（名册与战场单位同时消失）、
 *   占用拒绝（在任务中 / 在线，说清原因）与"删不存在的 id"这条幂等路径。
 * 输入：真实 core 运行时（createCoreRuntime + createStore）+ core 总线（emitCommand）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不打桩 core —— 删除必须真的过一遍 core 的 character manager（否则测的是
 *      "回执长得对"，不是"角色真的从名册里消失了"）；
 *   2. 不复用全局 worldStore —— 每个用例一份隔离的 store，跑完即弃。
 */

import { emitCommand } from '../../../core/bus';
import { createCoreRuntime } from '../../../core/runtime';
import { createStore, type CoreStore } from '../../../core/store';
import type { CharacterTask, WorldState } from '../../../core/types';
import { createCoreMcpHost, type CoreMcpHostOptions } from '../context';
import { McpToolError } from '../envelope';
import { characterCreateTool, characterDeleteTool } from '../tools/character';
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

interface DeleteData {
  character_id: string;
  name: string;
  removed_unit_id: string | null;
}

/** 调工具并把抛出的业务失败收敛成 McpToolError（没抛就是用例失败）。 */
async function expectToolError(
  host: McpHost,
  args: Record<string, unknown>
): Promise<McpToolError> {
  try {
    await characterDeleteTool.handler(args, host);
  } catch (error) {
    expect(error).toBeInstanceOf(McpToolError);
    return error as McpToolError;
  }
  throw new Error('期望工具抛业务失败，但它成功了');
}

describe('stratix_character_delete', () => {
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

  /** 建一个角色（走真实的 character_create —— 顺带验证 create → delete 的闭环）。 */
  const createCharacter = async (host: McpHost, name: string): Promise<DeleteData & { unit_id: string | null }> => {
    const result = await characterCreateTool.handler({ name }, host);
    const envelope = result.structuredContent as {
      ok: boolean;
      data: { character_id: string; unit_id: string | null };
    };
    expect(envelope.ok).toBe(true);
    return { character_id: envelope.data.character_id, name, unit_id: envelope.data.unit_id, removed_unit_id: null };
  };

  it('删除成功：角色从名册消失，战场单位也一并撤下（不留幽灵单位）', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '待清理的角色');
    expect(host.getWorldState().characters).toHaveLength(1);

    const result = await characterDeleteTool.handler({ character_id: created.character_id }, host);
    const envelope = result.structuredContent as { ok: boolean; data: DeleteData };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.character_id).toBe(created.character_id);
    expect(envelope.data.name).toBe('待清理的角色');
    expect(envelope.data.removed_unit_id).toBe(created.unit_id);

    const state = host.getWorldState();
    expect(state.characters).toHaveLength(0);
    expect(state.units).toHaveLength(0);
  });

  it('删不存在的 id → unknown_character（明确错误，不当成删成功、不崩）', async () => {
    const host = makeHost();
    const error = await expectToolError(host, { character_id: 'character_查无此角色' });
    expect(error.code).toBe('unknown_character');
    expect(error.message).toContain('character_查无此角色');
  });

  it('character_id 缺失 → invalid_arguments', async () => {
    const host = makeHost();
    const error = await expectToolError(host, {});
    expect(error.code).toBe('invalid_arguments');
  });

  it('在任务中（有未收尾任务）→ 拒绝删除并说清原因（名册不变）', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '在跑的');
    const tasks: CharacterTask[] = [
      {
        id: 'task_还在跑',
        characterId: created.character_id,
        prompt: '干活',
        status: 'running',
        createdAt: Date.now(),
        startedAt: Date.now(),
        endedAt: null,
        output: '',
      },
    ];
    store.setState((current) => ({ ...current, tasks }));

    const error = await expectToolError(host, { character_id: created.character_id });
    expect(error.code).toBe('illegal_transition');
    expect(error.message).toContain('在任务中');
    expect(host.getWorldState().characters).toHaveLength(1);
  });

  it('在线（有在办会话）→ 拒绝删除并说清原因', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '在聊天的');
    store.setState((current) => ({
      ...current,
      sessions: [
        {
          id: 'session_在聊',
          kind: 'character_chat',
          title: '角色对话',
          participants: [created.character_id],
          status: 'active',
          createdAt: Date.now(),
          lastEventAt: Date.now(),
          closedAt: null,
          eventCount: 1,
        },
      ],
    }));
    const error = await expectToolError(host, { character_id: created.character_id });
    expect(error.code).toBe('chat_busy');
    expect(error.message).toContain('在线');
    expect(host.getWorldState().characters).toHaveLength(1);
  });

  it('终态任务（completed）不算占用：这样的角色可以删', async () => {
    const host = makeHost();
    const created = await createCharacter(host, '干完了的');
    store.setState((current) => ({
      ...current,
      tasks: [
        {
          id: 'task_已完成',
          characterId: created.character_id,
          prompt: '干活',
          status: 'completed',
          createdAt: Date.now(),
          startedAt: Date.now(),
          endedAt: Date.now(),
          output: 'done',
        },
      ],
    }));
    const result = await characterDeleteTool.handler({ character_id: created.character_id }, host);
    const envelope = result.structuredContent as { ok: boolean };
    expect(envelope.ok).toBe(true);
    expect(host.getWorldState().characters).toHaveLength(0);
  });

  it('命令没人接管（core 运行时未起）→ internal_error（不假装删成功）', async () => {
    // 名册里**有**这个角色，但总线上无人消费这条命令 → 删不掉，如实报内部错误。
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
    const error = await expectToolError(host, { character_id: 'character_孤儿' });
    expect(error.code).toBe('internal_error');
    expect(orphan.getState().characters).toHaveLength(1);
  });
});
