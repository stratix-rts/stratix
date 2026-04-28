# src/stratix-rts/ui/v2/CommandPanelV2.ts

> 语言：typescript | 代码行数：955

## 概述

/**
 * CommandPanel V2 - 重构版本
 *
 * 引入状态机的响应式命令面板
 * - 自动推导状态 (empty / single_agent / multi_agent / zone)
 * - 增量渲染，无完全销毁重建
 * - 过渡动画支持
 * - Loading 状态支持
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `CommandPanelV2` | 0 | - |

## 依赖

- phaser
- @/stratix-core/ui/components/base/EnhancedUIComponent
- @/stratix-core/ui/core/types/component.types
- @/stratix-core/ui/foundation/theme/ReactiveToken
