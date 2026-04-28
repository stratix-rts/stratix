# src/design-system/semantic/_generator.ts

> 语言：typescript | 代码行数：853

## 概述

/**
 * 语义 Token 生成器
 * 
 * 根据主题色板动态生成语义 Token
 * 解决硬编码问题，实现主题切换时语义 Token 自动更新
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `alpha` | `color: string, opacity: number` | - |
| `generateButtonSemantic` | `colors: ThemePrimitives, radii` | - |
| `generatePanelSemantic` | `colors: ThemePrimitives, radii` | - |
| `generateInputSemantic` | `colors: ThemePrimitives` | - |
| `generateStatusSemantic` | `colors: ThemePrimitives` | - |
| `generateFormSemantic` | `colors: ThemePrimitives` | - |
| `generateNavigationSemantic` | `colors: ThemePrimitives` | - |
| `generateTooltipSemantic` | `colors: ThemePrimitives, radii` | - |
| `generateTableSemantic` | `colors: ThemePrimitives` | - |
| `generateCardSemantic` | `colors: ThemePrimitives, radii` | - |
| `generateDividerSemantic` | `colors: ThemePrimitives` | - |
| `generateScrollbarSemantic` | `colors: ThemePrimitives` | - |
| `generateBadgeSemantic` | `colors: ThemePrimitives` | - |
| `generateAvatarSemantic` | `colors: ThemePrimitives` | - |
| `generateProgressSemantic` | `colors: ThemePrimitives` | - |
| `generateSkeletonSemantic` | `colors: ThemePrimitives` | - |
| `generateAllSemanticTokens` | `colors: ThemePrimitives, radii` | - |

## 依赖

- ../types
