# stratix-core 模块评审报告

## 概览

**模块路径**: `src/stratix-core/`
**文件数量**: 60+ 个文件
**核心职责**: Stratix 的核心协议层，定义数据类型、事件总线、服务定位器、Agent 路由、重试策略、OpenClaw 连接管理、Texture 管理等基础设施。

### 关键子模块

| 子模块 | 文件 | 职责 |
|--------|------|------|
| **EventBus** | `StratixEventBus.ts` | 基于 mitt 的全局事件发布/订阅 |
| **ServiceLocator** | `services/ServiceLocator.ts` | 环境检测和服务提供者路由 |
| **AgentRouter** | `agent/AgentRouter.ts` | Agent 任务分发和隔离策略 |
| **RetryPolicyEngine** | `retry/RetryPolicyEngine.ts` | 指数退避重试引擎 |
| **UnifiedOpenClawConnectionManager** | `UnifiedOpenClawConnectionManager.ts` | OpenClaw 连接管理 |
| **TextureManager** | `services/TextureManager.ts` | 纹理生成/上传/LRU 缓存 |
| **StatusSyncWebSocketService** | `services/StatusSyncWebSocketService.ts` | Zone 事件 WebSocket 转发 |
| **Error types** | `errors.ts` | 错误类层次 |

---

## 代码质量

### 单例滥用严重

**stratix-core 是单例模式重灾区**：

| 类/实例 | 文件 | 单例模式 |
|---------|------|----------|
| `StratixEventBus` | `StratixEventBus.ts` | `static instance` |
| `ServiceLocator` | `services/ServiceLocator.ts` | `static instance` |
| `StatusSyncWebSocketService` | `services/StatusSyncWebSocketService.ts` | `static instance` |
| `UnifiedOpenClawConnectionManager` | `UnifiedOpenClawConnectionManager.ts` | `static instance` |
| `agentRouter` | `agent/AgentRouter.ts` | 模块级单例 |
| `textureManager` | `services/TextureManager.ts` | 模块级单例 |
| `retryPolicyEngine` | `retry/RetryPolicyEngine.ts` | 模块级单例 |

**问题**：
- 所有单例在测试中无法替换，导致模块可测试性极低
- `ServiceLocator.ts:78` 在**模块导入时**即执行 `new ServiceLocator().getProvider()`，SSR 环境下 `window` 不存在会报错

### `any` 类型滥用

- `UnifiedOpenClawConnectionManager.ts:64`: `private electronAPI: any = null;`
- `AgentRouter.ts:33`: `private executor: (task: AgentTask, agentId: string | undefined, signal: AbortSignal) => Promise<unknown> = async () => { throw new Error(...) }`
- 多处 `options?: any`、`config: any` 等

### `StratixEventBus` 事件缓冲无限增长风险

- `src/stratix-core/StratixEventBus.ts:107-112`
- `bufferEvent()` 无上限地往 Map 中 push 事件。若某事件类型一直无人订阅（如 `zone:updated` 在某功能未启用时），内存会持续增长。建议加 `MAX_BUFFER_SIZE = 100` 限制。

### `StatusSyncWebSocketService` 重连定时器泄漏

- `src/stratix-core/services/StatusSyncWebSocketService.ts:106-120`
- `scheduleReconnect()` 中 `clearTimeout(this.reconnectTimeout)` 后立即设置新 timeout，但若 `connect()` 同步失败后调用 `scheduleReconnect()`，timeout 已被清空，仍会调度一个新的。这本身没问题，但 `maxReconnectDelay` 达到 30s 后不再增长，可能导致频繁重连风暴。

### `TextureManager` LRU 打分可能溢出

- `src/stratix-core/services/TextureManager.ts:207`
  ```typescript
  const score = value.accessCount * 1000 + (Date.now() - value.lastAccess);
  ```
  `accessCount` 是 `number`，若某缓存项被访问 9,223,372,036 次（`Number.MAX_SAFE_INTEGER / 1000`），`* 1000` 会溢出成 `NaN`。实际几乎不可能，但应改用 `BigInt` 或直接用 `accessCount` 和时间各自独立比较。

### `AgentRouter.remote` 隔离策略未实现但未报错

- `src/stratix-core/agent/AgentRouter.ts:134-138`:
  ```typescript
  if (isolation === "remote") {
    console.warn(`[AgentRouter] isolation="remote" is not implemented...`);
  }
  ```
  直接 fallback 到 direct execution，没有任何标识或 error，调用方无法知道隔离未生效。

---

## 安全

### `pairConnectProxy` 中使用 `confirm()` 阻塞 UI

- `src/stratix-core/UnifiedOpenClawConnectionManager.ts:231-233`
- 在浏览器主线程调用 `confirm()` 弹出浏览器原生对话框，这是同步阻塞调用，非常 bad practice。在 Electron 环境下可能导致 UI 卡死。**应替换为异步的 UI 对话框**。

### WebSocket URL 构建无验证

- `StatusSyncWebSocketService.ts:31-33`:
  ```typescript
  const wsUrl = `${wsProtocol}//${wsHost}/ws`;
  ```
  `window.location.host` 未做空值检查，若在 SSR 或 `window` 不存在的环境中运行会报错。

### ServiceLocator 环境检测脆弱

- `src/stratix-core/services/ServiceLocator.ts:54-67`
- 通过 `window.electronAPI` 和 userAgent 检测 Electron，不可靠（userAgent 可伪造，且新版 Electron 可能不包含 'electron' 字符串）。建议统一通过 `window.electronAPI` 检测。

### API Key 通过 URL 传递

- `UnifiedOpenClawConnectionManager` 多个方法直接 `fetch('/api/...')`，无认证 token 附加。若后端需要认证，应通过 cookie 或 Authorization header。

---

## 性能

### ServiceLocator 模块级初始化

- `src/stratix-core/services/ServiceLocator.ts:78`:
  ```typescript
  const services = ServiceLocator.getInstance().getProvider();
  ```
  在模块加载时立即执行。若 `WebServiceProvider` 或 `ElectronServiceProvider` 初始化有 I/O（如读文件、建立连接），会阻塞应用的初始加载。

### TextureManager LRU 上限过低

- `TextureManager.ts:29`: `MAX_CACHE_SIZE = 20`
- 20 个 Canvas 可能不足以覆盖实际使用场景（多角色切换），导致频繁重新生成纹理。

### StatusSyncWebSocketService 重连退避上限过高

- `maxReconnectDelay = 30000`（30 秒），达到后不再增加。若服务器持续不可达，会每 30 秒重连一次，可能加重服务器负担。生产环境建议上限 5 分钟。

### AgentRouter 无任务数量上限

- `AgentRouter.ts:31`: `private taskRegistry: Map<string, TaskContext> = new Map();`
- `dispatch()` 不断向 Map 添加任务，但无上限检查。若高频 dispatch 但任务快速完成，Map 会持续增长（虽然 task 完成时会从 registry 中移除，但若任务被 abort 但 `result` promise 未 resolve，Map entry 会残留）。

---

## 架构

### 单例模式导致严重耦合

- `StatusSyncWebSocketService` 内部直接调用 `StratixEventBus.getInstance()` — 两个单例相互依赖，单测无法替换 mock。
- `TextureManager` 在模块级实例化 `services` — 依赖 `ServiceLocator` 单例。

### 依赖方向问题

```
ServiceLocator ──> ElectronServiceProvider / WebServiceProvider
TextureManager ──> ServiceLocator (services)
StatusSyncWebSocketService ──> StratixEventBus
AgentRouter ──> (无外部依赖，但 executor 初始化后才能使用)
UnifiedOpenClawConnectionManager ──> (无外部依赖)
```

### 职责不清晰

- `ServiceLocator` 同时负责"创建 provider"和"检测环境"，违反单一职责。
- `UnifiedOpenClawConnectionManager` 包含连接管理 + WebSocket 消息处理 + 状态机 + Tailscale 发现，过于庞大（约 900 行）。

---

## 测试

### 覆盖情况

| 类/模块 | 测试文件 | 覆盖范围 |
|---------|----------|----------|
| `UnifiedOpenClawConnectionManager` | `__tests__/UnifiedOpenClawConnectionManager.test.ts` | 有 |
| `PermissionOrchestrator` | `permission/__tests__/PermissionOrchestrator.test.ts` | 有 |
| `StratixEventBus` | 无 | 0% |
| `ServiceLocator` | 无 | 0% |
| `StatusSyncWebSocketService` | 无 | 0% |
| `AgentRouter` | 无 | 0% |
| `TextureManager` | 无 | 0% |
| `RetryPolicyEngine` | 无 | 0% |

### 关键模块完全无测试

- `StratixEventBus` 是全局通信核心，完全没有测试，其 buffer replay 逻辑的正确性无法验证。
- `RetryPolicyEngine` 有复杂的指数退避、jitter、source-aware 逻辑，无测试。

---

## 改进建议（按优先级）

### P0 — 必须修复

1. **移除 `ServiceLocator` 模块级初始化**
   - `ServiceLocator.ts:78`
   - 改为 `getServices()` 函数惰性获取，而非模块级执行

2. **修复 `StratixEventBus` 事件缓冲无限增长**
   - `StratixEventBus.ts:107-112`
   - 加缓冲上限，超过时丢弃最旧事件或拒绝缓冲

3. **替换 `confirm()` 为异步对话框**
   - `UnifiedOpenClawConnectionManager.ts:231`
   - 在 Electron/浏览器环境使用自定义 modal 组件

### P1 — 强烈建议

4. **为 `StratixEventBus` 添加订阅计数/取消机制**
   - `StratixEventBus.unsubscribe` 当前不检查是否还有其他订阅者，直接 `off`
   - 导致最后一个订阅者取消后事件可能被错误地 buffer（取决于 `subscribedEvents` 状态）

5. **为 `AgentRouter` 添加任务上限**
   - 防止高频 dispatch 导致 registry 膨胀
   - 建议 `MAX_CONCURRENT_TASKS = 100`

6. **增加 `TextureManager` 缓存上限**
   - `MAX_CACHE_SIZE = 20` → 50 或可配置

7. **统一单例访问方式**
   - 所有单例改用 `static getInstance()` 代替模块级导出，便于测试替换

### P2 — 建议改进

8. **为 `remote` 隔离策略实现真正的进程隔离**
   - 当前只是 warning + fallback
   - 应返回 error 或实现真正的 `child_process.spawn`

9. **修复 `electronAPI: any` 类型**
   - 定义 `ElectronAPI` 接口，明确可调用方法

10. **添加 `RetryPolicyEngine` 单元测试**
    - 覆盖：指数退避计算、jitter 范围、各状态码处理、context overflow 场景
