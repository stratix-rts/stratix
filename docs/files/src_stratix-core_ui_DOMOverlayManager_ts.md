# src/stratix-core/ui/DOMOverlayManager.ts

> 语言：typescript | 代码行数：80

## 概述

/**
 * DOM 弹窗点击穿透防护管理器
 * 
 * 原理：在 DOM 弹窗容器上阻止事件冒泡，防止事件到达 Phaser Canvas
 * 这样 Phaser 场景就收不到点击事件，自然就不会有穿透问题
 * 
 * 注意：不拦截点击弹窗外部的区域，那些点击会正常到达 Phaser
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `DOMOverlayManager` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `stopPropagation` | `` | - |
