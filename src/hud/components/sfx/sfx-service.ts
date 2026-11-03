/**
 * 文件职责：**音效反馈服务**（task_060）—— 关键事件的「那一声」（Tech→Product 音频方法论：少而准）。
 *   事件 → 音的映射表 SFX_TABLE 冻结 ≤5 种（克制：exp.gained 每次任务都发、太频繁，刻意不配音）；
 *   每种音是一串短促正弦音（OscillatorNode + GainNode 线性包络），全程序化合成 ——
 *   v2 考古（git ls-tree master，无任何 .mp3/.ogg/.wav 与 audio 模块）确认无资产可复用，
 *   合成参数（频率 / 时长 / 音量）集中在本表常量，不引任何音频库。
 *   与 toast-host 同一装配口径：服务只暴露 play(key)，事件订阅在组合根接线
 *   （onWorldEvent → sfxKeyForEvent → play，hud 零总线依赖 —— 见 main-entry 接线段）。
 * 输入：play(key)（组合根喂）；设置屏直写的 localStorage（**声音引擎那一对键**
 *   'stratix.sound.enabled' 总开关 / 'stratix.sound.volume' 全局音量，每次播放现读 —— 设置屏改完
 *   立即生效，不留第二份真相）。
 * 输出：WebAudio 音符调度（AudioContext → destination）；无副作用返回值。
 * ============ AudioContext 懒初始化与自动播放策略 ============
 *   ① 懒初始化：首个 play 才创建 AudioContext（无事件不建 ctx —— 页面加载零音频开销）；
 *   ② 浏览器自动播放策略：AudioContext 在用户首次交互前是 suspended 态 —— 此时调用
 *     resume() 请求解锁，**本次播放静默丢弃**（不报错、不排队：挂起的 ctx 上调度音符会在
 *     解锁瞬间糊成一团，丢弃比错拍好）；解锁后的下一个事件正常发声；
 *   ③ 无 AudioContext 环境（jsdom / 极老浏览器）：静默 no-op —— 音效是锦上添花，不是功能。
 * 节流：同 key 在 SFX_THROTTLE_MS（1s）内不重播（五个事件可能成串到达 —— 流水线连跑 /
 *   批量失败时不能机关枪）；不同 key 互不影响。节流时间戳只在**真正发声**时记录
 *   （被开关拦下 / 未解锁丢弃的不占坑：解锁后紧跟的事件还有一声）。
 * 禁止事项：
 *   1. 引入音频库 / 音频文件 / 新依赖 —— 程序合成是刻意的（零资产、零加载、体积极小）；
 *   2. 在这里订阅总线 —— 事件→key 的裁决在纯函数 sfxKeyForEvent，订阅归组合根；
 *   3. 把 enabled/volume 缓存进服务字段 —— localStorage 每次现读（设置屏直写后立即生效）；
 *   4. 未解锁时硬等 resume 再播 —— 静默丢弃（见上方②）；
 *   5. 音符调度抛错冒泡 —— 单个音符失败只影响那一声，不能打断调用方的事件处理。
 *
 * @since v3.36（task_060）。
 */

import type { WorldEvent } from '../../../core/types';
// 声音引擎那一对键（@since v3.7，task_130 收敛）：本服务与演示声音包**共用**同一道闸。
//   why 不再各写一份键：task_060 时代本服务用 'stratix.sfx.*'，声音引擎用 'stratix.sound.*' ——
//   双键并存时"读侧用哪个全凭缘分"，关一边总有一半声音关不掉。收敛后只有一个活跃键
//   （老键值的迁移在 hud/sound-engine.ts 的 migrateLegacySoundPreferences 里做）。
import { readSoundEnabled, readSoundVolumeRatio } from '../../sound-engine';

// ============================================================================
// 常量表（合成参数单一真相源）
// ============================================================================

/** 同 key 重播节流窗口（ms）：1s 内同一事件音只响一次（常量，规格③）。 */
export const SFX_THROTTLE_MS = 1000;

/** 包络起音时长（ms）：0 → peak 的线性爬升。太短（<5ms）有咔哒声，太长音头发闷。 */
export const SFX_ATTACK_MS = 12;

/**
 * 音效键词表（≤5 种，规格①）。键名与 WorldEvent 的 type 同名 —— sfxKeyForEvent 直接透传。
 * 刻意不收录的：exp.gained（每次任务都发，太频繁）、task.cancelled / agent.online
 * （已有持久可见态或轻提示，不抢「少而准」的耳朵预算）。
 */
export type SfxKey =
  | 'task.completed'
  | 'task.failed'
  | 'level.up'
  | 'task.awaiting_approval'
  | 'agent.offline';

/** 单音符合成参数（全部正弦波；gain 是 0-1 内的相对响度，播放时再乘全局音量）。 */
export interface SfxNote {
  /** 频率（Hz）。 */
  readonly frequency: number;
  /** 音长（ms，从 start 到完全收零）。 */
  readonly durationMs: number;
  /** 相对响度（0-1；与全局音量相乘 = 实际 peak）。 */
  readonly gain: number;
  /** 相对本音组开头的延迟（ms；缺省 0 —— 音组内串行排布靠它，不是靠相邻音长凑）。 */
  readonly delayMs?: number;
}

/**
 * 事件 → 音映射表（规格①，冻结 5 种）：
 *   - task.completed 轻快双音：A5→D6 上行小跳（880→1174.66Hz）——「收工」的明快；
 *   - task.failed 低沉单音：G3（196Hz）长音 ——「出事了」的钝重，与 toast danger 同族；
 *   - level.up 上行三连音：C5→E5→G5 大三和弦琶音 ——「涨了」的阶梯感（尾音稍长收稳）；
 *   - task.awaiting_approval 提示两音：F#5→C#5 下行 ——「等你裁决」的询问感（非故障，
 *     刻意比 failed 轻、比 completed 短）；
 *   - agent.offline 短低音：E3（164.81Hz）一记闷响 —— 掉线是坏消息，但灰显已是主提醒。
 */
export const SFX_TABLE: Readonly<Record<SfxKey, readonly SfxNote[]>> = {
  'task.completed': [
    { frequency: 880, durationMs: 90, gain: 0.5 },
    { frequency: 1174.66, durationMs: 140, gain: 0.5, delayMs: 100 },
  ],
  'task.failed': [
    { frequency: 196, durationMs: 320, gain: 0.5 },
  ],
  'level.up': [
    { frequency: 523.25, durationMs: 90, gain: 0.45 },
    { frequency: 659.25, durationMs: 90, gain: 0.45, delayMs: 100 },
    { frequency: 783.99, durationMs: 200, gain: 0.45, delayMs: 200 },
  ],
  'task.awaiting_approval': [
    { frequency: 739.99, durationMs: 110, gain: 0.4 },
    { frequency: 554.37, durationMs: 170, gain: 0.4, delayMs: 130 },
  ],
  'agent.offline': [
    { frequency: 164.81, durationMs: 180, gain: 0.4 },
  ],
};

// ============================================================================
// 纯函数：事件映射 / 音符规划（独立导出，单测直打）
// ============================================================================

/**
 * 事件 → 音效键（组合根接线用）。词表外的事件（含刻意不收录的 exp.gained）一律 null。
 */
export function sfxKeyForEvent(event: WorldEvent): SfxKey | null {
  switch (event.type) {
    case 'task.completed':
    case 'task.failed':
    case 'level.up':
    case 'task.awaiting_approval':
    case 'agent.offline':
      return event.type; // 键名与事件 type 同名，透传即映射
    default:
      return null;
  }
}

/** 规划后的音符（可直接灌进 WebAudio 的时间轴参数 —— freq/时长/包络的全量生成参数）。 */
export interface PlannedSfxNote {
  readonly frequency: number;
  /** 起播时刻（ctx.currentTime 基准，秒；= contextTime + delayMs/1000）。 */
  readonly startAt: number;
  /** 起音完成时刻（秒；attack 不越过音长 —— 短音自动压扁包络，不产生 attack > stop 的坏参数）。 */
  readonly attackEndAt: number;
  /** 收零时刻（秒；= startAt + durationMs/1000）。 */
  readonly stopAt: number;
  /** 实际峰值响度（= note.gain × masterVolume）。 */
  readonly peakGain: number;
}

/**
 * 音符规划（纯函数，规格④）：note 参数 + 全局音量 + 当前 ctx 时钟 → 时间轴全量参数。
 * 包络形态：0 --线性--> peak（attack）--线性--> 0（整个余长当 release，短音的「叮」感）。
 */
export function planNote(note: SfxNote, masterVolume: number, contextTime: number): PlannedSfxNote {
  const startAt = contextTime + (note.delayMs ?? 0) / 1000;
  const stopAt = startAt + note.durationMs / 1000;
  const attackEndAt = Math.min(startAt + SFX_ATTACK_MS / 1000, stopAt);
  return {
    frequency: note.frequency,
    startAt,
    attackEndAt,
    stopAt,
    peakGain: note.gain * masterVolume,
  };
}

// ============================================================================
// localStorage：与声音引擎共用同一对键（@since v3.7，task_130 收敛）
// ============================================================================
// 本服务**不再**自建一套开关 / 音量的读写口：总开关与音量都读 hud/sound-engine.ts 的
//   readSoundEnabled / readSoundVolumeRatio（同一份键、同一份迁移、同一份缺省）。
//   why：老服务读 'stratix.sfx.enabled'、声音引擎读 'stratix.sound.enabled' —— 双键并存时
//   「关掉音效」只关掉一半通路，另一半照样响。老键值的迁移在 sound-engine 里做（见其迁移函数）。

// ============================================================================
// WebAudio 最小结构面（懒初始化 + 测试 mock 注入的共同契约）
// ============================================================================

/** 参数值（AudioParam 的最小面：value 可写）。 */
interface SfxParam {
  value: number;
}

/** 包络参数（AudioParam 的最小面：两个线性调度调用）。 */
interface SfxEnvelopeParam {
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
}

/** 振荡器最小面（真实 OscillatorNode 经工厂处的 unknown 断言接入，不做结构兼容体操）。 */
interface SfxOscillator {
  type: string;
  frequency: SfxParam;
  connect(node: SfxGain): void;
  start(when: number): void;
  stop(when: number): void;
}

/** 增益节点最小面。 */
interface SfxGain {
  gain: SfxEnvelopeParam;
  connect(destination: unknown): void;
}

/** AudioContext 最小面（本服务只用这几个口）。 */
export interface SfxAudioContext {
  readonly currentTime: number;
  readonly state: string;
  resume(): unknown;
  createOscillator(): SfxOscillator;
  createGain(): SfxGain;
  readonly destination: unknown;
}

/**
 * 缺省 AudioContext 工厂：浏览器原生（经 unknown 断言接进最小面 —— 真实节点面比本接口
 * 宽，结构断言是刻意的，避免在接口上做 connect 重载的兼容体操）；无 AudioContext
 * 全局（jsdom / 极老浏览器）返回 null → play 静默 no-op。
 */
function defaultCreateAudioContext(): SfxAudioContext | null {
  const Ctor = (globalThis as { AudioContext?: new () => unknown }).AudioContext;
  return Ctor ? (new Ctor() as unknown as SfxAudioContext) : null;
}

/** 播放失败前的解锁尝试：resume 同步抛 / 异步 reject 都吞掉（音效不冒错给调用方）。 */
function tryUnlock(context: SfxAudioContext): void {
  try {
    const resumed = context.resume() as Promise<void> | void;
    if (resumed && typeof (resumed as Promise<void>).catch === 'function') {
      (resumed as Promise<void>).catch(() => undefined);
    }
  } catch {
    // 极端环境（ctx 已被关闭等）：吞掉 —— 下一次 play 还会再试。
  }
}

/** 单音符调度：规划（纯函数）→ 灌进 WebAudio 时间轴。振荡器自带 stop 时点，无需回收。 */
function scheduleNote(context: SfxAudioContext, note: SfxNote, masterVolume: number): void {
  const planned = planNote(note, masterVolume, context.currentTime);
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = planned.frequency;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, planned.startAt);
  envelope.gain.linearRampToValueAtTime(planned.peakGain, planned.attackEndAt);
  envelope.gain.linearRampToValueAtTime(0, planned.stopAt);
  oscillator.connect(envelope);
  envelope.connect(context.destination);
  oscillator.start(planned.startAt);
  // stop 留 5ms 余量：与收零 ramp 同帧 stop 在部分实现上有截断咔哒声。
  oscillator.stop(planned.stopAt + 0.005);
}

// ============================================================================
// 服务（组合根与测试共用同一份逻辑）
// ============================================================================

/** 注入件（全部可选，缺省 = 浏览器原生 / Date.now / 真 localStorage）。 */
export interface SfxServicePorts {
  /** AudioContext 工厂（懒初始化时调用；返回 null = 无音频环境）。测试注入 mock。 */
  readonly createAudioContext?: () => SfxAudioContext | null;
  /** 时钟口（节流判定用；测试注入可控时钟，不依赖 fake timers）。 */
  readonly now?: () => number;
}

/** 服务对外形状（组合根与测试按它操作）。 */
export interface SfxService {
  /** 播放一音（开关 / 节流 / 解锁态三重门都在内部，调用方零判断）。 */
  play(key: SfxKey): void;
  /** 释放：丢掉 AudioContext 引用与节流时间戳（页面销毁时调用；ctx 由 GC 收）。 */
  dispose(): void;
  /** AudioContext 是否已创建（测试观察口：懒初始化断言 —— 无事件不建 ctx）。 */
  readonly contextCreated: boolean;
}

/** 创建音效服务。构造零副作用（不建 ctx、不读存储）—— 生命周期归组合根控制。 */
export function createSfxService(ports: SfxServicePorts = {}): SfxService {
  const createContext = ports.createAudioContext ?? defaultCreateAudioContext;
  const now = ports.now ?? Date.now;
  let context: SfxAudioContext | null = null;
  const lastPlayedAtMs = new Map<SfxKey, number>();

  const play = (key: SfxKey): void => {
    // 门一：总开关（每次现读 localStorage —— 设置屏直写后立即生效；键与声音引擎同一把）。
    if (!readSoundEnabled()) return;
    // 门二：节流（同 key 1s 内不重播；不同 key 各自计时，互不影响）。
    const atMs = now();
    const last = lastPlayedAtMs.get(key);
    if (last !== undefined && atMs - last < SFX_THROTTLE_MS) return;
    // 门三：AudioContext（懒初始化 —— 首个真正要发声的事件才建）。
    if (context === null) context = createContext();
    if (context === null) return; // 无音频环境：静默 no-op（jsdom 同款路径）
    if (context.state !== 'running') {
      // 自动播放策略：未解锁 → 请求 resume，本次静默丢弃（文件头②）。节流不记：
      // 丢弃不占坑，解锁后的下一个事件照常发声。
      tryUnlock(context);
      return;
    }
    // 三门全过才算「真正发声」：此刻才记节流时间戳。
    lastPlayedAtMs.set(key, atMs);
    const masterVolume = readSoundVolumeRatio();
    for (const note of SFX_TABLE[key]) {
      scheduleNote(context, note, masterVolume);
    }
  };

  return {
    play,
    dispose: () => {
      context = null;
      lastPlayedAtMs.clear();
    },
    get contextCreated() {
      return context !== null;
    },
  };
}
