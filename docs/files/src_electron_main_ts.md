# src/electron/main.ts

> 语言：typescript | 代码行数：546

## 概述

/**
 * Stratix Electron 主进程
 *
 * 在 Electron 内部启动完整的 Gateway 服务，包括：
 * - Gateway HTTP 服务（仅本地访问）
 * - 数据存储服务（Electron userData 目录）
 * - Tailscale 集成
 * - OpenClaw 直连支持
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `initializeServices` | `` | - |
| `createWindow` | `` | - |
| `setupIPC` | `` | - |
| `loadDevUrl` | `` | - |

## 依赖

- fs
- path
- electron
- fs-extra
- ../stratix-gateway
- ../stratix-gateway/dataStoreService
- ../stratix-openclaw-adapter/WebSocketOpenClawAdapter
- ../stratix-tailscale/EmbeddedTailscale
