# stratix-ai-service 模块评审报告

## 概览

**模块路径**: `src/stratix-ai-service/`
**文件数量**: 11 个 TypeScript 文件
**核心职责**: AI 服务抽象层，提供 OpenAI/Claude/Ollama 三大模型的统一接口封装，以及需求解析和任务拆分的高层封装。

### 关键 Exports

| 导出 | 文件 | 说明 |
|------|------|------|
| `AIServiceProvider` / `BaseAIProvider` | `core/AIServiceProvider.ts` | Provider 接口与抽象基类 |
| `OpenAIProvider` / `ClaudeProvider` / `OllamaProvider` | `core/*.ts` | 三个具体实现 |
| `AIServiceFactory` | `core/AIServiceFactory.ts` | 工厂类，单例模式 |
| `RequirementParser` | `parsers/RequirementParser.ts` | 需求 -> 结构化 ParsedRequirement |
| `TaskSplitter` | `parsers/TaskSplitter.ts` | 任务拆分策略执行器 |

---

## 代码质量

### 命名与函数长度

- 命名整体清晰，符合 TypeScript 惯例。
- 函数长度控制良好，无超长函数（大多 < 50 行）。
- `RequirementParser.parseResponse` 和 `TaskSplitter.parseTasks` 有重复的 JSON 提取逻辑（`response.match(/\{[\s\S]*\}/)`），可提取为公共方法。

### 重复代码

**严重重复** — `RequirementParser` 和 `TaskSplitter` 的 `parse()`/`split()` 方法中，流式调用与非流式调用的分支逻辑完全一致：

```typescript
// RequirementParser.ts:21-57 与 TaskSplitter.ts:26-62 结构完全相同
if (streamCallback && this.aiFactory.getConfig().streaming) {
  let fullContent = '';
  await provider.chatStream(
    [{ role: 'system', content: '...' }, { role: 'user', content: prompt }],
    {
      onToken: (token) => { fullContent += token; streamCallback.onToken(token); },
      onComplete: (result) => { streamCallback.onComplete(result); },
      onError: (error) => { streamCallback.onError(error); },
    }
  );
  response = fullContent;
} else {
  const result = await provider.chat([...]);
  response = result.content;
}
```

**建议**: 提取为 `AIServiceProvider.chatWithOptionalStream()` 或独立的流式处理 wrapper。

### 死代码 / 无用代码

- 未发现明显的死代码。

### 类型使用

- `types.ts` 中 `TaskTypeConfig` 定义了 `id/name/color/icon/description` 字段，但实际代码中未使用（`TaskType` enum 被直接使用）。
- `ParsedRequirement.metadata.provider` 和 `model` 字段在 `RequirementParser.parseResponse()` 中被设为空字符串，metadata 未真正填充 AI 返回值。

---

## 安全

### API Key 管理

- API Key 通过配置文件加载，支持 `${VAR_NAME:default}` 格式的环境变量替换（`AIServiceFactory.resolveEnvVars`）。
- API Key 以明文存储在 `config/ai.config.json`，无加密。
- **风险**: 配置文件 commit 到代码库会泄露密钥。需确保 `ai.config.json` 在 `.gitignore` 中。

### 注入风险

- `AIServiceFactory.resolveEnvVar()` 中 `value.match(/\$\{([^}]+)\}/)` 的正则提取未做输入验证，理论上可被操控。
- `resolveEnvVar` 中的 `defaultValue` 分割逻辑：`const [name, defaultValue] = envVar.split(':')` — 如果环境变量名中含 `:` 会导致误判（例如 `${HTTP_PROXY:localhost:8080}`），但实际影响极低。

### Ollama 本地调用

- OllamaProvider 使用 HTTP 明文 localhost 通信，适合本地开发，生产环境部署需注意网络隔离。

---

## 性能

### Provider 实例缓存

- `AIServiceFactory.providers` Map 缓存已创建的 provider 实例（`src/stratix-ai-service/core/AIServiceFactory.ts:14`），避免重复创建 — **良好设计**。

### 无超时控制

- `OllamaProvider.chat()` 和 `chatStream()` 使用原生 `fetch` 但**未设置 `signal`（AbortController）**。若 Ollama 服务挂死，请求将无限等待。
- 同样问题存在于 `OpenAIProvider` 和 `ClaudeProvider`（通过 SDK 发起，SDK 自身可能有超时，但未显式配置）。

### healthCheck 无缓存

- `AIServiceFactory.checkProvidersHealth()` 每次调用都遍历所有 provider 发起真实健康检查请求，无缓存或去抖机制，高频调用会产生大量无效网络请求。

### 内存与流处理

- `OllamaProvider.chatStream()` 中 `for (;;)` 循环读取流，`reader.read()` 无取消路径。若上层提前终止（如 AbortSignal），reader 可能泄漏。
- 缺少 `maxTasks` 限制 — `TaskSplitter` 的 `SplitConfig.maxTasks` 参数存在但从未被使用，任务列表可能无限增长。

---

## 架构

### 依赖方向

```
RequirementParser ──> AIServiceFactory.getInstance()
TaskSplitter      ──> AIServiceFactory.getInstance()
AIServiceFactory  ──> OpenAIProvider / ClaudeProvider / OllamaProvider
```

### 问题: 静态单例与测试

- `AIServiceFactory.getInstance()` 是静态单例，**无法在测试中替换 mock 实现**，严重影响可测试性。
- `RequirementParser` 和 `TaskSplitter` 在构造函数中直接调用 `AIServiceFactory.getInstance()`，而不是接收 provider 实例作为参数 — 违反依赖注入原则。

### Provider 扩展机制

- 添加新 Provider（如 Azure OpenAI、Google Gemini）需要修改 `AIServiceFactory.createProvider()` 的 switch 语句，违反开闭原则。**建议**: 使用注册表模式（registry）动态注册。

### Prompt 管理

- Prompts 作为模板字符串放在独立 `prompts/` 目录，结构清晰，便于非开发者修改。但提示词硬编码为中文，若系统面向国际团队需重构。

---

## 测试

- **完全没有测试文件**。`src/stratix-ai-service/` 下无任何 `.spec.ts` 或 `.test.ts`。
- `RequirementParser.validate()` 和 `detectCycle()` 逻辑复杂，无单元测试验证边界情况（自依赖、跨任务环等）。

### 缺失的测试场景

1. 循环依赖检测：`A -> B -> C -> A`
2. 依赖不存在的任务 ID
3. AI 返回非 JSON 格式时的错误处理
4. Ollama 流式响应中间出现无效 JSON 行
5. `healthCheck` 在网络超时时的行为

---

## 横向联动

| 依赖模块 | 调用位置 | 说明 |
|----------|----------|------|
| `openai` npm 包 | `OpenAIProvider` | 直接依赖 |
| `@anthropic-ai/sdk` | `ClaudeProvider` | 直接依赖 |
| `fs`, `path` (Node.js) | `AIServiceFactory` | 读取配置文件 |
| `stratix-agent` | 未知 | 推测为下游消费者 |

### AI Response 消费者

- `ParsedRequirement.metadata` 接收 AI 返回的 `model`/`provider` 但**从未被实际填充**（固定为空字符串），消费者拿到的是无意义的空值。
- `AIStreamCallback.onComplete` 的 `result` 参数类型为 `any`，无类型约束。

---

## 改进建议（按优先级）

### P0 — 必须修复

1. **为 OllamaProvider 添加 AbortController 超时控制**
   - `src/stratix-ai-service/core/OllamaProvider.ts:16-33`
   - 当前 fetch 无超时，会在服务异常时永久阻塞
   ```typescript
   const controller = new AbortController();
   const timeout = setTimeout(() => controller.abort(), 30000);
   const response = await fetch(`${this.baseUrl}/api/chat`, {
     signal: controller.signal,
     // ...
   });
   clearTimeout(timeout);
   ```

2. **修复 `RequirementParser.parseResponse()` 中空的 metadata**
   - `src/stratix-ai-service/parsers/RequirementParser.ts:83-93`
   - `model` 和 `provider` 应从实际调用的 AI provider 获取：
   ```typescript
   metadata: {
     originalRequirement: requirement,
     parseTime: new Date(),
     model: this.aiFactory.getDefaultProvider().name, // 或传入
     provider: this.aiFactory.getConfig().defaultProvider,
     ...parsed.metadata,
   }
   ```

3. **提取重复的流式/非流式调用逻辑**
   - `RequirementParser.ts:21-57` 与 `TaskSplitter.ts:26-62` 完全相同
   - 建议在 `AIServiceProvider` 或独立工具文件中提取 `chatWithStreamFallback()` 复用

### P1 — 强烈建议

4. **实现 Provider 注册表模式替代 switch**
   - `AIServiceFactory.createProvider()` 目前用 switch 分发，添加新 Provider 需修改原函数
   - 改为 `providers: Map<AIProviderType, new (config) => AIServiceProvider>` 注册机制

5. **为 healthCheck 添加缓存（TTL 30s）**
   - `AIServiceFactory.checkProvidersHealth()` 每次遍历全量 provider，无缓存
   - 建议使用 `Map<string, { healthy: boolean, timestamp: number }>` 缓存结果

6. **解决静态单例，引入依赖注入**
   - `RequirementParser` 和 `TaskSplitter` 直接调用 `getInstance()`，无法在测试中替换 mock
   - 改为构造函数注入：`constructor(aiFactory: AIServiceFactory)` 或接受 `AIServiceProvider` 实例

### P2 — 建议改进

7. **修复 `getTaskSplittingPrompt()` 的 undefined 风险**
   - `src/stratix-ai-service/prompts/task-splitting.ts:88`
   - 若传入未知 `strategy`，`TASK_SPLITTING_PROMPTS[strategy]` 返回 `undefined`，`.replace()` 会抛出
   - 建议加 default 或在 `TaskSplitter.split()` 入参校验

8. **为 `TaskSplitter.optimize()` 添加 `maxTasks` 限制**
   - `SplitConfig.maxTasks` 参数存在但未被使用，可考虑在 `optimize()` 中截断

9. **统一 `AIStreamCallback.onComplete` 的 result 类型**
   - 当前为 `any`，建议定义为 `AIResponse` 类型

10. **补充单元测试**
    - 至少覆盖：`detectCycle()` 的环检测、`removeDuplicates()` 的合并逻辑、`resolveEnvVar()` 的边界情况
