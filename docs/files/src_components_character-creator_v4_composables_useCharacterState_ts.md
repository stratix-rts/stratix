# src/components/character-creator/v4/composables/useCharacterState.ts

> 语言：typescript | 代码行数：251

## 概述

/**
 * useCharacterState - 角色状态管理（V4 Vue Composable）
 * 管理当前角色数据、isDirty 标记、已保存角色列表
 * 调用 characterStorage API 进行 CRUD 操作
 *
 * V3 对照：src/components/character-creator/v3/composables/useCharacterState.ts
 * V1 参考：src/stratix-character-creator/CharacterCreatorScene.ts saveCharacter()
 *
 * 保存流程（8 步）：
 * 1. composeCharacter → canvas
 * 2. generateThumbnail → thumbnail
 * 3. generateAndUploadTexture → texture
 * 4. updatedAt = Date.now()
 * 5. 深拷贝（剥离 Vue reactive proxy）+ 清理 apiKey
 * 6. characterStorage.save()
 * 7. isDirty = false
 * 8. loadSavedCharacters() 刷新列表
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
- @/stratix-character-creator/types
- @/stratix-character-creator/constants
- @/stratix-character-creator/core/CharacterStorage
- @/stratix-character-creator/core/CharacterComposer
- @/stratix-core/services
- @/stratix-character-creator/constants
