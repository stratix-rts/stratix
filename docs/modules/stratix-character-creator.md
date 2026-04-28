# stratix-character-creator 模块

> 分析时间：2026-04-28 21:12
> 文件数：40 | 代码行数：15489 | 文档覆盖：72%

## 概述

（待补充模块概述）

## 核心类

### `CharacterCreatorScene`

继承自：`Phaser`

> -

### `AgentListPanel`

> -

### `AgentConfigPanel`

> -

### `StratixAgentConfigPanel`

> -

### `SoulEditor`

> -

### `AgentChatPanel`

> -

### `WorkflowConfigPanel`

> -

### `SkillTreeUI`

> -

### `OpenClawConnectionPanel`

> -

### `CharacterPreview`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `angleToLPCRow` | `normalizedDegrees: number` | - |
| `hexToNumber` | `hex: string` | - |
| `toCssColor` | `color: string | number` | - |
| `THEME` | `` | - |
| `closeModal` | `` | - |
| `closeModal` | `` | - |
| `createCharacterCreator` | `config: CharacterCreatorConfig` | - |
| `getModelsForProvider` | `provider: string` | - |
| `filterTemplates` | `` | - |
| `showGoalSuggestions` | `` | - |

## 依赖关系

### 本模块依赖

- @/stratix-data/agency-agents.json
- ./ui/_buttonStyles
- ../constants
- @/agent-platform/workflow/presets
- ../core/SoulTemplateRenderer
- ./types
- ./CharacterCreatorScene
- ../config/soulTemplates
- @/stratix-core/utils/MarkdownRenderer
- @/agent-platform/workflow/types
- phaser
- ../types
- ../core/PartRegistry
- @/config/custom-providers.config.json
- ./StratixAgentConfigPanel

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释