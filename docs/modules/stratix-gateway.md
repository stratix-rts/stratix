# stratix-gateway 模块

> 分析时间：2026-04-28 21:12
> 文件数：39 | 代码行数：11866 | 文档覆盖：33%

## 概述

（待补充模块概述）

## 核心类

### `GatewayEventBus`

继承自：`EventEmitter`

> -

### `DataStoreService`

> -

### `CommandTransformer`

> -

### `SkillExecutor`

> -

### `LRAService`

> -

### `OpenClawProxyManager`

继承自：`EventEmitter`

> -

### `ServerDeviceIdentityManager`

> -

### `OpenClawConnectionManager`

> -

### `AgentOrchestrationService`

> -

### `LLMAgent`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `startGatewayService` | `options: GatewayServiceOptions = {}` | - |
| `gracefulShutdown` | `` | - |
| `buildSignPayload` | `params: {
  deviceId: string;
  clientId` | - |
| `uint8ArrayToBase64Url` | `bytes: Uint8Array` | - |
| `uint8ArrayToHex` | `bytes: Uint8Array` | - |
| `hexToUint8Array` | `hex: string` | - |
| `getApiKeysFilePath` | `` | - |
| `saveApiKey` | `providerId: string, apiKey: string` | - |
| `loadApiKey` | `providerId: string` | - |
| `deleteApiKey` | `providerId: string` | - |

## 依赖关系

### 本模块依赖

- child_process
- ../../dataStoreService
- ../../stratix-database/ProjectRepository
- ../../command-transformer/CommandTransformer
- ../../../stratix-agent/types
- ../api/apiKeyStore
- ./types
- ./types/api
- ./api/routes/command
- ./api/routes/zone-coordinator
- ../stratix-project/types
- ../../../stratix-agent/core/BuiltinSkills
- ../../../stratix-project/types
- ./agents/LLMAgent
- ../../../stratix-database/TaskFlowRepository

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释