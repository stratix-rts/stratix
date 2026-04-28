# tests/stratix-database/helpers/mockDatabase.ts

> 语言：typescript | 代码行数：391

## 概述

/**
 * Mock Database Helper for Repository Tests
 *
 * Provides a mock database interface that mimics better-sqlite3 behavior.
 * Allows testing repository logic without a real database connection.
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `createMockDatabase` | `config: MockDatabaseConfig = {` | - |
| `createMockStatement` | `sql: string, options: {
    re` | - |
| `createMockZoneRow` | `overrides: Partial<{
  zone_id` | - |
| `createMockAgentRow` | `overrides: Partial<{
  agent_i` | - |
| `createMockProjectRow` | `overrides: Partial<{
  project` | - |
| `createMockZoneFileRow` | `overrides: Partial<{
  file_id` | - |
| `createMockZoneMemberRow` | `overrides: Partial<{
  id: str` | - |
| `createMockCapabilityRow` | `overrides: Partial<{
  id: str` | - |
| `createMockTaskFlowRow` | `overrides: Partial<{
  flow_id` | - |
| `createMockAuditLogRow` | `overrides: Partial<{
  id: str` | - |
| `createMockSkillRow` | `overrides: Partial<{
  skill_i` | - |
| `createMockLearnedSkillRow` | `overrides: Partial<{
  skill_i` | - |
