# src/stratix-agent/core/ZoneAgentSkills.ts

> 语言：typescript | 代码行数：420

## 概述

/**
 * ZoneAgentSkills - Agent → Zone skill functions
 *
 * These are helper functions that Agents call directly (not via SkillExecutor)
 * to communicate back to the Zone Coordinator.
 *
 * Functions:
 * - taskClaim: Agent claims a task
 * - taskProgress: Agent reports progress
 * - taskComplete: Agent completes a task
 * - taskIssue: Agent reports an issue
 * - capabilityUpdate: Agent updates its capabilities
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `taskClaim` | `agentId: string, zoneId: strin` | - |
| `taskProgress` | `agentId: string, zoneId: strin` | - |
| `taskComplete` | `agentId: string, zoneId: strin` | - |
| `taskIssue` | `agentId: string, zoneId: strin` | - |
| `capabilityUpdate` | `agentId: string, zoneId: strin` | - |

## 依赖

- ../../stratix-orchestration/zone/ZoneCoordinator
