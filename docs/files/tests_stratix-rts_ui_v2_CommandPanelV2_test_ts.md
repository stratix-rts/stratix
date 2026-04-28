# tests/stratix-rts/ui/v2/CommandPanelV2.test.ts

> 语言：typescript | 代码行数：250

## 概述

/**
 * CommandPanelV2 Unit Tests
 *
 * Tests business logic: state derivation, panel data updates, callbacks
 * Uses dependency injection and minimal mocking
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `deriveState` | `data: PanelData` | - |
| `mergePanelData` | `existing: PanelData, update: P` | - |
| `updateAgentInfoLogic` | `agent: AgentInfo | null` | - |
| `updateSelectedAgentsLogic` | `agents: AgentInfo[]` | - |
| `updateZoneInfoLogic` | `zone: ZoneInfo | null` | - |

## 依赖

- @/stratix-rts/ui/v2/CommandPanelV2
