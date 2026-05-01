# CAE MVP Definition

> 基于 AUDIO_SYSTEM_DESIGN.md v0.7 的最小可行产品定义
> 目标：引擎能独立跑起来，发出像素风声音，Stratix 愿意接入

## MVP 范围

### In Scope（必须交付）

**1. 引擎核心**
- `ChipAudioEngine` 类：init() / destroy() / suspend() / resume()
- AudioContext 管理（自建或注入）
- 生命周期事件：on('ready') / on('error')

**2. Bus 树**
- MasterBus → MusicBus + SFXBus
- SFXBus → UIBus + GameplayBus
- 每个 Bus 支持：setVolume / setMuted / fadeTo

**3. OscillatorProvider**
- 唯一内置音源，Web Audio API 振荡器合成
- 支持配置：波形类型、频率（含滑音）、ADSR 包络、滤波器、音量、时长
- 多波形叠加（一个声音可由多个振荡器组成）

**4. SoundPack 配置加载**
- `pixel-sfc.json` 默认 Pack，包含所有 UI + Gameplay 声音定义
- 引擎启动时加载 Pack，所有声音参数从 Pack 读取
- JSON Schema 校验 Pack 格式
- 运行时可切换 Pack：loadSoundPack(anotherPack)

**5. 声音注册表**
- 基于 Pack 自动注册所有 SoundId
- 覆盖：相同 SoundId 的 play() 替换当前正在播的（如果策略允许）

**6. 事件聚合（三种策略）**
- arpeggio：同类事件合并为琶音序列（用于 taskComplete、connect、disconnect）
- stack：不同 SoundId 直接叠加，同 SoundId 短间隔排队
- debounce：窗口内只播最后一次（用于 hover、toggle）

**7. 通道池**
- 最大 8 通道（可配置）
- 通道分配策略：BGM 优先占用，SFX 按需分配
- 通道占满时等待最短声音释放（不丢弃事件）

**8. Ducking**
- 配置驱动：trigger soundId → target bus → dipTo → durations
- 内置默认规则：alert 播放时 MusicBus 压低

**9. Public API**

```typescript
class ChipAudioEngine {
  constructor(config: EngineConfig)
  init(): Promise<void>
  destroy(): void

  play(soundId: string, options?: PlayOptions): void
  stop(soundId: string): void

  getBus(busId: string): AudioBus
  getMasterBus(): AudioBus

  loadSoundPack(pack: SoundPack): void
  updateConfig(partial: Partial<EngineConfig>): void

  on(event: AudioEvent, handler: Function): void
  off(event: AudioEvent, handler: Function): void
}
```

**10. 默认 SoundPack（pixel-sfc）**

包含以下声音的完整合成参数：

| SoundId | 类型 | 波形 | 时长 |
|---------|------|------|------|
| ui.click | 方波 | 1200Hz | 50ms |
| ui.hover | 正弦波 | 800Hz | 30ms |
| ui.tabSwitch | 正弦波 | 600→800Hz | 40ms |
| ui.panelOpen | 方波+噪音 | 300→600Hz | 150ms |
| ui.panelClose | 方波+噪音 | 600→300Hz | 120ms |
| ui.toast | 正弦波 | 400→800Hz | 80ms |
| ui.toggle | 方波 | 1000Hz | 30ms |
| ui.dragStart | 正弦波 | 500→700Hz | 60ms |
| game.agentSelect | 正弦波 | 600Hz + 回响 | 100ms |
| game.agentDeselect | 正弦波 | 400→300Hz | 60ms |
| game.taskAssign | 方波+噪音 | 滤波 | 150ms |
| game.taskComplete | 三角波琶音 | C5-E5-G5 | 300ms |
| game.taskFail | 锯齿波 | 200→100Hz | 200ms |
| game.alert | 三角波 | 500→400Hz ×2 | 300ms |
| game.zoneCreate | 方波 | 100→400Hz | 200ms |
| game.zoneDestroy | 锯齿波 | 400→80Hz | 250ms |
| game.error | 锯齿波 | 150Hz | 150ms |
| game.connect | 正弦波三连 | 300→600→900Hz | 200ms |
| game.disconnect | 正弦波 | 800→200Hz | 200ms |

---

### Out of Scope（后续版本）

| 功能 | 版本 |
|------|------|
| SampleProvider（音频文件播放） | v0.2 |
| ChiptuneProvider + BGM 生成 | v0.2 |
| BGM crossfade 系统 | v0.2 |
| 环境音系统 | v0.2 |
| 空间音频（三层准入） | v0.3 |
| 焦点模式（视口/跟随/Zone/军团） | v0.3 |
| 熔断器（四层防护） | v0.3 |
| Phaser 适配器 | v0.4 |
| React 适配器 | v0.4 |
| 性能指标 getMetrics() | v0.3 |
| CircuitBreak 事件回调 | v0.3 |
| 全局静音/恢复（page visibility） | v0.2 |

---

## MVP 目录结构

```
chip-audio-engine/
├── src/
│   ├── core/
│   │   ├── ChipAudioEngine.ts    # 主引擎类
│   │   ├── AudioBus.ts           # Bus 节点（GainNode 封装）
│   │   └── ChannelPool.ts        # 8 通道管理
│   ├── providers/
│   │   └── OscillatorProvider.ts  # 振荡器合成
│   ├── aggregation/
│   │   ├── Aggregator.ts         # 聚合调度器
│   │   ├── ArpeggioStrategy.ts   # 琶音合并
│   │   ├── StackStrategy.ts      # 叠加排队
│   │   └── DebounceStrategy.ts   # 防抖
│   ├── config/
│   │   ├── schema.ts             # SoundPack JSON Schema
│   │   └── defaults.ts           # 默认引擎配置
│   ├── ducking/
│   │   └── DuckManager.ts        # Ducking 规则管理
│   └── index.ts                  # Public API 导出
├── packs/
│   ├── pixel-sfc.json            # 默认像素风 SoundPack
│   └── schema.json               # Pack 校验 Schema
├── tests/
│   ├── engine.test.ts            # 引擎生命周期测试
│   ├── bus.test.ts               # Bus 树测试
│   ├── aggregator.test.ts        # 聚合策略测试
│   └── provider.test.ts          # 音源测试
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE (MIT)
```

## MVP 验收标准

- [ ] `npm install` 后 `import { ChipAudioEngine } from 'chip-audio-engine'` 可用
- [ ] init() 成功创建 AudioContext + Bus 树
- [ ] play('ui.click') 发出方波短促声音
- [ ] play('game.taskComplete') 发出 C5-E5-G5 三音琶音
- [ ] 10 次 play('game.taskComplete') 在 200ms 内触发 → 合并为 1 次琶音
- [ ] play('game.alert') 触发 ducking → MusicBus 音量降低
- [ ] loadSoundPack(otherPack) 切换后声音参数变化
- [ ] destroy() 清理所有 AudioNode，无内存泄漏
- [ ] TypeScript 类型声明完整
- [ ] 测试覆盖率 > 80%

## MVP 工期估算

| 模块 | 预估 |
|------|------|
| Core（Engine + Bus + ChannelPool） | 1 天 |
| OscillatorProvider | 0.5 天 |
| SoundPack + Config | 0.5 天 |
| Aggregation（3 策略） | 1 天 |
| Ducking | 0.5 天 |
| pixel-sfc.json 参数调优 | 1 天 |
| 测试 | 1 天 |
| README + 文档 | 0.5 天 |
| **总计** | **~6 天** |

## Stratix 接入方式（MVP）

MVP 阶段 Stratix 通过 npm link 本地引用：

```bash
# 在 chip-audio-engine 目录
npm link

# 在 Stratix 目录
npm link chip-audio-engine
```

Stratix 侧的桥接代码（不在 CAE 内）：

```typescript
import { ChipAudioEngine } from 'chip-audio-engine';
import pixelPack from 'chip-audio-engine/packs/pixel-sfc.json';

const audio = new ChipAudioEngine({ soundPack: pixelPack });
await audio.init();

// 按钮点击
audio.play('ui.click');

// 任务完成
audio.play('game.taskComplete');
```
