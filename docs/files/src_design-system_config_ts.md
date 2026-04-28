# src/design-system/config.ts

> 语言：typescript | 代码行数：525

## 概述

/**
 * Stratix Design System 主配置
 * 
 * 修改此处快速切换整体风格
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getCurrentTheme` | `` | - |
| `getSemanticTokens` | `` | - |
| `invalidateSemanticTokenCache` | `` | - |
| `setTheme` | `themeName: keyof typeof Design` | - |
| `flattenSemanticTokens` | `semantic: CompleteSemanticToke` | - |
| `injectThemeCSSVariables` | `` | - |
| `restoreThemeFromStorage` | `` | - |
| `onThemeChange` | `callback: (event: { theme: str` | - |
| `initDesignSystem` | `` | - |
| `isThemeAvailable` | `name: string` | - |
| `getAvailableThemes` | `` | - |
| `mapTokenPath` | `path: string` | - |
| `getToken` | `path: string` | - |
| `getTokens` | `paths: string[]` | - |
| `handler` | `` | - |

## 依赖

- ./semantic/_generator
- ./semantic/_generator
- ./themes/cyberpunk
- ./themes/minimal
- ./themes/professional
- ./types
- ./types
