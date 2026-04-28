# src/stratix-openclaw-adapter/WebSocketOpenClawAdapter.ts

> 语言：typescript | 代码行数：504

## 概述

/**
 * WebSocketOpenClawAdapter - WebSocket 直连 OpenClaw Gateway
 * 
 * 支持完整的设备认证流程：
 * 1. 生成/加载 RSA 密钥对
 * 2. 派生 device.id（公钥 SHA256 前16位）
 * 3. WebSocket 连接 OpenClaw
 * 4. 处理 connect.challenge 签名
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `WebSocketOpenClawAdapter` | 0 | - |

## 依赖

- crypto
- fs
- path
- ws
- @/stratix-core/stratix-protocol
