# src/stores/agent.ts

> 语言：typescript | 代码行数：562

## 概述

（待补充）

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `savedCharacterToProfile` | `character: SavedCharacter` | - |
| `determineConfigStatus` | `profile: CharacterProfile | un` | - |
| `setOnAgentCreated` | `callback: (config: StratixAgen` | - |
| `setOnAgentDeleted` | `callback: (agentId: string` | - |
| `setOnAgentUpdated` | `callback: (config: StratixAgen` | - |
| `updateAgentPosition` | `agentId: string, position: { x` | - |
| `flushPositionUpdates` | `` | - |
| `loadAgents` | `` | - |
| `refreshAgents` | `` | - |
| `createAgent` | `type: 'writer' | 'dev' | 'anal` | - |
| `createAgentFromCharacter` | `character: SavedCharacter, opt` | - |
| `testBackendConnection` | `backendType: AgentBackendType,` | - |
| `updateAgentProfile` | `agentId: string, character: Sa` | - |
| `updateAgentConfig` | `agentId: string, updates: Part` | - |
| `markAgentReady` | `agentId: string` | - |
| `markAgentDraft` | `agentId: string` | - |
| `deleteAgent` | `agentId: string` | - |
| `selectAgent` | `agentId: string` | - |
| `deselectAgent` | `agentId: string` | - |
| `setSelectedIds` | `ids: string[]` | - |

## 依赖

- pinia
- vue
- @/stratix-character-creator/types
- @/stratix-core/config/defaults
- @/stratix-designer
