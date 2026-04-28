# src/stratix-gateway/api/routes/agentTask.ts

> 语言：typescript | 代码行数：213

## 概述

/**
 * Agent Task API Routes
 *
 * Provides REST endpoints for agents to poll and manage their tasks.
 * These routes bridge the gateway layer with the orchestration TaskQueueService.
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `verifyTaskOwnership` | `task: { assignedAgentId?: stri` | - |

## 依赖

- express
- ../../../stratix-orchestration/task-queue/TaskQueueService
- ../../GatewayEventBus
- ../../../stratix-core/utils
