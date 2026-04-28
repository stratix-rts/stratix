# src/stratix-orchestration/OrchestrationSync.ts

> 语言：typescript | 代码行数：257

## 概述

/**
 * OrchestrationSync - Connects orchestration services to StatusSync WebSocket
 *
 * This service bridges ZoneManager, TaskQueueService, BackgroundAgentService,
 * and AgentMessageRouter events to the WebSocket layer for frontend sync.
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `OrchestrationSync` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `zoneHandler` | `` | - |
| `taskHandler` | `` | - |
| `bgHandler` | `` | - |
| `msgHandler` | `` | - |
| `zoneCoordHandler` | `` | - |

## 依赖

- path
- ./background/BackgroundAgentService
- ./messaging/AgentMessageRouter
- ./messaging/MessageTypes
- ./task-queue/TaskItem
- ./task-queue/TaskQueueService
- ./zone/ZoneCoordinatorEvents
- ./zone/ZoneManager
- ./zone/ZoneState
