# stratix-ai-service 模块

> 分析时间：2026-04-28 21:12
> 文件数：11 | 代码行数：1069 | 文档覆盖：0%

## 概述

（待补充模块概述）

## 核心类

### `RequirementParser`

> -

### `TaskSplitter`

> -

### `BaseAIProvider`

> -

### `OpenAIProvider`

继承自：`BaseAIProvider`

> -

### `AIServiceFactory`

> -

### `ClaudeProvider`

继承自：`BaseAIProvider`

> -

### `OllamaProvider`

继承自：`BaseAIProvider`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getRequirementParsingPrompt` | `requirement: string` | - |
| `getTaskSplittingPrompt` | `strategy: SplitStrategy, summary: string` | - |

## 依赖关系

### 本模块依赖

- openai
- @anthropic-ai/sdk
- ./OpenAIProvider
- ../prompts/task-splitting
- ../prompts/requirement-parsing
- fs
- ../core/AIServiceFactory
- path
- ./OllamaProvider
- ./AIServiceProvider
- ./ClaudeProvider
- ../types

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释