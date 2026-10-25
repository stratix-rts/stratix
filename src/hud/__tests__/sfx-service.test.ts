/**
 * 单元测试：音效反馈服务（hud/components/sfx/sfx-service.ts，task_060）。
 * jsdom 没有 AudioContext —— 正好测两件事：①服务逻辑用注入的 mock ctx（结构最小面
 * SfxAudioContext）驱动：节流 / 开关 / 音量 / 懒初始化 / 未解锁丢弃；②纯函数直打：
 * 映射表完整性、sfxKeyForEvent 词表、planNote 合成参数。缺省工厂在 jsdom 里返回
 * null（无 AudioContext 全局）→ play 静默 no-op 也是一条被测路径。
 * @jest-environment jsdom
 */

import type { WorldEvent } from '../../core/types';
import {
  DEFAULT_SFX_VOLUME,
  SFX_ATTACK_MS,
  SFX_ENABLED_KEY,
  SFX_TABLE,
  SFX_THROTTLE_MS,
  SFX_VOLUME_KEY,
  createSfxService,
  planNote,
  readSfxEnabled,
  readSfxVolume,
  sfxKeyForEvent,
  writeSfxEnabled,
  writeSfxVolume,
  type SfxAudioContext,
  type SfxKey,
  type SfxNote,
} from '../components/sfx/sfx-service';

// ============================================================================
// mock AudioContext：录制每个音符的调度参数（频率 / 时间轴 / 包络调用）
// ============================================================================

interface EnvelopeCall {
  readonly kind: 'set' | 'ramp';
  readonly value: number;
  readonly at: number;
}

interface RecordedNote {
  readonly frequency: number;
  readonly startAt: number;
  readonly stopAt: number;
  readonly envelope: readonly EnvelopeCall[];
}

interface MockContext {
  readonly ctx: SfxAudioContext;
  readonly played: RecordedNote[];
  readonly resumeCalls: () => number;
}

function createMockContext(options: { state?: string; currentTime?: number } = {}): MockContext {
  const played: RecordedNote[] = [];
  let resumeCalls = 0;
  let state = options.state ?? 'running';
  const ctx: SfxAudioContext = {
    currentTime: options.currentTime ?? 42,
    get state() {
      return state;
    },
    resume: () => {
      resumeCalls += 1;
      state = 'running'; // 模拟解锁成功（下一个事件就能过门）
      return Promise.resolve();
    },
    createOscillator: () => {
      const osc = {
        type: 'sine',
        frequency: { value: 0 },
        connectedGain: null as { calls: EnvelopeCall[] } | null,
        startAt: -1,
        stopAt: -1,
        connect: (node: unknown) => {
          osc.connectedGain = node as { calls: EnvelopeCall[] };
        },
        start: (when: number) => {
          osc.startAt = when;
        },
        stop: (when: number) => {
          osc.stopAt = when;
          played.push({
            frequency: osc.frequency.value,
            startAt: osc.startAt,
            stopAt: osc.stopAt,
            envelope: (osc.connectedGain as { calls: EnvelopeCall[] } | null)?.calls ?? [],
          });
        },
      };
      return osc;
    },
    createGain: () => {
      const node = {
        calls: [] as EnvelopeCall[],
        gain: {
          setValueAtTime: (value: number, at: number) => {
            node.calls.push({ kind: 'set', value, at });
          },
          linearRampToValueAtTime: (value: number, at: number) => {
            node.calls.push({ kind: 'ramp', value, at });
          },
        },
        connect: (_destination: unknown) => undefined,
      };
      return node;
    },
    destination: { __mockDestination: true },
  };
  return { ctx, played, resumeCalls: () => resumeCalls };
}

/** 服务全家桶：mock ctx + 工厂计数（懒初始化断言）+ 可控时钟（节流断言）。 */
function makeService(options: {
  state?: string;
  now?: () => number;
  onContextCreated?: () => void;
}): { service: ReturnType<typeof createSfxService>; mock: MockContext; created: () => number } {
  const mock = createMockContext({ state: options.state });
  let created = 0;
  const service = createSfxService({
    createAudioContext: () => {
      created += 1;
      return mock.ctx;
    },
    now: options.now ?? (() => 0),
  });
  return { service, mock, created: () => created };
}

// ============================================================================
// 映射表完整性（规格④：表常量直打）
// ============================================================================

describe('SFX_TABLE：映射表完整性与合成参数合法性', () => {
  const EXPECTED_KEYS: readonly SfxKey[] = [
    'task.completed',
    'task.failed',
    'level.up',
    'task.awaiting_approval',
    'agent.offline',
  ];

  test('恰好 5 种（≤5 的克制口径：一词不多、一词不少）', () => {
    expect(Object.keys(SFX_TABLE).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  test('每种音非空且参数合法（频率/时长的量级、响度在 0-1 内）', () => {
    for (const key of EXPECTED_KEYS) {
      const notes = SFX_TABLE[key];
      expect(notes.length).toBeGreaterThan(0);
      for (const note of notes) {
        expect(note.frequency).toBeGreaterThan(80); // 可听频段（低到 164Hz 的掉线音也在内）
        expect(note.frequency).toBeLessThan(4000); // 不刺耳
        expect(note.durationMs).toBeGreaterThan(0);
        expect(note.durationMs).toBeLessThanOrEqual(500); // 「短促」的量级上限
        expect(note.gain).toBeGreaterThan(0);
        expect(note.gain).toBeLessThanOrEqual(1);
        if (note.delayMs !== undefined) expect(note.delayMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('音色契约：completed 双音 / failed 单音 / level.up 三连音 / awaiting 两音 / offline 单音', () => {
    expect(SFX_TABLE['task.completed']).toHaveLength(2);
    expect(SFX_TABLE['task.failed']).toHaveLength(1);
    expect(SFX_TABLE['level.up']).toHaveLength(3);
    expect(SFX_TABLE['task.awaiting_approval']).toHaveLength(2);
    expect(SFX_TABLE['agent.offline']).toHaveLength(1);
    // level.up 是上行三连音：频率严格递增
    const freqs = SFX_TABLE['level.up'].map((n: SfxNote) => n.frequency);
    expect(freqs[0]).toBeLessThan(freqs[1]);
    expect(freqs[1]).toBeLessThan(freqs[2]);
  });
});

describe('sfxKeyForEvent：事件 → 音效键', () => {
  test('五个目标事件透传同名键', () => {
    expect(sfxKeyForEvent({ type: 'task.completed', task: {} as never })).toBe('task.completed');
    expect(sfxKeyForEvent({ type: 'task.failed', task: {} as never })).toBe('task.failed');
    expect(sfxKeyForEvent({ type: 'level.up', characterId: 'c1', fromLevel: 1, toLevel: 2 })).toBe('level.up');
    expect(sfxKeyForEvent({ type: 'task.awaiting_approval', task: {} as never })).toBe('task.awaiting_approval');
    expect(sfxKeyForEvent({ type: 'agent.offline', kind: 'claude' as never })).toBe('agent.offline');
  });

  test('词表外一律 null：exp.gained 刻意不配音（太频繁），queued/cancelled/online 等同样安静', () => {
    const quiet: readonly Partial<WorldEvent>[] = [
      { type: 'exp.gained', characterId: 'c1', source: 'task_completed', amount: 5 },
      { type: 'task.queued', task: {} as never },
      { type: 'task.cancelled', task: {} as never },
      { type: 'agent.online', kind: 'claude' as never },
      { type: 'pipeline.completed', pipelineId: 'p1', pipelineName: 'x' },
      { type: 'unit.position', unitId: 'u1', x: 0, y: 0 },
    ];
    for (const event of quiet) {
      expect(sfxKeyForEvent(event as WorldEvent)).toBeNull();
    }
  });
});

// ============================================================================
// planNote：合成参数纯函数（规格④：freq/duration/envelope 生成参数）
// ============================================================================

describe('planNote：时间轴与包络参数', () => {
  test('无延迟音符：start = ctx 时钟，attack 12ms，stop = start + 时长，peak = gain×音量', () => {
    const planned = planNote({ frequency: 880, durationMs: 90, gain: 0.5 }, 0.8, 42);
    expect(planned.frequency).toBe(880);
    expect(planned.startAt).toBe(42);
    expect(planned.attackEndAt).toBeCloseTo(42 + SFX_ATTACK_MS / 1000, 10);
    expect(planned.stopAt).toBeCloseTo(42 + 0.09, 10);
    expect(planned.peakGain).toBeCloseTo(0.4, 10);
  });

  test('带延迟音符：delay 推 start；attack 不越过 stop（短音自动压扁包络）', () => {
    const planned = planNote({ frequency: 1174.66, durationMs: 5, gain: 1, delayMs: 100 }, 1, 0);
    expect(planned.startAt).toBeCloseTo(0.1, 10);
    expect(planned.stopAt).toBeCloseTo(0.105, 10);
    expect(planned.attackEndAt).toBeCloseTo(0.105, 10); // min(attack, stop)
  });

  test('音量为 0 → peak 0（静音但不崩参数）', () => {
    const planned = planNote({ frequency: 196, durationMs: 320, gain: 0.5 }, 0, 0);
    expect(planned.peakGain).toBe(0);
  });
});

// ============================================================================
// localStorage 读写：开关与音量持久化（规格④）
// ============================================================================

describe('开关与音量的 localStorage 持久化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('开关缺省开；写 0 读关、写 1 读开', () => {
    expect(readSfxEnabled()).toBe(true);
    writeSfxEnabled(false);
    expect(localStorage.getItem(SFX_ENABLED_KEY)).toBe('0');
    expect(readSfxEnabled()).toBe(false);
    writeSfxEnabled(true);
    expect(readSfxEnabled()).toBe(true);
  });

  test('音量缺省 1；写 0.3 读 0.3；写入前钳回 [0,1]', () => {
    expect(readSfxVolume()).toBe(DEFAULT_SFX_VOLUME);
    writeSfxVolume(0.3);
    expect(localStorage.getItem(SFX_VOLUME_KEY)).toBe('0.3');
    expect(readSfxVolume()).toBe(0.3);
    writeSfxVolume(2);
    expect(readSfxVolume()).toBe(1);
    writeSfxVolume(-1);
    expect(readSfxVolume()).toBe(0);
  });

  test('音量读侧容错：垃圾值 / 越界值回落（NaN→默认，2→钳 1，-0.5→钳 0）', () => {
    localStorage.setItem(SFX_VOLUME_KEY, 'not-a-number');
    expect(readSfxVolume()).toBe(DEFAULT_SFX_VOLUME);
    localStorage.setItem(SFX_VOLUME_KEY, '2');
    expect(readSfxVolume()).toBe(1);
    localStorage.setItem(SFX_VOLUME_KEY, '-0.5');
    expect(readSfxVolume()).toBe(0);
  });
});

// ============================================================================
// 服务逻辑（mock ctx 注入：懒初始化 / 节流 / 开关 / 音量 / 解锁丢弃）
// ============================================================================

describe('createSfxService：懒初始化', () => {
  beforeEach(() => localStorage.clear());

  test('无事件不建 ctx：构造与静默期工厂零调用', () => {
    const { service, created } = makeService({});
    expect(created()).toBe(0);
    expect(service.contextCreated).toBe(false);
  });

  test('首个 play 才建 ctx，且只建一次（后续播放复用）', () => {
    const { service, created, mock } = makeService({});
    service.play('task.completed');
    expect(created()).toBe(1);
    expect(service.contextCreated).toBe(true);
    service.play('task.failed');
    service.play('level.up');
    expect(created()).toBe(1); // 不重复建
    expect(mock.played.length).toBe(2 + 1 + 3); // completed 双音 + failed 单音 + level.up 三连音（不同 key 互不节流）
  });

  test('无 AudioContext 环境（工厂返回 null）：静默 no-op，不抛不记', () => {
    const service = createSfxService({ createAudioContext: () => null, now: () => 0 });
    expect(() => service.play('task.completed')).not.toThrow();
    expect(service.contextCreated).toBe(false);
  });

  test('jsdom 无 AudioContext 全局：缺省工厂同样静默（真实环境路径）', () => {
    const service = createSfxService({ now: () => 0 });
    expect(() => service.play('level.up')).not.toThrow();
    expect(service.contextCreated).toBe(false);
  });
});

describe('createSfxService：节流（同 key 1s 不重播，不同 key 互不影响）', () => {
  beforeEach(() => localStorage.clear());

  test('同 key 1s 内第二次不播；满 1s 后恢复', () => {
    let now = 0;
    const { service, mock } = makeService({ now: () => now });
    service.play('task.completed');
    expect(mock.played).toHaveLength(2); // 双音

    now = 500;
    service.play('task.completed');
    expect(mock.played).toHaveLength(2); // 节流拦下

    now = SFX_THROTTLE_MS - 1;
    service.play('task.completed');
    expect(mock.played).toHaveLength(2); // 差 1ms 仍拦

    now = SFX_THROTTLE_MS;
    service.play('task.completed');
    expect(mock.played).toHaveLength(4); // 满 1s 放行
  });

  test('不同 key 互不影响：A 播完立刻播 B，B 照常发声', () => {
    let now = 0;
    const { service, mock } = makeService({ now: () => now });
    service.play('task.failed');
    expect(mock.played).toHaveLength(1);
    now = 100;
    service.play('agent.offline');
    expect(mock.played).toHaveLength(2);
    now = 200;
    service.play('level.up');
    expect(mock.played).toHaveLength(5);
  });
});

describe('createSfxService：总开关与音量（localStorage 现读）', () => {
  beforeEach(() => localStorage.clear());

  test('开关关（0）：play 全拦，且不建 ctx（开关门在懒初始化之前）', () => {
    localStorage.setItem(SFX_ENABLED_KEY, '0');
    const { service, created } = makeService({});
    service.play('task.completed');
    expect(created()).toBe(0);
    expect(service.contextCreated).toBe(false);
  });

  test('播放中途关开关：下一次 play 立即静音（每次现读，不缓存）', () => {
    let now = 0;
    const { service, mock } = makeService({ now: () => now });
    service.play('task.completed');
    expect(mock.played).toHaveLength(2);
    writeSfxEnabled(false);
    now = 5000;
    service.play('task.completed');
    expect(mock.played).toHaveLength(2); // 关了：不再有声音
  });

  test('音量参与包络：peak = note.gain × 全局音量', () => {
    localStorage.setItem(SFX_VOLUME_KEY, '0.5');
    const { service, mock } = makeService({});
    service.play('task.failed'); // 单音 gain 0.5 → peak 0.25
    const note = mock.played[0];
    expect(note.frequency).toBe(196);
    // 包络：set(0) → ramp(peak) → ramp(0)
    expect(note.envelope[0]).toEqual({ kind: 'set', value: 0, at: note.startAt });
    expect(note.envelope[1]?.kind).toBe('ramp');
    expect(note.envelope[1]?.value).toBeCloseTo(0.25, 10);
    expect(note.envelope[2]).toMatchObject({ kind: 'ramp', value: 0 });
  });
});

describe('createSfxService：自动播放策略（未解锁静默丢弃）', () => {
  beforeEach(() => localStorage.clear());

  test('suspended 态：不发声、请求 resume、节流不占坑（解锁后下一事件照常播）', async () => {
    let now = 0;
    const { service, mock } = makeService({ state: 'suspended', now: () => now });
    service.play('task.completed');
    expect(mock.played).toHaveLength(0); // 静默丢弃
    expect(service.contextCreated).toBe(true); // ctx 建了（懒初始化已发生）

    await Promise.resolve(); // 让 mock resume 的状态翻转落地
    expect(mock.resumeCalls()).toBe(1);

    // 解锁后同 key 立刻再触发：未被丢弃事件占用节流坑 → 正常发声
    now = 10;
    service.play('task.completed');
    expect(mock.played).toHaveLength(2);
    expect(mock.resumeCalls()).toBe(1); // running 态不再请求解锁
  });

  test('dispose 后重新 play 会再建 ctx（生命周期可重来）', () => {
    let now = 0;
    const { service, created, mock } = makeService({ now: () => now });
    service.play('task.completed');
    expect(created()).toBe(1);
    service.dispose();
    expect(service.contextCreated).toBe(false);
    now = 5000; // 避开节流（虽然 dispose 已清时间戳，这里只是双保险）
    service.play('task.completed');
    expect(created()).toBe(2);
    expect(mock.played).toHaveLength(4);
  });
});
