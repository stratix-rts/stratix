# stratix-agent 模块

> 分析时间：2026-04-28 21:12
> 文件数：51 | 代码行数：11068 | 文档覆盖：37%

## 概述

（待补充模块概述）

## 核心类

### `StratixAgent`

> -

### `EnhancedStratixAgent`

继承自：`StratixAgent`

> -

### `AgencyAgentsParser`

> -

### `RateLimiter`

> -

### `LLMConnectionPool`

> -

### `PromptTemplateEngine`

> -

### `EnhancedPromptBuilder`

> -

### `AutoSaver`

> -

### `ToolUseLoop`

> -

### `StratixAgentManager`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `executePromise` | `` | - |
| `request` | `` | - |
| `request` | `` | - |
| `request` | `` | - |
| `request` | `` | - |
| `getHandlebarsEngine` | `` | - |
| `taskClaim` | `agentId: string, zoneId: string, taskId:` | - |
| `taskProgress` | `agentId: string, zoneId: string, taskId:` | - |
| `taskComplete` | `agentId: string, zoneId: string, report:` | - |
| `taskIssue` | `agentId: string, zoneId: string, taskId:` | - |

## 依赖关系

### 本模块依赖

- ./mixins/MixinComposer
- child_process
- ./SharedMemoryCache
- fs/promises
- ../runtime/SessionRuntime
- ./BashSkillExecutor
- ./core/SessionManager
- ./LLMConnector
- ../../types
- ./types
- ./core/StorageManager
- ../stratix-core/stratix-protocol
- ../types
- ./core/ReflectionManager
- ./ZoneSkillExecutor

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释