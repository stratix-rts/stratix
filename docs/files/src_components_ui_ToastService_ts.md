# src/components/ui/ToastService.ts

> 语言：typescript | 代码行数：174

## 概述

/**
 * ToastService - Unified Toast Notification System
 *
 * A singleton service that manages toast notifications across the entire application.
 * Provides:
 * - Unified notification types: success/warning/error/info
 * - Auto-dismiss (3-5 seconds)
 * - Stacked display of multiple toasts
 * - Enter/exit animations
 * - Position configuration (top-right, bottom-right, etc.)
 *
 * Bridges Vue composables and RTS event bus.
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `ToastService` | 0 | - |

## 依赖

- @/stratix-rts/events/core/RTSEventBus
- ./ToastItem
