# tests/stratix-database/helpers/TestDatabase.ts

> 语言：typescript | 代码行数：530

## 概述

/**
 * Test Database Helper
 *
 * Creates an in-memory SQLite database for unit testing.
 * Uses better-sqlite3 which supports in-memory databases with ':memory:'.
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `createTestDatabase` | `` | - |
| `createMockDatabaseWrapper` | `db: Database.Database` | - |
| `getSharedTestDatabase` | `` | - |
| `resetSharedTestDatabase` | `` | - |
| `closeSharedTestDatabase` | `` | - |

## 依赖

- better-sqlite3
- path
