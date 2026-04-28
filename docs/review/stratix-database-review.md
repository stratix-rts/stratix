# stratix-database 模块评审

## 概览

**模块用途**: Stratix 统一数据库层，使用 SQLite (better-sqlite3) 提供多表 CRUD 操作

**文件统计**: 13 文件
- `StratixDatabase.ts` - 数据库连接和 schema 初始化 (790 行)
- 各 Repository: Agent, Zone, Project, Skill, etc.
- `index.ts` - 导出 barrel

**关键 Exports**:
- `StratixDatabase` / `initializeDatabase()` / `getDatabase()`
- 各 Repository 单例: `agentRepository`, `zoneRepository`, etc.

---

## 代码质量

### 优点

- **SQL 注入防护**: 使用 parameterized queries (`this.db.prepare('... WHERE agent_id = ?')`)
- **WAL 模式**: `pragma('journal_mode = WAL')` 提高并发性能
- **外键约束**: `pragma('foreign_keys = ON')` 开启外键约束
- **N+1 优化**: `ZoneRepository.getFilesBatch()` 批量加载避免 N+1
- **软删除**: `ZoneRepository.deleteZone()` 使用 `deleted_at` 而非物理删除
- **迁移逻辑**: `migrateMissingColumns()` 自动检测并添加缺失列

### 问题

**问题 1: Schema 重复定义**
- `StratixDatabase.ts:641-652` 定义了 `shared_skills` 表
- 但在 `createTables()` 的 SQL 中也有相同表定义 (line 174-189)
- 表可能被创建两次（虽然 `CREATE TABLE IF NOT EXISTS` 会忽略已存在的表）

**问题 2: `any` 类型滥用**
- `AgentRepository.mapRowToAgent()` (line 76-93): `row: any` 参数
- `ZoneRepository.mapRowToZone()` (line 638): `row: any` 参数
- 应定义具体行类型

**问题 3: 迁移代码无版本控制**
- `migrateMissingColumns()` 每次启动都运行检测
- 无法知道哪些迁移已应用
- 建议: 添加 `schema_version` 表跟踪迁移状态

---

## 安全问题

### 低风险: JSON 字段无验证

- 多处 `JSON.parse(row.xxx)` 缺少 try-catch 包裹
- 虽然 Repository 层有 try-catch，但 schema 设计允许存储任意 JSON

**示例**:
```typescript
// ZoneRepository.ts:643-656
try {
  presentAgentIds = JSON.parse(row.present_agent_ids || '[]');
} catch { /* ignore malformed JSON */ }
```
- 静默忽略解析错误可能导致数据不一致

---

## 性能问题

### 中风险: 迁移检测每次启动运行

**位置**: `StratixDatabase.ts:37-297`
```typescript
private migrateMissingColumns(): void {
  // 检测每个表的列...
  // 每次启动都运行 PRAGMA table_info
}
```

- 每次调用 `initializeDatabase()` 都执行 `PRAGMA table_info` 查询
- 建议: 添加版本号机制，只在新版本时运行迁移

---

### 低风险: 缺少连接池

- `better-sqlite3` 是同步 API，单实例
- 虽然 SQLite 支持 WAL 并发，但写锁仍是串行的
- 对于 Electron 多窗口场景可能成为瓶颈

---

## 架构问题

### 单例 Repository 模式

```typescript
// 每个 Repository 都是单例
export const agentRepository = new AgentRepository();
```

**问题**:
- 无法在测试时替换 mock
- 所有 Repository 共享同一数据库连接

**建议**: 使用依赖注入或工厂模式

---

### Repository 职责过重

`ZoneRepository` 725 行，承担了:
- Zone CRUD
- Zone Members 管理
- Zone Files 管理
- Zone Tasks 管理
- Zone Messages 管理
- 模板导出/导入

**建议拆分**:
```
ZoneRepository - Zone 基本 CRUD
ZoneMemberRepository - 成员管理
ZoneFileRepository - 文件管理
ZoneTaskRepository - 任务管理
```

---

## 横向联动

**被依赖**:
- `stratix-agent` - Agent 数据
- `stratix-gateway` - Zone/Project 数据
- `stratix-project` - 所有业务数据
- `stratix-orchestration` - Task/Audit 数据

**依赖**:
- `better-sqlite3` - SQLite 驱动
- `fs-extra` - 文件系统操作

---

## 改进建议 (按优先级)

### P1 - 强烈建议

1. **添加 Schema 版本控制**
   - `StratixDatabase.ts`
   - 创建 `schema_version` 表记录已应用的迁移

2. **拆分 ZoneRepository**
   - 文件过大，职责不清
   - 按功能拆分为多个 Repository

3. **定义具体行类型替代 `any`**
   - `AgentRepository`, `ZoneRepository` 中的 `row: any`
   - 使用 TypeScript interface

### P2 - 可改进

4. **Repository 依赖注入**
   - 便于测试时 mock
   - 考虑使用 IoC 容器

5. **添加数据库连接选项**
   - 超时配置
   - 缓存大小配置

6. **添加索引提示日志**
   - 慢查询分析

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | A | 覆盖所有业务表 |
| 代码质量 | B | SQL 安全，Repository 过大 |
| 安全性 | A | Parameterized queries, 外键约束 |
| 性能 | B | 基本OK，缺少连接池 |
| 可维护性 | B | 单例模式，迁移无版本控制 |
| 测试覆盖 | D | 无测试 |
