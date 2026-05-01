# Stratix Audio System Design

> 状态：Draft v0.7
> 日期：2026-05-01
> 作者：锻 + 姜琦

## 0. 设计哲学：声音即信息聚合

> **声音系统不是事件广播器，是信息聚合器。**
>
> 就像文本 summarize 把大量文字压缩成核心要点，
> 声音聚合把大量事件压缩成有意义的听觉信号。
> 越远、越不重要的事件，压缩得越狠，直到静默。

**聚合管线（自下而上）**：

```
原始事件层（5000 Agent × N 种事件）
    ↓ 空间准入：只保留与用户关注点相关的事件
    ↓ 焦点模式：根据操作意图调整声音范围
    ↓ 事件聚合：同类事件合并（arpeggio / stack）
    ↓ 频率控制：防抖、限速、熔断
    ↓
用户听到的（2-5 个有意义的声音）
```

**每层的聚合逻辑**：

| 聚合层 | 做什么 | 保留什么 | 丢弃什么 |
|--------|--------|---------|----------|
| 空间准入 | 距离过滤 | 关注范围内的事件 | 远处的常规事件 |
| 焦点模式 | 意图匹配 | 与当前操作相关的声音 | 无关的操作声 |
| 事件聚合 | 同类合并 | 信息的"音色"（琶音旋律） | 重复的次数 |
| 频率控制 | 限速熔断 | 信息的时间节奏 | 声音轰炸 |

**贯穿全文的四条指导原则**：

1. **近处丰满，远处克制** — 离用户越近，声音信息越丰富；越远，只保留最重要的
2. **意图驱动，不是事件驱动** — 军团模式播 1 次不是 50 次，因为用户意图是"下达指令"
3. **失败穿透，成功收敛** — 异常事件的声音传播更远，正常事件只在局部响
4. **每个声音都有存在的理由** — 播出的每一个声音都承载用户需要知道的信息

---

## 1. 产品边界与 IO 契约

### 1.1 产品定义

**名称**：Chip Audio Engine (CAE)
**定位**：通用浏览器端音频引擎，可独立于任何宿主项目使用
**形态**：TypeScript npm 包，零外部依赖，纯 Web Audio API
**仓库**：独立 Git 仓库（不在任何宿主项目内）
**协议**：MIT 开源

### 1.2 发布形态

**NPM 包**，非二进制文件。

```
npm install chip-audio-engine
```

**包结构**：

```
chip-audio-engine/
├── dist/
│   ├── index.js          # UMD + ESM 双格式
│   ├── index.d.ts        # TypeScript 类型声明
│   └── chunk-*.js        # 按需加载的子模块
├── packs/
│   ├── pixel-sfc.json    # 内置像素风 SoundPack
│   ├── cyberpunk.json    # 可选 SoundPack
│   └── schema.json       # SoundPack JSON Schema（可校验用户自定义 Pack）
├── adapters/
│   ├── phaser.js         # Phaser 3 适配层
│   ├── pixi.js           # PixiJS 适配层
│   ├── react.js          # React hooks 适配层
│   └── vanilla.js        # 原生 JS 适配层（默认）
└── package.json
```

**适配器模式**：

核心包（`chip-audio-engine`）不依赖任何框架。框架集成通过适配层实现：

```typescript
// 原生 JS（无框架）
import { ChipAudioEngine } from 'chip-audio-engine';

// Phaser 3
import { createPhaserAudio } from 'chip-audio-engine/adapters/phaser';
const engine = createPhaserAudio(scene, config);
// 自动复用 Phaser 的 AudioContext

// React
import { useAudioEngine } from 'chip-audio-engine/adapters/react';
const engine = useAudioEngine(config);
```

### 1.3 通用化设计约束

CAE 要服务任何浏览器端应用/游戏，不能只服务 Stratix。以下是通用化的硬约束：

**1. 框架无关**

```
❌ 引擎不 import 任何框架的模块（phaser, react, vue, pixi）
❌ 引擎不假设 DOM 结构、Canvas 类型、游戏循环模式

✅ 引擎只依赖浏览器原生 API：Web Audio API + BaseAudioContext
✅ 框架集成走适配器层（adapters/）
✅ 适配器负责把框架概念翻译成引擎的通用接口
```

**2. AudioContext 可外部注入**

```typescript
interface AudioEngineConfig {
  // 引擎可以创建自己的 AudioContext...
  audioContext?: BaseAudioContext;
  // ...也可以复用宿主已有的（比如 Phaser 自带的）
}

// 场景 A：引擎自己创建
const engine = new ChipAudioEngine({});

// 场景 B：复用 Phaser 的 AudioContext
const engine = new ChipAudioEngine({
  audioContext: scene.sound.context as BaseAudioContext
});
```

**3. 空间参数不依赖游戏引擎的 Camera**

```typescript
// ❌ 引擎不应该接收 Phaser.Camera
engine.updateFocus(phaserCamera); // 错误

// ✅ 引擎接收通用的 viewport 参数
interface Viewport {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  zoom?: number;
}

engine.updateSpatial({ viewport: { centerX: 800, centerY: 480, width: 800, height: 600 } });

// 适配器负责把 Phaser.Camera → Viewport
```

**4. 事件系统自包含**

```typescript
// 引擎自带轻量事件系统，不依赖宿主
interface IAudioEngine {
  on(event: AudioEvent, handler: (...args: any[]) => void): void;
  off(event: AudioEvent, handler: (...args: any[]) => void): void;
}

type AudioEvent =
  | 'play'           // 声音开始播放
  | 'stop'           // 声音停止
  | 'queueDrop'      // 事件被聚合丢弃
  | 'circuitBreak'   // 熔断器触发
  | 'error';         // 错误

// 适配器可以桥接到宿主的事件系统
```

**5. 两种集成模式**

```
模式 A：嵌入式（宿主控制生命周期）
  适用于：游戏、应用内集成
  宿主调用 init() / destroy() 管理引擎
  引擎和宿主共享同一个 AudioContext

模式 B：独立运行（引擎自己管理一切）
  适用于：音频工具、调试面板、独立演示
  引擎自己创建 AudioContext
  引擎提供自己的简单 UI（音量控制、状态面板）
```

```
┌──────────────────────────────────────────────┐
│                宿主应用（Stratix / 其他）       │
│  ┌─────────┐  ┌─────────┐  ┌──────────────┐ │
│  │ UI 层   │  │ 游戏层  │  │ 配置文件     │ │
│  └────┬────┘  └────┬────┘  └──────┬───────┘ │
│       │            │              │           │
│       ▼            ▼              ▼           │
│  ┌──────────────────────────────────────┐    │
│  │     Chip Audio Engine (CAE)          │    │
│  │  ┌───────────┐  ┌───────────────┐   │    │
│  │  │ Public API│  │ Config System │   │    │
│  │  └─────┬─────┘  └───────┬───────┘   │    │
│  │        │                │            │    │
│  │  ┌─────▼────────────────▼────────┐  │    │
│  │  │         Engine Core            │  │    │
│  │  │  Bus Tree │ Aggregator │ Mixer │  │    │
│  │  └─────┬────────────────┬────────┘  │    │
│  │        │                │            │    │
│  │  ┌─────▼─────┐  ┌──────▼───────┐   │    │
│  │  │ Sound      │  │ Spatial      │   │    │
│  │  │ Providers  │  │ Provider     │   │    │
│  │  └───────────┘  └──────────────┘   │    │
│  └──────────────────────────────────────┘    │
│                     │                        │
│                     ▼                        │
│              Web Audio API                   │
│              (AudioContext)                  │
└──────────────────────────────────────────────┘
```

### 1.2 IO 契约

引擎的输入输出严格定义。宿主应用只通过以下接口交互，不直接操作内部模块。

**输入（宿主 → 引擎）**：

| 输入 | 类型 | 说明 |
|------|------|------|
| 配置 | `AudioEngineConfig` | 初始化时传入，定义总线、声音、聚合规则 |
| 播放请求 | `play(soundId, options?)` | 触发一个声音 |
| 控制指令 | `setVolume / fadeTo / setMuted` | 音量、静音控制 |
| 空间上下文 | `updateFocus(position, mode)` | 更新声音焦点位置和模式 |
| 生命周期 | `init() / destroy() / suspend() / resume()` | 引擎生命周期管理 |

**输出（引擎 → 宿主）**：

| 输出 | 类型 | 说明 |
|------|------|------|
| 播放状态 | `onPlay / onStop / onQueueDrop` 事件 | 声音播放/停止/丢弃时通知宿主 |
| 熔断事件 | `onCircuitBreak(state, stats)` | 熔断器状态变化时通知宿主 |
| 性能指标 | `getMetrics()` | CPU 使用率、活跃通道数、队列深度等 |
| 错误 | `onError(error)` | 音频系统内部错误 |

**不输出**：引擎不产生任何 UI 渲染、网络请求、或业务逻辑。纯音频信号。

### 1.3 解耦契约

引擎和宿主之间**不共享任何类型定义或业务概念**：

```
❌ 引擎不知道什么是 "Zone"、"Agent"、"HUD"
❌ 引擎不知道什么是 "Stratix"
❌ 引擎不依赖宿主的事件总线、状态管理、或 UI 框架

✅ 引擎只知道: soundId (string), position (x,y), priority (enum), config (JSON)
✅ 宿主通过映射层把业务事件翻译成引擎的输入
✅ 宿主可以随时替换引擎，只要实现相同的 IO 契约
```

**映射层示例（Stratix 的集成代码，不属于引擎）**：

```typescript
// stratix-audio-bridge.ts（宿主侧，不属于 CAE）
class StratixAudioBridge {
  private engine: ChipAudioEngine;

  // 业务事件 → 引擎输入
  onZoneTaskClaimed(zoneId: string, zonePos: Position) {
    this.engine.play('game.taskComplete', {
      spatial: { x: zonePos.x, y: zonePos.y }
    });
  }

  // 焦点模式切换（Stratix 特有概念 → 引擎通用接口）
  onSelectionChanged(selection: Selection) {
    if (selection.type === 'zone') {
      this.engine.updateFocus(selection.zone.center, 'area');
    } else if (selection.type === 'agents' && selection.count > 1) {
      this.engine.updateFocus(selection.boundingBox.center, 'legion');
    } else {
      this.engine.updateFocus(null, 'viewport');
    }
  }
}
```

---

## 2. 可扩展性架构

### 2.1 三维扩展模型

引擎在三个维度上可扩展，互不干扰：

```
         音源层（Sound Provider）
         ↕ 可替换：振荡器合成 → 采样播放 → 外部音源
         ─────────────────────
         曲风层（Sound Pack）
         ↕ 可替换：像素风 → 赛博朋克 → 管弦乐
         ─────────────────────
         规则层（Rule Config）
         ↕ 可替换：聚合策略 / 空间参数 / 通道分配
```

**换音源**：不改引擎代码，换 SoundProvider
**换曲风**：不改引擎代码，换 SoundPack 配置
**换规则**：不改引擎代码，改 Config JSON

### 2.2 音源层：SoundProvider 接口

```typescript
/** 音源提供者接口 — 引擎通过此接口获取声音，不关心实现 */
interface SoundProvider {
  /** 唯一标识 */
  readonly id: string;
  /** 能力声明 */
  readonly capabilities: SoundProviderCapabilities;

  /** 创建一个可播放的声音实例 */
  createSound(
    ctx: BaseAudioContext,
    soundId: string,
    params: SoundParams
  ): SoundInstance;

  /** 预加载（可选） */
  preload?(soundIds: string[]): Promise<void>;
}

interface SoundProviderCapabilities {
  /** 支持的声音类型 */
  supportedTypes: ('synth' | 'sample' | 'stream')[];
  /** 最大同时发声数（-1 = 无限制） */
  maxPolyphony: number;
  /** 是否支持实时参数调节（音高、滤波器等） */
  realtimeParams: boolean;
}

interface SoundInstance {
  /** 连接到音频图 */
  connect(node: AudioNode): void;
  /** 播放 */
  start(when: number, params: PlayParams): void;
  /** 停止 */
  stop(when: number): void;
  /** 销毁资源 */
  dispose(): void;
}
```

**内置 Provider（开箱即用）**：

| Provider | 说明 | 适用场景 |
|----------|------|----------|
| `OscillatorProvider` | Web Audio API 振荡器合成 | 默认，零依赖，像素风 |
| `SampleProvider` | AudioBuffer 采样播放 | 有外部音效文件 |
| `ChiptuneProvider` | MIDI 脚本驱动的芯片合成器 | BGM 生成 |

**自定义 Provider（用户扩展）**：

```typescript
// 示例：接入 FM 合成器
const fmSynthProvider: SoundProvider = {
  id: 'fm-synth',
  capabilities: { supportedTypes: ['synth'], maxPolyphony: 8, realtimeParams: true },
  createSound(ctx, soundId, params) {
    // 自定义 FM 合成逻辑
    return new FMSynthInstance(ctx, params);
  }
};

engine.registerProvider(fmSynthProvider);
```

### 2.3 曲风层：SoundPack 配置驱动

**当前问题**：波形参数硬编码在代码里（`sine 600Hz`, `square 1200Hz`）。换曲风要改代码。

**解法**：所有声音参数外置为配置文件，引擎启动时加载。

```typescript
/** SoundPack = 一套完整的音色配置 */
interface SoundPack {
  /** Pack 名称 */
  name: string;
  /** 风格标签，供 UI 展示 */
  style: string;
  /** 每个声音的完整参数 */
  sounds: Record<SoundId, SoundDefinition>;
  /** 全局混音参数 */
  masterConfig: MasterConfig;
  /** BGM 定义 */
  bgm?: Record<BgmId, BgmDefinition>;
  /** 环境音定义 */
  ambient?: Record<AmbientId, AmbientDefinition>;
}

interface SoundDefinition {
  /** 使用哪个 Provider */
  provider: string;
  /** 波形类型 */
  waveforms: WaveformConfig[];
  /** ADSR 包络 */
  envelope: ADSRConfig;
  /** 滤波器 */
  filter?: FilterConfig;
  /** 默认音量 */
  volume: number;
  /** 默认时长 (ms) */
  duration: number;
  /** 音高变化曲线 */
  pitch?: PitchCurve;
}

interface ADSRConfig {
  attack: number;    // ms
  decay: number;     // ms
  sustain: number;   // 0-1
  release: number;   // ms
}

interface WaveformConfig {
  type: OscillatorType;
  frequency: number | [number, number]; // Hz 或 [start, end] 表示滑音
  detune?: number;
  gain?: number;
}

interface FilterConfig {
  type: BiquadFilterType;
  frequency: number;
  Q?: number;
  gain?: number;
}
```

**示例：像素风 SoundPack（默认）**：

```json
{
  "name": "pixel-sfc",
  "style": "像素风 SFC/GBA 16-bit 芯片音源",
  "sounds": {
    "ui.click": {
      "provider": "oscillator",
      "waveforms": [{ "type": "square", "frequency": 1200, "gain": 0.3 }],
      "envelope": { "attack": 0, "decay": 20, "sustain": 0.8, "release": 30 },
      "volume": 0.4,
      "duration": 50
    },
    "game.taskComplete": {
      "provider": "oscillator",
      "waveforms": [
        { "type": "triangle", "frequency": [523, 659], "gain": 0.4, "detune": 5 }
      ],
      "envelope": { "attack": 5, "decay": 50, "sustain": 0.6, "release": 100 },
      "filter": { "type": "lowpass", "frequency": 3000, "Q": 1 },
      "volume": 0.5,
      "duration": 300
    }
  }
}
```

**换曲风**：加载不同的 SoundPack JSON，引擎代码不变。

```typescript
// 切换到赛博朋克风
engine.loadSoundPack(cyberpunkPack);
// 所有声音参数自动替换，无需改代码
```

### 2.4 规则层：Config JSON

聚合策略、空间参数、通道分配全部可配置：

```typescript
interface AudioEngineConfig {
  // === 总线配置 ===
  buses: BusConfig[];
  channelCount: number; // 默认 8（SFC 约束）

  // === 聚合规则 ===
  aggregation: Record<SoundId, AggregationConfig>;

  // === 空间参数 ===
  spatial: SpatialConfig;

  // === 焦点模式 ===
  focusModes: FocusModeConfig[];

  // === 熔断器 ===
  circuitBreaker: CircuitBreakerConfig;

  // === Ducking 规则 ===
  duckRules: DuckRule[];
}
```

**所有配置都可在运行时热更新**：

```typescript
// 运行时调整空间参数
engine.updateConfig({
  spatial: { fullVolumeRatio: 0.8, maxAudibleRatio: 3.0 }
});

// 运行时调整聚合策略
engine.updateConfig({
  aggregation: { 'game.taskComplete': { strategy: 'arpeggio', windowMs: 300 } }
});
```

### 2.5 复用性保障

**引擎作为独立 npm 包发布时的目录结构**：

```
chip-audio-engine/
├── src/
│   ├── core/            # 核心引擎（Bus/Aggregator/Mixer/ChannelPool）
│   ├── providers/       # 内置音源（Oscillator/Sample/Chiptune）
│   ├── spatial/         # 空间音频模块
│   ├── config/          # 配置系统 + Schema 校验
│   └── index.ts         # Public API
├── packs/
│   ├── pixel-sfc.json   # 默认像素风 SoundPack
│   ├── cyberpunk.json   # 可选赛博朋克 SoundPack
│   └── schema.json      # SoundPack JSON Schema
├── README.md
├── package.json
└── tsconfig.json
```

**在其他项目中复用**：

```typescript
import { ChipAudioEngine } from 'chip-audio-engine';
import pixelPack from 'chip-audio-engine/packs/pixel-sfc.json';

const engine = new ChipAudioEngine({
  soundPack: pixelPack,
  channelCount: 8,
});

engine.init();
engine.play('ui.click');
```

---

## 3. 现状分析

### 3.1 当前音频代码

Stratix 当前有**两套并行、互不关联**的音频系统：

| 系统 | 文件 | 能力 | 问题 |
|------|------|------|------|
| `SoundEffects` | `src/stratix-rts/audio/SoundEffects.ts` | 5 种合成音效 | 单例、无总线、无优先级 |
| `SoundService` | `src/services/SoundService.ts` | 4 种合成音效 + ADSR 包络 | 单例、无总线、持久化设置 |

两者都基于 Web Audio API，都用振荡器合成声音，都只有一个 masterGain 控制总音量。

### 3.2 缺失的能力

- ❌ 没有总线分层（所有声音一锅炖）
- ❌ 没有优先级系统（N 个声音同时响时无法管理）
- ❌ 没有 ducking（SFX 播放时 BGM 自动降低）
- ❌ 没有 BGM 系统（循环播放、crossfade 切换）
- ❌ 没有环境音系统（持续循环的背景声）
- ❌ 没有音效池化（频繁播放时没有复用机制）
- ❌ 声音种类太少（总共 9 种，且两套系统有重叠）

---

## 4. 行业方案对比

| 方案 | 代表产品 | 优点 | 缺点 | 适用性 |
|------|---------|------|------|--------|
| **FMOD Studio** | StarCraft II, Halo | 工业标准，可视化编辑器，完整工具链 | 商业授权费用，需要 native 集成 | ❌ 过重 |
| **Wwise** | 大量 AAA 游戏 | 和 FMOD 同级别 | 同样需要授权 | ❌ 过重 |
| **Web Audio API 自建** | Web 游戏 | 零依赖，灵活，Phaser 已基于此 | 需要自己写框架 | ✅ 推荐 |
| **Howler.js** | 轻量 Web 项目 | 简单易用，sprite 支持 | 总线控制弱，不适合复杂混音 | ⚠️ 备选 |

**结论：基于 Web Audio API 自建音频总线框架。**

理由：
1. 零新依赖（项目已在用 Web Audio API）
2. Phaser 3 的音频系统底层就是 Web Audio API，可以无缝对接
3. GainNode 天然就是总线节点，不需要额外抽象
4. 灵活度最高，可以按需实现 FMOD 的核心功能

---

## 5. 总线架构

### 3.1 Bus 树

```
AudioContext
│
└── MasterBus (GainNode) — 主音量控制
    │
    ├── MusicBus (GainNode) — BGM 音乐
    │   ├── [bgm.main]        — 主界面主题
    │   ├── [bgm.intense]     — 高负载/战斗状态
    │   └── [bgm.ambient]     — 空闲/平静状态
    │
    ├── SFXBus (GainNode) — 音效总控
    │   │
    │   ├── UIBus (GainNode) — UI 交互音效
    │   │   ├── [ui.click]          — 按钮点击
    │   │   ├── [ui.hover]          — 悬停微鸣
    │   │   ├── [ui.tabSwitch]      — Tab 切换
    │   │   ├── [ui.panelOpen]      — 面板展开
    │   │   ├── [ui.panelClose]     — 面板收起
    │   │   ├── [ui.toast]          — 通知弹出
    │   │   ├── [ui.toggle]         — 开关切换
    │   │   └── [ui.dragStart]      — 拖拽开始
    │   │
    │   ├── GameplayBus (GainNode) — 游戏事件音效
    │   │   ├── [game.agentSelect]  — 选中 Agent
    │   │   ├── [game.agentDeselect]— 取消选中
    │   │   ├── [game.taskAssign]   — 分配任务
    │   │   ├── [game.taskComplete] — 任务完成
    │   │   ├── [game.taskFail]     — 任务失败
    │   │   ├── [game.alert]        — 警报
    │   │   ├── [game.zoneCreate]   — Zone 创建
    │   │   ├── [game.zoneDestroy]  — Zone 销毁
    │   │   ├── [game.error]        — 操作错误
    │   │   ├── [game.connect]      — Agent 连接
    │   │   └── [game.disconnect]   — Agent 断线
    │   │
    │   └── AmbientBus (GainNode) — 环境音效
    │       ├── [ambient.datacenter] — 数据中心嗡鸣
    │       ├── [ambient.studio]     — 工作室环境
    │       ├── [ambient.workshop]   — 工坊机械
    │       └── [ambient.electric]   — 电流噼啪
    │
    └── VoiceBus (GainNode) — 语音/TTS（预留）
        └── (TTS 输出、语音指令反馈等)
```

### 3.2 Bus 操作能力

每条 Bus 支持：

| 操作 | 说明 |
|------|------|
| `setVolume(0-1)` | 设置音量，影响该 Bus 下所有声音 |
| `setMuted(bool)` | 静音/取消静音 |
| `fadeTo(target, duration)` | 平滑过渡到目标音量 |
| `getState()` | 返回当前 { volume, muted, activeCount } |

### 3.3 Ducking（侧链压缩）

```
触发规则：
  GameplayBus.alert 播放时
    → MusicBus.fadeTo(0.2, 200ms)
    → 等 alert 播完
    → MusicBus.fadeTo(1.0, 800ms)

  GameplayBus.taskComplete 播放时
    → MusicBus.fadeTo(0.4, 100ms)
    → 等播完
    → MusicBus.fadeTo(1.0, 500ms)

  UIBus 的声音不触发 ducking（太短太频繁）
```

Ducking 配置表：

```typescript
interface DuckRule {
  /** 触发声音的 ID */
  trigger: SoundId;
  /** 被压低的目标 Bus */
  target: 'music';
  /** 压低到的音量 */
  dipTo: number;       // 0-1
  /** 压低过渡时间 (ms) */
  dipDuration: number;
  /** 恢复过渡时间 (ms) */
  recoverDuration: number;
}
```

### 3.4 BGM Crossfade

BGM 切换时无缝过渡：

```
当前: bgm.ambient (volume 1.0)
触发: Agent 负载 > 80% → 切到 bgm.intense

过程:
  bgm.ambient.fadeTo(0, 2000ms)  // 2 秒淡出
  bgm.intense.fadeTo(1, 2000ms)  // 2 秒淡入
  （交叉进行，无缝衔接）
```

BGM 切换触发条件（初版）：

| 场景 | BGM | 触发条件 |
|------|-----|---------|
| 主界面 | bgm.main | 启动时 |
| 空闲 | bgm.ambient | 无 Agent 在线 / 无活跃任务 |
| 高负载 | bgm.intense | 在线 Agent > 5 且忙碌率 > 60% |

---

## 6. 声音清单

### 4.1 全部声音 ID 及参数

```typescript
type SoundId =
  // UI
  | 'ui.click'          // 短促清脆，~50ms，square wave 1200Hz
  | 'ui.hover'          // 极轻微鸣，~30ms，sine 800Hz，音量 0.05
  | 'ui.tabSwitch'      // 短 tick，~40ms，sine 600→800Hz
  | 'ui.panelOpen'      // whoosh 上升，~150ms，noise + sine 300→600Hz
  | 'ui.panelClose'     // whoosh 下降，~120ms，noise + sine 600→300Hz
  | 'ui.toast'          // 泡泡弹出，~80ms，sine 400→800Hz
  | 'ui.toggle'         // 咔嗒，~30ms，square 1000Hz
  | 'ui.dragStart'      // 轻拾起，~60ms，sine 500→700Hz

  // Gameplay
  | 'game.agentSelect'  // 确认 ping，~100ms，sine 600Hz → 短回响
  | 'game.agentDeselect'// 轻柔取消，~60ms，sine 400→300Hz
  | 'game.taskAssign'   // 分配 whoosh，~150ms，noise filtered
  | 'game.taskComplete' // 愉悦三音 C5-E5-G5，~300ms
  | 'game.taskFail'     // 低沉失败，~200ms，sawtooth 200→100Hz
  | 'game.alert'        // 警报，~300ms，triangle 500→400Hz，循环 2 次
  | 'game.zoneCreate'   // 机械启动，~200ms，square 100→400Hz
  | 'game.zoneDestroy'  // 关闭消散，~250ms，sawtooth 400→80Hz
  | 'game.error'        // 错误嗡鸣，~150ms，sawtooth 150Hz
  | 'game.connect'      // 连接建立，~200ms，sine 300→600→900Hz 三连
  | 'game.disconnect'   // 断线，~200ms，sine 800→200Hz 下降

  // BGM（MIDI 脚本生成 Chiptune）
  | 'bgm.main'
  | 'bgm.intense'
  | 'bgm.ambient'

  // Ambient（程序生成或外部文件）
  | 'ambient.datacenter'
  | 'ambient.studio'
  | 'ambient.workshop'
  | 'ambient.electric';
```

### 4.2 声音生成策略

基于第 13 章像素风 16-bit 芯片音源约束：

| 类型 | 策略 | 波形 | 理由 |
|------|------|------|------|
| UI 音效 | **振荡器合成** | 方波 + 三角波 | SFC 风格交互反馈，短促温润 |
| Gameplay 音效 | **振荡器合成** | 三角波 + 方波 + 琶音 | 回合制 RPG 风格事件通知 |
| BGM | **MIDI 脚本生成 Chiptune** | 多通道芯片音 | SFC 8 通道 PCM 风格，前端轻量生成 |
| 环境音 | **振荡器 drone + 滤波器** | 三角波底层 | 像素风环境层，温润不刺耳 |

**所有声音均由前端脚本生成，不依赖外部音频文件。**

---

## 7. 事件聚合与并发控制

> **核心原则：事件零丢失。** Stratix 是 RTS 界面，声音是信息通道。
> 任何事件都不应该被静默丢弃。能立即播放就播放，不能就合并，但绝不丢。

### 5.1 优先级定义

优先级决定的是**聚合策略的激进程度**，不是"能不能播"。

```typescript
enum SoundPriority {
  Critical = 0,  // 警报、错误 — 立即播放，可打断同类型正在播放的
  High     = 1,  // 任务完成/失败、Agent 连接/断线 — 排队或琶音合并
  Normal   = 2,  // UI 点击、Tab 切换 — 可短间隔排队
  Low      = 3,  // Hover、拖拽 — 防抖合并（用户感知不到丢失）
}
```

### 5.2 事件聚合策略

当同一声音短时间内被多次触发时，不同优先级采用不同策略：

```
Critical（警报、错误）
  → Restart: 立即重新播放，覆盖当前
  → 因为警报本身就是"现在注意"，延迟 = 失败
  → 例: 3 个 error 在 100ms 内触发 → 播放 1 次但有 3 次重复感（音高微升）

High（任务完成、Agent 状态变化）
  → Arpeggio Merge: 合并为琶音序列
  → 5 个 taskComplete 在 200ms 内 → 播放 1 次递升琶音 C5-E5-G5-C6
  → 音符数 = min(eventCount, 5)，超过 5 个用最高音收尾
  → 用户听到的是"很多事情同时完成了"，信息不丢

Normal（UI 交互、游戏事件）
  → Stack（叠加播放）: 不同 SoundId 直接叠加，同 SoundId 短间隔排队
  → click + panelOpen + tabSwitch 同时触发 → 3 个声音同时播放（不同通道）
  → click × 3 快速触发 → 排队播 3 次，间隔 30ms
  → 优先叠加，只在同 SoundId 连续触发时才排队

Low（Hover）
  → Debounce: 只播放最后一次
  → hover 天然高频，用户不感知单次丢失
  → cooldown 150ms
```

### 5.3 聚合配置

```typescript
interface AggregationConfig {
  /** 策略 */
  strategy: 'restart' | 'arpeggio' | 'stack' | 'debounce';
  /** 聚合窗口 (ms)，窗口内的同类事件合并处理 */
  windowMs: number;
  /** 琥音最大音符数 (arpeggio 策略) */
  maxNotes?: number;
  /** 同 SoundId 叠加最小间隔 (ms) (stack 策略) */
  stackInterval?: number;
  /** 排队最小间隔 (ms) (queue 策略，已弃用) */
  queueInterval?: number;
  /** 防抖冷却 (ms) (debounce 策略) */
  cooldown?: number;
  /** 队列最大深度，超出的丢弃最新（queue 策略） */
  maxQueueDepth?: number;
  /** 队列最大延迟 (ms)，超过此时间的待播事件自动丢弃 */
  maxQueueLatency?: number;
}
```

各声音的聚合配置：

| SoundId | Priority | Strategy | Window | 说明 |
|---------|----------|----------|--------|------|
| game.alert | Critical | restart | 0 | 立即重播 |
| game.error | Critical | restart | 0 | 立即重播 |
| game.taskComplete | High | arpeggio | 200 | C5→E5→G5→C6 递升 |
| game.taskFail | High | arpeggio | 200 | C4→A3→F3 递降 |
| game.connect | High | arpeggio | 200 | 三连升调 |
| game.disconnect | High | arpeggio | 200 | 三连降调 |
| game.agentSelect | Normal | stack | 30 | 同 SoundId 间隔 30ms 排队，不同 ID 叠加 |
| game.agentDeselect | Normal | debounce | 80 | 快速连点合并 |
| game.taskAssign | Normal | stack | 30 | 同上 |
| game.zoneCreate | Normal | stack | 30 | 同上 |
| game.zoneDestroy | Normal | stack | 30 | 同上 |
| ui.click | Normal | stack | 30 | 同 SoundId 排队，maxDepth=5，maxLatency=200ms |
| ui.tabSwitch | Normal | debounce | 80 | 防重复 |
| ui.panelOpen | Normal | stack | 50 | 同上 |
| ui.panelClose | Normal | stack | 50 | 同上 |
| ui.toast | Normal | stack | 80 | 同上，maxDepth=3 |
| ui.toggle | Normal | debounce | 80 | 防重复 |
| ui.hover | Low | debounce | 150 | 防抖 |
| ui.dragStart | Low | debounce | 100 | 防抖 |
| bgm.* | — | — | — | 不走聚合，由 BGM 系统管理 |
| ambient.* | — | — | — | 不走聚合，持续播放 |

### 5.4 队列防护：防队头阻塞

队列的天然问题是队头阻塞——前面没播完，后面全等着。RTS 场景下声音跟操作脱节 = 体验灾难。

**防护规则**：

```
1. 深度限制（maxQueueDepth）
   - 每个 queue 策略的声音有最大队列深度（2-5）
   - 队列满时，新事件直接丢弃（不是插队，不是踢旧）
   - 因为此时声音已经滞后于操作，多播一个反而更乱

2. 延迟窗口（maxQueueLatency）
   - 每个入队事件记录入队时间
   - 当轮到它播放时，如果已经等了超过 maxQueueLatency → 丢弃
   - ui.click: maxLatency=200ms（超过 200ms 的点击声没意义）
   - game.taskAssign: maxLatency=500ms（游戏事件稍宽容）

3. 没有“超长声音”问题
   - 所有 SFX 由芯片合成器生成，时长硬编码在 30-300ms
   - BGM/Ambient 不走队列，由独立系统管理
   - 不存在外部音频文件，不存在无法预估时长的声音
```

**极端场景推演**：

```
场景：用户疯狂连点按钮，1 秒内 20 次 click

无防护：
  队列积压 20 个 → 最后一个等 1 秒才播 → 操作和声音完全脱节

有防护（maxDepth=5, maxLatency=200ms）：
  T+0ms:   click-1 播放
  T+30ms:  click-2 入队
  T+60ms:  click-3 入队
  T+90ms:  click-4 入队
  T+120ms: click-5 入队
  T+150ms: click-6 入队 → 队列满，丢弃
  T+180ms: click-7 → 丢弃
  ...
  T+110ms: click-1 播完 → click-2 播放
  T+140ms: click-2 播完 → click-3 播放
  T+170ms: click-3 播完 → click-4 播放
  T+200ms: click-4 播完 → click-5 此时已等了 80ms < 200ms → 播放
  T+230ms: click-5 播完 → 队列空
  结果：播了 5 次，用户感知“连续快速点击反馈”，合理
```

### 5.5 管线极限场景推演

Stratix 实际规模：地图 1600×960，默认 10 Agent，最大 500 Zone。以下推演所有极限叠加场景。

**场景 A：批量任务完成（最常见的高频场景）**
```
触发: 10 个 Agent 同时完成任务 → 10 × game.taskComplete
策略: arpeggio 合并 → 播放 1 次 C5-E5-G5-C6 递升琶音
通道: 仅占通道 4
结果: ✓ 无问题，用户听到"大量任务完成"
```

**场景 B：用户 UI 密集操作**
```
触发: 用户点了按钮 + 切了 tab + 开了面板 + 弹了 toast（100ms 内）
事件: click + tabSwitch + panelOpen + toast
策略: 不同 SoundId 直接叠加播放（stack）
通道: click 占通道 6，panelOpen 占通道 6（但声音短不冲突），
       tabSwitch debounce 不响（刚切完），toast 排队等 80ms
实际同时发声: 2 个（click + panelOpen）
结果: ✓ 无问题
```

**场景 C：混合极端（最坏情况）**
```
触发: 同时发生——
  - 3 个 Agent 完成任务
  - 1 个警报
  - 用户点了 2 下按钮
  - 1 个面板展开
  - BGM 在播
  - 环境音在播

通道分配:
  通道 0-2: BGM              — 始终占用
  通道 3:   Ambient drone     — 始终占用
  通道 4:   taskComplete 琶音  — arpeggio 合并 3 个事件为 1 次播放
  通道 5:   (空闲)
  通道 6:   click + panelOpen  — stack 叠加，2 个短音重叠
  通道 7:   alert             — Critical 专用通道

总占用: 7/8 通道，1 个备用
结果: ✓ 无问题，每个事件都有声音反馈
```

**场景 D：管线批量操作（Zone 级联）**
```
触发: 用户删除 1 个 Zone → 级联触发 zoneDestroy + agentDeselect × 3 + disconnect × 3
事件: 1 个 zoneDestroy + 3 个 agentDeselect + 3 个 disconnect
策略:
  zoneDestroy: stack 立即播放
  agentDeselect: debounce 80ms → 只播 1 次
  disconnect: arpeggio 合并 → 播 1 次三连降调
通道: zoneDestroy 占通道 4，disconnect 琶音占通道 5
gentDeselect 和 zoneDestroy 是不同 SoundId → 叠加播放
实际同时发声: 3 个（zoneDestroy + agentDeselect + disconnect 琶音）
结果: ✓ 无问题
```

**结论**：以 Stratix 10 Agent / 500 Zone 的规模，8 通道绰绰有余。
真正的并发压力来自同种事件的高频触发（arpeggio 已解决），
不是来自不同事件的叠加（stack 天然支持）。

### 5.6 SFC 8 通道约束

SFC 硬件只有 8 个音频通道，这是风格约束。Web Audio API 没有这个限制，但我们主动遵守以保持像素风音色。

**通道分配（推荐默认）**：

```
通道 0-2:  BGM (bass + lead + pad)      — 始终占用
通道 3:    Ambient drone                 — 始终占用
通道 4:    Gameplay 音效                  — 按需使用
通道 5:    Gameplay 音效（备用/琶音扩展） — 按需使用
通道 6:    UI 音效                        — 按需使用
通道 7:    保留（Critical 专用）
```

**当通道全部占满时**：
- 不是丢弃事件，而是**等待最短的声音播完释放通道**
- SFX 的时长都在 30-300ms，等待极短
- 最坏情况：300ms 延迟，RTS 中可接受

### 5.7 不同类型事件互不挤占

**关键设计：不同 Bus 的通道独立，互不挤占。**

```
❌ 错误: 6 个 taskComplete 挤占了所有通道，alert 无法播放
✅ 正确: GameplayBus 用通道 4-5，UIBus 用通道 6，Critical 用通道 7
         即使 Gameplay 在密集播放，alert 仍然立即发声
```

---

## 8. 音频与 HUD 的集成点

### 6.1 HUD 组件 → 音频触发映射

| HUD 组件 | 用户操作 | 触发声音 |
|----------|---------|---------|
| CommandPanel tab | 切换 tab | ui.tabSwitch |
| CommandPanel 按钮 | hover | ui.hover |
| CommandPanel 按钮 | 点击 | ui.click |
| CommandPanel | 展开 | ui.panelOpen |
| CommandPanel | 收起 | ui.panelClose |
| Toast | 弹出 | ui.toast |
| TopBar help 按钮 | 切换 | ui.toggle |
| Minimap | 点击移动 | game.agentSelect（如有 Agent 选中） |
| Agent sprite | 点击选中 | game.agentSelect |
| Agent sprite | 取消选中 | game.agentDeselect |
| Zone | 创建 | game.zoneCreate |
| Zone | 销毁 | game.zoneDestroy |

### 6.2 游戏事件 → 音频触发映射

| 游戏事件 | 触发声音 | 来源 |
|----------|---------|------|
| 任务完成 | game.taskComplete | App.vue event handler |
| 任务失败 | game.taskFail | App.vue event handler |
| Agent 状态变化 | game.connect / game.disconnect | App.vue event handler |
| 警报触发 | game.alert | Alert system |
| 操作错误 | game.error | Error handler |

---

## 9. API 设计（Draft）

### 7.1 核心接口

```typescript
interface IAudioBus {
  readonly id: string;
  readonly parent: IAudioBus | null;
  volume: number;           // 0-1
  muted: boolean;

  fadeTo(target: number, durationMs: number): void;
  getActiveCount(): number;
}

interface IAudioEngine {
  // 初始化
  init(): Promise<void>;
  destroy(): void;

  // Bus 访问
  getBus(busId: AudioBusId): IAudioBus;
  readonly master: IAudioBus;

  // 播放
  play(soundId: SoundId, options?: PlayOptions): void;
  stop(soundId: SoundId): void;

  // BGM
  playBGM(bgmId: BgmId, crossfadeMs?: number): void;
  stopBGM(fadeMs?: number): void;

  // 环境音
  startAmbient(ambientId: AmbientId): void;
  stopAmbient(ambientId: AmbientId, fadeMs?: number): void;

  // Ducking
  addDuckRule(rule: DuckRule): void;

  // 全局设置
  masterVolume: number;
  masterMuted: boolean;
}

interface PlayOptions {
  volume?: number;          // 覆盖默认音量
  pitch?: number;           // 播放速率
  delay?: number;           // 延迟播放 (ms)
}
```

### 7.2 使用示例

```typescript
// 初始化
audioEngine.init();

// 调整 UI 音效音量（不影响 BGM）
audioEngine.getBus('sfx.ui').volume = 0.5;

// 播放 UI 音效
audioEngine.play('ui.click');
audioEngine.play('ui.hover');

// 切换 BGM（2 秒交叉淡入淡出）
audioEngine.playBGM('bgm.intense', 2000);

// 开始环境音
audioEngine.startAmbient('ambient.datacenter');

// 游戏事件触发音效（自动 ducking）
audioEngine.play('game.alert'); // BGM 自动降低

// 静音一切
audioEngine.masterMuted = true;
```

---

## 10. 与现有系统的关系

### 8.1 迁移计划

| 阶段 | 内容 | 影响范围 |
|------|------|---------|
| Phase 1 | 实现 AudioEngine + Bus 树 + 合成音效 | `src/stratix-rts/audio/` 新建 |
| Phase 2 | HUD 组件接入（TopBar/CommandPanel/Minimap 的交互音效） | `src/stratix-rts/ui/v2/` |
| Phase 3 | 游戏事件接入（App.vue 的 event handler） | `src/App.vue` |
| Phase 4 | BGM 系统 + Crossfade | 需要音频文件资源 |
| Phase 5 | 环境音系统 + Ambient | 合成 + 可选外部文件 |
| Phase 6 | 清理旧的 SoundEffects + SoundService | 删除旧文件 |

### 8.2 需要确认的问题

1. **BGM 生成**：MIDI 脚本生成 Chiptune 的音质是否可接受？需要做原型验证
2. **移动端适配**：移动端是否需要音频？Web Audio API 兼容性如何？
3. **性能预算**：8 通道芯片合成 + 滤波器的 CPU 消耗需要实际测量
4. **BGM 作曲**：需要定义旋律风格、调性、BPM 范围的详细规范

---

## 11. 声音风格定义

### 9.1 核心风格：像素风复古音频

> Stratix 的视觉风格是 64×64 像素美术画风，声音必须与视觉高度统一。
>
> 整体音乐与音效适配像素美术画风，走轻复古像素游戏听觉调性。
> 音色温润柔和、节奏轻快干净，自带怀旧氛围感，不刺耳、不单调、无尖锐高频噪音。
> 旋律结构简洁清爽，适配小游戏场景使用，氛围感克制高级，复古感恰到好处，不土味、不过度老旧。
> 整体听感轻盈通透，适配轻量化程序播放，贴合像素艺术的视觉气质，音画高度统一。

**风格约束（不可违反）**：

| 维度 | 要求 | 禁止 |
|------|------|------|
| 音色 | 温润柔和、不刺耳 | 尖锐高频噪音、冰冷金属感 |
| 节奏 | 轻快干净 | 沉闷拖沓 |
| 氛围 | 怀旧但克制高级，恰到好处 | 土味、过度老旧、粗糙 8-bit 噪音 |
| 旋律 | 简洁清爽 | 复杂交响、厚重管弦 |
| 听感 | 轻盈通透 | 厚重浑浊 |
| 密度 | 稀疏留白 | 音效轰炸 |

### 9.2 技术选型：16-bit 芯片音源

**优先选用 16-bit 芯片风音源，对标 SFC/GBA 复古音色架构。**

采用前端轻量 MIDI 脚本生成，无需高比特率规格，兼顾风格适配与轻量化运行需求。

| 技术约束 | 说明 |
|---------|------|
| 合成方式 | 前端轻量 MIDI 脚本生成，不依赖外部音频文件 |
| 音源架构 | 对标 SFC（SNES）8 通道 PCM / GBA 6 通道 PCM |
| 采样率 | 22050Hz 足够，不追求 44100Hz |
| 通道数 | 最多 8 个同时发声通道（含 BGM 占 2-3 个） |
| 位深 | 16-bit，不追求 Hi-Fi |

**为什么是 SFC/GBA 而不是 NES/8-bit**：
- NES 太粗糙，方波刺耳，和「温润柔和」冲突
- SFC 有 8 通道 PCM 采样，可以做到温润而有质感
- GBA 是 SFC 的进化版，音色更丰富但保留了复古感
- 这个区间 = "复古但不粗糙"，正好匹配像素画风

### 9.3 声音风格指南（Sound Bible）

```
UI 音效 = 芯片风交互反馈
  → 短、轻、脆，像按下 SFC 手柄的触感
  → 方波 + 三角波为主，轻微失真
  → 频率范围: 600-2000Hz
  → 时长: 30-80ms
  → 包络: instant attack, fast release
  → 绝对不能刺耳

Gameplay 音效 = 像素风事件通知
  → 比 UI 稍有重量感
  → 像回合制 RPG 的战斗音效
  → 频率范围: 200-3000Hz
  → 时长: 80-250ms
  → 包络: fast attack, medium release
  → 可用 arpeggio（琶音）增加旋律感

Alerts = 芯片风警报
  → 短促重复 pattern
  → 2-3 次循环，间隔 100ms
  → 不走低频轰鸣（那是现代游戏的做法）
  → 走高频短促脉冲（更符合像素风）

BGM = 芯片音乐（Chiptune）
  → SFC 风格的轻快旋律
  → 2-3 个通道：bass + lead + pad
  → 120-140 BPM，不急不慢
  → 循环长度: 8-16 小节
  → 不抢注意力，像背景里的电子雨

Ambient = 像素风环境层
  → 极低音量持续
  → 1-2 个通道的长音 drone
  → 用三角波做柔和的底层
  → 定义"你在哪里"但不打扰
```

---

## 12. 实时性与连贯性

### 10.1 问题：声音的实时性如何保证？

Web Audio API 的调度精度是**样本级**的（AudioContext.currentTime 精度约 2.9μs），远高于视觉帧率。真正的挑战不在调度精度，而在**触发延迟**——从游戏事件发生到调用 `play()` 之间的路径。

**延迟来源分析**：

```
游戏事件发生
  → Event/Callback 触发（~0ms，同步）
  → 业务逻辑处理（~0-5ms）
  → audioEngine.play() 调用（~0ms，同步入队）
  → Web Audio 调度（~0ms，currentTime 精度）
  → DAC 输出（~5-20ms，硬件缓冲区）

总延迟: 5-25ms，人耳不可感知（< 30ms 即为即时）
```

**规则：所有声音触发必须在事件回调的同一帧内完成。**

禁止的模式：
```typescript
// ❌ 异步触发（可能延迟一帧或多帧）
setTimeout(() => audioEngine.play('ui.click'), 0);
requestAnimationFrame(() => audioEngine.play('ui.click'));

// ✅ 同步触发（在事件回调中立即调用）
handleClick() {
  audioEngine.play('ui.click');  // 同步
  this.doSomethingElse();
}
```

### 10.2 问题：打断（Interruption）如何处理？

有些声音天然需要被打断，类比 FPS 的枪声：

- 换弹匣时，装弹声音必须中断换弹动画中途的声音
- 连续开火时，每一枪的尾部被下一枪截断

**打断规则表**：

```typescript
enum InterruptPolicy {
  /** 不打断，等播完再播下一个 */
  Queue,
  /** 立即停止当前，播放新的 */
  Restart,
  /** 如果正在播就不播新的（防重复） */
  IgnoreIfPlaying,
  /** 快速淡出当前（50ms），然后播新的 */
  CrossfadeQuick,
}
```

**各声音的打断策略**：

| 声音 | InterruptPolicy | 理由 |
|------|----------------|------|
| ui.click | IgnoreIfPlaying | 快速点击不重复响 |
| ui.hover | IgnoreIfPlaying | 鼠标划过不连续响 |
| ui.panelOpen | Restart | 快速开关面板时重置 |
| ui.panelClose | Restart | 同上 |
| ui.toast | Queue | 多条 toast 排队播放 |
| game.agentSelect | IgnoreIfPlaying | 防快速点击重复 |
| game.taskComplete | Queue | 多个任务完成排队 |
| game.alert | Restart | 新警报覆盖旧警报 |
| game.error | Restart | 同上 |
| game.connect | IgnoreIfPlaying | 不重复 |
| bgm.* | CrossfadeQuick | BGM 切换始终交叉淡入淡出 |
| ambient.* | CrossfadeQuick | 环境音切换同上 |

### 10.3 连贯性：声音之间的衔接

**无缝衔接的核心原则：每个声音都有进入和离开的方式。**

```
进入方式（Attack）:
  - instant: 0ms 淡入（click, toggle）
  - quick:  10ms 淡入（大多数 SFX）
  - smooth: 50-100ms 淡入（panel open/close）
  - fade:   200-2000ms 淡入（BGM, ambient）

离开方式（Release）:
  - instant: 0ms 淡出（被截断时）
  - quick:  30ms 淡出（大多数 SFX，防咔嗒声）
  - smooth: 100-200ms 淡出（panel, toast）
  - fade:   500-2000ms 淡出（BGM, ambient）
```

**防咔嗒声（click/pop）规则**：

所有声音停止时必须有一个至少 5ms 的淡出，即使在截断场景下。Web Audio API 直接 `stop()` 会产生可听见的咔嗒声。

```typescript
// ❌ 直接停止（会产生咔嗒声）
oscillator.stop(ctx.currentTime);

// ✅ 快速淡出后停止
const now = ctx.currentTime;
gainNode.gain.setValueAtTime(gainNode.gain.value, now);
gainNode.gain.linearRampToValueAtTime(0, now + 0.005); // 5ms 淡出
oscillator.stop(now + 0.006);
```

---

## 13. 异常防护：循环触发熔断

### 11.1 问题场景

类比 FPS 枪声：如果游戏 bug 导致开火事件每帧触发一次，1 秒 60 次枪声会炸掉音频系统。

Stratix 中的等价场景：
- Agent 状态高频切换（online→offline→online→...）
- 错误循环触发
- UI 事件风暴（鼠标快速移过大量元素）

### 11.2 多层防护

**第一层：单声音防抖（Per-Sound Debounce）**

```typescript
interface SoundConfig {
  // ...
  /** 同一声音两次播放的最小间隔 (ms)，0 = 不限制 */
  cooldown: number;
}

// 默认 cooldown
ui.click:    80ms    // 最多 ~12 次/秒
game.alert:  500ms   // 最多 2 次/秒
ui.hover:   150ms   // 最多 ~6 次/秒
game.error:  300ms
```

**第二层：Bus 级速率限制（Bus Rate Limit）**

```typescript
interface BusConfig {
  /** 该 Bus 每秒最大播放次数，超过的丢弃 */
  maxPlaysPerSecond: number;
}

UIBus:       20 次/秒   // UI 交互密集但有限
GameplayBus: 10 次/秒   // 游戏事件相对稀疏
AmbientBus:  2 次/秒    // 环境音几乎不变
```

**第三层：全局熔断器（Global Circuit Breaker）**

```typescript
interface CircuitBreakerConfig {
  /** 窗口大小 (ms) */
  windowMs: number;
  /** 窗口内最大总播放次数 */
  maxPlays: number;
  /** 触发后冷却时间 (ms) */
  cooldownMs: number;
}

// 默认：1 秒内超过 30 次播放 → 熔断 2 秒
global: { windowMs: 1000, maxPlays: 30, cooldownMs: 2000 }
```

熔断状态：
- **Green**: 正常，所有声音播放
- **Yellow**: 接近阈值（>80%），降级——只播 Critical 和 High
- **Red**: 熔断——只播 Critical，其余全部丢弃，持续 cooldownMs

**第四层：异常检测回调（可选）**

```typescript
interface AudioEngineConfig {
  /** 当熔断器触发时的回调，用于日志上报 */
  onCircuitBreak?: (stats: {
    triggerCount: number;
    lastWindowPlays: number;
    droppedSounds: string[];
  }) => void;
}
```

这让业务层可以感知到声音系统的异常，进而排查触发源。

---

## 14. 规模化声音准入与空间收音

> **前提**：Stratix 的目标是 5000 Agent（500 Zone × 10 Agent/Zone）。
> 声音是注意力聚焦工具，不是全景广播。
> 5000 个 Agent 同时发出声音 = 噪音，不是信息。

### 12.1 声音准入原则

**核心规则：只有与用户当前关注点相关的声音才准入。**

```
全局视角（5000 Agent）

                    用户当前视口
                 ┌─────────────┐
                 │  ← 聚焦区 → │  ← 约 20-50 个 Agent
                 │  声音全开   │
                 └─────────────┘
           ┌───────────────────────┐
           │    外围感知区         │  ← 约 100-200 个 Agent
           │    仅 Critical 声音   │    视口外 1-2 屏范围
           └───────────────────────┘
   ┌─────────────────────────────────────┐
   │           安全区                    │  ← 约 4700+ Agent
   │           完全静默                  │    不在关注范围内
   └─────────────────────────────────────┘
```

### 12.2 三层声音准入

| 层级 | 范围 | Agent 数（估算） | 可播放声音 | 说明 |
|------|------|-----------------|-----------|------|
| **聚焦层** | 视口内 | 20-50 | 全部声音 | 用户正在看的，完整音频反馈 |
| **感知层** | 视口外 1-2 屏 | 100-200 | 仅 Critical（alert、error） | 远处出事了能听到，但不吵 |
| **静默层** | 更远 | 4000+ | 无声音 | 不在关注范围，不产生任何音频 |

**为什么是这三层**：

- 聚焦层：用户主动看的区域，每个操作都需要即时声音反馈
- 感知层：用户没在看但可能关心——只有警报级别的信息值得穿透
- 静默层：5000 个 Agent 的大部分工作不需要用户实时关注

### 12.3 各事件类型的准入规则

**规则 1：UI 交互音效 → 始终准入（全局）**

UI 元素不在地图上，不受空间限制。用户点击按钮、切换 tab，无论地图上有多少 Agent，UI 反馈都不能丢。

```
ui.click, ui.hover, ui.tabSwitch, ui.panelOpen, ui.panelClose,
ui.toast, ui.toggle, ui.dragStart
→ 始终全局播放，不受视口约束
```

**规则 2：BGM / Ambient → 始终播放（全局）**

背景音乐和环境音跟随用户，不跟随地图位置。

```
bgm.*, ambient.*
→ 始终播放，按 Zone 覆盖比例混合
```

**规则 3：Gameplay 事件 → 按层级准入**

| 事件 | 聚焦层 | 感知层 | 静默层 | 理由 |
|------|--------|--------|--------|------|
| game.alert | ✅ 全音量 | ✅ 30% 音量 | ❌ | 警报需要穿透，但远处降低音量 |
| game.error | ✅ 全音量 | ✅ 20% 音量 | ❌ | 同上，但更安静 |
| game.taskComplete | ✅ 全音量 | ❌ | ❌ | 正常事件只限视口内 |
| game.taskFail | ✅ 全音量 | ✅ 20% 音量 | ❌ | 失败比成功更值得关注 |
| game.connect | ✅ 全音量 | ❌ | ❌ | 连接是常规事件 |
| game.disconnect | ✅ 全音量 | ✅ 30% 音量 | ❌ | 断线是异常事件，值得感知 |
| game.agentSelect | ✅ 全音量 | — | — | 只在用户主动选择时触发 |
| game.agentDeselect | ✅ 全音量 | — | — | 同上 |
| game.taskAssign | ✅ 全音量 | ❌ | ❌ | 用户分配的任务，只在视口内响 |
| game.zoneCreate | ✅ 全音量 | ❌ | ❌ | 同上 |
| game.zoneDestroy | ✅ 全音量 | ✅ 20% 音量 | ❌ | 销毁比创建更值得关注 |

**关键设计：失败 > 成功 的声音穿透优先级。**
- 任务完成只在视口内响——用户在看才关心
- 任务失败在感知层也响——用户可能没在看但应该知道
- 断线在感知层也响——异常事件需要穿透

### 12.4 视口收音：聚焦层的声音衰减

在聚焦层（视口内）进一步做距离衰减，让声音有"近大远小"的空间感：

```typescript
function calculateFocusVolume(
  sourceX: number,
  sourceY: number,
  camera: Phaser.Cameras.Scene2D.Camera
): number {
  const centerX = camera.scrollX + camera.width / 2;
  const centerY = camera.scrollY + camera.height / 2;
  const distance = Math.hypot(sourceX - centerX, sourceY - centerY);
  const viewportRadius = Math.hypot(camera.width, camera.height) / 2;

  // 视口中心 40% 范围内全音量
  const fullVolumeRadius = viewportRadius * 0.4;
  // 视口边缘衰减到 0.5（不是 0，视口内的声音都要听到）
  const edgeVolume = 0.5;

  if (distance <= fullVolumeRadius) return 1.0;
  if (distance >= viewportRadius) return edgeVolume;

  const t = (distance - fullVolumeRadius) / (viewportRadius - fullVolumeRadius);
  return 1.0 - t * (1.0 - edgeVolume);
}
```

**注意**：视口内最低音量是 0.5（不是 0），因为聚焦层内的声音都要可听。

### 12.5 感知层：穿透声音的音量

感知层的声音走更激进的衰减，只保留"远处有事发生"的信息量：

```typescript
function calculateAwarenessVolume(
  sourceX: number,
  sourceY: number,
  camera: Phaser.Cameras.Scene2D.Camera,
  eventType: 'alert' | 'error' | 'fail' | 'disconnect' | 'destroy'
): number {
  // 感知层基础音量（很小）
  const baseVolumes: Record<string, number> = {
    alert: 0.30,
    error: 0.20,
    fail: 0.20,
    disconnect: 0.30,
    destroy: 0.20,
  };

  const centerX = camera.scrollX + camera.width / 2;
  const centerY = camera.scrollY + camera.height / 2;
  const distance = Math.hypot(sourceX - centerX, sourceY - centerY);
  const viewportRadius = Math.hypot(camera.width, camera.height) / 2;

  // 感知层范围：1-2 屏（viewportRadius * 2 到 viewportRadius * 4）
  const innerEdge = viewportRadius * 2;
  const outerEdge = viewportRadius * 4;

  if (distance < innerEdge) return baseVolumes[eventType];
  if (distance > outerEdge) return 0;

  const t = (distance - innerEdge) / (outerEdge - innerEdge);
  return baseVolumes[eventType] * (1.0 - t);
}
```

### 12.6 视口环境音混合

500 个 Zone 可能同时存在多种类型，但用户一次只看到其中几个。环境音按视口内 Zone 的覆盖面积比例混合：

```
视口内 3 个 Zone:
  DataCenter Zone 占 50% → ambient.datacenter 音量 0.5
  Studio Zone 占 30%     → ambient.studio 音量 0.3
  Workshop Zone 占 20%   → ambient.workshop 音量 0.2

视口外 497 个 Zone → 不产生环境音
```

### 12.7 特殊情况

| 场景 | 处理 |
|------|------|
| 全局警报（系统级） | 不走空间衰减，全局播放，不受感知层限制 |
| 视口快速移动（快捷跳转） | 声音场景切换：旧视口 fade out 300ms + 新视口 fade in 300ms |
| 缩放（zoom in/out） | zoom in → 聚焦层变窄 → 更少 Agent 有声音；zoom out → 反之 |
| Minimap 点击跳转 | 触发目标位置的声音场景重建 |
| "全屏警报"模式 | 紧急状态下所有层级的 Critical 声音全局播放（由业务层控制） |

### 12.8 规模化极限推演

**5000 Agent 同时在线的最坏情况**：

```
场景：5000 Agent 中，1000 个同时完成任务

无准入规则：
  1000 × game.taskComplete → 声音系统崩溃

有三层准入：
  聚焦层（视口内 ~40 Agent）: 8 个完成任务 → arpeggio 合并为 1 次琶音
  感知层（~200 Agent）: taskComplete 不准入 → 静默
  静默层（~4760 Agent）: 完全静默
  
  实际播放：1 次 taskComplete 琶音
  结果：✓ 用户只听到视口内完成的声音，清晰不乱
```

```
场景：5000 Agent 中，50 个同时断线

无准入规则：
  50 × game.disconnect → 声音灾难

有三层准入：
  聚焦层: 3 个断线 → arpeggio 合并为 1 次降调琶音（全音量）
  感知层: 10 个断线 → arpeggio 合并为 1 次（30% 音量）
  静默层: 37 个断线 → 静默
  
  实际播放：2 次 disconnect（1 次大声 + 1 次小声）
  结果：✓ 用户知道附近有断线，远处也有但很远
```

### 12.9 声音焦点模式

三层准入（聚焦/感知/静默）是基于视口的静态模型。但用户的操作有**意图上下文**，声音焦点应该跟随意图变化。

**焦点模式定义**：

| 模式 | 焦点位置 | 声音范围 | 触发条件 |
|------|---------|---------|----------|
| **视口模式** | 视口中心 | 视口内全声音 + 感知层 Critical | 默认状态，未选中任何对象 |
| **跟随模式** | 选中 Agent 的位置 | 以 Agent 为圆心的动态范围 | 选中单个 Agent 且跟随移动 |
| **Zone 模式** | 选中 Zone 的区域 | Zone 内全声音 + 相邻 Zone 环境音渗透 | 选中 Zone 时 |
| **军团模式** | 军团中心点 | 军团范围内声音，但个体事件只播 1 次 | 选中多个 Agent 时 |

#### 跟随模式（Agent 移动）

```
用户选中 Agent A，Agent 在地图上移动

声音焦点跟随 Agent A：
  - Agent 所在位置为中心，半径 200px 范围全音量
  - 路过 Zone 时，该 Zone 的环境音渐入渐出
  - Agent 路过的 Zone 工作声（taskComplete 等）可听
  - 远处 Zone 的 Critical 事件感知层仍生效

变化过程（Agent 从 Zone A 走到 Zone B）：
  T+0s:   Zone A 环境音 100%, Zone B 0%
  T+1s:   Zone A 70%, Zone B 30%  （交叉渐变）
  T+2s:   Zone A 30%, Zone B 70%
  T+3s:   Zone A 0%, Zone B 100%  （完成切换）
```

#### Zone 模式（选中 Zone）

```
用户选中 Zone B（有 5 个 Agent 在工作）

声音层次：
  Layer 1 — Zone B 内部：
    完整声音（环境音 + Agent 工作声 + 任务事件）
    5 个 Agent 的 taskComplete 各自触发但走 arpeggio 合并

  Layer 2 — 相邻 Zone（直接相邻，共享边界）：
    仅环境音渗透，音量 15%
    像隔壁房间的嗡嗡声
    不播相邻 Zone 的 Agent 事件声

  Layer 3 — 更远 Zone：
    仅 Critical 穿透（alert/error），音量 10%
    环境音静默

空间临场感：用户在 Zone B 里工作，能感受到"周围有其他 Zone 在运转"。
```

#### 军团模式（选中多个 Agent）

```
星际争霸规则：声音代表意图，不代表数量。

选中 50 个 Agent → 点移动：
  ❌ 不播 50 次 game.taskAssign
  ❌ 不播每种类型各一次的 taskAssign
  ✅ 播 1 次 game.taskAssign（代表"指令已下达"）

选中 50 个 Agent → 其中 20 个同时完成任务：
  ❌ 不播 20 次 game.taskComplete
  ✅ 播 1 次 arpeggio（代表"军团有进展"）

选中混合类型（30 个 Studio Agent + 20 个 DataCenter Agent）→ 点移动：
  ✅ 播 1 次 game.taskAssign
  不需要按类型各播一次——用户的意图是"这群 Agent 去那里"，不是"Studio 去那里，DC 去那里"
```

**军团模式的声音范围**：

```
选中 50 个 Agent，分布在 300×300 的区域内

声音焦点 = 军团的 bounding box 中心
声音范围 = bounding box + 100px padding

范围内：
  - 军团成员的事件声可听（但走 arpeggio/stack 聚合）
  - 范围内其他非军团 Agent 的事件也可见（视口模式规则）

范围外：
  - 感知层和静默层规则不变
```

### 12.10 声音焦点切换过渡

不同焦点模式之间切换时，声音场景平滑过渡：

| 切换 | 过渡方式 | 时长 |
|------|---------|------|
| 视口 → 跟随 | 焦点从视口中心滑向 Agent 位置，环境音重新混合 | 300ms |
| 跟随 → Zone | 焦点固定到 Zone 中心，相邻 Zone 环境音渐入 | 200ms |
| Zone → 军团 | 焦点扩展到 bounding box，声音范围扩大 | 200ms |
| 军团 → 视口 | 焦点收缩回视口中心，范围缩小 | 300ms |
| 取消选中（任何模式 → 视口） | 渐变回视口模式 | 300ms |

---

## 15. 待讨论

- [ ] Bus 树结构是否需要调整？
- [ ] 声音列表是否有遗漏？
- [ ] Ducking 规则是否合理？
- [ ] BGM 切换条件是否需要更细化？
- [ ] 是否需要音频可视化（AnalyserNode → HUD 音频波形）？
- [ ] 是否需要录音/回放能力（和 ReplayControls 联动）？
- [ ] 优先级和并发数是否合理？
- [ ] 声音风格约束是否需要更具体（给合成器参数的约束范围）？
- [ ] 空间音频的 logarithmic 衰减 vs 线性衰减？
- [ ] 视口环境音混合是否需要 HRTF（头部相关传输函数）做立体声定位？
- [ ] 熔断器阈值是否合理（30次/秒是否太低/太高）？
- [ ] 是否需要 AudioProfiler（开发模式下可视化声音系统状态）？
