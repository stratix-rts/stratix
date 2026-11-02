/**
 * 文件职责：**演示声音包**（task_083）—— 用 WebAudio **代码合成**五个声音，零音频文件。
 *   规格：docs/DEMO-PLAN.md §10「声音包」。
 *   ① 选中 ack：880Hz 短哔 80ms；
 *   ② 派活：哒 —— 240Hz 方波 60ms；
 *   ③ 完成：C5 → E5 上行双音各 120ms；
 *   ④ 报错：180Hz 低鸣 300ms + 轻微失谐；
 *   ⑤ 里程碑：完成音 + 上行琶音（三音）。
 * 输入：core 总线的 world 通道事件（组合根喂 handleEvent —— hud 组件零总线依赖，
 *   与 toast-host / sfx-service 同一装配口径）；localStorage（总开关 + 音量 0-100）；
 *   浏览器用户手势（首次点击解锁 AudioContext）。
 * 输出：WebAudio 振荡器 + 增益包络（AudioContext → destination）；无返回值副作用。
 * 禁止事项：
 *   1. import 任何 src/world/、phaser、app/ —— 铁律（声音是 HUD 侧的纯表现层）；
 *   2. import core/bus —— 订阅归组合根（main-entry 接线段），本模块只暴露 handleEvent；
 *   3. 音频文件 / 音频库 —— DEMO-PLAN §0 的硬约束：全部由振荡器 + 包络合成；
 *   4. 在本模块里另抄一份频率 / 时长 —— 合成参数一律读唯一事实源
 *   （core/theme/visual-spec.ts 的 SOUND_METRICS）；
 *   5. 把开关 / 音量缓存成字段 —— 每次播放现读 localStorage（顶栏改完立即生效）；
 *   6. 未解锁时硬等 resume —— 静默丢弃（见下方「手势激活」）。
 *
 * ============ 事件 → 声音的接线（组合根只管把事件递进来）============
 *   - world 的 fx.sound cue（task_077 预留的钩子）：
 *       select → 选中 ack；command / claim / focus → 派活哒；
 *       complete → 完成音（**兜底通道**，见下方「同一动作只响一声」）；
 *   - core 的 task.completed → 完成音；每满 SOUND_METRICS.milestoneEvery 个换成里程碑复合音
 *     （计数口径与 HUD 里程碑大字同源 —— 同一个 task.completed、同一个间隔）；
 *   - core 的 task.failed → 报错低鸣。
 *
 * ============ 同一动作只响一声 ============
 *   「一次任务完成」有两条通道：core 的 task.completed（事件）与 world 的 fx.sound('complete')
 *   （战场插旗时发出的 cue）。两条都播会叠成噪音 —— 故 task.completed 通道为准，
 *   战场的 complete cue 落在 SOUND_METRICS.duplicateSuppressMs 窗口内时被抑制；
 *   若战场的状态跳变没有对应的 task.completed（回放重演等旁路），cue 仍能兜底发声。
 *
 * ============ 手势激活（浏览器自动播放策略）============
 *   AudioContext 在用户首次交互前是 suspended 态，且在无手势时创建会触发浏览器的
 *   「not allowed to start」告警。故：引擎**不在无手势时创建 ctx**，而是监听首次
 *   pointerdown / keydown —— 命中手势才建 ctx 并 resume()（浏览器只认手势里的调用）。
 *   未解锁窗口内的播放请求静默丢弃（不排队、不报错）：挂起的 ctx 上堆音符，
 *   解锁瞬间会糊成一团，丢弃比错拍好。
 */

import { SOUND_METRICS, type SoundId, type SoundNoteSpec } from '../core/theme/visual-spec';
import type { SoundCue, WorldEvent } from '../core/types';

export type { SoundId } from '../core/theme/visual-spec';

/** 总开关的 localStorage 键（值 '1' 开 / '0' 关；缺键 = 开）。 */
export const SOUND_ENABLED_KEY = 'stratix.sound.enabled';

/** 音量的 localStorage 键（0-100 的整数字符串）。 */
export const SOUND_VOLUME_KEY = 'stratix.sound.volume';

// ============================================================================
// localStorage 读写（顶栏开关 / 音量滑条与本引擎共用同一份逻辑，不各抄一遍）
// ============================================================================

/** localStorage 的最小面（便于单测注入内存实现）。 */
export interface SoundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 缺省存储：浏览器全局 localStorage；没有（node / 隐私模式）时返回 null。 */
function defaultStorage(): SoundStorage | null {
  try {
    const store = (globalThis as { localStorage?: SoundStorage }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/**
 * 读总开关：值 '0' = 关；无键 / 其它值 / 存储异常 = 开。
 * why 缺省开：演示模式默认开（DEMO-PLAN §10「总开关（demo 模式默认开）」），
 *   且音效是锦上添花 —— 缺省关会让直播现场「怎么没声」的排查成本远高于收益。
 */
export function readSoundEnabled(storage: SoundStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(SOUND_ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

/** 写总开关（顶栏 toggle 用）；写失败不抛（隐私模式下次读回落缺省开）。 */
export function writeSoundEnabled(enabled: boolean, storage: SoundStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(SOUND_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // 写不进去就算了：音效缺省开，可用性不受影响。
  }
}

/** 读音量（0-100）：非法值 / 缺键 / 异常回落缺省音量；越界钳回 [0, volumeMax]。 */
export function readSoundVolume(storage: SoundStorage | null = defaultStorage()): number {
  try {
    const raw = Number.parseInt(storage?.getItem(SOUND_VOLUME_KEY) ?? '', 10);
    if (!Number.isFinite(raw)) return SOUND_METRICS.defaultVolume;
    return Math.min(SOUND_METRICS.volumeMax, Math.max(0, raw));
  } catch {
    return SOUND_METRICS.defaultVolume;
  }
}

/** 写音量（顶栏滑条用）；写入前钳回 [0, volumeMax]（滑条失步的防御）。 */
export function writeSoundVolume(volume: number, storage: SoundStorage | null = defaultStorage()): void {
  try {
    const clamped = Math.min(SOUND_METRICS.volumeMax, Math.max(0, Math.round(volume)));
    storage?.setItem(SOUND_VOLUME_KEY, String(clamped));
  } catch {
    // 同 writeSoundEnabled：写丢弃。
  }
}

// ============================================================================
// 纯函数：事件 → 声音 / 音符 → 时间轴
// ============================================================================

/**
 * 战场 cue → 声音（task_077 预留钩子的消费口径）。
 * command / claim / focus 归到同一个「哒」：三者都是「活儿派下去了」的那一声；
 * complete 映射到完成音（是否被抑制由引擎按「同一动作只响一声」裁决）。
 */
export function soundIdForCue(cue: SoundCue): SoundId | null {
  switch (cue) {
    case 'select':
      return 'select';
    case 'command':
    case 'claim':
    case 'focus':
      return 'command';
    case 'complete':
      return 'complete';
    default:
      return null;
  }
}

/**
 * 总线事件 → 声音（组合根接线时用；task.completed 例外 —— 它由引擎自己计数裁决
 * 完成音还是里程碑复合音，故此处返回 null）。
 */
export function soundIdForEvent(event: WorldEvent): SoundId | null {
  switch (event.type) {
    case 'fx.sound':
      return soundIdForCue(event.cue);
    case 'task.failed':
      return 'error';
    default:
      return null;
  }
}

/** 规划后的音符（可直接灌进 WebAudio 的时间轴参数）。 */
export interface PlannedNote {
  /** 实际要跑的振荡器频率（Hz）：失谐时是两个（基频 + 偏移频）。 */
  readonly frequencies: readonly number[];
  /** 起播时刻（ctx.currentTime 基准，秒；= contextTime + delayMs/1000）。 */
  readonly startAt: number;
  /** 起音完成时刻（秒；attack 不越过收零时刻 —— 短音自动压扁包络）。 */
  readonly attackEndAt: number;
  /** 峰值保持到此刻（秒；无 hold 时 = attackEndAt）。 */
  readonly holdEndAt: number;
  /** 收零时刻（秒；= startAt + durationMs/1000）。 */
  readonly stopAt: number;
  /** 实际峰值响度（= note.gain × masterVolume，masterVolume 为 0-1）。 */
  readonly peakGain: number;
}

/** 音分 → 频率倍率（2^(cents/1200)）。 */
function centsToRatio(cents: number): number {
  return 2 ** (cents / 1200);
}

/**
 * 音符规划（纯函数）：音符参数 + 全局音量 + 当前 ctx 时钟 → 时间轴全量参数。
 * 包络形态：0 --attack(线性)--> peak --[hold]--> peak --(线性)--> 0。
 * holdRatio = 0 时没有保持段，起音后一路线性衰减（短促的「叮」）；
 * holdRatio > 0 时保持峰值到指定比例处再收（低鸣的「嗡」）。
 */
export function planNote(note: SoundNoteSpec, masterVolume: number, contextTime: number): PlannedNote {
  const startAt = contextTime + (note.delayMs ?? 0) / 1000;
  const stopAt = startAt + note.durationMs / 1000;
  const attackMs = note.attackMs ?? SOUND_METRICS.attackMs;
  const attackEndAt = Math.min(startAt + attackMs / 1000, stopAt);
  const holdRatio = note.holdRatio ?? 0;
  const holdEndAt = Math.min(startAt + (note.durationMs * holdRatio) / 1000, stopAt);
  const frequencies =
    note.detuneCents && note.detuneCents > 0
      ? [note.frequency, note.frequency * centsToRatio(note.detuneCents)]
      : [note.frequency];
  return {
    frequencies,
    startAt,
    attackEndAt,
    holdEndAt: Math.max(holdEndAt, attackEndAt),
    stopAt,
    peakGain: note.gain * masterVolume,
  };
}

// ============================================================================
// WebAudio 最小结构面（懒初始化 + 测试 mock 注入的共同契约）
// ============================================================================

/** 参数值（AudioParam 的最小面：value 可写）。 */
interface SoundParam {
  value: number;
}

/** 包络参数（AudioParam 的最小面：两个线性调度调用）。 */
interface SoundEnvelopeParam {
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
}

/** 振荡器最小面（真实 OscillatorNode 经工厂处的 unknown 断言接入）。 */
interface SoundOscillator {
  type: string;
  frequency: SoundParam;
  connect(node: SoundGain): void;
  start(when: number): void;
  stop(when: number): void;
}

/** 增益节点最小面。 */
interface SoundGain {
  gain: SoundEnvelopeParam;
  connect(destination: unknown): void;
}

/** AudioContext 最小面（本模块只用这几个口）。 */
export interface SoundAudioContext {
  readonly currentTime: number;
  readonly state: string;
  resume(): unknown;
  createOscillator(): SoundOscillator;
  createGain(): SoundGain;
  readonly destination: unknown;
}

/** document 的最小面（只为挂 / 摘手势监听）。 */
export interface SoundDocument {
  addEventListener(type: string, listener: (event: unknown) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

/**
 * 缺省 AudioContext 工厂：浏览器原生（经 unknown 断言接进最小面 —— 真实节点面比本接口宽，
 * 结构断言是刻意的，避免在接口上做 connect 重载的兼容体操）；无 AudioContext 全局
 * （jsdom / 极老浏览器）返回 null → 播放静默 no-op。
 */
function defaultCreateAudioContext(): SoundAudioContext | null {
  const Ctor = (globalThis as { AudioContext?: new () => unknown }).AudioContext;
  return Ctor ? (new Ctor() as unknown as SoundAudioContext) : null;
}

/** 缺省 document 取法（浏览器全局；没有则返回 null —— 纯逻辑环境无手势可听）。 */
function defaultDocument(): SoundDocument | null {
  try {
    const doc = (globalThis as { document?: SoundDocument }).document;
    return doc ?? null;
  } catch {
    return null;
  }
}

/** 解锁尝试：resume 同步抛 / 异步 reject 都吞掉（音效不冒错给调用方）。 */
function tryUnlock(context: SoundAudioContext): void {
  try {
    const resumed = context.resume() as Promise<void> | void;
    if (resumed && typeof (resumed as Promise<void>).catch === 'function') {
      (resumed as Promise<void>).catch(() => undefined);
    }
  } catch {
    // 极端环境（ctx 已被关闭等）：吞掉 —— 下一次播放还会再试。
  }
}

// ============================================================================
// 引擎
// ============================================================================

/** 注入件（全部可选，缺省 = 浏览器原生 / Date.now / 真 localStorage / 真 document）。 */
export interface SoundEnginePorts {
  /** AudioContext 工厂（手势命中时才调用；返回 null = 无音频环境）。测试注入 mock。 */
  readonly createAudioContext?: () => SoundAudioContext | null;
  /** 时钟口（节流判定用）。测试注入可控时钟。 */
  readonly now?: () => number;
  /** localStorage 取法（缺省走浏览器全局；测试注入内存实现）。 */
  readonly storage?: () => SoundStorage | null;
  /** document 取法（手势监听用；缺省走浏览器全局）。 */
  readonly document?: () => SoundDocument | null;
}

/** 引擎对外形状（组合根与测试按它操作）。 */
export interface SoundEngine {
  /** 喂一个总线事件（world 通道）—— 事件 → 声音的裁决全在内部。 */
  handleEvent(event: WorldEvent): void;
  /** 直接播一个声音（测试与将来 HUD 主动触发用；开关 / 节流 / 解锁门同样生效）。 */
  play(id: SoundId): void;
  /** 释放：摘手势监听、丢 AudioContext 引用与节流时间戳（页面销毁时调用）。 */
  dispose(): void;
  /** AudioContext 是否已创建（观察口：懒初始化断言 —— 没手势不建 ctx）。 */
  readonly contextCreated: boolean;
  /** 是否已发生过用户手势（观察口）。 */
  readonly gestureSeen: boolean;
  /** 已计到的任务完成数（观察口：里程碑计数）。 */
  readonly completedCount: number;
}

/** 手势事件名（pointerdown 覆盖鼠标 / 触摸；keydown 覆盖键盘操作）。 */
const GESTURE_EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * 创建声音引擎。构造零副作用（不建 ctx、不读存储、不挂 DOM —— 手势监听是唯一的
 * DOM 副作用，且在首次命中后自摘）。
 */
export function createSoundEngine(ports: SoundEnginePorts = {}): SoundEngine {
  const createContext = ports.createAudioContext ?? defaultCreateAudioContext;
  const now = ports.now ?? Date.now;
  const resolveStorage = ports.storage ?? defaultStorage;
  const resolveDocument = ports.document ?? defaultDocument;

  let context: SoundAudioContext | null = null;
  let gestureSeen = false;
  let completedCount = 0;
  /** 已释放标记：dispose 之后不再发声（页面销毁后不该再有声音冒出来）。 */
  let disposed = false;
  /** 每个声音各自的节流时间戳（不同声音互不影响）。 */
  const lastPlayedAtMs = new Map<SoundId, number>();
  /** 最近一次「完成音」的时刻（毫秒）：战场的 complete cue 在窗口内被抑制。 */
  let lastCompletionSoundAtMs = Number.NEGATIVE_INFINITY;

  // ===== 手势监听（首次 pointerdown / keydown 命中即建 ctx + resume）=====
  const gestureListener = (): void => {
    activate();
  };
  const removeGestureListeners = (): void => {
    const doc = resolveDocument();
    if (!doc) return;
    for (const type of GESTURE_EVENTS) {
      try {
        doc.removeEventListener(type, gestureListener);
      } catch {
        // 摘不掉就算了：引擎即将 dispose 时也会再摘一次。
      }
    }
  };
  const installGestureListeners = (): void => {
    const doc = resolveDocument();
    if (!doc) return;
    for (const type of GESTURE_EVENTS) {
      try {
        doc.addEventListener(type, gestureListener, { once: true });
      } catch {
        // 挂不上（老浏览器 / 怪环境）：播放时仍会懒建 ctx（可能带浏览器告警）。
      }
    }
  };

  /** 手势命中：建 ctx（仅此之后才建）并解锁。 */
  const activate = (): void => {
    gestureSeen = true;
    removeGestureListeners();
    const ctx = ensureContext();
    if (ctx !== null && ctx.state !== 'running') tryUnlock(ctx);
  };

  /** 取（必要时建）AudioContext —— 没有手势前一律返回 null（不建 ctx，不触发浏览器告警）。 */
  const ensureContext = (): SoundAudioContext | null => {
    if (context !== null) return context;
    if (!gestureSeen) return null;
    try {
      context = createContext();
    } catch {
      context = null;
    }
    return context;
  };

  /** 调度单个音符：规划（纯函数）→ 灌进 WebAudio 时间轴。 */
  const scheduleNote = (ctx: SoundAudioContext, note: SoundNoteSpec, masterVolume: number): void => {
    const planned = planNote(note, masterVolume, ctx.currentTime);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, planned.startAt);
    envelope.gain.linearRampToValueAtTime(planned.peakGain, planned.attackEndAt);
    if (planned.holdEndAt > planned.attackEndAt) {
      envelope.gain.linearRampToValueAtTime(planned.peakGain, planned.holdEndAt);
    }
    envelope.gain.linearRampToValueAtTime(0, planned.stopAt);
    for (const frequency of planned.frequencies) {
      const oscillator = ctx.createOscillator();
      oscillator.type = note.waveform ?? 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(envelope);
      oscillator.start(planned.startAt);
      // stop 留 5ms 余量：与收零 ramp 同帧 stop 在部分实现上有截断咔哒声。
      oscillator.stop(planned.stopAt + 0.005);
    }
    envelope.connect(ctx.destination);
  };

  /** 播一个声音：总开关 → 音量 → 节流 → AudioContext → 解锁门 → 调度。 */
  const play = (id: SoundId): void => {
    // 门零：已释放（页面销毁）→ 不发声。
    if (disposed) return;
    // 门一：总开关（每次现读 localStorage —— 顶栏改完立即生效）。
    if (!readSoundEnabled(resolveStorage())) return;
    // 门二：音量（0 = 静音；不为 0 也要调度 0 峰值的音符是浪费，直接不排）。
    const volume = readSoundVolume(resolveStorage());
    if (volume <= 0) return;
    // 门三：节流（同声音 throttleMs 内不重播；不同声音各自计时）。
    const atMs = now();
    const last = lastPlayedAtMs.get(id);
    if (last !== undefined && atMs - last < SOUND_METRICS.throttleMs) return;
    // 门四：AudioContext（没有用户手势前不建 —— 见文件头「手势激活」）。
    const ctx = ensureContext();
    if (ctx === null) return;
    if (ctx.state !== 'running') {
      // 自动播放策略：未解锁 → 请求 resume，本次静默丢弃。节流不记：
      // 丢弃不占坑，解锁后的下一个事件照常发声。
      tryUnlock(ctx);
      return;
    }
    // 四门全过才算「真正发声」：此刻才记节流时间戳。
    lastPlayedAtMs.set(id, atMs);
    const masterVolume = volume / SOUND_METRICS.volumeMax;
    for (const note of SOUND_METRICS.sounds[id]) {
      scheduleNote(ctx, note, masterVolume);
    }
  };

  /** 完成音（里程碑时用复合音）：同时记下时刻，供战场的 complete cue 抑制用。 */
  const playCompletion = (id: 'complete' | 'milestone'): void => {
    lastCompletionSoundAtMs = now();
    play(id);
  };

  /** 总线事件入口：完成 / 里程碑 / 报错 / 战场 cue 的统一裁决。 */
  const handleEvent = (event: WorldEvent): void => {
    if (event.type === 'task.completed') {
      completedCount += 1;
      const isMilestone = completedCount % SOUND_METRICS.milestoneEvery === 0;
      playCompletion(isMilestone ? 'milestone' : 'complete');
      return;
    }
    if (event.type === 'fx.sound' && event.cue === 'complete') {
      // 同一动作只响一声：task.completed 通道已经发过完成音（或里程碑复合音）→
      //   窗口内的战场 cue 丢弃，不叠第二声。
      if (now() - lastCompletionSoundAtMs < SOUND_METRICS.duplicateSuppressMs) return;
      playCompletion('complete');
      return;
    }
    const id = soundIdForEvent(event);
    if (id !== null) play(id);
  };

  installGestureListeners();

  return {
    handleEvent,
    play,
    dispose: () => {
      disposed = true;
      removeGestureListeners();
      context = null;
      lastPlayedAtMs.clear();
    },
    get contextCreated() {
      return context !== null;
    },
    get gestureSeen() {
      return gestureSeen;
    },
    get completedCount() {
      return completedCount;
    },
  };
}
