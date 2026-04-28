# stratix-rts 模块

> 分析时间：2026-04-28 21:13
> 文件数：119 | 代码行数：25817 | 文档覆盖：21%

## 概述

（待补充模块概述）

## 核心类

### `StratixRTSUIScene`

继承自：`Phaser`

> -

### `StratixRTSEventManager`

> -

### `StratixRTSGameScene`

继承自：`Phaser`

> -

### `SelectBox`

> -

### `ZoneDrawingUI`

> -

### `HelpPanel`

> -

### `ShortcutManager`

> -

### `ThemeSelectorUI`

> -

### `ShortcutBar`

> -

### `Map3DView`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `hexToNumber` | `hex: string` | - |
| `BG_COLOR` | `` | - |
| `hexToNumber` | `` | - |
| `createStratixRTS` | `config: StratixRTSConfig` | - |
| `handleContextMenu` | `` | - |
| `handleResize` | `` | - |
| `normalizeAttribute` | `value: number, maxValue: number` | - |
| `calculateDimensionRawScore` | `dimension: CombatDimension, attributes: ` | - |
| `calculateDimensionScore` | `dimension: CombatDimension, attributes: ` | - |
| `hexToNumber` | `` | - |

## 依赖关系

### 本模块依赖

- ../../events/core/RTSEventBus
- ./SpatialHashGrid
- ../constants
- ../stratix-project/ProjectManagerIntegrationHTTP
- ./ground/GroundDecorationSystem
- ./types
- ../stratix-core/StratixEventBus
- ./ZoneConnection
- ./SpatialGridDebugger
- @/stratix-core/stratix-protocol
- ../../constants
- ../history/ZoneHistory
- ./systems/CommandSystem
- ./effects/DataFlowAnimation
- @/stratix-character-creator/core/CharacterComposer

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释