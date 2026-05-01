# Stratix Audio System Design

> 状态：Draft v0.4  
> 日期：2026-05-01  
> 作者：锻 + 姜琦

---

## 1. 现状分析

### 1.1 当前音频代码

Stratix 当前有**两套并行、互不关联**的音频系统：

| 系统 | 文件 | 能力 | 问题 |
|------|------|------|------|
| `SoundEffects` | `src/stratix-rts/audio/SoundEffects.ts` | 5 种合成音效 | 单例、无总线、无优先级 |
| `SoundService` | `src/services/SoundService.ts` | 4 种合成音效 + ADSR 包络 | 单例、无总线、持久化设置 |

两者都基于 Web Audio API，都用振荡器合成声音，都只有一个 masterGain 控制总音量。

### 1.2 缺失的能力

- ❌ 没有总线分层（所有声音一锅炖）
- ❌ 没有优先级系统（N 个声音同时响时无法管理）
- ❌ 没有 ducking（SFX 播放时 BGM 自动降低）
- ❌ 没有 BGM 系统（循环播放、crossfade 切换）
- ❌ 没有环境音系统（持续循环的背景声）
- ❌ 没有音效池化（频繁播放时没有复用机制）
- ❌ 声音种类太少（总共 9 种，且两套系统有重叠）

---

## 2. 行业方案对比

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

## 3. 总线架构

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

## 4. 声音清单

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

基于第 9 章像素风 16-bit 芯片音源约束：

| 类型 | 策略 | 波形 | 理由 |
|------|------|------|------|
| UI 音效 | **振荡器合成** | 方波 + 三角波 | SFC 风格交互反馈，短促温润 |
| Gameplay 音效 | **振荡器合成** | 三角波 + 方波 + 琶音 | 回合制 RPG 风格事件通知 |
| BGM | **MIDI 脚本生成 Chiptune** | 多通道芯片音 | SFC 8 通道 PCM 风格，前端轻量生成 |
| 环境音 | **振荡器 drone + 滤波器** | 三角波底层 | 像素风环境层，温润不刺耳 |

**所有声音均由前端脚本生成，不依赖外部音频文件。**

---

## 5. 事件聚合与并发控制

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

Normal（UI 交互）
  → Queue: 排队播放，间隔 ≥ 50ms
  → 5 个 click 在 100ms 内 → 排队播 5 次，每次间隔 50ms，总耗时 250ms
  → 用户感知为连续点击反馈，合理

Low（Hover）
  → Debounce: 只播放最后一次
  → hover 天然高频，用户不感知单次丢失
  → cooldown 150ms
```

### 5.3 聚合配置

```typescript
interface AggregationConfig {
  /** 策略 */
  strategy: 'restart' | 'arpeggio' | 'queue' | 'debounce';
  /** 聚合窗口 (ms)，窗口内的同类事件合并处理 */
  windowMs: number;
  /** 琥音最大音符数 (arpeggio 策略) */
  maxNotes?: number;
  /** 排队最小间隔 (ms) (queue 策略) */
  queueInterval?: number;
  /** 防抖冷却 (ms) (debounce 策略) */
  cooldown?: number;
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
| game.agentSelect | Normal | queue | 50 | 排队 |
| game.agentDeselect | Normal | debounce | 80 | 快速连点合并 |
| game.taskAssign | Normal | queue | 50 | 排队 |
| game.zoneCreate | Normal | queue | 50 | 排队 |
| game.zoneDestroy | Normal | queue | 50 | 排队 |
| ui.click | Normal | queue | 30 | 快速排队 |
| ui.tabSwitch | Normal | debounce | 80 | 防重复 |
| ui.panelOpen | Normal | queue | 50 | 排队 |
| ui.panelClose | Normal | queue | 50 | 排队 |
| ui.toast | Normal | queue | 100 | 多条排队 |
| ui.toggle | Normal | debounce | 80 | 防重复 |
| ui.hover | Low | debounce | 150 | 防抖 |
| ui.dragStart | Low | debounce | 100 | 防抖 |
| bgm.* | — | — | — | 不走聚合，由 BGM 系统管理 |
| ambient.* | — | — | — | 不走聚合，持续播放 |

### 5.4 SFC 8 通道约束

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

### 5.5 不同类型事件互不挤占

**关键设计：不同 Bus 的通道独立，互不挤占。**

```
❌ 错误: 6 个 taskComplete 挤占了所有通道，alert 无法播放
✅ 正确: GameplayBus 用通道 4-5，UIBus 用通道 6，Critical 用通道 7
         即使 Gameplay 在密集播放，alert 仍然立即发声
```

---

## 6. 音频与 HUD 的集成点

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

## 7. API 设计（Draft）

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

## 8. 与现有系统的关系

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

## 9. 声音风格定义

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

## 10. 实时性与连贯性

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

## 11. 异常防护：循环触发熔断

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

## 12. 空间音频与视口收音

### 12.1 问题：可视范围的声音收集

类比 RTS 游戏的视口音频：

- StarCraft II：只能听到视口内单位的声音
- Age of Empires IV：远处战斗声模糊，近处清晰
- 你在地图左边，听不到右边的 Agent 报警

### 12.2 空间音频模型

Stratix 的场景是一个 2D 俯视地图，有摄像机（viewport）。声音的来源是地图上的 Agent、Zone 等。

**坐标系统**：

```typescript
interface SpatialSource {
  /** 声音源在世界坐标中的位置 */
  worldX: number;
  worldY: number;
}
```

**视口收音规则**：

```
              Camera Viewport
         ┌─────────────────────┐
         │                     │
         │   🔵 Agent A        │  ← 全音量 (在视口内)
         │                     │
    🔴   │                     │   ← 静音 (在视口外)
  Agent B│                     │
         │         🟡 Agent C  │  ← 50% 音量 (在边缘)
         └─────────────────────┘
              ↑ 边缘过渡带
```

**音量衰减模型**：

```typescript
function calculateSpatialVolume(
  sourceX: number,
  sourceY: number,
  camera: Phaser.Cameras.Scene2D.Camera,
  config: SpatialConfig
): number {
  // 1. 计算声音源到视口中心的距离
  const viewportCenterX = camera.scrollX + camera.width / 2;
  const viewportCenterY = camera.scrollY + camera.height / 2;
  const distance = Math.hypot(sourceX - viewportCenterX, sourceY - viewportCenterY);

  // 2. 视口半径（对角线的一半）
  const viewportRadius = Math.hypot(camera.width, camera.height) / 2;

  // 3. 衰减区间
  const { fullVolumeRadius, maxAudibleRadius } = config;
  // fullVolumeRadius: 视口中心到该距离内全音量
  // maxAudibleRadius: 超过该距离静音

  if (distance <= fullVolumeRadius) return 1.0;
  if (distance >= maxAudibleRadius) return 0.0;

  // 4. 线性插值衰减（也可用对数衰减更自然）
  const t = (distance - fullVolumeRadius) / (maxAudibleRadius - fullVolumeRadius);
  return 1.0 - t;
}
```

**空间配置**：

```typescript
interface SpatialConfig {
  /** 全音量范围（像素），= 视口半径 * 此系数 */
  fullVolumeRatio: number;     // 默认 0.6 (视口中心 60% 范围全音量)
  /** 最大可听范围（像素），超过则静音 */
  maxAudibleRatio: number;     // 默认 1.5 (视口对角线 1.5 倍)
  /** 衰减曲线 */
  rollOffCurve: 'linear' | 'logarithmic';  // 默认 logarithmic
}
```

### 12.3 声音的空间分类

| 分类 | 空间模式 | 说明 |
|------|---------|------|
| UI 音效 | **无空间**（全局） | UI 元素不在地图上，始终全音量 |
| BGM | **无空间**（全局） | 背景音乐跟随玩家，不跟随位置 |
| Ambient | **Zone 绑定** | 环境音绑定到 Zone 位置，根据 Zone 与视口距离衰减 |
| Gameplay | **事件源位置** | Agent 选中/任务完成等跟随事件发生的地图位置 |

### 12.4 视口环境音混合

当视口同时覆盖多个 Zone 时，环境音按面积比例混合：

```
Camera Viewport
┌────────────────────────────┐
│  Zone A (DataCenter)  60%  │  ← ambient.datacenter 60% 音量
│                    ┌───────┤
│                    │Zone B │  ← ambient.studio 40% 音量
│                    │Studio │
└────────────────────┴───────┘

混合结果:
  ambient.datacenter → volume 0.6
  ambient.studio     → volume 0.4
```

这创造了「移动摄像机穿过不同区域时环境音自然过渡」的效果。

### 12.5 特殊情况

| 场景 | 处理 |
|------|------|
| 全局事件（系统警报） | 不走空间衰减，全局播放 |
| 视口快速移动（快捷跳转） | 环境音 crossfade 300ms 过渡 |
| 缩放（zoom in/out） | 缩放越大→fullVolumeRatio 越小→声音更聚焦 |
| Minimap 点击跳转 | 触发目标位置的环境音 crossfade |

---

## 13. 待讨论

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
