# stratix-task-executor 模块代码审查

## 概览

**模块职责**: 提供任务执行器客户端和结果收集器，支持 Agent 任务编排和项目执行结果管理。

**文件统计**: 4 个源文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 导出入口，重导出 LRAClient、LRAWatcher、AgentOrchestratorClient |
| `types.ts` | 类型定义 (TaskStatus, ProjectStatus, TaskExecution, TaskResult 等) |
| `AgentOrchestratorClient.ts` | Agent 编排 HTTP 客户端 |
| `collection/ResultCollector.ts` | 项目结果收集和清单生成 |

---

## 代码质量

### 优点

- **TypeScript 类型完善**: `types.ts` 定义了完整的 TaskStatus、ProjectStatus 等枚举和接口
- **单例模式**: `AgentOrchestratorClient` 使用经典单例模式
- **错误处理**: 各方法均有 try-catch，返回有意义的错误信息
- **文件系统操作**: `ResultCollector` 使用 `fs-extra` 库，异步操作规范

### 问题

#### 1. `AgentOrchestratorClient.ts:125-127` - 硬编码返回 false

```typescript
isAgentWorking(_agentId: string): boolean {
  return false;  // TODO: 实现此方法
}
```

**问题**: 公共方法直接返回固定值，未实现功能却未抛出 `NotImplementedException`。

**建议**: 抛出 `new Error('Not implemented')` 或实现真实逻辑。

#### 2. `ResultCollector.ts:42-53` - 串行收集结果

```typescript
async collectProjectResults(): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  const taskDirs = await this.getTaskDirectories();

  for (const taskDir of taskDirs) {
    const taskId = this.extractTaskId(taskDir);
    if (taskId) {
      const result = await this.collectTaskResult(taskId, taskDir);
      results.push(result);
    }
  }
  // ...
}
```

串行遍历任务目录，若有 100 个任务，每个读取一次文件系统，效率低。

**建议**: 使用 `Promise.all` 并发收集。

#### 3. `ResultCollector.ts:143-144` - 递归调用路径错误

```typescript
const subFiles = await this.getTaskFiles(entry.name);  // entry.name 是相对路径
files.push(...subFiles.map(f => path.join(entry.name, f)));  // 拼接错误
```

递归调用 `getTaskFiles(entry.name)` 时传入相对路径 `entry.name`，但之前调用 `getTaskFiles(taskDir)` 时传入的是绝对路径 `taskDir`。这会导致路径不一致。

**正确做法**: 传入完整路径 `path.join(taskDir, entry.name)`。

#### 4. `AgentOrchestratorClient.ts:18-23` - 单例与实例方法混用

```typescript
static getInstance(): AgentOrchestratorClient {
  if (!AgentOrchestratorClient.instance) {
    AgentOrchestratorClient.instance = new AgentOrchestratorClient();
  }
  return AgentOrchestratorClient.instance;
}
```

构造函数 `private constructor(config?: AgentOrchestratorClientConfig)` 是 private，但 `getInstance()` 忽略配置项，直接使用空配置创建实例。

**建议**: 允许首次调用时传入配置并缓存。

#### 5. `ResultCollector.ts:65-99` - Markdown 生成字符串拼接

```typescript
let markdown = `# 项目执行成果清单\n\n`;
// ... 大量字符串拼接
```

使用字符串拼接生成 Markdown，复杂且难以维护。

**建议**: 使用模板引擎（如 `handlebars`）或 `markdown-it`。

---

## 安全

### 风险点

| 风险 | 等级 | 位置 | 说明 |
|------|------|------|------|
| 路径遍历 | 低 | `ResultCollector.ts:108-124` | `taskDir.startsWith(this.projectPath)` 未校验 |
| 信息泄露 | 低 | `ResultCollector.ts:140` | 过滤 `.stratix-` 文件，但未过滤 `.env` 等敏感文件 |
| console.log | 低 | 多处 | 错误信息可能泄露内部状态 |

### 建议

1. **路径遍历防护**: `getTaskDirectories` 和 `extractTaskId` 应校验结果路径在 `projectPath` 内
2. **敏感文件过滤**: 增加对 `.env`, `.git`, `credentials` 等的过滤

---

## 性能

### 问题

#### 1. `ResultCollector.ts:47-53` - 串行文件 I/O

```typescript
for (const taskDir of taskDirs) {
  const result = await this.collectTaskResult(taskId, taskDir);
  results.push(result);
}
```

串行执行，应改为并发。

#### 2. `ResultCollector.ts:136-146` - 递归目录遍历无深度限制

```typescript
private async getTaskFiles(taskDir: string): Promise<string[]> {
  // ...
  if (entry.isDirectory()) {
    const subFiles = await this.getTaskFiles(entry.name); // 递归无限制
    // ...
  }
}
```

深层目录结构可能导致栈溢出或长时间阻塞。

**建议**: 增加 `maxDepth` 参数限制递归深度。

---

## 架构

### 模块边界

```
stratix-task-executor
├── index.ts (导出入口)
├── types.ts (类型定义)
├── AgentOrchestratorClient.ts (HTTP 客户端)
└── collection/
    └── ResultCollector.ts (文件收集)
```

### 依赖关系

```
AgentOrchestratorClient
├── 依赖: axios (HTTP)
├── 依赖: stratix-core (StratixAgentConfig)
└── 依赖: stratix-gateway (AgentState)

ResultCollector
├── 依赖: fs-extra (文件系统)
└── 依赖: types.ts (TaskResult)
```

### 架构问题

1. **单例配置问题**: `AgentOrchestratorClient` 单例忽略配置
2. **路径处理不一致**: `getTaskFiles` 递归调用时路径处理有 bug

---

## 测试

### 缺失覆盖

1. **AgentOrchestratorClient** - 无单元测试
   - `registerAgent`, `startAgent`, `stopAgent` 等方法
   - 单例模式行为

2. **ResultCollector** - 无单元测试
   - `collectTaskResult` 文件读取
   - `collectProjectResults` 并发收集
   - `extractTaskId` 路径解析

### Mock 建议

- Mock `axios` 避免真实 HTTP 请求
- Mock `fs-extra` 避免真实文件系统操作

---

## 横向联动

### 依赖该模块的模块

| 模块 | 调用方式 |
|------|----------|
| `stratix-lra-bridge` | 重导出 LRAClient, LRAWatcher |
| `stratix-project` | 可能使用 TaskExecutor 管理任务 |

---

## 改进建议

### P0 (关键)

1. **修复 getTaskFiles 路径 bug**
   - 文件: `src/stratix-task-executor/collection/ResultCollector.ts:143`
   - 方案: 传入完整路径 `path.join(taskDir, entry.name)`

2. **实现 isAgentWorking 方法或抛出异常**
   - 文件: `src/stratix-task-executor/AgentOrchestratorClient.ts:125-127`
   - 方案: 抛出 `new Error('Not implemented')` 或实现真实逻辑

### P1 (重要)

3. **ResultCollector 添加路径安全校验**
   - 文件: `src/stratix-task-executor/collection/ResultCollector.ts`
   - 方案: 校验任务目录在项目目录内

4. **并发收集任务结果**
   - 文件: `src/stratix-task-executor/collection/ResultCollector.ts:47-53`
   - 方案: `Promise.all(taskDirs.map(...))`

5. **单例支持配置**
   - 文件: `src/stratix-task-executor/AgentOrchestratorClient.ts:18-23`
   - 方案: 首次调用时缓存配置

### P2 (优化)

6. **使用模板引擎生成 Markdown**
   - 方案: 引入 handlebars 或类似库

7. **增加单元测试**
   - Mock axios 和 fs-extra

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | B | 核心功能完整，isAgentWorking 未实现 |
| 代码质量 | B- | 有 bug (路径处理)，串行 I/O 可优化 |
| 安全性 | B | 路径遍历风险低，但缺少校验 |
| 性能 | B- | 串行 I/O，大项目可能慢 |
| 可维护性 | B | 结构清晰，但单例配置有问题 |
| 测试覆盖 | D | 无测试 |

**核心改进方向**: 修复路径处理 bug、实现未完成方法、改为并发 I/O、建立测试。
