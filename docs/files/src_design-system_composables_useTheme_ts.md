# src/design-system/composables/useTheme.ts

> 语言：typescript | 代码行数：130

## 概述

/**
 * useTheme composable
 *
 * Runtime theme switcher that:
 * - Manages current theme (cyberpunk, minimal, professional)
 * - Persists selection to localStorage
 * - Applies CSS custom properties (--stratix-*) to document.documentElement
 * - Provides a themes list for UI rendering
 * - Adds a brief CSS transition overlay during switch to avoid flash
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `flattenToCssVars` | `obj: any, prefix = '--stratix'` | - |
| `applyTokensToRoot` | `tokens: DesignSystemTokens` | - |
| `useTheme` | `` | - |
| `setTheme` | `name: ThemeName` | - |
| `initTheme` | `` | - |

## 依赖

- vue
- ../themes
- ../themes/cyberpunk
- ../themes/minimal
- ../themes/professional
- ../types
