/**
 * 单元测试：演示声音包（hud/sound-engine.ts，task_083）。
 * 覆盖：① 五音的合成参数（频率 / 时长 / 波形 —— 对着 DEMO-PLAN §10 逐条断言）；
 *      ② 包络形状（起音 → 峰值 → 收零）与峰值响度（= 相对响度 × 音量）；
 *      ③ 事件接线（世界 cue / task.completed / task.failed）与里程碑计数；
 *      ④ 总开关、音量 0-100、节流；
 *      ⑤ 手势激活（首次 pointerdown 建 ctx + resume，且控制台零报错）。
 * jsdom 没有 AudioContext —— 用注入的 mock ctx（结构最小面 SoundAudioContext）驱动。
 * @jest-environment jsdom
 */

import { SOUND_METRICS } from '../../core/theme/visual-spec';
import type { WorldEvent } from '../../core/types';
import {
  SOUND_ENABLED_KEY,
  SOUND_VOLUME_KEY,
  createSoundEngine,
  planNote,
  readSoundEnabled,
  readSoundVolume,
  soundIdForCue,
  soundIdForEvent,
  writeSoundEnabled,
  writeSoundVolume,
  type SoundAudioContext,
  type SoundStorage,
} from '../sound-engine';

// ============================================================================
// mock AudioContext：录制每个振荡器的调度参数与包络调用
// ============================================================================

interface EnvelopeCall {
  readonly kind: 'set' | 'ramp';
  readonly value: number;
  readonly at: number;
}

interface RecordedNote {
  readonly frequency: number;
  readonly type: string;
  readonly startAt: number;
  readonly stopAt: number;
  readonly envelope: readonly EnvelopeCall[];
}

interface MockContext {
  readonly ctx: SoundAudioContext;
  readonly played: RecordedNote[];
  readonly resumeCalls: () => number;
}

function createMockContext(options: { state?: string; currentTime?: number; resumeChangesState?: boolean } = {}): MockContext {
  const played: RecordedNote[] = [];
  let resumeCalls = 0;
  // 真实浏览器里新建的 AudioContext 一律是 suspended（等用户手势解锁）—— mock 照此建模。
  let state = options.state ?? 'suspended';
  const ctx: SoundAudioContext = {
    currentTime: options.currentTime ?? 10,
    get state() {
      return state;
    },
    resume: () => {
      resumeCalls += 1;
      if (options.resumeChangesState !== false) state = 'running';
      return Promise.resolve();
    },
    createOscillator: () => {
      const osc = {
        type: 'sine',
        frequency: { value: 0 },
        envelope: null as EnvelopeCall[] | null,
        startAt: -1,
        stopAt: -1,
        connect: (node: unknown) => {
          osc.envelope = (node as { calls: EnvelopeCall[] }).calls;
        },
        start: (when: number) => {
          osc.startAt = when;
        },
        stop: (when: number) => {
          osc.stopAt = when;
          played.push({
            frequency: osc.frequency.value,
            type: osc.type,
            startAt: osc.startAt,
            stopAt: osc.stopAt,
            envelope: osc.envelope ?? [],
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

/** 内存 localStorage（缺省 = 空 → 总开关开、音量取缺省）。 */
function createStorage(initial: Record<string, string> = {}): SoundStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

/** 造一个引擎：mock ctx + 内存存储 + 可控时钟。 */
function makeEngine(options: {
  storage?: SoundStorage;
  now?: () => number;
  state?: string;
  resumeChangesState?: boolean;
} = {}) {
  const mock = createMockContext({
    state: options.state,
    resumeChangesState: options.resumeChangesState,
  });
  const storage = options.storage ?? createStorage();
  let created = 0;
  let clock = 1000;
  const engine = createSoundEngine({
    createAudioContext: () => {
      created += 1;
      return mock.ctx;
    },
    now: options.now ?? (() => clock),
    storage: () => storage,
  });
  return {
    engine,
    mock,
    created: () => created,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** 触发一次用户手势（引擎监听 pointerdown → 建 ctx + resume）。 */
function gesture(): void {
  document.dispatchEvent(new Event('pointerdown'));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('声音包：五音的合成参数（DEMO-PLAN §10）', () => {
  test('选中 ack = 880Hz 短哔 80ms', () => {
    const notes = SOUND_METRICS.sounds.select;
    expect(notes).toHaveLength(1);
    expect(notes[0].frequency).toBe(880);
    expect(notes[0].durationMs).toBe(80);
  });

  test('派活 = 240Hz 方波 60ms', () => {
    const notes = SOUND_METRICS.sounds.command;
    expect(notes).toHaveLength(1);
    expect(notes[0].frequency).toBe(240);
    expect(notes[0].durationMs).toBe(60);
    expect(notes[0].waveform).toBe('square');
  });

  test('完成 = C5 → E5 上行双音各 120ms', () => {
    const notes = SOUND_METRICS.sounds.complete;
    expect(notes.map((n) => n.frequency)).toEqual([523.25, 659.25]);
    expect(notes.every((n) => n.durationMs === 120)).toBe(true);
    // 上行：第二个音晚一个音长起播。
    expect(notes[1].delayMs).toBe(120);
  });

  test('报错 = 180Hz 低鸣 300ms + 轻微失谐', () => {
    const notes = SOUND_METRICS.sounds.error;
    expect(notes).toHaveLength(1);
    expect(notes[0].frequency).toBe(180);
    expect(notes[0].durationMs).toBe(300);
    expect(notes[0].detuneCents).toBeGreaterThan(0);
  });

  test('里程碑 = 完成音 + 上行琶音（三音）', () => {
    const notes = SOUND_METRICS.sounds.milestone;
    // 前两音是完成音本体，后三音是上行琶音。
    expect(notes.map((n) => n.frequency).slice(0, 2)).toEqual([523.25, 659.25]);
    expect(notes.map((n) => n.frequency).slice(2)).toEqual([523.25, 659.25, 783.99]);
    // 琶音三音依次排布（不叠音）。
    const arpeggio = notes.slice(2);
    expect(arpeggio[1].delayMs).toBeGreaterThan(arpeggio[0].delayMs ?? 0);
    expect(arpeggio[2].delayMs).toBeGreaterThan(arpeggio[1].delayMs ?? 0);
  });
});

describe('声音包：包络与响度（纯函数）', () => {
  test('包络 = 0 起音到峰值再线性收零', () => {
    const planned = planNote(SOUND_METRICS.sounds.select[0], 1, 10);
    expect(planned.startAt).toBe(10);
    expect(planned.attackEndAt).toBeCloseTo(10 + SOUND_METRICS.attackMs / 1000, 6);
    expect(planned.stopAt).toBeCloseTo(10.08, 6);
    expect(planned.peakGain).toBeCloseTo(SOUND_METRICS.sounds.select[0].gain, 6);
  });

  test('峰值响度 = 相对响度 × 全局音量', () => {
    const planned = planNote(SOUND_METRICS.sounds.select[0], 0.5, 0);
    expect(planned.peakGain).toBeCloseTo(SOUND_METRICS.sounds.select[0].gain * 0.5, 6);
  });

  test('失谐音叠两个振荡器（低鸣的拍频来源）', () => {
    const planned = planNote(SOUND_METRICS.sounds.error[0], 1, 0);
    expect(planned.frequencies).toHaveLength(2);
    expect(planned.frequencies[0]).toBe(180);
    expect(planned.frequencies[1]).toBeGreaterThan(180);
    expect(planned.frequencies[1]).toBeLessThan(190);
  });

  test('低鸣音有峰值保持段（不是立刻衰减）', () => {
    const planned = planNote(SOUND_METRICS.sounds.error[0], 1, 0);
    expect(planned.holdEndAt).toBeGreaterThan(planned.attackEndAt);
    expect(planned.holdEndAt).toBeLessThan(planned.stopAt);
  });

  test('短音的起音不越过收零时刻（不产生坏参数）', () => {
    const planned = planNote({ frequency: 440, durationMs: 2, gain: 0.5 }, 1, 0);
    expect(planned.attackEndAt).toBeLessThanOrEqual(planned.stopAt);
  });
});

describe('声音包：事件接线', () => {
  test('战场 cue → 声音（select / command / claim / focus / complete）', () => {
    expect(soundIdForCue('select')).toBe('select');
    expect(soundIdForCue('command')).toBe('command');
    expect(soundIdForCue('claim')).toBe('command');
    expect(soundIdForCue('focus')).toBe('command');
    expect(soundIdForCue('complete')).toBe('complete');
  });

  test('task.failed → 报错音；其余事件不配音', () => {
    const failed = { type: 'task.failed', task: { id: 't1' } } as unknown as WorldEvent;
    expect(soundIdForEvent(failed)).toBe('error');
    expect(soundIdForEvent({ type: 'exp.gained' } as unknown as WorldEvent)).toBeNull();
  });

  test('选中 cue 真的发声（880Hz）', () => {
    const { engine, mock } = makeEngine();
    gesture();
    engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(mock.played).toHaveLength(1);
    expect(mock.played[0].frequency).toBe(880);
    engine.dispose();
  });

  test('派活 cue 真的发声（240Hz 方波）', () => {
    const { engine, mock } = makeEngine();
    gesture();
    engine.handleEvent({ type: 'fx.sound', cue: 'command' } as WorldEvent);
    expect(mock.played[0].frequency).toBe(240);
    expect(mock.played[0].type).toBe('square');
    engine.dispose();
  });

  test('task.failed 真的发声（180Hz 低鸣）', () => {
    const { engine, mock } = makeEngine();
    gesture();
    engine.handleEvent({ type: 'task.failed', task: { id: 't1' } } as unknown as WorldEvent);
    expect(mock.played.length).toBeGreaterThanOrEqual(1);
    expect(mock.played[0].frequency).toBe(180);
    engine.dispose();
  });
});

describe('声音包：完成与里程碑', () => {
  test('前 9 次完成走完成音，第 10 次换成里程碑复合音', () => {
    const { engine, mock, advance } = makeEngine();
    gesture();
    for (let i = 0; i < 9; i += 1) {
      engine.handleEvent({ type: 'task.completed', task: { id: `t${i}` } } as unknown as WorldEvent);
      advance(SOUND_METRICS.throttleMs + 1); // 越过节流窗口
    }
    // 完成音 = C5 → E5 两个振荡器。
    expect(mock.played).toHaveLength(18);
    expect(mock.played[0].frequency).toBe(523.25);
    expect(engine.completedCount).toBe(9);

    engine.handleEvent({ type: 'task.completed', task: { id: 't9' } } as unknown as WorldEvent);
    expect(engine.completedCount).toBe(10);
    // 里程碑 = 完成音 + 琶音三音 → 五个振荡器。
    const last = mock.played.slice(-5);
    expect(last.map((n) => n.frequency)).toEqual([523.25, 659.25, 523.25, 659.25, 783.99]);
    engine.dispose();
  });

  test('同一动作只响一声：task.completed 之后紧接的战场 complete cue 被抑制', () => {
    const { engine, mock } = makeEngine();
    gesture();
    engine.handleEvent({ type: 'task.completed', task: { id: 't1' } } as unknown as WorldEvent);
    expect(mock.played).toHaveLength(2); // 完成音 C5 → E5
    engine.handleEvent({ type: 'fx.sound', cue: 'complete' } as WorldEvent);
    expect(mock.played).toHaveLength(2); // 没有第二声
    engine.dispose();
  });

  test('没有对应 task.completed 时，战场的 complete cue 兜底发声', () => {
    const { engine, mock } = makeEngine();
    gesture();
    engine.handleEvent({ type: 'fx.sound', cue: 'complete' } as WorldEvent);
    expect(mock.played).toHaveLength(2);
    engine.dispose();
  });
});

describe('声音包：总开关 / 音量 / 节流', () => {
  test('总开关关掉后一声不响', () => {
    const storage = createStorage({ [SOUND_ENABLED_KEY]: '0' });
    const { engine, mock } = makeEngine({ storage });
    gesture();
    engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(mock.played).toHaveLength(0);
    engine.dispose();
  });

  test('总开关缺省是开的（演示模式默认开）', () => {
    expect(readSoundEnabled(createStorage())).toBe(true);
  });

  test('音量 0 → 不排音符；音量 100 → 峰值 = 相对响度', () => {
    const muted = makeEngine({ storage: createStorage({ [SOUND_VOLUME_KEY]: '0' }) });
    gesture();
    muted.engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(muted.mock.played).toHaveLength(0);
    muted.engine.dispose();

    const loud = makeEngine({ storage: createStorage({ [SOUND_VOLUME_KEY]: '100' }) });
    gesture();
    loud.engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    const peak = loud.mock.played[0].envelope.find((c) => c.kind === 'ramp');
    expect(peak?.value).toBeCloseTo(SOUND_METRICS.sounds.select[0].gain, 6);
    loud.engine.dispose();
  });

  test('音量读写（0-100，越界钳回）', () => {
    const storage = createStorage();
    writeSoundVolume(45, storage);
    expect(readSoundVolume(storage)).toBe(45);
    writeSoundVolume(999, storage);
    expect(readSoundVolume(storage)).toBe(SOUND_METRICS.volumeMax);
    writeSoundVolume(-5, storage);
    expect(readSoundVolume(storage)).toBe(0);
  });

  test('开关读写', () => {
    const storage = createStorage();
    writeSoundEnabled(false, storage);
    expect(readSoundEnabled(storage)).toBe(false);
    writeSoundEnabled(true, storage);
    expect(readSoundEnabled(storage)).toBe(true);
  });

  test('同一声音在节流窗口内不重播', () => {
    let clock = 1000;
    const { engine, mock } = makeEngine({ now: () => clock });
    gesture();
    engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(mock.played).toHaveLength(1);
    clock += SOUND_METRICS.throttleMs - 10;
    engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(mock.played).toHaveLength(1); // 窗口内：被节流
    clock += 20;
    engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(mock.played).toHaveLength(2); // 窗口外：再响一声
    engine.dispose();
  });
});

describe('声音包：手势激活', () => {
  test('没有手势不建 AudioContext（不触发浏览器自动播放告警）', () => {
    const { engine, mock, created } = makeEngine();
    engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(created()).toBe(0);
    expect(engine.contextCreated).toBe(false);
    expect(mock.played).toHaveLength(0);
    engine.dispose();
  });

  test('首次点击建 ctx 并解锁，控制台零报错', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, mock, created } = makeEngine();
    gesture();
    expect(created()).toBe(1);
    expect(mock.resumeCalls()).toBe(1);
    expect(engine.gestureSeen).toBe(true);
    // 解锁后立刻能发声。
    engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(mock.played).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    engine.dispose();
  });

  test('ctx 处于 suspended 时静默丢弃（不排队、不报错）', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // resume 不改状态：模拟「点了但浏览器没解锁」的极端情形。
    const { engine, mock } = makeEngine({ state: 'suspended', resumeChangesState: false });
    gesture();
    engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(mock.played).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    engine.dispose();
  });

  test('dispose 之后不再发声（资源释放）', () => {
    const { engine, mock } = makeEngine();
    gesture();
    engine.dispose();
    engine.handleEvent({ type: 'fx.sound', cue: 'select' } as WorldEvent);
    expect(mock.played).toHaveLength(0);
  });
});
