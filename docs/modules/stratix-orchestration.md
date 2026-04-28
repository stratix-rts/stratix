# stratix-orchestration 模块

> 分析时间：2026-04-28 21:13
> 文件数：18 | 代码行数：4877 | 文档覆盖：11%

## 概述

（待补充模块概述）

## 核心类

### `OrchestrationSync`

> -

### `AgentCheckpointManager`

> -

### `BackgroundAgentService`

> -

### `RelevanceScorer`

> -

### `ContextCompressionService`

> -

### `TaskQueueService`

> -

### `ZoneCoordinator`

> -

### `ZoneCoordinatorEventEmitter`

> -

### `ZoneManager`

> -

### `AgentMessageRouter`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `zoneHandler` | `` | - |
| `taskHandler` | `` | - |
| `bgHandler` | `` | - |
| `msgHandler` | `` | - |
| `zoneCoordHandler` | `` | - |

## 依赖关系

### 本模块依赖

- ./ConversationConstraints
- ./AgentCheckpoint
- ./zone/ZoneState
- ./ZoneState
- ../../stratix-core/permission
- ../../stratix-database
- ../zone/ZoneManager
- ../../stratix-agent/core/LLMConnector
- ../../stratix-database/StratixDatabase
- ./task-queue/TaskItem
- ./ZoneCoordinatorEvents
- ./TaskItem
- ./task-queue/TaskQueueService
- ./MessageTypes
- ./background/BackgroundAgentService

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释