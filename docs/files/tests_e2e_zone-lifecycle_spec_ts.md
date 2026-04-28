# tests/e2e/zone-lifecycle.spec.ts

> 语言：typescript | 代码行数：260

## 概述

/**
 * Zone 生命周期 E2E 测试
 *
 * 测试策略：
 * 1. 先通过 API 预置 Zone 数据
 * 2. 通过 Canvas 点击打开 Zone 面板
 * 3. 验证 DOM 状态变化
 * 4. 通过 API 验证后端数据一致性
 */

## 依赖

- @playwright/test
- ./page-objects/ZonePage
- ./helpers/canvas-helper
- ./helpers/zone-api-helper
