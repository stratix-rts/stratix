# RetryPolicyEngine 深度集成方案

> 目标：所有外部调用（HTTP、WebSocket、外部服务）均接入 RetryPolicyEngine，实现统一重试保护

---

## 1. 现状分析

### 1.1 已接入 RetryPolicyEngine 的调用链路

| 调用链路 | 模块 | 接入方式 |
|----------|------|----------|
| LLM API 调用（OpenAI / Anthropic / DeepSeek / Ollama） | `LLMConnector.generate()` / `generateWithTools()` | `retryPolicyEngine.executeWithRetry()` ✅ |
| LLM 流式生成 | `LLMConnector.generateStream()` | ❌ 未接入（直接调用，无重试） |

**LLMConnector 已接入**（`src/stratix-agent/core/LLMConnector.ts`）：
```typescript
// 所有 generate* 方法均通过 retryPolicyEngine.executeWithRetry 包装
const response = await retryPolicyEngine.executeWithRetry(request, undefined, {
  source: 'background',
  provider: this.config.provider,
  model: this.config.model,
});
```

### 1.2 未接入 RetryPolicyEngine 的调用链路

#### 1.2.1 OpenClawConnectionResilience — 独立 backoff 实现

**文件**: `src/stratix-core/openclaw/OpenClawConnectionResilience.ts`

```
onConnectionLost() / refreshAuth()
  └─ 自实现指数退避（与 RetryPolicyEngine 逻辑重复）
     maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000, 无 jitter
```

- 有自己的 backoff 逻辑，与 RetryPolicyEngine 完全独立
- 重试参数写死，不可配置
- **问题**：两个模块维护两套 backoff 逻辑，配置不一致

#### 1.2.2 MCPConnectionManager — 独立 backoff 实现

**文件**: `src/stratix-core/mcp/MCPConnectionManager.ts`

```
scheduleReconnect() / calculateBackoff()
  └─ 自实现指数退避（与 RetryPolicyEngine 逻辑几乎一致）
     maxRetries: 5, initialDelayMs: 1000, backoffMultiplier: 2
```

- `calculateBackoff()` 逻辑与 `RetryPolicyEngine.calculateDelay()` 相同
- 重试参数写死，不可配置
- **问题**：与 RetryPolicyEngine 重复实现

#### 1.2.3 StatusSyncWebSocketService — 独立 backoff 实现

**文件**: `src/stratix-core/services/StatusSyncWebSocketService.ts`

```
scheduleReconnect()
  └─ 硬编码 backoff（reconnectDelay: 3000 → max 30000，无 jitter）
```

- WebSocket 断开后重连逻辑独立，与 RetryPolicyEngine 完全无关
- **问题**：与 RetryPolicyEngine 重复实现

#### 1.2.4 Gateway HTTP 路由（无重试保护）

| 路由 | 方法 | 外部依赖 | 问题 |
|------|------|----------|------|
| `/api/stratix/openclaw/ws-connect` | POST | `OpenClawConnectionManager.testConnection()` | 失败直接抛错，无重试 |
| `/api/stratix/openclaw/test` | GET | `fetch(endpoint)` | 网络抖动直接失败，无重试 |
| `/api/stratix/openclaw/tailscale/nodes` | GET | `fetch('http://127.0.0.1:4243/...')` | Tailscale API 无重试 |
| `/api/stratix/agent/test-connection` | POST | `ExecutorFactory.getExecutor().testConnection()` | 连接失败无重试 |
| `/api/stratix/agent/chat` | POST | `executor.execute()` 或 `StratixAgent.chat()` | 失败无重试 |
| `/api/stratix/openclaw/connections/:id/connect` | POST | `openClawProxyManager.connect()` | 连接失败无重试 |

**关键问题**：
- `ApiClient`（`src/stratix-gateway/api/client.ts`）的 `get/post/put/patch/delete` 方法**无重试包装**
- Gateway 内部 `fetch` 调用**无统一重试拦截**

#### 1.2.2 OpenClaw 连接层（无重试保护）

| 调用路径 | 方法 | 问题 |
|----------|------|------|
| `OpenClawConnectionManager.testConnection()` | `WebSocketOpenClawAdapter.connect()` | 连接失败无重试 |
| `OpenClawConnectionManager.connect()` | `WebSocketOpenClawAdapter.connect()` | 连接失败无重试 |
| `OpenClawWebSocketConnection.connectWithPairing()` | WebSocket connect | 连接/认证失败无重试 |
| `OpenClawWebSocketConnection.sendMessage()` | WebSocket send | 发送失败无重试 |
| `OpenClawWebSocketConnection.getChatHistory()` | RPC request | 超时/失败无重试 |

#### 1.2.3 Project/Zone Service 层（低风险，内部调用为主）

| 调用路径 | 外部依赖 | 风险 |
|----------|----------|------|
| `ProjectService` 各方法 | SQLite 数据库（本地） | 低，网络无关 |
| `ZoneService` 各方法 | SQLite 数据库（本地） | 低，网络无关 |
| `AgentOrchestrationService` | `StratixAgent.chat()` | LLM 层已有重试 ✅ |

### 1.3 调用链路图（现状）

```
外部请求
    │
    ▼
Gateway HTTP Routes (express router)
    │
    ├─ /openclaw/*  → OpenClawConnectionManager / WebSocketOpenClawAdapter  ❌ 无重试
    ├─ /agent/*     → ExecutorFactory / StratixAgent  (chat/test-conn)  ❌ 无重试
    │
    ▼
LLMConnector
    └─ retryPolicyEngine.executeWithRetry()  ✅ 已接入
        │
        ▼
    OpenAI / Anthropic / DeepSeek / Ollama API
```

---

## 2. 目标状态

### 2.1 统一重试保护架构

```
外部请求
    │
    ▼
Gateway HTTP Routes
    │
    ├─ retryable routes ──→ ApiClient (with RetryPolicyEngine) ──→ 外部服务
    │                            │
    │                     retryPolicyEngine.executeWithRetry()
    │
    └─ non-retryable routes ──→ 纯内部逻辑（DB/内存）
                                    │
                                    ▼
                            直接调用（无重试）
```

### 2.2 重试分层策略

| 层级 | 来源 | 策略选择 | 配置 |
|------|------|----------|------|
| `foreground` | 用户同步请求（等待响应） | 少次重试，短延迟 | `maxRetries: 2, initialDelayMs: 500, maxDelayMs: 10000` |
| `background` | 后台任务/Agent 执行 | 正常重试 | `maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000` |
| `unattended` | 定时任务/恢复逻辑 | 多次重试，长延迟 | `maxRetries: 5, initialDelayMs: 2000, maxDelayMs: 60000` |

### 2.3 目标调用链路

```
外部请求
    │
    ▼
Gateway HTTP Routes
    │
    ▼
ApiClient (统一 HTTP 客户端 with RetryPolicyEngine)
    │
    ▼
retryPolicyEngine.executeWithRetry()
    │
    ├─ 5xx / 429 ──→ 指数退避重试
    ├─ 401 / 403 ──→ 不重试（认证失效）
    ├─ network error ──→ 重试
    └─ context overflow ──→ 减半重试
            │
            ▼
        外部服务响应
```

---

## 3. 集成方案

### 3.1 核心思路

**三层防护**：
1. **ApiClient 层**：所有 HTTP 出请求统一经由带重试的 `ApiClient`
2. **OpenClaw 连接层**：`OpenClawWebSocketConnection` 的 `connect/send` 操作包装重试
3. **Gateway 路由层**：对特定路由手动包装重试逻辑

**关键约束**：
- 幂等请求（GET/HEAD）可安全重试；非幂等（POST/PUT/DELETE）需确保请求本身幂等
- WebSocket 发送操作需配合 `idempotencyKey` 确保重试安全
- 已接入 LLMConnector 的路径不再重复包装

### 3.2 接入点矩阵

| 接入点 | 文件 | 接入方式 | 策略来源 |
|--------|------|----------|----------|
| HTTP 客户端统一包装 | `src/stratix-gateway/api/client.ts` | 封装 `fetch` 调用 | foreground |
| OpenClaw WebSocket 连接 | `src/stratix-core/openclaw/OpenClawWebSocketConnection.ts` | 包装 `connectWithPairing` / `connectWithTailscale` | unattended |
| OpenClaw 消息发送 | `src/stratix-core/openclaw/OpenClawWebSocketConnection.ts` | 包装 `sendMessage` / `sendMessageSync` | foreground |
| OpenClaw 连接管理 | `src/stratix-gateway/openclaw/OpenClawConnectionManager.ts` | 包装 `testConnection` / `connect` | unattended |
| Gateway Tailscale 发现 | `src/stratix-gateway/api/routes/openclaw.ts` | 包装 `fetch` 调用 | background |
| Gateway Agent 测试连接 | `src/stratix-gateway/api/routes/agent.ts` | 包装 `testConnection` 调用 | foreground |
| Gateway Agent Chat | `src/stratix-gateway/api/routes/agent.ts` | 包装 `executor.execute()` | background |

---

## 4. 具体修改

### 4.1 `ApiClient` 重试增强（`src/stratix-gateway/api/client.ts`）

**目标**：将 `ApiClient` 改造为默认使用 `retryPolicyEngine` 的 HTTP 客户端

```typescript
import { retryPolicyEngine } from '@/stratix-core/retry';

export class ApiClient {
  // ... 现有属性 ...

  /**
   * 执行带重试的请求
   * @param method HTTP 方法
   * @param path 请求路径
   * @param body 请求体
   * @param options 请求选项
   * @param source 重试策略来源
   */
  async requestWithRetry<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options?: ApiRequestOptions,
    source: RetryContext['source'] = 'foreground'
  ): Promise<ApiResult<T>> {
    const config = RetryPolicyEngine.createDefaultConfig(source);

    return retryPolicyEngine.executeWithRetry(
      async () => {
        return this.request<T>(method, path, body, options);
      },
      config,
      { source }
    );
  }

  /**
   * 底层请求（无重试，供重试包装内部调用）
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<ApiResult<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout);

      const response = await fetch(this.buildUrl(path), {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return this.parseResponse<T>(response);
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: 'Request timeout' };
        }
        // 将网络错误包装为可重试格式
        const networkError = new Error(`network_error: ${error.message}`);
        (networkError as any).status = undefined;
        throw networkError;
      }
      return { success: false, error: 'Unknown error' };
    }
  }

  // === 现有公开方法改为调用 requestWithRetry ===

  async get<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.requestWithRetry<T>('GET', path, undefined, options, 'foreground');
  }

  async post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.requestWithRetry<T>('POST', path, body, options, 'foreground');
  }

  async put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.requestWithRetry<T>('PUT', path, body, options, 'foreground');
  }

  async patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.requestWithRetry<T>('PATCH', path, body, options, 'foreground');
  }

  async delete<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.requestWithRetry<T>('DELETE', path, undefined, options, 'foreground');
  }
}
```

**注意**：`parseResponse` 中的 HTTP 错误（`response.ok === false`）需改为抛出异常供重试引擎捕获：

```typescript
private async parseResponse<T>(response: Response): Promise<ApiResult<T>> {
  if (!response.ok) {
    // 包装为带 status 的错误，供 shouldRetry 提取状态码
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  // ... 其余逻辑不变 ...
}
```

### 4.2 `OpenClawWebSocketConnection` 重试包装（`src/stratix-core/openclaw/OpenClawWebSocketConnection.ts`）

**目标**：连接建立和消息发送包装重试

```typescript
import { retryPolicyEngine } from '../retry/RetryPolicyEngine';
import type { RetryContext } from '../retry/types';

export class OpenClawWebSocketConnection {
  // ...

  /**
   * 连接（带重试）- 替换原有 connectWithPairing
   */
  async connectWithPairingWithRetry(
    endpoint: string,
    sharedToken: string,
    source: RetryContext['source'] = 'unattended'
  ): Promise<ConnectionResult> {
    const config = RetryPolicyEngine.createDefaultConfig(source);

    return retryPolicyEngine.executeWithRetry(
      () => this.connectWithPairing(endpoint, sharedToken),
      config,
      { source, provider: 'openclaw' }
    );
  }

  /**
   * 连接（带重试）- 替换原有 connectWithTailscale
   */
  async connectWithTailscaleWithRetry(
    endpoint: string,
    source: RetryContext['source'] = 'unattended'
  ): Promise<ConnectionResult> {
    const config = RetryPolicyEngine.createDefaultConfig(source);

    return retryPolicyEngine.executeWithRetry(
      () => this.connectWithTailscale(endpoint),
      config,
      { source, provider: 'openclaw' }
    );
  }

  /**
   * 发送消息（带重试）- 替换原有 sendMessage
   * 注意：sendMessage 本身有内部超时和幂等 key，重试安全
   */
  async sendMessageWithRetry(
    message: string,
    callbacks?: ChatCallbacks,
    options?: SendMessageOptions,
    source: RetryContext['source'] = 'foreground'
  ): Promise<string> {
    const config = RetryPolicyEngine.createDefaultConfig(source);

    return retryPolicyEngine.executeWithRetry(
      () => this.sendMessage(message, callbacks, options),
      { ...config, maxRetries: 2 }, // 消息发送次数不宜过多
      { source, provider: 'openclaw' }
    );
  }

  /**
   * 发送同步消息（带重试）
   */
  async sendMessageSyncWithRetry(
    message: string,
    options?: SendMessageOptions,
    source: RetryContext['source'] = 'foreground'
  ): Promise<ChatMessage> {
    const config = RetryPolicyEngine.createDefaultConfig(source);

    return retryPolicyEngine.executeWithRetry(
      () => this.sendMessageSync(message, options),
      { ...config, maxRetries: 2 },
      { source, provider: 'openclaw' }
    );
  }

  // 保留原有方法不变（兼容直接调用场景）
  async connectWithPairing(endpoint: string, sharedToken: string): Promise<ConnectionResult> { /* 现有逻辑 */ }
  async connectWithTailscale(endpoint: string): Promise<ConnectionResult> { /* 现有逻辑 */ }
  async sendMessage(message: string, callbacks?: ChatCallbacks, options?: SendMessageOptions): Promise<string> { /* 现有逻辑 */ }
  async sendMessageSync(message: string, options?: SendMessageOptions): Promise<ChatMessage> { /* 现有逻辑 */ }
}
```

### 4.3 `OpenClawConnectionManager` 重试包装（`src/stratix-gateway/openclaw/OpenClawConnectionManager.ts`）

```typescript
import { retryPolicyEngine } from '@/stratix-core/retry';
import type { RetryContext } from '@/stratix-core/retry/types';

export class OpenClawConnectionManager {
  // ...

  async testConnectionWithRetry(
    config: StratixOpenClawConfig,
    source: RetryContext['source'] = 'unattended'
  ): Promise<ConnectionTestResult> {
    const retryConfig = RetryPolicyEngine.createDefaultConfig(source);

    return retryPolicyEngine.executeWithRetry(
      () => this.testConnection(config),
      retryConfig,
      { source, provider: 'openclaw' }
    );
  }

  async connectWithRetry(
    config: StratixOpenClawConfig,
    source: RetryContext['source'] = 'unattended'
  ): Promise<ConnectionTestResult> {
    const retryConfig = RetryPolicyEngine.createDefaultConfig(source);

    return retryPolicyEngine.executeWithRetry(
      () => this.connect(config),
      retryConfig,
      { source, provider: 'openclaw' }
    );
  }

  // 保留原有方法
  async testConnection(config: StratixOpenClawConfig): Promise<ConnectionTestResult> { /* 现有逻辑 */ }
  async connect(config: StratixOpenClawConfig): Promise<ConnectionTestResult> { /* 现有逻辑 */ }
}
```

### 4.4 Gateway 路由层重试接入

#### 4.4.1 `openclaw.ts` 路由重试

**`/api/stratix/openclaw/test`（GET）** - 改为使用 `ApiClient`：

```typescript
// 现有代码：
const response = await fetch(endpoint, { method: 'GET', headers, signal: controller.signal });

// 修改为：
const client = new ApiClient({ baseURL: '' }); // 无 baseURL，直接用绝对路径
const result = await client.get(endpoint, { headers, timeout: 5000 });
```

**`/api/stratix/openclaw/tailscale/nodes`（GET）** - 包装重试：

```typescript
router.get('/tailscale/nodes', async (_req: Request, res: Response) => {
  try {
    const result = await retryPolicyEngine.executeWithRetry(
      async () => {
        const response = await fetch('http://127.0.0.1:4243/localapi/v0/machines', {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) return { ok: false, data: [] as any[] };
        return { ok: true, data: await response.json() as any[] };
      },
      { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 5000, backoffMultiplier: 2, retryableStatuses: [500, 502, 503] },
      { source: 'background', provider: 'tailscale' }
    );

    if (!result.ok) {
      res.json(requestHelper.success([], 'Tailscale not available'));
      return;
    }
    // ... 其余逻辑不变 ...
  } catch (error) {
    console.warn('[OpenClaw] Failed to discover Tailscale nodes:', error);
    res.json(requestHelper.success([], 'Tailscale discovery failed'));
  }
});
```

#### 4.4.2 `agent.ts` 路由重试

**`/api/stratix/agent/test-connection`（POST）**：

```typescript
router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    // ... 现有验证逻辑不变 ...

    const result = await retryPolicyEngine.executeWithRetry(
      () => executor.testConnection(mockAgentConfig as any),
      RetryPolicyEngine.createDefaultConfig('foreground'),
      { source: 'foreground', provider: testConfig.backendType }
    );

    res.json(requestHelper.success(result, result.success ? 'Connection successful' : 'Connection failed'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});
```

**`/api/stratix/agent/chat`（POST）** - StratixAgent 路径已有 LLM 重试，executor 路径需包装：

```typescript
// 在 executor.execute() 调用处包装
const result = await retryPolicyEngine.executeWithRetry(
  () => executor.execute(command, mockAgentConfig as any, { history }),
  RetryPolicyEngine.createDefaultConfig('background'),
  { source: 'background', provider: chatConfig.backendType }
);
```

### 4.6 `OpenClawConnectionResilience` — 替换自实现 backoff

**文件**: `src/stratix-core/openclaw/OpenClawConnectionResilience.ts`

将 `onConnectionLost()` 和 `refreshAuth()` 中的自实现 backoff：

```typescript
// 现状：自实现 backoff
const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.random() * 100;
await this.sleep(delay);
```

改为调用 `RetryPolicyEngine`：

```typescript
import { retryPolicyEngine } from '../../retry/RetryPolicyEngine';

// onConnectionLost()
async onConnectionLost(
  id: string,
  reconnectFn: () => Promise<boolean>
): Promise<boolean> {
  const handle = this.connections.get(id);
  if (!handle) return false;

  handle.status = 'reconnecting';
  const { maxRetries, baseDelayMs, maxDelayMs } = handle.config;

  try {
    await retryPolicyEngine.executeWithRetry(
      async () => {
        const success = await reconnectFn();
        if (!success) throw new Error('Reconnect failed');
        return true;
      },
      {
        maxRetries,
        initialDelayMs: baseDelayMs,
        maxDelayMs,
        backoffMultiplier: 2,
        retryableStatuses: [0], // network error（无 status code）
      },
      { source: 'background', operation: 'websocket', connectionId: id }
    );
    this.markConnected(id);
    this.logEvent('reconnected', id);
    return true;
  } catch (error) {
    this.markDisconnected(id);
    return false;
  }
}
```

**注意**：`RefreshAuth()` 同样处理。

### 4.7 `MCPConnectionManager` — 替换自实现 backoff

**文件**: `src/stratix-core/mcp/MCPConnectionManager.ts`

#### 4.7.1 移除 `calculateBackoff()`，改为复用 RetryPolicyEngine

```typescript
import { retryPolicyEngine } from '../../retry/RetryPolicyEngine';
import type { RetryContext } from '../../retry/types';

// 修改 scheduleReconnect — 调用 RetryPolicyEngine 的 delay 计算
private async scheduleReconnect(
  serverRef: MCPServerRef,
  handle: ConnectionHandle,
  internal: InternalConnection,
  config: ReconnectConfig
): Promise<void> {
  const attempt = handle.metrics.reconnectAttempts;

  // 复用 RetryPolicyEngine 的 delay 计算逻辑（包含 jitter）
  const delay = this.calculateDelayWithEngine(attempt, config);

  // delay === 0 表示不应重试
  if (delay === 0) {
    handle.status = 'error';
    this.trackInStateStore(handle);
    return;
  }

  internal.reconnectTimer = setTimeout(async () => {
    if (internal.isIntentionalDisconnect) return;
    try {
      await this.establishConnection(serverRef, handle, internal, config);
    } catch {
      // establishConnection 内部会再次调度
    }
  }, delay);
}

// 封装 RetryPolicyEngine 的 delay 计算（不执行重试，只算 delay）
private calculateDelayWithEngine(attempt: number, config: ReconnectConfig): number {
  const context: RetryContext = { source: 'background' };
  // 使用私有方法计算 delay（复用引擎的 backoff + jitter 逻辑）
  // 若无法直接调用，则内联相同逻辑
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  const capped = Math.min(baseDelay, config.maxDelayMs);
  const jitter = 0.8 + Math.random() * 0.4;
  return attempt > config.maxRetries ? 0 : Math.floor(capped * jitter);
}
```

#### 4.7.2 `establishConnection()` catch 块简化

```typescript
} catch (error) {
  handle.metrics.reconnectAttempts++;
  handle.metrics.totalReconnects++;
  handle.metrics.lastError = error instanceof Error ? error.message : 'Connection failed';

  // 不再直接 throw，而是通过 scheduleReconnect 处理重试
  if (!internal.isIntentionalDisconnect) {
    await this.scheduleReconnect(serverRef, handle, internal, config);
  } else {
    handle.status = 'error';
    this.trackInStateStore(handle);
  }
}
```

### 4.8 `StatusSyncWebSocketService` — 替换自实现 backoff

**文件**: `src/stratix-core/services/StatusSyncWebSocketService.ts`

```typescript
import { retryPolicyEngine } from '../retry/RetryPolicyEngine';
import { DEFAULT_RETRY_CONFIG } from '../retry/types';

class StatusSyncWebSocketService {
  private reconnectAttempt = 0;

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // 使用 RetryPolicyEngine 计算 delay（复用 exponential backoff + jitter）
    const delay = retryPolicyEngine['calculateDelay'](
      this.reconnectAttempt + 1,
      {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 10,
        initialDelayMs: 3000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
      { source: 'background' }
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }

  public connect(): void {
    // ... 连接成功后重置计数器
    this.reconnectAttempt = 0;
  }
}
```

### 4.9 新增文件

```
src/stratix-gateway/api/
└── retry/
    ├── GatewayRetryAdapter.ts   # HTTP 层重试适配器（封装 retryPolicyEngine）
    └── index.ts
```

**`GatewayRetryAdapter.ts`**：

```typescript
import { retryPolicyEngine, RetryPolicyEngine } from '@/stratix-core/retry';
import type { RetryContext } from '@/stratix-core/retry/types';

/**
 * Gateway 层重试适配器
 * 封装 retryPolicyEngine，提供更简洁的调用接口
 */
export class GatewayRetryAdapter {
  constructor(private defaultSource: RetryContext['source'] = 'foreground') {}

  /**
   * 执行带重试的 HTTP 请求
   */
  async execute<T>(
    request: () => Promise<T>,
    source?: RetryContext['source'],
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const src = source ?? this.defaultSource;
    const fullConfig = {
      ...RetryPolicyEngine.createDefaultConfig(src),
      ...config
    };

    return retryPolicyEngine.executeWithRetry(request, fullConfig, { source: src });
  }

  /**
   * 创建带重试的 fetch 请求
   */
  async fetch<T>(
    url: string,
    options?: RequestInit,
    source?: RetryContext['source']
  ): Promise<T> {
    return this.execute(
      async () => {
        const response = await fetch(url, options);
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`) as Error & { status: number };
          error.status = response.status;
          throw error;
        }
        return response.json() as Promise<T>;
      },
      source
    );
  }
}

// 导出单例
export const gatewayRetryAdapter = new GatewayRetryAdapter();
```

---

## 5. 需要修改的文件清单

| 文件 | 修改类型 | 优先级 |
|------|----------|--------|
| `src/stratix-gateway/api/client.ts` | 重构 | P0 |
| `src/stratix-core/openclaw/OpenClawWebSocketConnection.ts` | 新增 `*WithRetry` 方法 | P0 |
| `src/stratix-gateway/openclaw/OpenClawConnectionManager.ts` | 新增 `*WithRetry` 方法 | P0 |
| `src/stratix-gateway/api/routes/openclaw.ts` | 路由方法重试包装 | P1 |
| `src/stratix-gateway/api/routes/agent.ts` | 路由方法重试包装 | P1 |
| `src/stratix-gateway/api/retry/GatewayRetryAdapter.ts` | 新增 | P1 |
| `src/stratix-agent/core/LLMConnector.ts` | `generateStream` 接入重试 | P2 |
| `src/stratix-gateway/api/retry/index.ts` | 新增 barrel export | P1 |

---

## 6. 风险与注意事项

### 6.1 幂等性风险

| 操作类型 | 幂等 | 重试安全 | 注意事项 |
|----------|------|----------|----------|
| GET | ✅ | ✅ | 可自由重试 |
| POST `/chat` | ⚠️ | ⚠️ | `executor.execute` 需确保幂等（已有 `idempotencyKey`） |
| POST `/test-connection` | ⚠️ | ⚠️ | 连接测试可重试，但可能有副作用（创建临时连接） |
| PUT/PATCH | ⚠️ | ⚠️ | 部分更新需确保服务端幂等处理 |
| DELETE | ⚠️ | ⚠️ | 删除操作需确保重复调用不报错 |
| WebSocket `sendMessage` | ✅ | ✅ | 已有 `idempotencyKey`（`runId`） |

### 6.2 重试风暴风险

**缓解**：RetryPolicyEngine 内部已有指数退避 + jitter + 源特定 multiplier，不会产生集中重试风暴。

**额外注意**：`maxRetries` 不要设置过高，建议：
- `foreground`: 2-3 次
- `background`: 3-5 次
- `unattended`: 5 次

### 6.3 错误状态码处理

| 状态码 | 处理策略 |
|--------|----------|
| 401 / 403 | **不重试** - 认证失效，应退出重试流程 |
| 404 | **不重试** - 资源不存在，重试也无用 |
| 429 | **重试** - 已有专门处理（更长退避） |
| 500 / 502 / 503 / 529 | **重试** - 服务端问题，可能临时恢复 |
| network timeout | **重试** - 网络抖动，可能成功 |

### 6.4 Context Overflow 处理

RetryPolicyEngine 对包含 "context overflow" 的错误有专门处理：**自动减半重试次数**（前一半重试，后一半放弃）。这与 LLM 调用配合良好，但需注意：
- 在 Gateway 路由层直接包装 `StratixAgent.chat()` 时，context overflow 错误会被正确处理
- 但若是业务层自己解析错误并重试，需注意不要与引擎的退避策略冲突

### 6.5 WebSocket 连接状态

连接层的重试需注意：
- WebSocket 连接状态（`connected`/`connecting`/`disconnected`）需在重试前检查
- 若已处于 `connected` 状态，不应重复连接
- `OpenClawConnectionManager` 已有 `isConnected()` 检查，重试逻辑应尊重该状态

---

## 7. 验收标准

### 7.1 功能验收

- [ ] `ApiClient` 所有方法（get/post/put/patch/delete）默认带重试
- [ ] `OpenClawWebSocketConnection.connectWithPairing()` 失败时自动重试（最多 5 次 unattended）
- [ ] `OpenClawWebSocketConnection.sendMessage()` 失败时自动重试（最多 2 次 foreground）
- [ ] `OpenClawConnectionManager.testConnection()` / `connect()` 失败时自动重试
- [ ] Gateway `/openclaw/tailscale/nodes` API 失败时自动重试
- [ ] Gateway `/agent/test-connection` API 失败时自动重试
- [ ] LLM `generateStream()` 失败时自动重试

### 7.2 行为验收

- [ ] 401/403 错误立即失败，不重试
- [ ] 429 错误使用更长退避重试
- [ ] 5xx 错误指数退避重试
- [ ] 网络超时自动重试
- [ ] context overflow 错误自动减半重试

### 7.3 性能验收

- [ ] 重试未显著增加 API 延迟（指数退避在后台等待）
- [ ] foreground 请求最多等待 ~10s（2 次重试 + 退避）
- [ ] unattended 请求最多等待 ~60s（5 次重试 + 退避）

### 7.4 测试验收

- [ ] 单元测试：验证 `ApiClient` 重试行为（mock fetch 模拟失败）
- [ ] 单元测试：验证 `OpenClawWebSocketConnection` 重试连接
- [ ] E2E 测试：模拟 OpenClaw 连接失败，验证重试后恢复
- [ ] E2E 测试：模拟 LLM API 429，验证退避重试

---

## 8. 实施步骤

### Phase 1：核心基础设施（P0）
1. 新建 `src/stratix-gateway/api/retry/GatewayRetryAdapter.ts`
2. 重构 `src/stratix-gateway/api/client.ts` - 所有方法默认包装重试
3. 在 `client.ts` 的 `parseResponse` 中将 HTTP 错误转为可重试异常

### Phase 2：OpenClaw 连接层（P0）
4. 在 `OpenClawWebSocketConnection.ts` 新增 `connectWithPairingWithRetry` / `sendMessageWithRetry` 方法
5. 在 `OpenClawConnectionManager.ts` 新增 `testConnectionWithRetry` / `connectWithRetry` 方法
6. 将 `OpenClawConnectionManager` 内部调用切换到 `*WithRetry` 版本

### Phase 3：Gateway 路由层（P1）
7. 重构 `openclaw.ts` 路由 - `/test` 和 `/tailscale/nodes` 接入重试
8. 重构 `agent.ts` 路由 - `/test-connection` 和 `/chat` 接入重试

### Phase 4：收尾（P2）
9. `LLMConnector.generateStream()` 接入重试
10. 新增 `src/stratix-gateway/api/retry/index.ts` barrel export
11. 运行现有测试，确保无回归
12. 编写新增的单元测试
