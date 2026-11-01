/**
 * 单测：Stratix 上下文注入中间件（task_053，app/services/stratix-context.ts）。
 * 覆盖四块（规格⑤）：
 *   1. builder：分节渲染 / 截断策略（4000 上限 + 从尾部段砍）/ 空输入降级；
 *   2. provider：快照派生（同场名单 / 任务史前 3 / 话题透传）+ 两级开关裁决 + 角色不在档；
 *   3. 话题缓存 persister：user 消息进缓存、透传落库、读数；
 *   4. resolveStratixContextBlock：注入件缺省 / null 快照 / 抛错吞掉。
 * 全部纯函数与注入件测试 —— 零真实 IO（WorldState 夹具 / 内存 Storage 面）。
 */

import type {
  CharacterTask,
  CharacterView,
  TaskStatus,
  UnitView,
  WorldState,
} from '../../core/types';
import {
  buildStratixContextBlock,
  createStratixContextProvider,
  createTopicCachePersister,
  isGlobalContextEnabled,
  resolveStratixContextBlock,
  STRATIX_CONTEXT_MAX_CHARS,
  STRATIX_CONTEXT_TAG_CLOSE,
  STRATIX_CONTEXT_TAG_OPEN,
  STRATIX_CONTEXT_TASK_SUMMARY_LEN,
  STRATIX_CONTEXT_TOPIC_LEN,
  type StratixContextInput,
  type StratixTaskBrief,
} from '../services/stratix-context';

// ============================================================================
// 夹具
// ============================================================================

function snapshot(patch: Partial<StratixContextInput> = {}): StratixContextInput {
  return {
    characterId: 'character_1',
    characterName: '阿锻',
    profileSummary: 'Lv.3 · EXP 120 · codex',
    peers: [
      { id: 'character_2', name: '贝塔', kind: 'codex', level: 2 },
      { id: 'character_3', name: '伽马', kind: 'claude-code', level: 1 },
    ],
    recentTasks: [
      { summary: '修复登录页样式', status: 'completed' as TaskStatus, at: 1_761_380_000_000 },
      { summary: '编写部署脚本', status: 'failed' as TaskStatus, at: 1_761_370_000_000 },
    ],
    lastTopic: { text: '帮我看看部署报错', at: 1_761_390_000_000 },
    ...patch,
  };
}

function character(patch: Partial<CharacterView> = {}): CharacterView {
  return {
    id: 'character_1',
    name: '阿锻',
    persona: '# 角色\n沉着冷静',
    level: 3,
    experience: 120,
    agentKind: 'codex',
    ...patch,
  };
}

function unit(id: string, patch: Partial<UnitView> = {}): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 0, ...patch };
}

function task(patch: Partial<CharacterTask> = {}): CharacterTask {
  return {
    id: 'task_1',
    characterId: 'character_1',
    prompt: '修复登录页',
    status: 'completed',
    createdAt: 1_700_000_000_000,
    startedAt: null,
    endedAt: null,
    output: '',
    ...patch,
  };
}

function state(patch: Partial<Pick<WorldState, 'characters' | 'units' | 'tasks'>> = {}): Pick<WorldState, 'characters' | 'units' | 'tasks'> {
  return {
    characters: [
      character(),
      character({ id: 'character_2', name: '贝塔', agentKind: 'codex', level: 2 }),
    ],
    units: [unit('unit_character_1', { characterId: 'character_1' })],
    tasks: [],
    ...patch,
  };
}

/** 内存 Storage 面（localStorage 形状，零依赖 jsdom）。 */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    get length(): number { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
}

// ============================================================================
// builder：分节渲染
// ============================================================================

describe('buildStratixContextBlock 分节渲染', () => {
  it('四路输入齐备 → 标签包裹 + 043 风格分节小标题 + 档案摘要行', () => {
    const block = buildStratixContextBlock(snapshot());
    expect(block.startsWith(STRATIX_CONTEXT_TAG_OPEN)).toBe(true);
    expect(block.endsWith(STRATIX_CONTEXT_TAG_CLOSE)).toBe(true);
    expect(block).toContain('# 角色档案');
    expect(block).toContain('阿锻（Lv.3 · EXP 120 · codex）');
    expect(block).toContain('# 同场角色');
    expect(block).toContain('- 贝塔（Lv.2 · codex）');
    expect(block).toContain('# 近期任务');
    expect(block).toContain('- [已完成] 修复登录页样式');
    expect(block).toContain('- [失败] 编写部署脚本');
    expect(block).toContain('# 最近对话');
    expect(block).toContain('用户最近说：帮我看看部署报错');
  });

  it('注入位置契约：块是独立一段（首尾无多余空白），service 拼进 persona 与用户消息之间', () => {
    const block = buildStratixContextBlock(snapshot());
    expect(block.trim()).toBe(block); // 拼装用 \n\n join，块自身不带首尾空白
  });

  it('任务摘要与话题超长预截断（带省略号）', () => {
    const longTask = '甲'.repeat(200);
    const longTopic = '乙'.repeat(200);
    const block = buildStratixContextBlock(
      snapshot({
        recentTasks: [{ summary: longTask, status: 'queued', at: 0 } as StratixTaskBrief],
        lastTopic: { text: longTopic, at: 0 },
      })
    );
    expect(block).toContain(`[排队中] ${'甲'.repeat(STRATIX_CONTEXT_TASK_SUMMARY_LEN - 1)}…`);
    expect(block).toContain(`用户最近说：${'乙'.repeat(STRATIX_CONTEXT_TOPIC_LEN - 1)}…`);
    expect(block).not.toContain('甲'.repeat(STRATIX_CONTEXT_TASK_SUMMARY_LEN + 1));
  });

  it('状态标签全覆盖六态词表', () => {
    const statuses: TaskStatus[] = ['queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled'];
    const labels = ['排队中', '执行中', '待审批', '已完成', '失败', '已取消'];
    for (let i = 0; i < statuses.length; i += 1) {
      const block = buildStratixContextBlock(
        snapshot({ recentTasks: [{ summary: `任务${i}`, status: statuses[i] as TaskStatus, at: 0 }] })
      );
      expect(block).toContain(`[${labels[i]}] 任务${i}`);
    }
  });

  it('同场角色超出上限 → 截断并附「…等共 N 名」', () => {
    const peers = Array.from({ length: 20 }, (_, i) => ({
      id: `character_${i + 10}`,
      name: `同伙${i}`,
      kind: 'codex',
      level: 1,
    }));
    const block = buildStratixContextBlock(snapshot({ peers }));
    expect(block).toContain('…等共 20 名');
    expect(block).not.toContain('同伙19'); // 第 13 名起不展示（MAX_PEERS=12）
  });
});

// ============================================================================
// builder：空输入降级（无历史 / 无同场 / 无话题 / 全空）
// ============================================================================

describe('buildStratixContextBlock 空输入降级', () => {
  it('无同场角色 → 该分节整个消失，其余照常', () => {
    const block = buildStratixContextBlock(snapshot({ peers: [] }));
    expect(block).not.toContain('# 同场角色');
    expect(block).toContain('# 近期任务');
  });

  it('无任务史 + 无话题 → 只剩档案与同场', () => {
    const block = buildStratixContextBlock(snapshot({ recentTasks: [], lastTopic: null }));
    expect(block).not.toContain('# 近期任务');
    expect(block).not.toContain('# 最近对话');
    expect(block).toContain('# 角色档案');
    expect(block).toContain('# 同场角色');
  });

  it('四路全空 → 空串（调用方按无块处理，不注入空壳标签）', () => {
    expect(
      buildStratixContextBlock(
        snapshot({ profileSummary: '', peers: [], recentTasks: [], lastTopic: null })
      )
    ).toBe('');
  });

  it('摘要为空白串 → 视为无档案节', () => {
    const block = buildStratixContextBlock(snapshot({ profileSummary: '   ' }));
    expect(block).not.toContain('# 角色档案');
  });
});

// ============================================================================
// builder：截断策略（4000 上限，从尾部段砍）
// ============================================================================

describe('buildStratixContextBlock 截断策略', () => {
  it('总长超限 → 先砍最近对话、再砍近期任务（尾部段整段丢，前段完整保留）', () => {
    const bigPeers = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      name: `超长名字的角色${i}${'长'.repeat(30)}`,
      kind: 'codex',
      level: 9,
    }));
    const block = buildStratixContextBlock(
      snapshot({
        profileSummary: '长'.repeat(300),
        peers: bigPeers,
        recentTasks: [
          { summary: '深'.repeat(48), status: 'completed', at: 1_700_000_000_000 },
          { summary: '度'.repeat(48), status: 'failed', at: 1_700_000_000_000 },
          { summary: '测'.repeat(48), status: 'running', at: 1_700_000_000_000 },
        ],
        lastTopic: { text: '话题', at: 1_700_000_000_000 },
      })
    );
    expect(block.length).toBeLessThanOrEqual(STRATIX_CONTEXT_MAX_CHARS);
    // 标签必须始终配对完整（截断不许产生裸标签）
    expect(block.startsWith(STRATIX_CONTEXT_TAG_OPEN)).toBe(true);
    expect(block.endsWith(STRATIX_CONTEXT_TAG_CLOSE)).toBe(true);
    // 头部段保真：档案节永远在
    expect(block).toContain('# 角色档案');
  });

  it('首段也超限（极端长档案摘要）→ 硬截断首段正文，标签仍配对、总长不超限', () => {
    const block = buildStratixContextBlock(snapshot({ profileSummary: '爆'.repeat(6000) }));
    expect(block.length).toBeLessThanOrEqual(STRATIX_CONTEXT_MAX_CHARS);
    expect(block.startsWith(STRATIX_CONTEXT_TAG_OPEN)).toBe(true);
    expect(block.endsWith(STRATIX_CONTEXT_TAG_CLOSE)).toBe(true);
    expect(block).toContain('# 角色档案');
    expect(block).toContain('…');
    // 其余分节已全被砍掉
    expect(block).not.toContain('# 最近对话');
  });

  it('常规快照远小于上限（预截断保证）', () => {
    const block = buildStratixContextBlock(snapshot());
    expect(block.length).toBeLessThan(1000);
  });
});

// ============================================================================
// provider：快照派生 + 两级开关
// ============================================================================

describe('createStratixContextProvider 快照派生', () => {
  it('同场角色 = 单位命中的其它角色（排除自己 / 排除未绑定 agent / 排除未上场）', () => {
    const me = character();
    const onField = character({ id: 'character_2', name: '贝塔', agentKind: 'codex', level: 2 });
    const onFieldNoKind = character({ id: 'character_4', name: '小四', agentKind: null, level: 1 });
    const offField = character({ id: 'character_5', name: '场外', agentKind: 'kimi', level: 5 });
    const provider = createStratixContextProvider({
      getState: () => ({
        characters: [me, onField, onFieldNoKind, offField],
        units: [
          unit('u1', { characterId: 'character_1' }),
          unit('u2', { characterId: 'character_2' }),
          unit('u4', { characterId: 'character_4' }),
        ],
        tasks: [],
      }),
    });
    const input = provider('character_1');
    expect(input).not.toBeNull();
    expect(input?.peers).toEqual([{ id: 'character_2', name: '贝塔', kind: 'codex', level: 2 }]);
    expect(input?.profileSummary).toContain('Lv.3');
    expect(input?.profileSummary).toContain('codex');
    expect(input?.characterName).toBe('阿锻');
  });

  it('任务史取该角色最近 3 条（createdAt 倒序，时间用 endedAt 优先）', () => {
    const provider = createStratixContextProvider({
      getState: () =>
        state({
          characters: [character()],
          units: [],
          tasks: [
            task({ id: 't1', createdAt: 100, endedAt: 500, status: 'completed' }),
            task({ id: 't2', characterId: 'character_other', createdAt: 999 }),
            task({ id: 't3', createdAt: 300, endedAt: null, startedAt: null, status: 'queued' }),
            task({ id: 't4', createdAt: 200, endedAt: 400, status: 'failed' }),
            task({ id: 't5', createdAt: 50, endedAt: 60, status: 'cancelled' }),
          ],
        }),
    });
    const input = provider('character_1');
    expect(input?.recentTasks.map((t) => t.summary)).toEqual(['修复登录页', '修复登录页', '修复登录页']);
    // 前三条 = createdAt 300/200/100（t3/t4/t1），t5（50）挤出；时间 = endedAt ?? startedAt ?? createdAt
    expect(input?.recentTasks[0]?.at).toBe(300); // t3 无 endedAt/startedAt → createdAt
    expect(input?.recentTasks[1]?.at).toBe(400); // t4 endedAt
    expect(input?.recentTasks[2]?.at).toBe(500); // t1 endedAt
  });

  it('话题透传 lastTopicFor；未给话题口 → null', () => {
    const withTopic = createStratixContextProvider({
      getState: () => state(),
      lastTopicFor: () => ({ text: '最近的话题', at: 1 }),
    });
    expect(withTopic('character_1')?.lastTopic).toEqual({ text: '最近的话题', at: 1 });

    const noTopic = createStratixContextProvider({ getState: () => state() });
    expect(noTopic('character_1')?.lastTopic).toBeNull();
  });
});

describe('createStratixContextProvider 两级开关裁决', () => {
  it('角色级开关关（contextEnabled=false）→ null', () => {
    const provider = createStratixContextProvider({
      getState: () => state({ characters: [character({ contextEnabled: false })] }),
    });
    expect(provider('character_1')).toBeNull();
  });

  it('角色级开关缺省（undefined/null/true）→ 正常出快照', () => {
    for (const value of [undefined, null, true]) {
      const provider = createStratixContextProvider({
        getState: () => state({ characters: [character({ contextEnabled: value })] }),
      });
      expect(provider('character_1')).not.toBeNull();
    }
  });

  it('全局开关关（isEnabled=false）→ null（优先于一切派生）', () => {
    const provider = createStratixContextProvider({
      getState: () => state(),
      isEnabled: () => false,
    });
    expect(provider('character_1')).toBeNull();
  });

  it('角色不在档 → null（不编造快照）', () => {
    const provider = createStratixContextProvider({ getState: () => state() });
    expect(provider('character_ghost')).toBeNull();
  });
});

// ============================================================================
// 全局开关（localStorage 面）
// ============================================================================

describe('isGlobalContextEnabled', () => {
  it('无键 / 值非 0 → 开；值 0 → 关；无存储环境 → 开', () => {
    expect(isGlobalContextEnabled(memoryStorage())).toBe(true);
    expect(isGlobalContextEnabled(memoryStorage({ 'stratix.context.enabled': '1' }))).toBe(true);
    expect(isGlobalContextEnabled(memoryStorage({ 'stratix.context.enabled': '0' }))).toBe(false);
    expect(isGlobalContextEnabled(null)).toBe(true);
  });
});

// ============================================================================
// 话题缓存 persister
// ============================================================================

describe('createTopicCachePersister', () => {
  it('user 消息进缓存（后一条覆盖），非 user 消息不进；全部原样透传落库', () => {
    const persisted: Array<{ characterId: string; role: string; text: string }> = [];
    const cache = createTopicCachePersister((m) => persisted.push(m));
    cache.persist({ characterId: 'c1', role: 'user', text: '第一句' });
    cache.persist({ characterId: 'c1', role: 'assistant', text: '回应' });
    cache.persist({ characterId: 'c1', role: 'user', text: '第二句' });
    cache.persist({ characterId: 'c2', role: 'user', text: '别人的话题' });

    expect(cache.lastTopicFor('c1')).toEqual({ text: '第二句', at: expect.any(Number) });
    expect(cache.lastTopicFor('c2')?.text).toBe('别人的话题');
    expect(cache.lastTopicFor('c3')).toBeNull();
    expect(persisted.map((m) => m.text)).toEqual(['第一句', '回应', '第二句', '别人的话题']);
  });

  it('base 落库抛错 → 吞掉不炸（话题仍进缓存）', () => {
    const lines: string[] = [];
    const cache = createTopicCachePersister(
      () => { throw new Error('disk full'); },
      (line) => lines.push(line)
    );
    expect(() => cache.persist({ characterId: 'c1', role: 'user', text: '话题' })).not.toThrow();
    expect(cache.lastTopicFor('c1')?.text).toBe('话题');
    expect(lines[0]).toContain('disk full');
  });

  it('无 base（非 Electron）→ 只记话题不落库', () => {
    const cache = createTopicCachePersister(undefined);
    expect(() => cache.persist({ characterId: 'c1', role: 'user', text: '话题' })).not.toThrow();
    expect(cache.lastTopicFor('c1')?.text).toBe('话题');
  });
});

// ============================================================================
// resolveStratixContextBlock（service 统一取件口）
// ============================================================================

describe('resolveStratixContextBlock', () => {
  it('注入件缺省 → 空串；快照 null → 空串；有快照 → 块文本', () => {
    expect(resolveStratixContextBlock(undefined, 'c1')).toBe('');
    expect(resolveStratixContextBlock(() => null, 'c1')).toBe('');
    expect(resolveStratixContextBlock(() => snapshot(), 'c1')).toContain(STRATIX_CONTEXT_TAG_OPEN);
  });

  it('注入件抛错 → 吞掉记日志，返回空串（不绑架对话回路）', () => {
    const lines: string[] = [];
    const block = resolveStratixContextBlock(
      () => { throw new Error('snapshot boom'); },
      'c1',
      (line) => lines.push(line)
    );
    expect(block).toBe('');
    expect(lines[0]).toContain('c1');
    expect(lines[0]).toContain('snapshot boom');
  });
});
