# src/design-system/semantic/inputs.ts

> 语言：typescript | 代码行数：306

## 概述

/**
 * 输入框语义 Token
 * 
 * 使用方法：
 * import { getInputSemantic } from '@/design-system/semantic/inputs';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const inputStates = getInputSemantic(theme);
 * 
 * // 应用默认状态
 * input.style.backgroundColor = inputStates.default.background;
 * input.style.borderColor = inputStates.default.border;
 * 
 * // 聚焦时切换
 * input.addEventListener('focus', () => {
 *   input.style.borderColor = inputStates.focus.border;
 *   input.style.boxShadow = inputStates.focus.shadow;
 * });
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getInputSemantic` | `theme: DesignSystemTokens` | - |
| `getInputState` | `theme: DesignSystemTokens, sta` | - |
| `generateInputCSSVariables` | `theme: DesignSystemTokens` | - |
| `applyInputStyles` | `element: HTMLElement, token: I` | - |
| `isReadOnlyElement` | `element: HTMLElement` | - |
| `isDisabledElement` | `element: HTMLElement` | - |
| `bindInputStateEvents` | `element: HTMLElement, theme: D` | - |

## 依赖

- @/design-system/semantic/inputs
- @/design-system/config
- ../types
- ./_generator
- ../types
