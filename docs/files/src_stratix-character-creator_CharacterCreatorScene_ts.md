# src/stratix-character-creator/CharacterCreatorScene.ts

> 语言：typescript | 代码行数：1544

## 概述

/**
 * CharacterCreatorScene - Phaser 场景
 * 角色生成器模块入口场景，整合所有 UI 组件
 * 
 * Layout Design (Cyberpunk Editor Style):
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  HEADER: 角色创建器                           [体型选择] [操作按钮] │
 * ├──────────────┬─────────────────────────────────┬─────────────────┤
 * │              │                                 │                 │
 * │   PREVIEW    │                                 │   SAVED         │
 * │   PANEL      │      PART SELECTOR              │   CHARACTERS    │
 * │   (280px)    │      (Main Work Area)           │    (280px)      │
 * │              │                                 │                 │
 * │  - 动画控制   │                                 │                 │
 * │  - 缩放控制   │                                 │                 │
 * │  - 属性显示   │                                 │                 │
 * │              │                                 │                 │
 * └──────────────┴─────────────────────────────────┴─────────────────┘
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `CharacterCreatorScene` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `hexToNumber` | `hex: string` | - |
| `toCssColor` | `color: string | number` | - |
| `THEME` | `` | - |
| `closeModal` | `` | - |
| `closeModal` | `` | - |

## 依赖

- phaser
- @/design-system/config
- @/stratix-core/UnifiedOpenClawConnectionManager
- @/stratix-core/services
- ./config/skillTreeConfig
- ./constants
- ./constants
- ./core/CharacterComposer
- ./core/CharacterStorage
- ./core/EventEmitter
- ./core/PartRegistry
- ./core/SkillTree
- ./types
- ./ui
- ./ui/_buttonStyles
