# StratixStateStore 深度集成方案

> 目标：将 RTS（Phaser 场景）完全接入统一状态内核，实现 agents / zones / sessions 的双向同步

---

## 1. 现状分析

### 1.1 已接入 StateStore 的模块

| 模块 | 接入内容 | 接入方式 |
|------|----------|----------|
| `ZoneService` | zones | `syncZoneToStore()` / `removeZoneFromStore()` 在 CRUD 后同步到 `stratixStateStore` |
| `MCPConnectionManager` | mcp.connections / mcp.tools | 初始化时写入 |
| `SessionRecorder` | sessions | 会话录制时写入 |

### 1.2 未接入 StateStore 的模块

| 模块 | 本地状态 | 问题 |
|------|----------|------|
| `StratixRTSGameScene` | `agentSprites: Map<string, AgentSprite>` | Agent 创建/状态变更不写 StateStore |
| `StratixRTSGameScene` | `selectedAgentIds: Set<string>` | 选择状态不写 StateStore |
| `StratixRTSGameScene` | `agentZoneTracking: Map<string, string>` | Agent 位置/区域追踪不写 StateStore |
| `StratixRTSGameScene` | `selectedZoneIds: Set<string>` | Zone 选择状态不写 StateStore |

### 1.3 根本原因

```
StratixRTSGameScene 是 Phaser.Scene 子类，运行在游戏循环（update/render）中
→ 直接操作 Sprite/Container，不经过 StateStore
→ 导致"统一状态内核"只统一了一半：ZoneService 写 zone，RTS 写 sprite
```

### 1.4 数据流断裂示例

```
用户拖拽 Agent 进入 Zone：
  RTS: AgentSprite 移动动画 → 更新 local agentZoneTracking
  StateStore: 不感知（zone 状态由 ZoneService 更新，但 agent 位置不更新）
  → UI 读取 StateStore.agentZoneTracking 获取 Agent 位置 → 永远是 undefined/旧值
```

---

## 2. 目标状态：完整调用链路图

### 2.1 写入路径（谁来改 → 写 StateStore）

```
┌─────────────────────────────────────────────────────────────────────┐
│                          StratixStateStore                           │
│   agents: Map<id, AgentState>                                        │
│   zones:  Map<id, ZoneState>                                         │
│   ui:     { selectedAgents, selectedZone, ... }                       │
│   sessions: Map<id, SessionState>                                    │
└─────────────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
    ZoneService写入       RTS写入            Vue UI写入
    (CRUD zone)         (agent/zone/         (selection change)
                            selection)
```

**关键原则**：所有状态写入都必须经过 StateStore，不允许绕过

### 2.2 读取路径（谁来读 → 订阅/查询 StateStore）

```
┌─────────────────────────────────────────────────────────────────────┐
│                          StratixStateStore                           │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                    │
    ZoneService订阅        RTS订阅             Vue UI订阅
    (zone 变更后          (agent状态变更后       (selection/agent
     刷新缓存)             更新 Sprite)          面板刷新)
```

### 2.3 RTS 场景内调用链路

```
AgentSprite 状态变更
    ↓ (setAgentStatus / setZoneBadge / setHighlight)
StratixRTSGameScene.onAgentStatusChanged()
    ↓
stratixStateStore.updateAgent(id, partial)   ← 写入 StateStore
    ↓ (notify subscribers)
所有订阅者收到更新

Vue UI ← 订阅 selectedAgents → 读取 StateStore → 更新 AgentPanel
         ← 订阅 selectedZone  → 读取 StateStore → 更新 ZonePanel
```

---

## 3. 集成方案

### 3.1 核心思路：RTS 场景作为 StateStore 的"游戏世界投影"

RTS Scene = Phaser 游戏循环（60fps），不适合直接订阅外部状态
→ 解决思路：**单向写入 + 按需读取**

- **写入**：RTS 内部状态变更时，同步写入 StateStore（无订阅开销）
- **读取**：RTS 初始化时从 StateStore 拉取已有状态；状态查询用 `createSelector` 按需读取

### 3.2 新增文件

```
src/stratix-rts/state/
├── RTSStateBridge.ts      # 核心桥接类：RTS ↔ StateStore
├── RTSStateSelectors.ts   # RTS 专用 selector 工厂
└── index.ts
```

### 3.3 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `src/stratix-rts/StratixRTSGameScene.ts` | 注入 `RTSStateBridge`，在状态变更处调用桥接层 |
| `src/stratix-rts/sprites/AgentSprite.ts` | 新增 `onStateChanged` 回调支持 |
| `src/stratix-core/state/StratixStateStore.ts` | 新增 `AgentState.currentZone` 映射 |
| `src/stratix-gateway/project/ZoneService.ts` | 已有同步逻辑，确保与 RTS 共用同一 Store 实例 |
| `src/stratix-project/ui/ZonePanel.vue` | 已有订阅逻辑，确保订阅路径正确 |

---

## 4. 具体修改

### 4.1 `AgentState` 扩展（`src/stratix-core/state/StratixStateStore.ts`）

```typescript
// 新增 currentZone 字段，用于 RTS 追踪 Agent 位置
export interface AgentState {
  id: string;
  name: string;
  status: {
    config: AgentConfigStatus;
    connection: AgentConnectionStatus;
    activity: AgentActivityStatus;
    lastError?: string;
    lastActiveAt?: number;
  };
  currentZone?: string;      // ← 新增：Agent 当前所在 Zone ID
  lastActiveAt?: number;
  config: Record<string, unknown>;
  // 新增：位置（用于 UI 显示，非必需）
  position?: { x: number; y: number };
}
```

### 4.2 `RTSStateBridge.ts`（新建）

```typescript
import { stratixStateStore, AgentState, ZoneState } from '@/stratix-core/state';
import type { AgentStatus } from '../sprites/AgentSprite';
import type { StratixAgentConfig } from '@/stratix-core/stratix-protocol';

export class RTSStateBridge {
  // ── Agent 操作 ────────────────────────────────────────

  /**
   * 当 RTS 创建 AgentSprite 时，同步到 StateStore
   */
  registerAgent(agentId: string, name: string, config: Partial<AgentState>['config']): void {
    const existing = stratixStateStore.getAgent(agentId);
    const state: AgentState = existing ? { ...existing } : {
      id: agentId,
      name,
      status: { config: 'configured', connection: 'disconnected', activity: 'idle' },
      config: config ?? {},
    };
    stratixStateStore.setAgent(agentId, state);
  }

  /**
   * 当 AgentSprite 状态变更时同步
   * 调用点：StratixRTSGameScene.onAgentStatusChanged()
   */
  updateAgentStatus(agentId: string, status: AgentStatus): void {
    const activityMap: Record<AgentStatus, AgentState['status']['activity']> = {
      online: 'active',
      offline: 'idle',
      busy: 'working',
      error: 'error',
    };
    stratixStateStore.updateAgent(agentId, {
      status: { activity: activityMap[status] } as any,
      lastActiveAt: Date.now(),
    });
  }

  /**
   * 当 Agent 进入 Zone 时同步
   * 调用点：StratixRTSGameScene.onZoneMemberJoined()
   */
  agentEnterZone(agentId: string, zoneId: string): void {
    stratixStateStore.updateAgent(agentId, { currentZone: zoneId });
  }

  /**
   * 当 Agent 离开 Zone 时同步
   * 调用点：StratixRTSGameScene.onZoneMemberLeft()
   */
  agentLeaveZone(agentId: string): void {
    stratixStateStore.updateAgent(agentId, { currentZone: undefined });
  }

  /**
   * 当 Agent 被删除时同步
   * 调用点：StratixRTSGameScene.removeAgent()
   */
  unregisterAgent(agentId: string): void {
    stratixStateStore.removeAgent(agentId);
  }

  // ── Selection 操作 ─────────────────────────────────────

  private previousSelectedAgents: string[] = [];

  /**
   * 当 RTS 选择变更时同步
   * 调用点：StratixRTSGameScene.emitSelectionChanged()
   */
  syncSelection(selectedAgentIds: string[], selectedZoneId: string | null): void {
    const uiState = stratixStateStore.get('ui');
    if (
      uiState.selectedAgents.join(',') !== selectedAgentIds.join(',') ||
      uiState.selectedZone !== selectedZoneId
    ) {
      stratixStateStore.set('ui', {
        ...uiState,
        selectedAgents: selectedAgentIds,
        selectedZone: selectedZoneId ?? uiState.selectedZone,
      });
    }
  }

  // ── Zone 操作（委托给 ZoneService，不重复写）────────────
  // ZoneService 已通过 syncZoneToStore() 写入 StateStore
  // RTS 无需重复写，但需要订阅变更以刷新 UI
}
```

### 4.3 `RTSStateSelectors.ts`（新建）

```typescript
import { stratixStateStore, AgentState } from '@/stratix-core/state';

/**
 * 创建 Agent 当前位置 selector
 * 用于 UI 按需查询，不在 update() 里全量订阅
 */
export const makeAgentPositionSelector = (agentId: string) =>
  stratixStateStore.createSelector(
    (state) => state.agents.get(agentId)?.position,
    (a, b) => a?.x === b?.x && a?.y === b?.y
  );

/**
 * 创建 Agent 当前 Zone selector
 */
export const makeAgentZoneSelector = (agentId: string) =>
  stratixStateStore.createSelector(
    (state) => state.agents.get(agentId)?.currentZone
  );

/**
 * 创建在线 Agent 列表 selector
 */
export const makeOnlineAgentsSelector = () =>
  stratixStateStore.createSelector(
    (state) => Array.from(state.agents.values()).filter(a => a.status.connection === 'connected')
  );
```

### 4.4 `StratixRTSGameScene.ts` 改造

**注入桥接层**（在 `create()` 中）：

```typescript
import { RTSStateBridge } from './state/RTSStateBridge';

private stateBridge: RTSStateBridge;

private initStateBridge(): void {
  this.stateBridge = new RTSStateBridge();
}
```

**修改 `onCreateAgent()`**（已有 agent 创建处）：

```typescript
// 在 addAgentSprite() 之后，同步到 StateStore
this.stateBridge.registerAgent(config.agentId, config.name, config.config ?? {});
```

**修改 `onUpdateAgentStatus()`**：

```typescript
private onUpdateAgentStatus(data: { agentId: string; status: AgentStatus }): void {
  const sprite = this.agentSprites.get(data.agentId);
  if (sprite) {
    sprite.setAgentStatus(data.status);
    // 新增：同步到 StateStore
    this.stateBridge.updateAgentStatus(data.agentId, data.status);
  }
}
```

**修改 `onZoneMemberJoined()`**：

```typescript
// 现有逻辑 + 同步
this.stateBridge.agentEnterZone(data.agentId, data.zoneId);
```

**修改 `onZoneMemberLeft()`**：

```typescript
// 现有逻辑 + 同步
this.stateBridge.agentLeaveZone(data.agentId);
```

**修改 `removeAgent()`**：

```typescript
public removeAgent(agentId: string): void {
  // ... 现有 destroy 逻辑
  this.stateBridge.unregisterAgent(agentId);  // ← 新增
}
```

**修改 `emitSelectionChanged()`**：

```typescript
private emitSelectionChanged(): void {
  // ... 现有 emit 逻辑
  // 新增：同步 selection 到 StateStore
  const selectedAgentIds = Array.from(this.selectedAgentIds);
  const selectedZoneIds = Array.from(this.selectedZoneIds);
  this.stateBridge.syncSelection(
    selectedAgentIds,
    selectedZoneIds[0] ?? null
  );
}
```

### 4.5 `ZoneService.ts` 无需修改（已接入）

确认 `ZoneService.syncZoneToStore()` 和 `removeZoneFromStore()` 在所有 CRUD 操作后被调用即可。

---

## 5. 性能与响应式注意事项

### 5.1 Phaser 游戏循环中的 StateStore 订阅

**禁止在 `update()` 中订阅 StateStore**。Phaser 游戏循环 60fps，StateStore 每次 `notify()` 都会遍历所有订阅者并重新渲染，完全浪费。

**正确做法**：
- 游戏逻辑单向写入 StateStore（无订阅）
- 需要读取时用 `createSelector()` 按需查询（带 memoization）
- UI 层（Vue）订阅 StateStore 变更（低频，不影响游戏循环）

### 5.2 批量更新优化

StateStore 提供 `batch()` API，用于批量操作后只通知一次：

```typescript
stratixStateStore.batch((store) => {
  agentIds.forEach(id => store.updateAgent(id, { status: { activity: 'working' } }));
});
```

RTS 在 `handleZoneDrawEnd()` 等多步操作处使用 `batch()` 包裹。

### 5.3 AgentSprite 状态变更去重

`setAgentStatus()` 可能在同一帧内被多次调用。使用 `createSelector` 的 memoization 特性，相同值不触发通知：

```typescript
// RTSStateBridge.updateAgentStatus 中
const current = stratixStateStore.getAgent(agentId);
if (current?.status.activity === activityMap[status]) return; // 去重
```

---

## 6. 风险与缓解

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| StateStore 写入频率过高（每帧多次 `notify()`） | 高 | 使用 `batch()` 包裹；关键路径去重检查 |
| 循环依赖（RTS → Store → Vue → RTS） | 中 | StateStore 只做数据承载，RTS 不订阅自己写入的变更 |
| 初始化顺序问题（Store 先于 Scene 就绪） | 低 | RTSStateBridge 懒初始化，Scene create() 后才实例化 |
| AgentSprite 和 StateStore 状态不一致 | 中 | 统一入口：所有 Agent 状态变更必须经过 `RTSStateBridge`，禁止直接修改 `agentSprites` 后不同步 |
| ZoneService 和 RTS 同时写 ZoneState | 低 | ZoneService 写 zone，RTS 只写 agent.currentZone，不写 zone 状态 |

---

## 7. 验收标准

### 7.1 功能验收

- [ ] Agent 在 RTS 中被创建/删除时，`StateStore.agents` 同步增减
- [ ] Agent 状态变更（online/offline/busy/error）写入 `StateStore.agents[id].status`
- [ ] Agent 进入/离开 Zone 时，`StateStore.agents[id].currentZone` 正确更新
- [ ] RTS 选择 Agent 时，`StateStore.ui.selectedAgents` 同步更新
- [ ] RTS 选择 Zone 时，`StateStore.ui.selectedZone` 同步更新
- [ ] ZoneService 创建/删除 Zone 时，`StateStore.zones` 同步（已验证）

### 7.2 性能验收

- [ ] `StratixRTSGameScene.update()` 中无 StateStore 订阅调用
- [ ] 批量操作使用 `batch()`，无连续 `notify()`
- [ ] E2E 测试：创建 20 个 Agent，RTS 帧率无明显下降（对比基准）

### 7.3 架构验收

- [ ] 新增 `src/stratix-rts/state/` 模块，无状态直接写入 Sprite 而不同步
- [ ] `RTSStateBridge` 是 RTS 到 StateStore 的唯一写入路径
- [ ] Vue UI 面板通过 `stratixStateStore.subscribe()` 订阅，不直接读 RTS 内部状态

---

## 8. 实施步骤

### Phase 1：基础设施（新建文件）
1. 新建 `src/stratix-rts/state/RTSStateBridge.ts`
2. 新建 `src/stratix-rts/state/RTSStateSelectors.ts`
3. 新建 `src/stratix-rts/state/index.ts`（barrel export）

### Phase 2：RTS Scene 集成
4. 在 `StratixRTSGameScene.create()` 中初始化 `RTSStateBridge`
5. 在 `onCreateAgent()` / `removeAgent()` / `onUpdateAgentStatus()` / `onZoneMemberJoined()` / `onZoneMemberLeft()` / `emitSelectionChanged()` 处插入同步调用

### Phase 3：验证
6. 运行 E2E 测试 `tests/e2e/zone-lifecycle.spec.ts`
7. 手动测试：创建 Agent、拖拽、进入 Zone、检查 Vue DevTools 中 StateStore 状态

---

## 附录：StateStore 完整 API

```typescript
// 核心
stratixStateStore.get<K>('agents')  // 获取整个 Map
stratixStateStore.set('ui', uiState) // 整体替换
stratixStateStore.subscribe(fn)       // 订阅所有变更

// Agent
stratixStateStore.getAgent(id)        // 获取单个
stratixStateStore.setAgent(id, state) // 写入单个
stratixStateStore.updateAgent(id, partial) // 部分更新
stratixStateStore.removeAgent(id)     // 删除

// Zone
stratixStateStore.getZone(id)
stratixStateStore.setZone(id, state)
stratixStateStore.updateZone(id, partial)
stratixStateStore.removeZone(id)

// Session
stratixStateStore.getSession(id)
stratixStateStore.setSession(id, state)
stratixStateStore.updateSession(id, partial)
stratixStateStore.removeSession(id)

// 批量 & 性能
stratixStateStore.batch(fn)           // 批量更新
stratixStateStore.createSelector(fn)   // 带 memoization 的 selector
```
