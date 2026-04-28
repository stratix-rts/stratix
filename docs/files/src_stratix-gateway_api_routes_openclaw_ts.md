# src/stratix-gateway/api/routes/openclaw.ts

> 语言：typescript | 代码行数：707

## 概述

（待补充）

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getProxyKey` | `endpoint: string` | - |
| `initConnectionStore` | `store: OpenClawConnectionStore` | - |
| `extractNameFromEndpoint` | `endpoint: string` | - |
| `initWebSocketServer` | `server: http.Server` | - |

## 依赖

- http
- https
- express
- ws
- ../../../stratix-core/utils
- ../../../stratix-data-store/OpenClawConnectionStore
- ../../../stratix-data-store/types
- ../../openclaw/OpenClawConnectionManager
- ../../openclaw/OpenClawProxyManager
- @/stratix-core/retry
- ../client
- ../types/api
