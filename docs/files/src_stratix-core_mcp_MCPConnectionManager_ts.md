# src/stratix-core/mcp/MCPConnectionManager.ts

> 语言：typescript | 代码行数：335

## 概述

/**
 * MCPConnectionManager - Connection lifecycle management with auto-reconnect
 *
 * Responsibilities:
 * - connect(serverRef): Promise<ConnectionHandle> with auto-reconnect
 * - disconnect(connectionId): void
 * - getConnection(id): ConnectionHandle | null
 * - healthCheck(id): HealthStatus
 * - Connection state tracking via StratixStateStore
 * - Exponential backoff reconnect (max 5 retries)
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `MCPConnectionManager` | 0 | - |

## 依赖

- ../state/StratixStateStore
