# stratix-agent 模块评审

## 概览

**模块用途**: Stratix Agent 核心引擎，支持工作流执行、反思机制、技能注册、Session 管理、LLM 多提供商连接

**文件统计**: 40+ 文件
- `index.ts` - 入口导出
- `EnhancedStratixAgent.ts` - 增强 Agent (1100+ 行)
- `core/` - 核心服务 (20+ 文件): SkillRegistry, SessionManager, LLMConnector, MemoryManager, etc.
- `runtime/` - 运行时 (SessionRuntime, TranscriptStore)
- `types/` - 类型定义
- `parsers/` - Markdown 解析器
- `mixins/` - Mixin 组合器

**关键 Exports**:
- `EnhancedStratixAgent` - 增强 Agent 类
- `LLMConnector` - 多 LLM 提供商连接器
- `SkillRegistry` - 技能注册表
- `SessionManager` - Session 管理
- `MixinComposer` - Mixin 组合

---

## 代码质量

### 优点

- **类型覆盖完整**: `types.ts` 和 `runtime/types.ts` 定义了所有关键接口
- **多提供商支持**: OpenAI, Anthropic, Ollama, DeepSeek, Qwen
- **缓存机制**: SkillRegistry 有 TTL + LRU 淘汰
- **进度回调**: SkillRegistry 的 progressCallback 设计良好

### 问题

**问题 1: `EnhancedStratixAgent` 过长**
- 文件 1100+ 行，单一职责违反
- 建议: 拆分为 WorkflowExecutor, ReflectionManager, EvolutionManager

**问题 2: 动态 `require()`**
- `EnhancedStratixAgent.ts:678-681`
```typescript
const TaskQueueService = require('../stratix-orchestration/task-queue/TaskQueueService').TaskQueueService;
```
- 应使用顶层 `import` 而非动态 require

**问题 3: `getCacheKey` 潜在性能问题**
- `SkillRegistry.ts:133-135`
```typescript
private getCacheKey(skillId: string, params: Record<string, any>): string {
  return `${skillId}:${JSON.stringify(params)}`;
}
```
- JSON.stringify 对大对象慢，应考虑哈希

**问题 4: Session 消息无硬上限**
- `SessionManager.ts:54-56` 只做 trim，不报错
- 长期运行可能积累大量消息

---

## 安全问题

### 中风险: API Key 内存存储

- `LLMConnector` 和各 Config 对象将 `apiKey` 存储在实例变量
- `EnhancedStratixAgent` 也持有 `AgentConfig` 包含 apiKey
- 建议: 使用后从内存清除，或使用安全的 token 管理

---

### 低风险: 跨模块循环依赖风险

**位置**: `EnhancedStratixAgent.ts:6-7`
```typescript
import { EVOLUTION_PROMPT } from '../stratix-character-creator/config/skillHubConfig';
import { zoneContextManager } from '../stratix-character-creator/core/ZoneContextManager';
```
- `stratix-agent` 依赖 `stratix-character-creator`
- 若 `stratix-character-creator` 也依赖 `stratix-agent`，会形成循环依赖

**建议**: 将共用类型提取到 `stratix-core`

---

### 低风险: 缺乏输入验证

- `LLMConnector.generateStream()` 的 `onChunk` 回调无大小限制
- Session messages 无内容过滤

---

## 性能问题

### 中风险: SkillRegistry 缓存淘汰不均匀

**位置**: `SkillRegistry.ts:162-167`
```typescript
if (this.cache.size >= this.cacheMaxEntries) {
  const oldestKey = this.cache.keys().next().value;
```
- 使用 `keys().next().value` 获取"最旧"key，但 Map 的迭代顺序不一定按插入顺序（取决于实现）
- 建议: 使用 `Map` 的 `keys()` 迭代器，或用 `SortedMap`

---

### 低风险: Anthropic 流式模拟

**位置**: `LLMConnector.ts:343-347`
```typescript
if (this.isAnthropic()) {
  const result = await this.generate(messages);
  for (const char of result.content) {
    onChunk(char);
    await new Promise(r => setTimeout(r, 10));
  }
```
- Anthropic 不支持真流式，用 `setTimeout(10)` 模拟
- 1000 字符需要 10 秒，不现实

---

## 架构问题

### 模块过大

`stratix-agent` 承担了过多职责：
- Agent 生命周期管理
- LLM 连接
- 技能执行
- Session 管理
- 工作流执行
- 反思和进化机制
- 任务轮询

**建议拆分**:
```
stratix-agent-core/ - Agent 基类、LLM 连接
stratix-agent-skills/ - 技能系统
stratix-agent-workflow/ - 工作流引擎
stratix-agent-reflection/ - 反思和进化
```

---

### 依赖方向问题

```
stratix-character-creator
         ↑
stratix-agent ←←←←←←←←←←←←┛
         ↓
stratix-orchestration
```

- Agent 依赖 CharacterCreator 的 ZoneContextManager（获取 Zone 上下文）
- 但 Agent 又通过 TaskQueueService 依赖 Orchestration
- 可能形成间接循环

---

## 横向联动

**被依赖**:
- `stratix-openclaw-adapter` - 通过 LLMConnector
- `stratix-character-creator` - 使用 Agent 做后端
- `stratix-orchestration` - TaskQueueService

**依赖**:
- `stratix-core` - 重试引擎、协议类型
- `stratix-character-creator` - ZoneContextManager, SoulTemplates
- `stratix-orchestration` - TaskQueueService (动态 require)
- `@anthropic-ai/sdk`, `openai` - LLM SDK

---

## 改进建议 (按优先级)

### P0 - 必须修复

1. **移除动态 require**
   - `EnhancedStratixAgent.ts:678-681`
   - 改用顶层 import

2. **修复 Anthropic 流式模拟**
   - 或明确标注 "Anthropic 流式为模拟，非真流式"

### P1 - 强烈建议

3. **提取共用依赖到 stratix-core**
   - `ZoneContextManager` 类型应该独立
   - 避免循环依赖

4. **SkillRegistry 缓存淘汰改进**
   - `SkillRegistry.ts:162-167`
   - 使用更可靠的 LRU 实现

5. **Session 消息硬上限**
   - `SessionManager.ts`
   - 添加 `maxTotalMessages` 配置，超过时拒绝或警告

6. **API Key 安全处理**
   - 使用后从内存清除
   - 或使用加密存储

### P2 - 可改进

7. **getCacheKey 性能**
   - 使用对象哈希而非 JSON.stringify

8. **拆分 EnhancedStratixAgent**
   - 1100+ 行应拆分为多个类

9. **添加单元测试**
   - 当前完全无测试

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | A | 功能非常全面 |
| 代码质量 | B | 核心清晰，但有些臃肿 |
| 安全性 | B | 基本OK，有小改进空间 |
| 性能 | B | 缓存设计良好，部分实现可优化 |
| 可维护性 | B | 模块过大，职责需拆分 |
| 测试覆盖 | D | 无测试 |
