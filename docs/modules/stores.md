# stores 模块

> 分析时间：2026-04-28 21:12
> 文件数：4 | 代码行数：1126 | 文档覆盖：0%

## 概述

（待补充模块概述）

## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `savedCharacterToProfile` | `character: SavedCharacter` | - |
| `determineConfigStatus` | `profile: CharacterProfile | undefined, b` | - |
| `setOnAgentCreated` | `callback: (config: StratixAgentConfig, c` | - |
| `setOnAgentDeleted` | `callback: (agentId: string` | - |
| `setOnAgentUpdated` | `callback: (config: StratixAgentConfig` | - |
| `updateAgentPosition` | `agentId: string, position: { x: number; ` | - |
| `flushPositionUpdates` | `` | - |
| `loadAgents` | `` | - |
| `refreshAgents` | `` | - |
| `createAgent` | `type: 'writer' | 'dev' | 'analyst'` | - |

## 依赖关系

### 本模块依赖

- @/stratix-designer
- @/stratix-core/config/defaults
- @/stratix-gateway/api/types/api
- @/stratix-project/types
- @/stratix-gateway/api/client
- vue
- pinia
- @/stratix-character-creator/types

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释