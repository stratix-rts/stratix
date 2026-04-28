# src/stratix-core/openclaw/ConnectionResilience.ts

> 语言：typescript | 代码行数：506

## 概述

/**
 * ConnectionResilience - Connection resilience layer for OpenClaw WebSocket connections
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Auth refresh before reconnect
 * - Circuit breaker pattern
 * - Health check / heartbeat
 * - Connection lifecycle events via typed EventEmitter
 *
 * Framework-agnostic: pure TypeScript with Node.js types only.
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `ConnectionResilience` | 0 | - |

## 依赖

- events
