# src/stratix-agent/core/HandlebarsPromptEngine.ts

> 语言：typescript | 代码行数：261

## 概述

/**
 * HandlebarsPromptEngine - 基于 Handlebars 的提示词模板引擎
 *
 * 支持 Jinja2 风格的模板语法：
 * - {{variable}} 变量插值
 * - {{#if}} / {{else}} / {{/if}} 条件
 * - {{#each}} / {{/each}} 循环
 * - {{> partial_name}} 模板复用
 * - {{{unescaped}}} 不转义输出
 *
 * 目录结构：
 * templates/
 *   partials/
 *     meta/header.hbs, footer.hbs
 *     layers/layer1-role.hbs, layer2-mission.hbs, ...
 *   helpers/index.ts
 *   layouts/full-prompt.hbs
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `HandlebarsPromptEngine` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `getHandlebarsEngine` | `` | - |

## 依赖

- fs
- path
- handlebars
- ../templates/helpers
