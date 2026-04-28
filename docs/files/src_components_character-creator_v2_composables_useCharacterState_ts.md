# src/components/character-creator/v2/composables/useCharacterState.ts

> 语言：typescript | 代码行数：248

## 概述

/**
 * useCharacterState - 角色状态管理
 * 管理当前角色数据、isDirty标记、已保存角色列表
 * 调用 characterStorage API 进行 CRUD 操作
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `useCharacterState` | `options: UseCharacterStateOpti` | - |
| `loadSavedCharacters` | `` | - |
| `createNew` | `bodyType: BodyType = DEFAULT_B` | - |
| `loadCharacter` | `characterId: string` | - |
| `saveCharacter` | `` | - |
| `deleteCharacter` | `characterId: string` | - |
| `setDefaultCharacter` | `characterId: string` | - |
| `updateName` | `name: string` | - |
| `updateBodyType` | `bodyType: BodyType` | - |
| `updatePart` | `category: string, selection: P` | - |
| `updateThumbnail` | `thumbnail: string` | - |
| `resetCharacter` | `` | - |

## 依赖

- vue
- @/stratix-character-creator/core/CharacterStorage
- @/stratix-character-creator
- @/stratix-core/services
- @/stratix-character-creator/constants
- @/stratix-character-creator/types
- @/stratix-character-creator/constants
- @/stratix-character-creator/types
