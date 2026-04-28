# stratix-project 模块

> 分析时间：2026-04-28 21:13
> 文件数：13 | 代码行数：2883 | 文档覆盖：8%

## 概述

（待补充模块概述）

## 核心类

### `ProjectClient`

> -

### `ProjectManagerIntegration`

> -

### `ProjectManagerIntegration`

> -

### `ProjectZonePreview`

> -

### `ProjectManager`

> -

### `ProjectZone`

继承自：`BaseZone`

> -

### `ProjectStore`

> -

### `ProjectManagementExampleScene`

继承自：`Phaser`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `usePanelTransition` | `` | - |
| `useListAnimation` | `` | - |
| `generateId` | `prefix: string` | - |
| `formatDate` | `date: Date` | - |
| `parseDate` | `dateString: string` | - |
| `now` | `` | - |
| `validatePriority` | `priority: number` | - |
| `validateProgress` | `progress: number` | - |
| `validateProjectStatus` | `status: string` | - |
| `validateTaskStatus` | `status: string` | - |

## 依赖关系

### 本模块依赖

- ./core/ProjectZonePreview
- ../../stratix-rts/zones/BaseZone
- fs-extra
- ./types
- phaser
- ../types
- ./core/ProjectZone
- ../stratix-gateway/api/types/api
- ../stratix-gateway/api/client
- ./storage/ProjectStore
- ../utils/helpers
- ./core/ProjectManager
- ./utils/helpers
- ../stratix-rts/events/core/RTSEventBus
- ../storage/ProjectStore

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释