# src/stratix-character-creator/core/SoulTemplateRenderer.ts

> 语言：typescript | 代码行数：186

## 概述

/**
 * SoulTemplateRenderer - 角色模板渲染器
 *
 * 负责将 rawContent + soul 配置渲染为最终的 renderedPrompt
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `renderSoulTemplate` | `template: SoulTemplate, soul?:` | - |
| `buildDefaultContent` | `soul: Partial<StratixSoulConfi` | - |
| `renderWithTemplate` | `template: string, context: Rec` | - |
| `renderTemplatePrompt` | `soul: StratixSoulConfig, evolu` | - |

## 依赖

- @/stratix-core/stratix-protocol
- ../config/soulTemplates
