# src/stores/zone.ts

> 语言：typescript | 代码行数：267

## 概述

（待补充）

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `loadZones` | `projectId?: string` | - |
| `fetchZone` | `zoneId: string` | - |
| `createZone` | `request: ZoneCreateRequest` | - |
| `updateZone` | `zoneId: string, request: ZoneU` | - |
| `deleteZone` | `zoneId: string` | - |
| `selectZone` | `zoneId: string | null` | - |
| `addFile` | `zoneId: string, file: Omit<Zon` | - |
| `removeFile` | `zoneId: string, fileId: string` | - |
| `addTask` | `zoneId: string, title: string` | - |
| `updateTask` | `zoneId: string, taskId: string` | - |
| `addMessage` | `zoneId: string, content: strin` | - |
| `getZoneById` | `zoneId: string` | - |
| `clear` | `` | - |
| `createZoneApiClient` | `` | - |

## 依赖

- pinia
- vue
- @/stratix-gateway/api/client
- @/stratix-gateway/api/types/api
- @/stratix-project/types
