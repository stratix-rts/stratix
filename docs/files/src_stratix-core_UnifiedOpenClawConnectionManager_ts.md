# src/stratix-core/UnifiedOpenClawConnectionManager.ts

> 语言：typescript | 代码行数：906

## 概述

/**
 * UnifiedOpenClawConnectionManager - 统一 OpenClaw 连接管理器
 * 
 * 支持两种连接方式：
 * - pairing: 配对连接（本地/远程，需要 shared token）
 * - tailscale: Tailscale 身份验证（无需 token）
 * 
 * 支持两种模式：
 * - direct: 直连模式（浏览器 WebSocket 直接连接）
 * - proxy: 代理模式（通过 Gateway 代理连接，token 不暴露）
 * 
 * 浏览器和 Electron 有一致的连接体验
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `UnifiedOpenClawConnectionManager` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `cleanup` | `` | - |

## 依赖

- @/stratix-data-store/types
- @/stratix-openclaw-adapter/types
- ./openclaw/DeviceIdentityManager
- ./openclaw/OpenClawWebSocketConnection
