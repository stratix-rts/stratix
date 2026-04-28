# stratix-lra-bridge 模块审查报告

## 概览

**模块目的**: LRA (Long-running Agent) 任务系统的桥接模块，提供前端轮询 watcher 和 HTTP 客户端

**文件统计**: 4 个文件
- `index.ts` - 桶形导出
- `LRAWatcher.ts` - 任务列表轮询监听器
- `LRAClient.ts` - LRA API HTTP 客户端
- `types.ts` - TypeScript 接口定义

**关键导出**: `LRAClient`, `LRAWatcher`, `LraTask`, `LraTaskList`, `LraTaskDetail`, `LraClaimResult`

---

## 代码质量

### 优点

- **模块职责单一**: 清晰分离 Watcher（轮询）和 Client（HTTP）
- **TypeScript 类型完整**: 所有接口都有类型定义
- **错误处理**: LRAClient 的每个方法都有 try-catch
- **并发控制**: `LRAWatcher.pollTasks()` 有 `isPolling` 标志防止并发请求

### 问题

| 位置 | 问题 | 严重性 |
|------|------|--------|
| `LRAClient.ts:26` | 错误处理直接 throw，但 axios 错误对象结构不统一 | 低 |
| `LRAClient.ts:65-67` | `listTasks` 失败时返回空数组而非抛出异常，调用方可能不知情 | 中 |
| `LRAWatcher.ts:51-53` | `setInterval` 返回 `NodeJS.Timeout`，但在 Node 环境和浏览器环境类型不同 | 低 |

### 函数长度

- `LRAClient.createTask()`: 15 行 - 合理
- `LRAWatcher.pollTasks()`: 22 行 - 合理
- 所有方法长度均合理

### 死代码

- 无明显死代码

---

## 安全

### 注入风险

| 位置 | 风险 | 评估 |
|------|------|------|
| `LRAClient.ts:58-60` | `projectPath` 作为 query 参数，可能需要 URL 编码 | 低 |
| `LRAClient.ts:39-43` | `description` 和 `template` 作为 POST body，无注入风险 | 低 |

### 敏感数据

- 无敏感数据处理

### 错误处理安全性

**位置**: `LRAClient.ts:25-27`
```typescript
} catch (error) {
  throw new Error(`Failed to initialize LRA: ${error}`);
}
```
- 错误信息直接拼接，可能泄露内部路径/细节
- 建议使用 `error instanceof Error ? error.message : String(error)`

---

## 性能

### 优点

- **轮询并发控制**: `isPolling` 标志防止重复请求
- **轻量级**: 模块小，无额外依赖（仅 axios）

### 问题

| 位置 | 问题 | 影响 |
|------|------|------|
| `LRAWatcher.ts` 无最大重试次数 | 网络错误时无限重试 | 低 |
| `LRAWatcher.ts` 无指数退避 | 频繁轮询可能给服务器压力 | 低 |

### N+1 查询

- 不适用（无 DB）

---

## 架构

### 模块边界

```
index.ts (桶形导出)
├── LRAClient (HTTP API 客户端)
│   └── axios
└── LRAWatcher (任务列表轮询)
    └── LRAClient
```

### 依赖方向

```
LRAWatcher → LRAClient → axios
                ↓
         Stratix Gateway (/api/lra)
```

**依赖方向正确**: 顶层组件依赖底层服务

### 耦合

- **低耦合**: LRAWatcher 依赖 LRAClient 接口，可 mock 测试
- **HTTP 耦合**: 直接依赖 `/api/lra` 路径，如 API 变更需改代码

---

## 测试

### 覆盖率

- **无测试**: 模块无测试文件

### 建议

- 为 `LRAClient` 添加单元测试：mock axios，验证各 API 方法调用正确
- 为 `LRAWatcher` 添加集成测试：mock LRAClient，验证轮询逻辑

---

## 横向联动

### 依赖的模块

| 模块 | 用途 |
|------|------|
| `axios` | HTTP 客户端 |

### 依赖本模块的模块

- `stratix-project` - 可能在任务管理 UI 中使用
- `stratix-agent` - Agent 可能使用 LRAClient 进行任务认领

---

## 改进建议

### P1 - 应修复

1. **listTasks 失败时返回空数组** (`LRAClient.ts:65-67`)
   ```typescript
   // 当前：失败时静默返回 []
   } catch (error) {
     console.error('[LRAClient] Failed to list tasks:', error);
     return [];
   }
   ```
   建议：区分"无任务"和"查询失败"，或添加 `success` 标志

2. **错误消息可能泄露内部信息** (`LRAClient.ts:26`, `49`, etc.)
   ```typescript
   throw new Error(`Failed to initialize LRA: ${error}`);
   ```
   建议：`throw new Error(`Failed to initialize LRA: ${error instanceof Error ? error.message : String(error)}`)`

### P2 - 可改进

3. **LRAWatcher 添加重试退避**
   - 建议：网络错误时使用指数退避而非固定间隔

4. **LRAWatcher 添加最大连续错误次数**
   - 连续错误 N 次后停止轮询，避免无效请求

5. **添加取消 token**
   - 使用 axios 的 `CancelToken` 支持请求取消

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | B+ | 职责清晰，类型完整 |
| 安全 | B | 基本安全，小问题 |
| 性能 | B | 轻量级，无明显性能问题 |
| 架构 | A | 模块边界清晰，依赖方向正确 |
| 测试 | D | 完全无测试 |
| 可维护性 | A- | 代码简洁，易于理解和维护 |

**总体评估**: 轻量级模块，代码质量良好，架构清晰。主要改进点是错误处理的统一性和测试覆盖。
