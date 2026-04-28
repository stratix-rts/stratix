# src/design-system/semantic/status.ts

> 语言：typescript | 代码行数：227

## 概述

/**
 * 状态/反馈语义 Token
 * 
 * 用于：
 * - Alert 警告提示
 * - Toast 轻提示
 * - Badge 徽章
 * - Validation 表单验证
 * - Progress 进度指示
 * 
 * 使用方法：
 * import { getStatusSemantic } from '@/design-system/semantic/status';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const statusStyles = getStatusSemantic(theme);
 * 
 * // 显示成功消息
 * alert.style.backgroundColor = statusStyles.success.background;
 * alert.style.borderColor = statusStyles.success.border;
 * alert.style.color = statusStyles.success.text;
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getStatusSemantic` | `theme: DesignSystemTokens` | - |
| `getStatusVariant` | `theme: DesignSystemTokens, sta` | - |
| `generateStatusCSSVariables` | `theme: DesignSystemTokens` | - |
| `applyStatusStyles` | `element: HTMLElement, token: S` | - |
| `getStatusIcon` | `status: keyof StatusSemanticSe` | - |

## 依赖

- @/design-system/semantic/status
- @/design-system/config
- ../types
- ./_generator
- ../types
