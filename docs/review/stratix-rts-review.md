# stratix-rts 模块审查报告

## 概览

**模块目的**: Stratix RTS 游戏引擎核心模块，提供 Phaser 3 游戏场景、单位移动、区域管理、命令系统、事件总线

**文件统计**: 80+ 文件
- 核心场景: `StratixRTSGameScene.ts`, `StratixRTSUIScene.ts`
- 事件系统: `events/` (core, bridge, replay, middleware)
- 系统: `systems/` (Command, Movement, ControlGroup, Formation, Collision, SpatialHashGrid, RenderMode)
- 区域: `zones/` (TaskZone, BaseZone, UnifiedZoneManager, ZoneTemplateManager, etc.)
- UI: `ui/` (SelectBox, ShortcutManager, ToastManager, etc., plus v2/)
- 效果: `effects/` (ParticleSystem, DataFlowAnimation, etc.)
- 状态: `state/` (RTSStateBridge, RTSStateSelectors, ZoneStateFlow)
- 其他: `sprites/`, `managers/`, `performance/`, `error/`, `history/`, `audio/`, `config/`, `themes/`, `ground/`

**关键导出**:
- `createStratixRTS()` - 工厂函数
- `StratixRTSGameScene` - 主游戏场景
- `StratixRTSEventManager` - Stratix 事件管理器
- `CommandSystem` - RTS 命令系统
- `rtsEventBus` - RTS 内部事件总线

---

## 代码质量

### 优点

- **事件驱动架构**: `RTSEventBus` 使用 mitt 实现，支持 middleware、request/response、事件队列
- **模块化设计**: 系统职责分离（CommandSystem、MovementSystem、ControlGroupSystem）
- **TypeScript 覆盖率高**: 大量类型定义
- **性能优化意识**: 事件队列批量处理、中间件节流、对象池
- **善用现有库**: 集成 mitt、xstate (可能)

### 问题

| 位置 | 问题 | 严重性 |
|------|------|--------|
| `StratixRTSGameScene.ts` | 单一场景 1500+ 行，承担过多职责 | 高 |
| `StratixRTSEventManager.ts` | 硬编码事件字符串，缺少类型安全 | 中 |
| `RTSEventBus.ts:154` | `return null` 类型断言不安全 | 中 |
| `RTSEventBus.ts:157` | `ReturnType<typeof setTimeout>` 在浏览器/Node 类型可能不同 | 低 |
| `events/middleware/` | 中间件存在但可能未被充分使用 | 低 |

### 函数长度

- `StratixRTSGameScene.create()`: ~50 行 (合理，但场景整体过大)
- `CommandSystem.createCommand()`: ~30 行 (合理)
- `RTSEventBus.request()`: ~30 行 (合理)

### 死代码

- `StratixRTSGameScene.ts` 可能存在未使用的私有字段
- 需要全面搜索确认

---

## 安全

### 注入风险

| 位置 | 风险 | 评估 |
|------|------|------|
| `StratixRTSEventManager.ts` | 从 StratixEventBus 接收 payload 直接类型断言 | 中 |
| 事件 payload | 所有事件数据来自外部（StratixEventBus），需验证 | 中 |

### 错误处理

**位置**: `RTSEventBus.ts:119-121`
```typescript
} catch (error) {
  console.error(`[RTSEventBus] Middleware error for ${event}:`, error);
}
```
- 错误被静默吞掉，不影响流程，但可能丢失错误上下文

---

## 性能

### 优点

- **事件队列批量处理**: `EventQueue` + `processQueue()` 批量发送事件
- **中间件节流**: `throttle` middleware
- **对象池**: `events/core/ObjectPool.ts`, `performance/ObjectPool.ts`
- **SpatialHashGrid**: 空间哈希网格优化碰撞检测

### 问题

| 位置 | 问题 | 影响 |
|------|------|------|
| `RTSEventBus.processQueue()` | `maxEvents: number = 100` 硬编码 | 低 |
| `StratixRTSGameScene` | 所有 agent 移动在主循环更新，大数量可能有性能问题 | 中 |
| 纹理预加载 | `preloadThemeTextures` 在 preload() 同步加载大量纹理 | 中 |

### N+1 查询

- 不直接适用（无 DB）

---

## 架构

### 模块边界

```
index.ts (入口)
├── StratixRTSGameScene (主游戏场景)
│   ├── CommandSystem (命令系统)
│   ├── MovementSystem (移动系统)
│   ├── ControlGroupSystem (控制组)
│   ├── UnifiedZoneManager (区域管理)
│   └── AgentSprite[] (单位精灵)
├── StratixRTSUIScene (UI 场景)
│   ├── ShortcutManager
│   ├── SelectBox
│   └── v2/CommandPanel, Minimap, TopBar
├── events/
│   ├── core/RTSEventBus (事件总线)
│   ├── bridge/RTSBridge (与 Vue/Stratix 桥接)
│   ├── replay/ (回放系统)
│   └── middleware/ (节流、日志、批处理)
└── systems/
    ├── CommandSystem
    ├── MovementSystem
    ├── CollisionSystem
    └── SpatialHashGrid
```

### 依赖方向

```
StratixRTSGameScene
  ├── rtsEventBus (单向)
  ├── ProjectManagerIntegration (stratix-project)
  ├── RTSCharacterRenderer (services)
  └── AgentSprite[]

RTSEventBus
  └── mitt (第三方库)
```

### 耦合

- **中等耦合**: 场景与系统紧耦合，但系统本身可独立测试
- **事件总线解耦**: `RTSEventBus` 解耦了场景间通信

---

## 测试

### 覆盖率

- **test/ 目录存在** (`src/stratix-rts/test/`)
- 但实际测试文件需进一步检查

### 建议

- CommandSystem 逻辑可单元测试
- RTSEventBus 的 middleware 可单元测试

---

## 横向联动

### 依赖的模块

| 模块 | 用途 |
|------|------|
| `@/stratix-core/stratix-protocol` | 类型定义 |
| `@/stratix-project/ProjectClient` | 项目客户端 |
| `@/design-system/config` | 主题 token |
| `mitt` | 事件发射器 |

### 依赖本模块的模块

- `stratix-project` - 通过 `ProjectManagerIntegrationHTTP` 使用
- `electron` - 作为游戏入口

---

## 改进建议

### P0 - 应修复

1. **StratixRTSEventManager 硬编码事件字符串** (`StratixRTSEventManager.ts`)
   ```typescript
   // 当前：硬编码
   this.subscribe('stratix:agent_create', this.onAgentCreate.bind(this));
   ```
   建议：从 `stratix-protocol` 导入事件类型常量

2. **RTSEventBus.request 返回类型不安全** (`RTSEventBus.ts:154`)
   ```typescript
   return null as RequestResponseMap[K]['response'];
   ```
   建议：使用 `undefined` 替代 `null` 或添加 `success` 标志

### P1 - 应修复

3. **StratixRTSGameScene 过大** - 建议拆分
   - 将 `createAgentSprite()`, `initCamera()`, `initSystems()` 等提取到独立 Manager 类
   - 或将场景按功能区域拆分（GridLayer, AgentLayer, ZoneLayer, UILayer）

4. **事件队列 maxEvents 硬编码** (`RTSEventBus.ts:132`)
   ```typescript
   processQueue(maxEvents: number = 100): void {
   ```
   建议：改为配置或常量

### P2 - 可改进

5. **添加更多中间件**
   - 当前有 `throttle`, `logger`, `performance`, `batch`
   - 可添加 `retry`, `circuitBreaker` 等

6. **纹理加载进度反馈**
   - `preloadThemeTextures` 无进度回调

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | B | 架构清晰，场景过于臃肿 |
| 安全 | B | 基本安全，payload 类型断言需改进 |
| 性能 | B+ | 有优化意识，队列/池化已实现 |
| 架构 | A- | 事件驱动，模块化良好 |
| 测试 | C | test 目录存在，需确认覆盖 |
| 可维护性 | B | 场景大但模块化好，维护性中等 |

**总体评估**: 核心 RTS 模块架构设计良好，事件驱动、模块化、性能优化意识都有体现。主要风险点是主场景类过于臃肿和部分类型安全问题。
