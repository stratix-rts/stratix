# src/stratix-gateway/api/websocket/StatusSync.ts

> 语言：typescript | 代码行数：380

## 概述

/**
 * Stratix Gateway - 状态同步服务
 *
 * 通过 WebSocket 实时推送 Agent 和指令状态到前端
 * 监听 GatewayEventBus 将内部事件转发到 WebSocket
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `StatusSyncService` | 0 | - |

## 依赖

- ws
- ../../../stratix-core/stratix-protocol
- ../../../stratix-project/types
- ../../GatewayEventBus
- ../../../stratix-orchestration/zone/ZoneCoordinatorEvents
