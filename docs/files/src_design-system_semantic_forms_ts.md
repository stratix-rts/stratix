# src/design-system/semantic/forms.ts

> 语言：typescript | 代码行数：194

## 概述

/**
 * 表单语义 Token
 * 
 * 用于统一表单组件的视觉样式：
 * - FormLabel 表单标签
 * - FormField 表单字段
 * - FormHelp 帮助文本
 * - FormError 错误提示
 * 
 * 使用方法：
 * import { getFormSemantic } from '@/design-system/semantic/forms';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const formStyles = getFormSemantic(theme);
 * 
 * // 标签样式
 * label.style.color = formStyles.label.color;
 * label.style.fontSize = formStyles.label.fontSize;
 * 
 * // 帮助文本样式
 * helpText.style.color = formStyles.helpText.color;
 * helpText.style.fontSize = formStyles.helpText.fontSize;
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getFormSemantic` | `theme: DesignSystemTokens` | - |
| `generateFormCSSVariables` | `theme: DesignSystemTokens` | - |
| `getFormSize` | `size: FormSize` | - |

## 依赖

- @/design-system/semantic/forms
- @/design-system/config
- ../types
- ./_generator
- ./_generator
- ../types
