# Stores Review

## 概览

| Store | 文件 | 职责 |
|-------|------|------|
| `useAgentStore` | `src/stores/agent.ts` | Agent 配置管理、生命周期、位置保存、自动刷新 |
| `useUIStore` | `src/stores/ui.ts` | UI 状态（sidebar、modals、theme、toasts、command logs） |
| `useZoneStore` | `src/stores/zone.ts` | Zone CRUD、files、tasks、messages |
| `useSystemZoneStore` | `src/stores/systemzone.ts` | System Zone 控制台状态（observer、strategist、guardian、proposals、executions） |

**测试**: `src/stores/__tests__/systemzone.test.ts` — 1000+ 行，覆盖 `useSystemZoneStore` 全部 actions/getters/state。

---

## 代码质量

### useAgentStore

**优点**:
- 清晰的状态管理：agents、selectedIds、loading、error 分离
- Position debouncing：L65-123 的 `pendingPositionUpdates` + `POSITION_SAVE_DELAY` 避免频繁保存
- Auto-refresh 有正确的清理机制
- Callback 模式解耦了 store 和 RTS game scene

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `agents.value?.` 可选链滥用 | L74-86 | `agents.value?.filter(...) ?? []` — `agents` 是 `ref<StratixAgentConfig[]>`，不可能为 undefined/nullable，但 `?.` 暗示可能为空，应直接 `agents.value.filter(...)` |
| `refreshAgents` 后立即调 `isRefreshing = false` | L212-214 | `setTimeout(() => { isRefreshing.value = false; }, 500)` — 500ms 硬编码延迟，为何不直接设 false？ |
| URL 构建未做编码 | L436 | `fetch('/api/stratix/config/agent/delete?agentId=${agentId}')` — `agentId` 未做 URL encode，可能有 injection 风险 |
| 创建后立即 refresh | L240, L297 | `createAgent` 和 `createAgentFromCharacter` 都调用 `await refreshAgents()`，但没有检查上次 refresh 是否还在进行中 |
| 未处理的 Promise rejection | L220-241 | `createAgent` 内部调用 `refreshAgents()` 但没有 catch，如果 refreshAgents 失败，错误会上冒 |

```typescript
// L74: agents 是 ref<StratixAgentConfig[]>，.value 永远不是 null/undefined
const selectedAgents = computed(() =>
  agents.value?.filter(a => selectedIds.value.includes(a.agentId)) ?? []
);
// 建议：
const selectedAgents = computed(() =>
  agents.value.filter(a => selectedIds.value.includes(a.agentId))
);

// L436: agentId 未编码
fetch(`/api/stratix/config/agent/delete?agentId=${agentId}`, { method: 'DELETE' });
// 建议：
fetch(`/api/stratix/config/agent/delete?agentId=${encodeURIComponent(agentId)}`, { method: 'DELETE' });
```

### useUIStore

**优点**:
- Toast 有 MAX_TOASTS=10 上限，防止内存泄漏
- Command logs 有 50 条上限，防止内存泄漏
- `isDarkMode` computed 正确响应系统主题变化
- 音量边界正确处理：`Math.max(0, Math.min(1, volume))`

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| Toast ID 碰撞风险 | L154 | `toast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` — `Date.now()` 毫秒级，fast consecutive calls 可能碰撞 |
| setTimeout 在 toast remove 前未清理 | L167-170 | 每个 toast 创建 setTimeout，但没有在 remove 时清理（虽然 3s 后自动触发不是大泄漏） |

### useZoneStore

**优点**:
- 正确使用 `ApiClient` 封装 fetch
- Zone 文件操作后乐观更新本地状态
- `timeout` 参数传入 API client

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `createZoneApiClient` 在每次调用 store 时重新创建 | L9-13 | 每次 import `useZoneStore` 都 new 一个 ApiClient 实例，但 ApiClient 可能包含连接池等资源 |
| `updateZone` 返回 boolean 但调用方可能忽略 | L89-104 | 函数返回 `false` 表示失败，但调用方通常不处理返回值 |
| `zone.files.push()` 假设 files 存在 | L141-144 | `zone.files.push(...)` — 如果 `zone.files` 是 undefined 会报错 |

```typescript
// L141-144: 如果 zone.files 是 undefined，会抛出错误
const zone = zones.value.find(z => z.id === zoneId);
if (zone) {
  zone.files.push(result.data.file);  // zone.files 可能不存在
}
```

### useSystemZoneStore

**优点**:
- Per-panel loading/error 状态管理细致
- `Promise.allSettled` 用于 initialize，不会因单个失败导致全失败
- 正确的资源清理：`stopAutoRefresh()`、`autoHeal.stop()`、`szLog.flush()`
- Visibility-aware auto-refresh：`document.visibilityState === 'visible'`

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `window as any` 类型断言 | L10-12 | `(window as any).GATEWAY_URL` — 绕过类型检查，应定义 proper type |
| `apiFetch` 泛型使用不当 | L14 | `apiFetch<T = any>` — 默认 `any`，应默认 `unknown` |
| `autoHeal` mock 可能导致真实测试覆盖缺失 | `__tests__/systemzone.test.ts:36-50` | `jest.mock('../../stratix-systemzone/ui/logger')` 替换了真实模块，但 `autoHeal.start(60_000)` 在测试中触发 |

---

## 安全

### 潜在风险

| 风险 | 位置 | 说明 |
|------|------|------|
| URL query parameter 未编码 | `agent.ts:436` | `agentId` 直接拼入 URL query string |
| API Key 通过 localStorage 存储 | `systemzone.ts:218` | `llmConfig` 包含 `apiKey: string` — localStorage 不应存敏感信息 |
| Backend 返回数据直接赋值到状态 | 多处 | `agents.value = result.data` — 没有 schema 验证，直接信任 API 响应 |
| Hardcoded gateway URL | `zone.ts:12`, `systemzone.ts:12` | `http://127.0.0.1:7524` — 生产环境可能不同 |

### llmConfig API Key 存储

```typescript
// systemzone.ts:218
const llmConfig = ref<{ provider: string; model: string; apiKey: string; baseUrl: string } | null>(null);

// systemzone.ts:532-548: updateLLMConfig 直接接受 apiKey
async function updateLLMConfig(config: { provider: string; model: string; apiKey?: string; baseUrl?: string }): Promise<boolean>
```

**建议**: API Key 应通过 HttpOnly cookie 或后台 service 中转，不应存储在 localStorage 或前端内存中明文保存。

---

## 性能

### useAgentStore

| 问题 | 说明 |
|------|------|
| `flushPositionUpdates` 循环内串行 fetch | L133-146 — 每个 agent 单独 PUT 请求，10 个 agent = 10 个 HTTP 请求，应合并为一个批量更新 |
| `refreshAgents` 返回新旧对比逻辑 | L182-206 — 在前端遍历比较，如果 agent 数量多应考虑后端返回 delta |
| Auto-refresh 没有指数退避 | L478-483 — 30s 固定间隔，持续失败时没有降级 |

### useZoneStore

| 问题 | 说明 |
|------|------|
| Zone 列表无分页 | `loadZones` 返回所有 zones，100+ zones 时有性能问题 |
| 每个文件操作单独 API 调用 | `addFile`, `removeFile`, `addTask`, `updateTask` — 没有批量操作 API |

### useSystemZoneStore

| 问题 | 说明 |
|------|------|
| Auto-refresh 固定 30s，无退避 | `startAutoRefresh` 固定 30s 间隔 |
| `initialize` 并行 5 个 API 调用 | `Promise.allSettled([fetchStatus(), fetchInsights(), fetchProposals(), fetchLLMConfig(), fetchLLMStatus()])` — 5 个请求同时发，高并发时可能压垮后端 |

### 内存管理

**正确做法**:
- Toast 限制 10 条上限
- Command logs 限制 50 条上限
- `clear()` 方法正确清理所有定时器

**潜在问题**:
- `setTimeout` for toast auto-remove: 虽然 3s 后会触发，但如果 component unmount 了，可能无法清理（`removeToast` 检查了 id，但 setTimeout 还在）
- `positionSaveTimer` 有 `stopPositionSaveTimer` 清理机制，正确

---

## 架构

### 模块边界

```
stores/
├── agent.ts       → 依赖 @stratix-character-creator, @stratix-core, @stratix-designer
├── zone.ts        → 依赖 @stratix-gateway/api/client, @stratix-project/types
├── ui.ts          → 无外部模块依赖（纯 UI 状态）
└── systemzone.ts  → 依赖 @/stratix-systemzone/ui/logger

被依赖方：
├── App.vue        → useAgentStore, useUIStore
├── stratix-rts    → useAgentStore (RTS game scene 回调)
└── components/*   → 多处使用 useUIStore
```

### 问题

| 问题 | 说明 |
|------|------|
| Circular dependency 风险 | `agent.ts` 导入 `@/stratix-designer`（WriterHeroTemplate 等），如果 designer 反向依赖 stores 会循环 |
| `createZoneApiClient` 重复创建 | `zone.ts` 每 import 一次创建新实例，应用模块不同实例导致连接池浪费 |
| SystemZoneStore 巨型单一职责 | 700 行 store 负责太多功能（insights、proposals、executions、sources、bootstrap、fitness、llm），应拆分为更小的子 store |

---

## 测试覆盖

### 覆盖情况

| Store | 单元测试 | 说明 |
|-------|----------|------|
| `useSystemZoneStore` | **完整** | 1000+ 行测试，覆盖所有 actions/getters |
| `useAgentStore` | **缺失** | 无测试文件 |
| `useUIStore` | **缺失** | 无测试文件 |
| `useZoneStore` | **缺失** | 无测试文件 |

### systemzone.test.ts 质量

**优点**:
- Mock 层次清晰（fetch、logger）
- 每个 action 都有 success/failure 两种测试
- 网络错误场景覆盖
- 状态变更断言完整

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `jest.clearAllMocks()` vs `jest.resetAllMocks()` | L175 | `clearAllMocks` 只清理调用计数，不清理 mock 返回值；`resetAllMocks` 会重置 mock 实现 |
| 重复的 mock setup | 每个 test 内 | 没有使用 `beforeEach` 共享默认 mock setup，重复代码多 |
| `mockFetch.mockResolvedValueOnce` 顺序依赖 | 多处 | 如果测试顺序改变，可能出现意外行为 |

---

## 横向联动

### 依赖关系图

```
stores/agent.ts
├── @/stratix-character-creator/types (SavedCharacter)
├── @/stratix-core (StratixAgentConfig, CharacterProfile, AgentBackendType, OpenClawConfig)
├── @/stratix-core/config/defaults (POSITION_SAVE_DELAY_MS)
└── @/stratix-designer (WriterHeroTemplate, DevHeroTemplate, AnalystHeroTemplate, generateAgentId)

stores/zone.ts
├── @/stratix-gateway/api/client (ApiClient)
├── @/stratix-gateway/api/types/api (API_PATHS, isApiError)
└── @/stratix-project/types (Zone, ZoneCreateRequest, ...)

stores/systemzone.ts
└── @/stratix-systemzone/ui/logger (szLog, withLog, autoHeal)

stores/ui.ts
└── 无外部依赖
```

### 被依赖方

| Store | 被使用位置 |
|-------|-----------|
| `useAgentStore` | `App.vue`, `stratix-rts/*`, `components/*` |
| `useUIStore` | `App.vue`, `MainLayout.vue`, 多处 component |
| `useZoneStore` | `ZonePanel.vue`, `ZoneDetail.vue`, `ZoneEditor.vue` |
| `useSystemZoneStore` | `SystemZoneConsole.vue`, `SystemZonePanel.vue` |

---

## 改进建议

### 高优先级

1. **Agent ID URL 编码** (`agent.ts:436`)
   - `agentId` 直接拼入 URL query string，需要 `encodeURIComponent(agentId)`
   - 同样问题可能存在于其他 store 的 URL 构建

2. **批量位置更新** (`agent.ts:125-147`)
   - 当前循环内每个 agent 单独 PUT 请求
   - 改为 `/api/stratix/config/agent/batch-update` 单个请求

3. **zone.files undefined 检查** (`zone.ts:141-144`)
   - 添加 `zone.files = zone.files || []` 保护

4. **AgentStore/UIStore/ZoneStore 单元测试**
   - 至少覆盖 happy path 和 error path
   - 可以参考 `systemzone.test.ts` 的测试结构

### 中优先级

5. **ApiClient 单例** (`zone.ts:9-13`)
   - `createZoneApiClient` 改为 module-level singleton 或依赖注入

6. **SystemZoneStore 拆分** (`systemzone.ts`)
   - 700 行巨型 store 难以维护
   - 建议拆分为：`useSystemzoneStatusStore`、`useSystemzoneProposalsStore`、`useSystemzoneBootstrapStore`

7. **Toast ID 生成改进** (`ui.ts:154`)
   - 改用 `crypto.randomUUID()` 或增加更多随机位

8. **API Key 存储方案** (`systemzone.ts:218, 532-548`)
   - API Key 不应存在 localStorage 或前端内存
   - 建议通过 HttpOnly cookie 或后端中转

9. **Auto-refresh 降级策略** (`agent.ts:478`, `systemzone.ts:570`)
   - 持续失败时增加间隔时间，而非固定 30s

### 低优先级

10. **jest.resetAllMocks vs clearAllMocks** (`systemzone.test.ts:175`)
    - `clearAllMocks` → `resetAllMocks` 更彻底

11. **Optional chain 清理** (`agent.ts:74-86`)
    - `agents.value?.filter` → `agents.value.filter`，ref.value 不可能为 null

12. **Test setup 提取** (`systemzone.test.ts`)
    - 重复的 `mockFetch.mockResolvedValueOnce` 可以抽取为 helper functions
