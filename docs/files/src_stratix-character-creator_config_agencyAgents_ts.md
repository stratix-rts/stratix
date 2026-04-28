# src/stratix-character-creator/config/agencyAgents.ts

> 语言：typescript | 代码行数：186

## 概述

/**
 * Agency Agents 模板配置
 *
 * 懒加载实现：
 * - 默认只导出元数据（无 rawContent）
 * - 完整内容按需加载（用户点击时才加载）
 * - 使用 Promise 缓存已加载的模板内容
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getLightweightAgencyTemplates` | `` | - |
| `getLightweightAgencyTemplatesByDomain` | `` | - |
| `loadAgencyTemplate` | `id: string` | - |
| `preloadAgencyTemplates` | `ids: string[]` | - |
| `clearAgencyTemplateCache` | `` | - |
| `getDomainDisplayName` | `domain: string` | - |

## 依赖

- @/stratix-data/agency-agents.json
- ./soulTemplates
