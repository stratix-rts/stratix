# stratix-data-store Review

## 概览

| 文件 | 职责 |
|------|------|
| `index.ts` | 入口，导出 `createDataStore()`, `initializeDataStore()` |
| `StratixDataStore.ts` | 核心存储类，封装 SQLite 操作 |
| `LogStore.ts` | 日志存储门面类 |
| `TemplateLibrary.ts` | 预设模板管理（3 个固定模板） |
| `EnhancedTemplateLibrary.ts` | 增强模板库，支持领域分类、标签搜索、Mixin 组合 |
| `OpenClawConnectionStore.ts` | OpenClaw 连接配置管理 |
| `BackupManager.ts` | 备份管理 |
| `types.ts` | 类型定义 |

**测试**: 无测试文件。

---

## 代码质量

### StratixDataStore

**优点**:
- 清晰的 SQLite wrapper 封装
- `ensureInitialized()` 惰性初始化模式

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `saveLog` JSON.stringify params | L77 | `JSON.stringify(log.params)` — 如果 params 包含 circular reference 会失败 |
| `getLogs` `params` JSON.parse 无 try-catch | L117 | `JSON.parse(row.params || '{}')` — 如果 params 是 invalid JSON 会 throw |
| `params: any[]` | L92 | SQL params 用 `any[]`，没有类型校验 |
| `updateLog` SQL 动态构建 | L170-172 | `fields.join(', ')` 直接拼接，如果 `fields` 为空数组则生成无效 SQL |
| `getLog` 调用 `getLogs()` 然后 filter | L177-178 | 应该直接查数据库，不需要先查所有 logs |
| `exportData` 返回 `any` | L126 | `exportData(): Promise<any>` — 应返回具体类型 |
| `setPresetTemplates` 是空实现 | L225-227 | `console.log('[StratixDataStore] setPresetTemplates not implemented in SQLite')` — 完全没有实现 |

```typescript
// L170-172: 如果 fields 为空，生成无效 SQL
if (fields.length > 0) {
  values.push(logId);
  await db.prepare(`UPDATE command_logs SET ${fields.join(', ')} WHERE log_id = ?`).run(...values);
}
// 如果 fields 为空，if 块不执行，WHERE 子句缺失 logId

// L117: JSON.parse 没有错误处理
params: JSON.parse(row.params || '{}'),
// 如果 row.params 是损坏的 JSON，会 throw，导致整个 getLogs() 失败
```

### LogStore

**优点**:
- 简单的门面模式
- `generateId()` 生成唯一 ID

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `generateId` ID 碰撞风险 | L11-13 | `stratix-log-${Date.now()}-${Math.random()...}` — Date.now() 毫秒级，快速连续调用可能碰撞 |
| `updateStatus` 总是返回 `true` | L58 | `return true` — 即使 `updateLog` 失败也返回 true |

### TemplateLibrary

**优点**:
- 预设模板定义完整
- `createFromTemplate` 工厂方法正确复制模板

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `PRESET_TEMPLATES` 是硬编码的 | L5-113 | 3 个固定模板，没有从外部加载 |
| `getPresetTemplates` 每次 map 复制 | L127 | `PRESET_TEMPLATES.map(t => ({ ...t }))` — 每次调用都创建新数组，可以缓存 |
| `initialize` 调用空实现 | L123 | `this.dataStore.setPresetTemplates(PRESET_TEMPLATES)` — 但 `setPresetTemplates` 是空实现 |

### EnhancedTemplateLibrary

**优点**:
- 多种索引机制（Map-based: categoryIndex, tagIndex, mixinIndex）
- `query()` 方法支持多条件过滤和分页
- `getRecommendations` 基于上下文推荐
- `findSimilar` 相似模板搜索
- `toAgentConfig` / `fromAgentConfig` 双向转换

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `importFromDirectory` 错误处理不区分类型 | L88-128 | 所有错误统一 push 到 `errors` 数组，区分 "导入失败" 和 "跳过" |
| `query` 中 `query.tags` 比较不区分大小写 | L216 | `t.tags.map(tg => tg.toLowerCase()).includes(tag.toLowerCase())` — 但 `query.tags` 没被 toLowerCase |
| `query` 的 filter 链式调用 | L202-244 | 多个 filter 依次调用，每个都创建新数组，效率 O(n * k)，可以合并 |
| `domainToAgentType` / `agentTypeToDomain` mapping 不完整 | L560-589 | 只覆盖部分 domain → type 映射，未知 domain 返回 'custom' |
| ID 生成用 `Date.now()` | L404 | `agent-${Date.now()}-${Math.random()...}` — 与其他地方同样的碰撞风险 |

### OpenClawConnectionStore

**优点**:
- `initialize()` 双重检查（`initialized` + `initPromise`）防止重复初始化
- 文件 watcher 支持配置热重载
- Config 迁移逻辑（`upgradeConfig`）
- Listener 模式通知变更

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `watch()` 没有关闭 | `stopWatching` 调用 `watcher.close()` | 但如果 `startWatching` 抛出异常，`watcher` 可能未赋值 |
| `addListener` 返回 unsubscribe 函数但未强制类型 | L206-209 | `() => this.listeners.delete(listener)` 返回 `boolean`，而非显式的 unsubscribe semantics |
| `config` 直接替换而非 deep merge | L197-198 | `this.config = this.mergeWithDefaults(parsed)` — 如果文件中删除了某个 connection，旧的仍在内存中 |

### BackupManager

**优点**:
- `cleanOldBackups` 保留最新 N 个备份
- ISO timestamp 格式清晰

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `restoreBackup` 没有验证 JSON 结构 | L41 | `await this.dataStore.importData(data)` — `importData` 会直接用 `data.agents` |
| `deleteBackup` 忽略删除失败 | L98-100 | `} catch { continue; }` — 删除失败时静默忽略 |
| Backup 文件无大小限制 | L30 | 每次 `exportData()` 完整导出，无压缩 |

### types.ts

| 问题 | 位置 | 说明 |
|------|------|------|
| `params: Record<string, any>` | L47 | 应该是具体类型 |
| `DEFAULT_DB` 有 `logs: []` 但从未使用 | L73 | `StratixDataStore` 用 SQLite 存储 logs，不使用 `DEFAULT_DB.logs` |

---

## 安全

### 潜在风险

| 风险 | 位置 | 说明 |
|------|------|------|
| SQL Injection | `StratixDataStore.ts:91-110` | `db.prepare(query).all(...params)` — 如果 `params` 包含恶意 SQL，sqlite3 会 parameterized，但动态 query 构建有风险 |
| Import JSON 无验证 | `BackupManager.ts:40-41` | 导入的 JSON 直接作为 Agent 对象存入数据库，没有 schema 验证 |
| OpenClaw tokens 明文存储 | `types.ts:10-12` | `sharedToken`, `deviceToken`, `deviceId` 明文存储在 JSON 文件中 |
| `dataStoreService` 单例全局状态 | `StratixDataStore.ts:236` | 导出单例，多个模块同时修改可能导致竞态 |

### SQL Injection 分析

```typescript
// StratixDataStore.ts:91-110
let query = 'SELECT * FROM command_logs WHERE 1=1';
const params: any[] = [];

if (options?.agentId) {
  query += ' AND agent_id = ?';
  params.push(options.agentId);  // 参数化查询，安全
}
```

Query 本身是静态字符串，只有 `agentId` 等值通过 params 传入，这是 parameterized query，SQL injection 风险较低。但 `params: any[]` 类型不够严格。

---

## 性能

### StratixDataStore

| 问题 | 说明 |
|------|------|
| `getLogs` 无分页时返回所有记录 | L87-124 — 如果 logs 表有 10000 条，会全部加载到内存 |
| `clearLogs` DELETE 无 LIMIT | L181-189 — 大量数据时可能锁表 |
| 每个 operation 都 `getDatabase()` | L66, L89 — 每次都获取数据库句柄，有轻微开销 |

### EnhancedTemplateLibrary

| 问题 | 说明 |
|------|------|
| `query` 每次创建新数组 | L202-244 — filter 链式调用，多次遍历 |
| Tag index 存储 Set<string> 但只用 id | L158-162 — tagIndex 存储 template id 列表，query 时需要二次查找 |

### OpenClawConnectionStore

| 问题 | 说明 |
|------|------|
| `startWatching` 没有防重入 | L171-184 — 虽然检查了 `if (this.watcher) return`，但错误处理后没有重置 |
| File watcher 监听所有变更 | L175-179 — 外部修改文件会触发 reload，但不验证内容是否真的变了 |

---

## 架构

### 模块边界

```
stratix-data-store/
├── StratixDataStore.ts      → 依赖 stratix-database (SQLite), stratix-core
├── LogStore.ts              → 依赖 StratixDataStore
├── TemplateLibrary.ts        → 依赖 StratixDataStore
├── EnhancedTemplateLibrary.ts → 依赖 stratix-agent/parsers/AgencyAgentsParser, stratix-core
├── OpenClawConnectionStore.ts → 无外部依赖（纯文件系统）
├── BackupManager.ts          → 依赖 StratixDataStore
└── types.ts                 → 类型定义

被依赖方：
├── stratix-gateway          → 导入 StratixDataStore
├── stratix-agent            → 导入 EnhancedTemplateLibrary
└── stratix-core            → AgentRepository, AgentChatMessageRepository (数据库层)
```

### 问题

| 问题 | 说明 |
|------|------|
| `dataStoreService` 单例与依赖注入混用 | `StratixDataStore.ts:236` 导出单例，但 `index.ts` 的 `createDataStore()` 返回新实例 |
| `init.md` 描述的 API 与实际实现不符 | `init.md` 描述的是 LowDB 存储，但实际代码用 SQLite |
| `EnhancedTemplateLibrary` 与 `TemplateLibrary` 功能重叠 | 两个类都管理模板，但接口不同，没有继承关系 |

### init.md vs 实际实现

`init.md` (L77-106) 描述的 `StratixDataStore` 骨架使用 LowDB：
```typescript
// init.md 描述的：
private db: Low<StratixDatabase>;
await this.db.read();
this.db.data.agents.push(config);
await this.db.write();
```

**实际代码** (`StratixDataStore.ts`) 使用 SQLite：
```typescript
// 实际代码：
const db = getDatabase().getDatabase();
db.prepare('INSERT INTO ...').run(...);
```

`init.md` 文档与实际代码严重不符，这是文档债务。

---

## 测试覆盖

**无任何测试文件** — `stratix-data-store/` 下没有任何 `__tests__` 目录或 `.test.ts` 文件。

这是一个高优先级的改进点。

---

## 横向联动

### 依赖关系

| 模块 | 依赖 | 被依赖 |
|------|------|--------|
| `StratixDataStore` | `stratix-database`, `stratix-core` | `index.ts`, `LogStore`, `TemplateLibrary`, `BackupManager` |
| `EnhancedTemplateLibrary` | `stratix-agent/parsers/AgencyAgentsParser` | 外部调用 |
| `OpenClawConnectionStore` | 无外部依赖 | 可能被 UI components 使用 |

### 导入路径分析

```typescript
// StratixDataStore.ts
import { agentChatMessageRepository } from '../stratix-database/AgentChatMessageRepository';
import { agentRepository } from '../stratix-database/AgentRepository';
```

数据库层 (`stratix-database`) 是存储层的依赖方，但 `StratixDataStore` 又导入它们，形成循环依赖风险：存储层需要知道数据库 schema。

---

## 改进建议

### 高优先级

1. **重写 `setPresetTemplates` 实现** (`StratixDataStore.ts:225-227`)
   - 当前是空实现，但 `TemplateLibrary.initialize()` 调用它
   - 需要实际将 preset templates 存入数据库或配置

2. **添加单元测试** — 整个 `stratix-data-store` 无测试
   - `StratixDataStore` 的 CRUD 操作
   - `LogStore` 的 log 管理
   - `EnhancedTemplateLibrary` 的 query/filter

3. **修复 `init.md` 与实际代码不符** (`init.md`)
   - 文档描述 LowDB，实际用 SQLite
   - 需要更新文档或重构代码

### 中优先级

4. **JSON.parse 添加 try-catch** (`StratixDataStore.ts:117`)
   ```typescript
   // 当前
   params: JSON.parse(row.params || '{}'),
   // 建议
   params: (() => { try { return JSON.parse(row.params || '{}'); } catch { return {}; } })()
   ```

5. **BackupManager 验证导入数据结构** (`BackupManager.ts:40-41`)
   - 导入前验证 JSON schema，不合格则 reject

6. **EnhancedTemplateLibrary.query 优化** (`EnhancedTemplateLibrary.ts:202-244`)
   - 合并多个 filter 为单次遍历

7. **OpenClawConnectionStore 导出 unsubscribe 类型** (`OpenClawConnectionStore.ts:206`)
   - 返回 `() => boolean` 改为显式 `Unsubscribe` 类型

8. **OpenClaw tokens 加密存储** (`types.ts:10-12`)
   - sensitive tokens 应该加密后再存，或者通过 backend 中转

### 低优先级

9. **统一单例 vs 工厂模式** (`StratixDataStore.ts:236`)
   - `dataStoreService` 单例 vs `createDataStore()` 工厂，择一使用

10. **getLog 直接查数据库** (`StratixDataStore.ts:176-179`)
    - 当前先 `getLogs()` 再 `find`，应该直接 SQL 查询

11. **generateId 使用 crypto.randomUUID()** — 替代 `Date.now() + Math.random()`
