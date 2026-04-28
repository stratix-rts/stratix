# src/design-system/icons/registry.ts

> 语言：typescript | 代码行数：209

## 概述

/**
 * 图标注册表
 * 
 * 混合实现：
 * - SVG 用于 DOM 组件 (Lucide Icons)
 * - Graphics 用于 Phaser 组件
 * 
 * 所有图标本地化，支持离线使用
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getIconPath` | `_name: string` | - |
| `getCustomIcon` | `_name: string` | - |
| `createSVGIcon` | `_name: string, size: number = ` | - |
| `drawIcon` | `graphics: any, _name: string, ` | - |
| `getIconViewBox` | `__name: string` | - |

## 依赖

- ../types
