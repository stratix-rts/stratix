# agent-platform 模块

> 分析时间：2026-04-28 21:12
> 文件数：28 | 代码行数：1449 | 文档覆盖：0%

## 概述

（待补充模块概述）

## 核心类

### `ProviderRegistry`

> -

### `LLMAdapter`

> -

### `OllamaAdapter`

继承自：`LLMAdapter`

> -

### `StepFunAdapter`

继承自：`LLMAdapter`

> -

### `AnthropicAdapter`

继承自：`LLMAdapter`

> -

### `QwenAdapter`

继承自：`LLMAdapter`

> -

### `DeepSeekAdapter`

继承自：`LLMAdapter`

> -

### `OpenAIAdapter`

继承自：`LLMAdapter`

> -

### `GoogleAdapter`

继承自：`LLMAdapter`

> -

### `MoonshotAdapter`

继承自：`LLMAdapter`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getPresetById` | `id: string` | - |
| `getPresetsByCategory` | `category: WorkflowPreset['category']` | - |
| `buildGraphFromWorkflow` | `definition: WorkflowDefinition` | - |
| `registerWorkflowHandlers` | `userDataPath: string, fs: any, path: any` | - |
| `ensureDir` | `` | - |
| `getWorkflowPath` | `` | - |
| `registerProviderHandlers` | `` | - |
| `registerExecutionHandlers` | `` | - |

## 依赖关系

### 本模块依赖

- @langchain/anthropic
- ../workflow/types
- ./types
- @langchain/ollama
- ./state
- ../types
- ./base
- @langchain/langgraph
- ./single-agent
- ../providers/registry
- @langchain/core/language_models/chat_models
- ../providers/types
- ./code-review
- ./adapters/base
- @langchain/openai

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释