# src/composables/useToast.ts

> 语言：typescript | 代码行数：84

## 概述

/**
 * useToast composable
 *
 * Provides a unified toast notification API for Vue components.
 * Subscribe to the global toast service and provide methods to show/dismiss toasts.
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `useToast` | `` | - |
| `show` | `options: ToastOptions` | - |
| `success` | `title: string, message?: strin` | - |
| `error` | `title: string, message?: strin` | - |
| `warning` | `title: string, message?: strin` | - |
| `info` | `title: string, message?: strin` | - |
| `dismiss` | `id: string` | - |
| `dismissAll` | `` | - |

## 依赖

- vue
- @/components/ui/ToastService
