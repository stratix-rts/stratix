# src/design-system/semantic/tooltip.ts

> 语言：typescript | 代码行数：76

## 概述

/**
 * Tooltip / Popover 语义 Token
 *
 * 使用方法：
 * import { getTooltipSemantic } from '@/design-system/semantic/tooltip';
 * import { getCurrentTheme } from '@/design-system/config';
 *
 * const theme = getCurrentTheme();
 * const tooltip = getTooltipSemantic(theme).default;
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getTooltipSemantic` | `theme: DesignSystemTokens` | - |
| `getTooltipVariant` | `theme: DesignSystemTokens, var` | - |
| `generateTooltipCSSVariables` | `theme: DesignSystemTokens` | - |
| `applyTooltipStyles` | `element: HTMLElement, token: T` | - |

## 依赖

- @/design-system/semantic/tooltip
- @/design-system/config
- ../types
- ./_generator
- ./_generator
