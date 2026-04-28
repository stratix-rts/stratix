# src/stratix-core/ui/DOMContainer.ts

> 语言：typescript | 代码行数：148

## 概述

/**
 * DOM Container - 通用 DOM 弹窗容器
 * 
 * 统一解决 DOM 弹窗点击穿透问题
 * 所有需要覆盖在 Phaser 场景之上的 DOM 元素都应该使用此容器
 * 
 * 使用方法:
 * ```typescript
 * const container = new DOMContainer(scene, {
 *   x: 100,
 *   y: 100,
 *   html: '<div>...</div>',
 *   onClickOutside: () => container.close() // 可选：点击外部关闭
 * });
 * container.open();
 * ```
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `DOMContainer` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `createDOMContainer` | `scene: Phaser.Scene, config: D` | - |

## 依赖

- phaser
- @/design-system/tokens/depth
- ./DOMOverlayManager
