# src/design-system/semantic/index.ts

> 语言：typescript | 代码行数：181

## 概述

/**
 * Semantic Tokens 聚合导出
 *
 * Level 2: 语义化令牌 - 主题感知
 *
 * 使用方法：
 * import { getButtonSemantic, getPanelSemantic } from '@/design-system/semantic';
 * import { getCurrentTheme } from '@/design-system/config';
 *
 * const theme = getCurrentTheme();
 * const buttons = getButtonSemantic(theme);
 * const panels = getPanelSemantic(theme);
 */

## 依赖

- @/design-system/semantic
- @/design-system/config
