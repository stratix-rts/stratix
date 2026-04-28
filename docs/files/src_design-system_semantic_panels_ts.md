# src/design-system/semantic/panels.ts

> 语言：typescript | 代码行数：153

## 概述

/**
 * 面板语义 Token
 * 
 * 使用方法：
 * import { getPanelSemantic } from '@/design-system/semantic/panels';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const panelStyle = getPanelSemantic(theme).elevated;
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getPanelSemantic` | `theme: DesignSystemTokens` | - |
| `getPanelVariant` | `theme: DesignSystemTokens, var` | - |
| `generatePanelCSSVariables` | `theme: DesignSystemTokens` | - |
| `applyPanelStyles` | `element: HTMLElement, token: P` | - |
| `getPanelStyle` | `variant: keyof typeof PanelSem` | - |

## 依赖

- @/design-system/semantic/panels
- @/design-system/config
- ../types
- ./_generator
- ../types
