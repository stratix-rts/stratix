# tests 模块代码审查

## 概览

**模块职责**: Stratix 项目的测试套件，包括单元测试、集成测试和 E2E 测试。

**文件统计**: 100+ 测试文件

**测试分布**:
| 目录 | 文件数 | 类型 |
|------|--------|------|
| `tests/stratix-rts/` | 20+ | 单元/集成测试 |
| `tests/stratix-agent/` | 10+ | 单元测试 |
| `tests/stratix-core/` | 10+ | 单元测试 |
| `tests/stratix-database/` | 5+ | 单元测试 |
| `tests/stratix-project/` | 5+ | 单元测试 |
| `tests/agent-platform/` | 8+ | 单元测试 |
| `tests/stratix-gateway/` | 3+ | 集成测试 |
| `tests/e2e/` | 2+ | E2E 测试 |
| `tests/components/` | 2+ | 组件测试 |
| `tests/design-system/` | 2+ | 单元测试 |

---

## 代码质量

### 优点

1. **测试框架成熟**: 使用 Jest (ESM 模式) 作为测试框架
2. **Mock 基础设施完善**: `mockDatabase.ts` 提供了完整的数据库 mock，包括:
   - `createMockDatabase()` - 创建模拟数据库
   - `createMockStatement()` - 创建预定义返回的模拟语句
   - 各实体的 mock 工厂函数 (createMockZoneRow, createMockAgentRow 等)
3. **测试隔离**: `beforeEach`/`afterEach` 正确清理
4. **超时配置**: `jest.setTimeout(10000)` 设置合理

### 问题

#### 1. `GatewayEventBus.test.ts` - 测试与实现耦合

```typescript
jest.doMock('../../src/stratix-project/types', () => ({
  ProjectChannelMessage: {...}
}));
```

使用 `jest.doMock` mock 整个模块，导致测试与实现细节紧耦合。当 `ProjectChannelMessage` 类型变化时，测试也需要更新。

#### 2. `GatewayEventBus.test.ts:45-47` - 跳过单例测试

```typescript
// Note: Singleton tests skipped because the module mocking interferes with
// Jest's module cache. The singleton behavior is implicitly tested through
// the other tests which use the same gatewayEventBus instance.
```

单例模式的核心行为未被直接测试。

#### 3. `setup.ts` - 简单配置

```typescript
beforeAll(() => {
  console.log('🚀 Starting tests...');
});
```

setup 文件仅包含日志和超时配置，缺少全局 mock 或测试环境设置。

#### 4. 测试文件使用 `any` 类型

`GatewayEventBus.test.ts` 中大量使用 `any`:
```typescript
let GatewayEventBus: any;
let gatewayEventBus: any;
const module = require('../../src/stratix-gateway/GatewayEventBus');
```

这导致 TypeScript 类型检查失效，IDE 无法提供自动完成。

---

## 测试覆盖率

### 已有覆盖的模块

| 模块 | 覆盖率 | 说明 |
|------|--------|------|
| `stratix-gateway/GatewayEventBus` | 高 | 详细的事件测试 |
| `stratix-database` | 中 | Repository 测试使用 mock |
| `stratix-rts` | 中 | 各子模块有测试 |
| `stratix-agent` | 中 | 核心类有测试 |
| `stratix-core` | 中 | executor, schemas 等 |

### 缺失覆盖的领域

| 领域 | 风险 |
|------|------|
| API Routes | 中 - 无集成测试 |
| WebSocket | 高 - StatusSyncService 未测试 |
| ZoneService | 高 - 仅集成测试，无单元测试 |
| E2E | 低 - zone-lifecycle 存在 |

---

## 测试基础设施

### 优点

1. **Mock 工具完善**: `mockDatabase.ts` 提供强类型的 mock 行对象
2. **E2E 辅助工具**: `canvas-helper.ts`, `zone-api-helper.ts` 提供 E2E 测试辅助
3. **Page Objects**: `ZonePage.ts`, `AgentDesignerPage.ts` 等封装了页面交互

### 问题

#### 1. Mock 数据库实现简单

```typescript
const mockPrepare = jest.fn((sql: string): MockStatement => {
  const statement: MockStatement = {
    all: (...args: any[]): any[] => { return []; },
    // ...
  };
  return statement;
});
```

`mockDatabase.ts` 中的 mock 不验证 SQL 语句是否正确，也不模拟 better-sqlite3 的行为细节。

#### 2. E2E 测试依赖 Playwright 但配置不明确

从 `zone-lifecycle.spec.ts` 看出使用 Playwright，但 package.json 中可能未配置。

#### 3. 测试未使用 TypeScript 严格模式

大多数测试文件使用 `.ts` 扩展名但包含 `any` 类型，表明可能未启用严格类型检查。

---

## 测试最佳实践违反

### 1. 测试描述不清晰

`GatewayEventBus.test.ts` 中的测试描述可以更具体：
```typescript
it('should emit agent_mention event for mentioned agents', () => {...})
// 好：清晰描述预期行为
```

### 2. 缺少 AAA 模式注释

Arrange-Act-Assert 模式未明确标注，大型测试可能难以阅读。

### 3. 测试独立性

```typescript
beforeEach(() => {
  jest.resetModules();  // 每次重置模块
});
```

虽然有清理，但 mock 状态可能在测试间泄漏。

---

## 安全

### 风险点

| 风险 | 等级 | 说明 |
|------|------|------|
| console.log 在测试中 | 低 | `setup.ts` 和测试中有日志输出 |
| Mock 过于宽松 | 低 | mock 返回空数组可能掩盖问题 |

---

## 改进建议

### P0 (关键)

1. **为 ZoneService 添加单元测试**
   - 当前只有集成测试
   - 重点测试权限检查、文件操作安全、批量操作

2. **为 API Routes 添加集成测试**
   - 使用 supertest
   - 测试输入验证、权限检查、错误处理

### P1 (重要)

3. **改进 Mock 数据库实现**
   - 添加 SQL 语句验证
   - 更真实地模拟 better-sqlite3 行为

4. **移除测试中的 `any` 类型**
   - 启用 TypeScript 严格模式
   - 使用正确的类型导入

5. **补充 WebSocket 测试**
   - `StatusSyncService` 完全未测试

### P2 (优化)

6. **添加测试覆盖率报告**
   - 集成 Codecov 或类似工具
   - 设置覆盖率阈值

7. **改进 E2E 测试配置**
   - 确保 Playwright 配置与 package.json 一致
   - 添加 CI 环境变量配置

8. **统一测试 setup**
   - 添加全局 mock (如 console.log 静音)
   - 统一测试环境配置

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 覆盖率 | B | 核心模块有测试，但 API/WebSocket 缺失 |
| 代码质量 | B- | mock 工具完善，但 `any` 使用过多 |
| 隔离性 | B | 有清理机制，但 mock 状态可能泄漏 |
| 可维护性 | B | 测试结构清晰，但文档少 |
| 基础设施 | B+ | mock 工具和 Page Objects 封装良好 |

**核心改进方向**:
1. 补充 API Routes 和 WebSocket 测试
2. 移除 `any` 类型，使用正确类型
3. 改进 Mock 数据库实现
4. 添加全局测试 setup
