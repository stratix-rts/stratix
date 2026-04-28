# stratix-project 模块评审报告

## 概览

**模块路径**: `src/stratix-project/`
**文件数量**: 25+ 个文件（core/UI/storage/utils/types）
**核心职责**: 项目管理域的核心模块，管辖 Project/Zone 的创建、状态管理、RTS 可视化和持久化。

### 关键架构层次

| 层次 | 文件 | 职责 |
|------|------|------|
| **API Client** | `ProjectClient.ts` | HTTP API 封装（基于 `ApiClient`） |
| **业务层** | `core/ProjectManager.ts` | 项目生命周期、事件总线（mitt）、LRA 集成 |
| **持久化** | `storage/ProjectStore.ts` | LowDB JSON 文件存储 |
| **RTS 可视化** | `core/ProjectZone.ts` | Phaser BaseZone 子类 |
| **场景集成** | `ProjectManagerIntegration.ts` | Phaser 场景与后端的桥接 |
| **HTTP 集成** | `ProjectManagerIntegrationHTTP.ts` | HTTP 版集成（另一个实现？） |
| **Vue UI** | `ui/*.vue` | ZonePanel、ZoneDetail、ZoneFilePicker 等 |

---

## 代码质量

### `helpers.ts` — debounce 内存泄漏

- `src/stratix-project/utils/helpers.ts:75-90`
- 每次调用 debounced 函数都会创建新 timeout，但旧 timeout 被 `clearTimeout` 后 `timeoutId` 变量未清理，仍持有引用。实际影响极小（一个 timeout 对象），但应显式置 null。

### `deepClone` 使用 `JSON.parse(JSON.stringify())`

- `src/stratix-project/utils/helpers.ts:19-21`
- 无法克隆 `Date` 对象（会变成 string）、`undefined`、函数、`Symbol` 等。对于 `Project` 类型中大量 `Date` 字段，这会导致类型悄悄丢失。

### `ProjectZone.updateZoneTitle` 直接修改传入的 project 引用

- `src/stratix-project/core/ProjectZone.ts:224-233`
- 修改 `this.project.zoneContext.title`，若 `project` 对象被其他地方引用，会产生意外的共享状态。若 project 来自 store 的 reactive 状态，可能触发 Vue 响应性问题。

### `ProjectManager.createProject` 的 LRA 初始化失败无重试

- `src/stratix-project/core/ProjectManager.ts:56-57`
- `initializeLRA` 失败只打印 error，不回滚 project 创建，不重试，不通知调用方。

### `generateId` 的 ID 碰撞风险

- `src/stratix-project/utils/helpers.ts:1-5`
- 同一毫秒内快速调用两次 `generateId` 会产生碰撞（`Date.now()` 相同，`Math.random()` 可能相同）。高频场景（粘贴、快速双击创建）有理论风险。

### 重复的 Project/ZONE API 客户端

- `ProjectClient.ts` 使用 `ApiClient` 封装
- `ProjectManagerIntegrationHTTP.ts` 也使用 `axios` 直接调用
- 同一模块两种 HTTP 调用方式，增加维护成本

### 巨型 `ProjectManagerIntegrationHTTP.createProjectWithBounds`

- `src/stratix-project/ProjectManagerIntegrationHTTP.ts:211-265`
- 约 55 行，杂糅了：配置构建 → API 调用 → Zone 创建 → FK 关联 → 事件发布。建议拆为多个私有方法。

---

## 安全

### `ProjectClient` 硬编码 localhost URL

- `src/stratix-project/ProjectClient.ts:33`
  ```typescript
  baseURL: config?.baseURL || 'http://localhost:7524'
  ```
  生产环境需要不同 URL，但无环境变量机制。

### `ZonePanel.vue` 大量直接 `fetch` 无 CSRF/超时

- `src/stratix-project/ui/ZonePanel.vue` 多处直接调用 `fetch`:
  - L50-59: `handleUpdateZone` — 无超时，无 CSRF token
  - L82-86: `handleDeleteZone` — 无超时
  - L125-136: `handleScanFolder` — 无超时
  - L161-167: `handleAddFiles` — 循环内串行 fetch，无并发控制

### Git Credentials 存储

- `types.ts:13-24` 定义了 `GitConfig.credentials`，包含 `username`/`token`
- `ProjectStore` 将完整 project（含 credentials）存入 JSON 文件，无加密

### Zone 创建失败被静默忽略

- `ProjectManagerIntegrationHTTP.ts:254-256`:
  ```typescript
  } catch (zoneError) {
    console.error('[ProjectManager] Failed to create zone context:', zoneError);
    // Don't fail the whole operation if zone creation fails
  }
  ```
  项目创建成功但 Zone context 未创建，FK 未关联，后续 Zone 相关功能会异常。应有重试机制或明确的降级处理。

---

## 性能

### LowDB 每次操作全量读写

- `ProjectStore.ts` 每次 CRUD 都调用 `await this.db.read()` + `await this.db.write()` 读写整个 JSON 文件。100+ 项目时每次操作都序列化/反序列化全部数据，无分页、无索引。

### `createProjectZone` 顺序加载

- `ProjectManagerIntegrationHTTP.ts:138-140`:
  ```typescript
  for (const project of projects) {
    await this.createProjectZone(project);
  }
  ```
  每个 project 创建都触发 `fetchZoneContext`（独立 HTTP 请求）串行执行，n 个 project = n 个 HTTP 往返，应改为 `Promise.all`。

### `handleAddFiles` 循环内串行 fetch

- `ZonePanel.vue:160-174`:
  ```typescript
  for (const file of files) {
    const response = await fetch(...); // 串行！
  }
  ```
  10 个文件 = 10 个串行 HTTP 请求，应改为 `Promise.all`。

### `visibleZones` Set 无限增长

- `ProjectManagerIntegrationHTTP.ts:27`:
  ```typescript
  private visibleZones: Set<string> = new Set();
  ```
  区域删除时从 Set 中移除，但逻辑上看 `updateVisibleZones`（L295-314）只在区域新进入/离开视口时添加/删除，如果大量区域反复进出视口不会有泄漏，但若区域被删除而 `updateVisibleZones` 未触发，Set 可能残留。

### `ProjectZone` 文本对象无销毁保护

- `src/stratix-project/core/ProjectZone.ts:260-274` 的 `destroy()` 正确销毁了 `statusText`/`priorityText`/`agentCountText`，但若父类 `BaseZone` 的 `destroy()` 先执行，子类这些引用可能已被清空。

---

## 架构

### 重复的集成层

- `ProjectManagerIntegration.ts` 和 `ProjectManagerIntegrationHTTP.ts` 两个文件功能高度重叠。前者用于 Phaser 场景，后者也用于 Phaser 场景但使用 axios 而非 ApiClient。**应合并或明确区分用途**。

### LowDB 的并发写入风险

- `ProjectStore` 无文件锁。多个进程/实例同时写 `projects.json` 会导致数据损坏。生产环境应使用 SQLite 或其他支持并发的数据库。

### 依赖方向

```
ProjectClient → ApiClient (stratix-gateway)
ProjectManager → ProjectStore, LRAClient (stratix-lra-bridge), mitt
ProjectZone → BaseZone (stratix-rts)
ProjectManagerIntegration → ProjectClient, ProjectZone, UnifiedZoneManager (stratix-rts)
ProjectManagerIntegrationHTTP → axios, ProjectClient, ProjectZone, UnifiedZoneManager
```

---

## 测试

- **完全没有测试文件**。`src/stratix-project/` 下无任何 `.spec.ts`。
- `examples/` 目录下有 `TaskExecutionExample.ts.bak` 和 `IntegrationTest.ts.bak` — 表明曾有测试但被放弃。
- LowDB 持久化层和 Phaser 渲染层都难以单元测试，但没有 E2E 测试覆盖关键流程。

---

## 改进建议（按优先级）

### P0 — 必须修复

1. **Zone 创建失败静默忽略**
   - `ProjectManagerIntegrationHTTP.ts:254-256`
   - 改为重试机制（3 次指数退避），或若最终失败则回滚整个 project 创建

2. **LowDB 并发写入保护**
   - `ProjectStore.ts` — 多个实例同时写会导致数据损坏
   - 建议迁移到 SQLite（`better-sqlite3`）或添加文件锁

### P1 — 强烈建议

3. **并行化 `loadExistingProjects`**
   - `ProjectManagerIntegrationHTTP.ts:138-140`
   - 改为 `await Promise.all(projects.map(p => createProjectZone(p)))`

4. **并行化 `handleAddFiles`**
   - `ZonePanel.vue:160-174`
   - 改为 `Promise.all(files.map(f => fetch(...)))`

5. **统一 HTTP 客户端**
   - `ProjectManagerIntegrationHTTP.ts` 使用 `axios`，`ProjectClient.ts` 使用 `ApiClient`
   - 建议统一使用 `ApiClient` 并添加请求拦截器

6. **修复 `deepClone`**
   - 使用 `structuredClone()` 或自定义递归克隆器，保留 `Date` 类型

### P2 — 建议改进

7. **添加 `generateId` 的单调时间戳版本**
   - 对于高频场景，使用递增 counter 替代 `Date.now() + random`

8. **`visibleZones` Set 增加清理边界**
   - 在 `removeProjectZone` 时确保 Set 也清理

9. **拆分 `createProjectWithBounds`**
   - 提取 `_createZoneContext` / `_linkZoneContextFK` 等私有方法

10. **迁移 Hardcoded URL 到环境变量**
    - `ProjectClient.ts:33` — 支持 `GATEWAY_URL` 环境变量
