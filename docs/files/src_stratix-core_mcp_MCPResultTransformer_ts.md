# src/stratix-core/mcp/MCPResultTransformer.ts

> 语言：typescript | 代码行数：317

## 概述

/**
 * MCPResultTransformer - Prevent large results from blowing up context
 *
 * Responsibilities:
 * - Text blocks: truncate if > 10000 chars
 * - Images: resize if > 2MB
 * - Binary: save to temp file, return file reference
 * - Overall result: cap at 50KB total
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `MCPResultTransformer` | 0 | - |

## 依赖

- fs
- os
- path
