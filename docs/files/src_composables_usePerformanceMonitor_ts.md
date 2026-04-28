# src/composables/usePerformanceMonitor.ts

> 语言：typescript | 代码行数：163

## 概述

/**
 * usePerformanceMonitor composable
 *
 * Provides lightweight performance monitoring for Vue components:
 * - Render timing via performance.mark/measure
 * - Event handler timing
 * - Memory usage tracking
 * - Metric aggregation and thresholds
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `usePerformanceMonitor` | `options: { threshold?: number ` | - |
| `trackRender` | `stage: 'mount' | 'update' | 'u` | - |
| `trackEvent` | `name: string, fn: (` | - |
| `addMetric` | `name: string, duration: number` | - |
| `getMemory` | `` | - |
| `startMemoryTracking` | `intervalMs = 2000` | - |
| `stopMemoryTracking` | `` | - |
| `getReport` | `` | - |
| `clearMetrics` | `` | - |

## 依赖

- vue
