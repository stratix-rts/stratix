# src/stratix-core/StratixEventBus.ts

> 语言：typescript | 代码行数：136

## 概述

/**
 * Stratix Core - 事件总线实现
 *
 * 基于 mitt 实现的模块间通信事件发布/订阅机制
 * 所有模块通过此事件总线进行通信
 *
 * 特性：事件缓冲 - 在订阅者注册前到达的事件会被缓冲，
 *       订阅时自动重放缓冲的事件，避免时序问题
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `StratixEventBus` | 0 | - |

## 依赖

- mitt
