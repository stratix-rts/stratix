# src/components/character-creator/v4/composables/usePartSelection.ts

> 语言：typescript | 代码行数：378

## 概述

/**
 * usePartSelection - 部件选择逻辑 (V4)
 * 管理可用部件数据（按分类）、当前选中部件
 * 调用 partRegistry API 进行查询和随机选择
 * 纯状态 composable，三档随机化：精简/普通/完全
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `usePartSelection` | `character?: Ref<SavedCharacter` | - |
| `loadParts` | `` | - |
| `refreshPartsMetadata` | `` | - |
| `selectPart` | `category: PartCategory, select` | - |
| `deselectPart` | `category: PartCategory` | - |
| `setBodyType` | `newBodyType: BodyType` | - |
| `loadFromCharacter` | `parts: Record<string, PartSele` | - |
| `getRandomizationConfig` | `mode: RandomizationMode` | - |
| `getHumanHeadPart` | `` | - |
| `pickRandomVariant` | `part: PartMetadata` | - |
| `randomizeMinimal` | `` | - |
| `randomizeNormal` | `` | - |
| `randomizeFull` | `` | - |
| `randomize` | `mode: RandomizationMode = 'nor` | - |

## 依赖

- vue
- vue
- @/stratix-character-creator/core/PartRegistry
- @/stratix-character-creator/types
