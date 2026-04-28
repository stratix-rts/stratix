# components 模块

> 分析时间：2026-04-28 21:12
> 文件数：17 | 代码行数：2601 | 文档覆盖：71%

## 概述

（待补充模块概述）

## 核心类

### `ToastService`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `filterCommands` | `query: string` | - |
| `createModal` | `type: ModalType, options: ModalOptions` | - |
| `destroy` | `` | - |
| `update` | `newOptions: Partial<ModalOptions>` | - |
| `useCharacterState` | `options: UseCharacterStateOptions = {}` | - |
| `loadSavedCharacters` | `` | - |
| `createNew` | `bodyType: BodyType = DEFAULT_BODY_TYPE` | - |
| `loadCharacter` | `characterId: string` | - |
| `saveCharacter` | `` | - |
| `deleteCharacter` | `characterId: string` | - |

## 依赖关系

### 本模块依赖

- ./StratixConfirmDialog.vue
- @/stratix-character-creator/core/CharacterStorage
- @/stratix-character-creator
- @/stratix-rts/events/core/RTSEventBus
- vue
- @/stratix-character-creator/core/PartRegistry
- @/stratix-character-creator/types
- @/stratix-character-creator/core/CharacterComposer
- ./ToastItem
- @/stratix-core/services
- @/stratix-character-creator/constants

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释