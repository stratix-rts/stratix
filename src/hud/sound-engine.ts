/**
 * 文件职责：**演示声音包**（task_083 建 / task_087 升级）—— 优先回放**真实音源**
 *   （public/sfx/*.mp3，Freesound CC0）；文件缺失 / 加载失败时**回退**到 WebAudio 代码合成，
 *   保证「任何环境下都有声」。
 *   规格：docs/DEMO-PLAN.md §10「声音包」。
 *   ① 选中 ack：public/sfx/select.mp3；
 *   ② 派活：public/sfx/dispatch.mp3；
 *   ③ 完成：public/sfx/complete.mp3；
 *   ④ 报错：public/sfx/error.mp3；
 *   ⑤ 里程碑：public/sfx/milestone.mp3（回退合成 = 完成音 + 上行琶音）。
 * 输入：core 总线的 world 通道事件（组合根喂 handleEvent —— hud 组件零总线依赖，
 *   与 toast-host / sfx-service 同一装配口径）；localStorage（总开关 + 音量 0-100）；
 *   浏览器用户手势（首次点击解锁 AudioContext）；public/sfx/ 下的真实音源文件。
 * 输出：AudioBufferSource（真实音源）或 WebAudio 振荡器 + 增益包络（回退合成）→ destination。
 * 禁止事项：
 *   1. import 任何 src/world/、phaser、app/ —— 铁律（声音是 HUD 侧的纯表现层）；
 *   2. import core/bus —— 订阅归组合根（main-entry 接线段），本模块只暴露 handleEvent；
 *   3. 引入音频库 / npm 依赖 —— 只用浏览器原生 WebAudio；
 *   4. 在本模块里另抄一份频率 / 时长 —— 合成参数一律读唯一事实源
 *   （core/theme/visual-spec.ts 的 SOUND_METRICS）；
 *   5. 把开关 / 音量缓存成字段 —— 每次播放现读 localStorage（顶栏改完立即生效）；
 *   6. 未解锁时硬等 resume —— 静默丢弃（见下方「手势激活」）；
 *   7. 在音频文件缺失时抛错 / 打 console.error —— 静默回退合成器（见下方「回退合成」）。
 *
 * ================================ Attribution ================================
 * 五个真实音源全部来自 **Freesound**（https://freesound.org），许可 **CC0 1.0**
 * （公共领域贡献，可商用、可改编、无需署名 —— 仍保留出处以示尊重）。
 * 文件放在 public/sfx/（站点根下的 /sfx/），渲染层按 '../../../sfx' 相对基址取
 * （规则同 src/world/appearance/spritesheet-path.ts 的素材基址）。
 *
 *   select.mp3     ← fs:320181  "hint"          Freesound · CC0  （选中 ack）
 *   dispatch.mp3   ← fs:54405   "Button Click"  Freesound · CC0  （派活）
 *   complete.mp3   ← fs:243701  "correct"       Freesound · CC0  （完成）
 *   error.mp3      ← fs:242503  "Failure / wrong action" Freesound · CC0（报错）
 *   milestone.mp3  ← fs:442943  "Level Up"      Freesound · CC0  （里程碑）
 *
 * 备选（未入库，留在 docs/sfx-staging/）：fs:253177（短版里程碑 0.39s）、fs:702806（水滴点击）。
 * =========================================================================
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
 * ============ 真实音源优先 + 回退合成 ============
 *   播放请求的顺序：① 已有解码缓存 → 直接播；② 正在加载 → **攒下这一次请求**，
 *   加载完成后补响（不吞掉用户的第一次点击；同一音效至多补一声，不叠音）；
 *   ③ 未加载 → 后台 fetch + decodeAudioData，成功则缓存，失败则**永久回退**到合成器
 *   （同一个音效只试一次，缺文件不该每次触发都发一次 404）。
 *   手势解锁后预热全部五个文件（演示现场的第一次响动不该等网络）。
 *   回退合成时仍走同一套门（开关 / 音量 / 节流），只是音源从文件换成振荡器。
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

/**
 * 音量档位（@since v3.6，task_116）：静音 / 30 / 70 / 100 —— 点击循环切档。
 * why 有档位而不是连续调：顶栏那个 20×6px 的小条上连续调无从下手，
 *   「点一下换一个值」才是能被点出来的交互（死功能报告 #5：点了音量永远不变）。
 */
export const VOLUME_PRESETS: readonly number[] = Object.freeze([0, 30, 70, 100]);

/**
 * 下一档音量：找**严格大于**当前值的档位；没有（已到顶或超出）则回到静音档。
 * @since v3.6（task_116）
 */
export function nextVolumePreset(current: number): number {
  for (const preset of VOLUME_PRESETS) {
    if (preset > current) return preset;
  }
  return VOLUME_PRESETS[0] ?? 0;
}

/**
 * 音量的文字标签：0 → 「静音」，其余 → 「N%」。
 * why 单独抽：标题 / aria-label / 按钮文字三处用同一口径，
 *   免得出现「静音 0%」这类自相矛盾的文案（@since v3.6，task_116）。
 */
export function volumeLabel(volume: number): string {
  return volume <= 0 ? '静音' : `${Math.round(volume)}%`;
}

// ============================================================================
// 真实音源：文件清单 + 基址解析
// ============================================================================

/** 一个真实音源文件的描述。 */
export interface SfxFileSpec {
  /** 文件名（相对音频根目录，如 'select.mp3'）。 */
  readonly file: string;
  /** 出处与许可（Attribution 摘要；详见本文件顶部的 Attribution 注释块）。 */
  readonly attribution: string;
}

/**
 * 五个声音 → 真实音源文件（键 = SoundId）。
 * why 键是 SoundId 而不是 cue —— cue 是「战场动作」，SoundId 是「声音」，
 *   一个 cue 可映射到同一声音（command / claim / focus 共用 dispatch.mp3）。
 */
export const SFX_FILES: Readonly<Record<SoundId, SfxFileSpec>> = Object.freeze({
  /** 选中 ack —— fs:320181 · Freesound · CC0。 */
  select: Object.freeze({ file: 'select.mp3', attribution: 'fs:320181 · Freesound · CC0' }),
  /** 派活 —— fs:54405 · Freesound · CC0。 */
  command: Object.freeze({ file: 'dispatch.mp3', attribution: 'fs:54405 · Freesound · CC0' }),
  /** 完成 —— fs:243701 · Freesound · CC0。 */
  complete: Object.freeze({ file: 'complete.mp3', attribution: 'fs:243701 · Freesound · CC0' }),
  /** 报错 —— fs:242503 · Freesound · CC0。 */
  error: Object.freeze({ file: 'error.mp3', attribution: 'fs:242503 · Freesound · CC0' }),
  /** 里程碑 —— fs:442943 · Freesound · CC0。 */
  milestone: Object.freeze({ file: 'milestone.mp3', attribution: 'fs:442943 · Freesound · CC0' }),
});

/** 音频目录名（相对站点根）：public/sfx/ → 站点根下的 /sfx/。 */
export const SFX_DIR_NAME = 'sfx';

/**
 * 入口 HTML 相对站点根的目录层数（缺省 3 = src/app/main/）。
 * 事实源是 src/app/entry-paths.ts 的 ENTRY_PATH_DEPTH —— 组合根（main-entry）会显式传进来，
 * 这里的缺省值只是「按默认入口布局」的兜底（同 src/world/appearance/spritesheet-path.ts 的做法：
 * 事实源在 app 层，纯函数层留一个缺省值 + 单测断言两处一致）。
 */
export const DEFAULT_SFX_DEPTH = 3;

/** 按入口深度算出音频根的**相对** URL 片段（不带前导斜杠），如 '../../../sfx'。 */
export function sfxRelativeBase(depth: number = DEFAULT_SFX_DEPTH): string {
  const levels = Math.max(0, Math.floor(depth));
  return `${'../'.repeat(levels)}${SFX_DIR_NAME}`;
}

/**
 * 把 base URI 解析成音频根的绝对 URL（末尾无斜杠）。
 *
 * @param baseUri 页面基址（通常是 document.baseURI）。
 * @param depth 入口 HTML 相对站点根的目录层数。
 * @returns 音频根 URL，如 'http://127.0.0.1:7523/sfx' / 'file://…/dist/frontend/sfx'。
 *
 * why 用相对规则而不是"http 就用绝对路径、file:// 才特殊"：
 *   两条分支要维护两个真相（还得判断协议），而相对规则在 http 与 file:// 下是同一条 ——
 *   URL 解析会把 '../' 归一化，dev 的 '/src/app/main/xxx.html' 与 prod 的
 *   '/dist/frontend/src/app/main/xxx.html' 都能落回各自的站点根（file:// 下绝对路径
 *   '/sfx' 会被解析到文件系统根，正式包必须走相对基址）。
 */
export function sfxBaseUrl(baseUri: string, depth: number = DEFAULT_SFX_DEPTH): string {
  return new URL(sfxRelativeBase(depth), baseUri).href.replace(/\/+$/, '');
}

/** 拼出某个音效文件的绝对 URL。 */
export function sfxFileUrl(baseUrl: string, fileName: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${fileName}`;
}

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

/** 解码后的音频缓冲最小面（真实 AudioBuffer 经 unknown 断言接入）。 */
export interface SoundAudioBuffer {
  /** 缓冲时长（秒）。 */
  readonly duration: number;
}

/** 缓冲源节点最小面（真实 AudioBufferSourceNode 经 unknown 断言接入）。 */
export interface SoundBufferSource {
  /** 待播缓冲（回放真实音源时挂上）。 */
  buffer: SoundAudioBuffer | null;
  connect(node: SoundGain): void;
  start(when: number): void;
  stop(when: number): void;
}

/** AudioContext 最小面（本模块只用这几个口）。 */
export interface SoundAudioContext {
  readonly currentTime: number;
  readonly state: string;
  resume(): unknown;
  createOscillator(): SoundOscillator;
  createGain(): SoundGain;
  /** 建缓冲源（回放真实音源）。 */
  createBufferSource(): SoundBufferSource;
  /** 解码音频字节（真实音源）。 */
  decodeAudioData(data: ArrayBuffer): Promise<SoundAudioBuffer>;
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

/**
 * 缺省音频根 URL：按当前页面基址 + 默认入口深度推导。
 * why 不是硬编码 '/sfx'：electron 正式包走 file://，绝对路径会被解析到文件系统根；
 *   组合根（main-entry）会显式传入口深度进来，这里只是没传时的兜底。
 */
function defaultSfxBaseUrl(): string {
  try {
    const baseUri = (globalThis as { document?: { baseURI?: string } }).document?.baseURI;
    return baseUri ? sfxBaseUrl(baseUri) : `/${SFX_DIR_NAME}`;
  } catch {
    return `/${SFX_DIR_NAME}`;
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

/**
 * 音频文件加载器：URL → 可播放缓冲；返回 null = 取不到（调用方回退合成器）。
 * 缺省实现 = fetch 取字节 + AudioContext.decodeAudioData 解码。
 */
export type SoundFileLoader = (url: string, context: SoundAudioContext) => Promise<SoundAudioBuffer | null>;

/** 缺省加载器：fetch → arrayBuffer → decodeAudioData；任何一步失败都归为「取不到」。 */
async function defaultLoadAudioFile(url: string, context: SoundAudioContext): Promise<SoundAudioBuffer | null> {
  const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof fetchFn !== 'function') return null;
  const response = await fetchFn(url);
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  return await context.decodeAudioData(bytes);
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
  /** 音频根 URL（如 'http://127.0.0.1:7523/sfx'）；缺省按页面基址推导。 */
  readonly sfxBaseUrl?: string;
  /** 音频文件加载器（缺省 = fetch + decodeAudioData；测试注入）。 */
  readonly loadAudioFile?: SoundFileLoader;
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
  /** 已解码的真实音源数量（观察口：file 回放命中数）。 */
  readonly loadedFileCount: number;
  /** 已确认取不到文件、回退合成器的音效数量（观察口）。 */
  readonly fallbackCount: number;
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
  const loadAudioFile = ports.loadAudioFile ?? defaultLoadAudioFile;
  const baseUrl = ports.sfxBaseUrl ?? defaultSfxBaseUrl();

  let context: SoundAudioContext | null = null;
  let gestureSeen = false;
  let completedCount = 0;
  /** 已释放标记：dispose 之后不再发声（页面销毁后不该再有声音冒出来）。 */
  let disposed = false;
  /** 每个声音各自的节流时间戳（不同声音互不影响）。 */
  const lastPlayedAtMs = new Map<SoundId, number>();
  /** 最近一次「完成音」的时刻（毫秒）：战场的 complete cue 在窗口内被抑制。 */
  let lastCompletionSoundAtMs = Number.NEGATIVE_INFINITY;
  /** 已解码的真实音源（键 = SoundId）：命中即播，不碰网络。 */
  const bufferCache = new Map<SoundId, SoundAudioBuffer>();
  /** 已确认取不到文件的音效 → 永久回退合成器（缺文件不该每次触发都发一次 404）。 */
  const synthFallbackIds = new Set<SoundId>();
  /** 正在加载中的音效（并发去重：同一文件只发一次请求）。 */
  const loadingIds = new Set<SoundId>();
  /** 加载期间攒下的播放请求（至多一条 / 音效）：加载完成后再响 —— 不吞掉用户的第一次点击。 */
  const pendingPlayIds = new Set<SoundId>();

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

  /** 调度单个音符：规划（纯函数）→ 灌进 WebAudio 时间轴（回退合成路径）。 */
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

  /** 回退合成：按 SOUND_METRICS 的音符表铺一串振荡器（真实音源取不到时的兜底）。 */
  const playSynth = (ctx: SoundAudioContext, id: SoundId, masterVolume: number): void => {
    for (const note of SOUND_METRICS.sounds[id]) {
      scheduleNote(ctx, note, masterVolume);
    }
  };

  /** 真实音源回放：缓冲源 + 增益包络（10ms 起音、尾部 20ms 收零，避免咔哒）。 */
  const playBuffer = (ctx: SoundAudioContext, buffer: SoundAudioBuffer, masterVolume: number): void => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const startAt = ctx.currentTime;
    const duration = Math.max(0.01, buffer.duration);
    const stopAt = startAt + duration;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(masterVolume, startAt + 0.01);
    gain.gain.setValueAtTime(masterVolume, stopAt);
    gain.gain.linearRampToValueAtTime(0, stopAt + 0.02);
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(startAt);
    source.stop(stopAt + 0.03);
  };

  /** 现读一次音量（异步加载完成后重读 —— 加载期间用户可能改了音量）。 */
  const currentMasterVolume = (): number => {
    const volume = readSoundVolume(resolveStorage());
    return volume <= 0 ? 0 : volume / SOUND_METRICS.volumeMax;
  };

  /** 加载一个音效文件：成功 → 缓存；失败 → 永久回退合成器。 */
  const startLoad = (id: SoundId, ctx: SoundAudioContext): void => {
    loadingIds.add(id);
    const url = sfxFileUrl(baseUrl, SFX_FILES[id].file);
    const onSettled = (buffer: SoundAudioBuffer | null): void => {
      loadingIds.delete(id);
      if (disposed) return;
      if (buffer) {
        bufferCache.set(id, buffer);
      } else {
        // 取不到文件 → 标记回退合成（只试一次，缺文件不该每次触发都发一次 404）。
        synthFallbackIds.add(id);
      }
      // 加载期间攒下的播放请求在这里兑现（至多一声）。
      if (!pendingPlayIds.delete(id)) return;
      const masterVolume = currentMasterVolume();
      if (masterVolume <= 0 || !readSoundEnabled(resolveStorage())) return;
      const cached = bufferCache.get(id);
      if (cached) {
        playBuffer(ctx, cached, masterVolume);
      } else {
        playSynth(ctx, id, masterVolume);
      }
    };
    try {
      loadAudioFile(url, ctx).then(onSettled, () => onSettled(null));
    } catch {
      onSettled(null);
    }
  };

  /** 预热全部真实音源（手势解锁后触发）：演示现场第一次响动不该等网络。 */
  const preloadAll = (ctx: SoundAudioContext): void => {
    if (!readSoundEnabled(resolveStorage())) return;
    for (const id of Object.keys(SFX_FILES) as SoundId[]) {
      if (bufferCache.has(id) || synthFallbackIds.has(id) || loadingIds.has(id)) continue;
      startLoad(id, ctx);
    }
  };

  /** 手势命中：建 ctx（仅此之后才建）并解锁。 */
  const activate = (): void => {
    gestureSeen = true;
    removeGestureListeners();
    const ctx = ensureContext();
    if (ctx === null) return;
    if (ctx.state !== 'running') tryUnlock(ctx);
    preloadAll(ctx);
  };

  /** 播一个声音：总开关 → 音量 → 节流 → AudioContext → 解锁门 → 音源（文件 / 回退合成）。 */
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
    // 音源裁决：已解码 → 直接播；正在加载 → 攒下请求（加载完成再响，不吞掉这次点击）；
    //   已确认取不到 → 回退合成器。
    const buffered = bufferCache.get(id);
    if (buffered) {
      playBuffer(ctx, buffered, masterVolume);
      return;
    }
    if (synthFallbackIds.has(id)) {
      playSynth(ctx, id, masterVolume);
      return;
    }
    pendingPlayIds.add(id);
    if (!loadingIds.has(id)) startLoad(id, ctx);
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
      bufferCache.clear();
      synthFallbackIds.clear();
      loadingIds.clear();
      pendingPlayIds.clear();
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
    get loadedFileCount() {
      return bufferCache.size;
    },
    get fallbackCount() {
      return synthFallbackIds.size;
    },
  };
}
