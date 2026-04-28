# agent-platform 模块评审

## 概览

**模块用途**: 统一的 AI Provider 注册中心和工作流编排引擎，支持多 Provider 接入和 LangChain LangGraph 工作流构建

**文件统计**: 24 文件
- `providers/` - Provider 注册表 + 8 个适配器 (OpenAI, Anthropic, Google, DeepSeek, Qwen, Moonshot, StepFun, Ollama)
- `workflow/` - 工作流类型定义、持久化存储、预设模板
- `orchestration/` - LangGraph 状态机编排 (graph-builder, state)
- `ipc/` - Electron IPC 处理器 (workflow, providers, execution)

**关键 Exports**:
- `providerRegistry` / `ProviderRegistry` - 全局 Provider 注册表
- `workflowStore` / `WorkflowStore` - 工作流持久化
- `AgentGraphState` - LangGraph 状态类型
- `buildGraphFromWorkflow()` / `GraphBuilder` - 工作流到 LangGraph 构建器

---

## 代码质量

### 优点

- **适配器模式清晰**: `LLMAdapter` 抽象基类定义统一接口，各 Provider 独立实现
- **类型覆盖完整**: `types.ts` 定义了所有关键接口 (`ProviderConfig`, `CreateProviderOptions`, `WorkflowStep`, etc.)
- **目录遍历防护**: `workflow.ts:15` 使用正则 `/[/\\]|\.\./` 验证 workflow ID
- **Preset 系统**: 预设工作流模板支持快速启动
- **Store 双写策略**: `WorkflowStore` 同时操作内存 Map 和 Electron IPC 持久化

### 问题

**问题 1: `GraphBuilder` 的 `createRouterNode` / `createHumanNode` / `createParallelNode` 是空实现**
- `graph-builder.ts:100-125`
- 这些方法只返回 `{ ...state, currentStep: step.id }`，不执行任何实际操作
- `createParallelNode` 应该并发执行多个分支，但未实现

**问题 2: `testConnection` 使用同步 `llm.invoke` 但方法声明为 `async`**
- `registry.ts:91-103`
- 虽然方法签名是 `async`，但内部没有 `await` 对任何 Promise
- `llm.invoke()` 返回的是 LangChain `BaseChatModel` 的结果，如果是流式的会阻塞

**问题 3: `WorkflowStore` 的 `loaded` 标志无线程安全**
- `store.ts:16`
- `loaded` 检查和设置之间存在竞态条件，两个并发 `load()` 调用可能都通过 `if (!this.loaded)` 检查

**问题 4: `createFromPreset` 使用 `Math.random()` 生成 ID**
- `store.ts:119`
- `Math.random()` 不是加密安全的随机数，不应用于 ID 生成
- 建议使用 `crypto.randomUUID()` 或类似方法

---

## 安全问题

### 中风险: API Key 传递依赖全局 `window.electronAPI`

**位置**: `graph-builder.ts:152-160`
```typescript
private async getApiKey(providerId: string): Promise<string | undefined> {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.apiKey?.load) {
    const result = await (window as any).electronAPI.apiKey.load(providerId);
```
- 使用 `(window as any).electronAPI` 绕过类型检查
- API Key 通过 IPC 传输，涉及进程间通信安全性

### 低风险: `WorkflowStore` 直接使用 `JSON.parse` 无验证

**位置**: `store.ts:124`
```typescript
definition: JSON.parse(JSON.stringify(preset.definition)),
```
- `JSON.stringify` 后立即 `JSON.parse`，实际只是深拷贝
- 但如果 `preset.definition` 包含函数或特殊对象，会丢失数据

### 低风险: `registerWorkflowHandlers` 的 `fs` / `path` 注入

**位置**: `workflow.ts:4`
```typescript
export function registerWorkflowHandlers(userDataPath: string, fs: any, path: any) {
```
- `fs` 和 `path` 参数类型为 `any`，调用方可能传入恶意实现
- 内部 `ensureDir()` / `getWorkflowPath()` 依赖这些参数的安全性

---

## 性能问题

### 中风险: `testConnection` 每次调用都创建新 Model 实例

**位置**: `registry.ts:91-103`
```typescript
async testConnection(options: CreateProviderOptions): Promise<...> {
  const llm = this.createModel(options);  // 每次创建新实例
  await llm.invoke([{ role: 'user', content: 'Hello' }]);
}
```
- 连接测试应该复用已有实例，而不是每次创建新的
- 对于需要初始化连接的 Provider（如 Ollama），延迟会很高

### 低风险: `WorkflowStore.load()` 使用同步文件读取

**位置**: `workflow.ts:25-31`
```typescript
const files = fs.readdirSync(workflowDir);
for (const file of files) {
  const content = fs.readFileSync(filePath, 'utf-8');
```
- 同步 I/O 会阻塞事件循环
- 大量 workflow 文件时可能有性能问题

### 低风险: `GraphBuilder` 节点函数每次执行都创建新 LLM 实例

**位置**: `graph-builder.ts:65-72`
```typescript
const llm = providerRegistry.createModel({...});
```
- 每次执行工作流步骤都重新创建 Model，无法复用连接

---

## 架构问题

### 单例滥用

```typescript
// registry.ts
export const providerRegistry = new ProviderRegistry();

// store.ts
export const workflowStore = new WorkflowStore();
```

- 全局单例无法在测试时替换 mock
- `ProviderRegistry` 在构造函数中注册所有 8 个 Provider，即使只用到其中 1 个

### ProviderRegistry 实例存储无容量限制

**位置**: `registry.ts:18`
```typescript
private instances: Map<string, ProviderInstance> = new Map();
```
- `createAndStore()` 不断添加实例，但无清理机制
- 长期运行可能导致内存泄漏

### 模块边界模糊

```
agent-platform/
  providers/    - Provider 注册
  workflow/     - 工作流类型 + 存储
  orchestration/ - 状态机
  ipc/          - Electron IPC
```

- `ipc/` 目录混入了 Electron 特定逻辑
- `orchestration/` 依赖 `providers/`，但 `workflow/` 也依赖 `providers/`，存在间接依赖

### WorkflowStore 混合了内存和持久化逻辑

**位置**: `store.ts`
- 内存 Map (`this.workflows`) 和 Electron IPC 持久化混在一起
- 如果 IPC 调用失败，内存状态可能与磁盘不一致

---

## 横向联动

**被依赖**:
- `stratix-gateway` - 可能用于 AI Provider 选择
- Electron 主进程 - IPC 通道
- `@langchain/langgraph` - 工作流状态机
- `@langchain/openai`, `@langchain/anthropic`, etc. - 各 Provider SDK

**依赖**:
- `@langchain/core` - BaseChatModel 类型
- `@langchain/langgraph` - StateGraph
- Electron IPC (window.electronAPI)

---

## 改进建议 (按优先级)

### P1 - 强烈建议

1. **实现 `createRouterNode` / `createHumanNode` / `createParallelNode`**
   - `graph-builder.ts:100-125`
   - router 应根据条件分支；human 应等待用户输入；parallel 应并发执行

2. **添加 `ProviderRegistry` 实例清理机制**
   - `registry.ts`
   - 添加 `removeInstance()` 的调用点，或添加 TTL/容量限制

3. **修复 `testConnection` 复用已有实例**
   - `registry.ts:91-103`
   - 先检查 `instances` Map 中是否有可用实例

4. **使用 `crypto.randomUUID()` 替代 `Math.random()`**
   - `store.ts:119`

5. **将 `loaded` 标志改为原子操作或加锁**
   - `store.ts:16`

### P2 - 可改进

6. **分离 WorkflowStore 的内存和持久化逻辑**
   - 内存层只负责缓存
   - 持久化层通过 IPC 解耦

7. **添加 Provider 连接池**
   - 避免每次创建新 LLM 实例

8. **添加工作流执行进度事件**
   - 目前 `onProgress` 回调未在 graph-builder 中使用

9. **实现 `workflow:execute` IPC handler**
   - `ipc/workflow.ts` 只有 CRUD，缺少执行逻辑

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | B | Provider 接入完整，Workflow 执行部分实现 |
| 代码质量 | B | 适配器模式好，部分方法空实现 |
| 安全性 | B | 基本安全，有小改进空间 |
| 性能 | B | 小场景 OK，大规模/并发需优化 |
| 可维护性 | B | 架构清晰，单例和空实现问题 |
| 测试覆盖 | D | 无测试 |
