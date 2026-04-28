# src/components/character-creator/v3/composables/usePartSelection.ts

> 语言：typescript | 代码行数：417

## 概述

/**
 * usePartSelection - 部件选择逻辑 (V3)
 * 管理可用部件数据（按分类）、当前选中部件
 * 调用 partRegistry API 进行查询和随机选择
 * 接口与 V2 完全一致
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `usePartSelection` | `character?: Ref<SavedCharacter` | - |
| `loadParts` | `` | - |
| `refreshAvailableParts` | `` | - |
| `getPartsByCategory` | `category: PartCategory` | - |
| `isPartSelected` | `category: PartCategory, itemId` | - |
| `getSelectedPart` | `category: PartCategory` | - |
| `selectPart` | `category: PartCategory, itemId` | - |
| `deselectPart` | `category: PartCategory` | - |
| `clearAllSelections` | `` | - |
| `getRandomizationConfig` | `mode: RandomizationMode` | - |
| `getHumanHeadPart` | `` | - |
| `randomizeMinimal` | `` | - |
| `randomizeNormal` | `` | - |
| `randomizeFull` | `` | - |
| `randomize` | `` | - |
| `setBodyType` | `newBodyType: BodyType` | - |
| `loadFromCharacter` | `parts: Record<string, PartSele` | - |
| `getVariantsForPart` | `itemId: string` | - |
| `getPartName` | `itemId: string` | - |

## 依赖

- vue
- vue
- @/stratix-character-creator/core/PartRegistry
- @/stratix-character-creator/types
