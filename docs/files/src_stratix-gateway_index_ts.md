# src/stratix-gateway/index.ts

> 语言：typescript | 代码行数：329

## 概述

/**
 * Stratix Gateway 服务
 * 
 * 支持独立运行和嵌入式运行两种模式：
 * - 独立模式：作为 HTTP 服务运行，监听指定端口
 * - 嵌入式模式：在 Electron 内部运行，仅本地访问
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `startGatewayService` | `options: GatewayServiceOptions` | - |
| `gracefulShutdown` | `` | - |

## 依赖

- http
- path
- cors
- dotenv
- express
- fs-extra
- ../stratix-data-store/OpenClawConnectionStore
- ../stratix-database
- ../stratix-nocodb
- ./api/routes/agent
- ./api/routes/agentOrchestration
- ./api/routes/agentTask
- ./api/routes/command
- ./api/routes/lra
- ./api/routes/openclaw
- ./api/routes/project
- ./api/routes/skill
- ./api/routes/template
- ./api/routes/texture
- ./api/routes/zone
