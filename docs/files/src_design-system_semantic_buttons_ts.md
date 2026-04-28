# src/design-system/semantic/buttons.ts

> 语言：typescript | 代码行数：214

## 概述

/**
 * 按钮语义 Token
 * 
 * 使用方法：
 * import { getButtonSemantic } from '@/design-system/semantic/buttons';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const btnStyle = getButtonSemantic(theme).primary;
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getButtonSemantic` | `theme: DesignSystemTokens` | - |
| `getButtonVariant` | `theme: DesignSystemTokens, var` | - |
| `generateButtonCSSVariables` | `theme: DesignSystemTokens` | - |
| `applyButtonStyles` | `element: HTMLElement, token: B` | - |
| `getButtonStyle` | `variant: keyof typeof ButtonSe` | - |

## 依赖

- @/design-system/semantic/buttons
- @/design-system/config
- ../types
- ./_generator
- ../types
