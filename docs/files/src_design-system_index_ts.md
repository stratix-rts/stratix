# src/design-system/index.ts

> 语言：typescript | 代码行数：450

## 概述

/**
 * Stratix Design System
 * 
 * 统一的设计语言系统
 * 一人成军，万智听命
 * 
 * @example
 * // 基础使用
 * import { setTheme, getCurrentTheme, getSemanticTokens } from '@/design-system';
 * 
 * // 切换主题
 * setTheme('minimal');
 * 
 * // 获取当前主题
 * const theme = getCurrentTheme();
 * console.log(theme.colors.brand.primary);
 * 
 * // 获取语义 Token（推荐）
 * const semantic = getSemanticTokens();
 * button.style.backgroundColor = semantic.button.primary.background;
 * button.style.color = semantic.button.primary.text;
 * panel.style.boxShadow = semantic.panel.elevated.shadow;
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `createButtonStyle` | `variant: 'primary' | 'secondar` | - |
| `createPanelStyle` | `variant: 'default' | 'elevated` | - |

## 依赖

- @/design-system
- ./config
- @/design-system
