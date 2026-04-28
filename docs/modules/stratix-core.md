# stratix-core 模块

> 分析时间：2026-04-28 21:12
> 文件数：88 | 代码行数：14003 | 文档覆盖：74%

## 概述

（待补充模块概述）

## 核心类

### `AgentError`

继承自：`StratixError`

> -

### `DataStoreError`

继承自：`StratixError`

> -

### `UnifiedOpenClawConnectionManager`

> -

### `StratixEventBus`

> -

### `DOMOverlayManager`

> -

### `ContainerComponentBase`

继承自：`UIComponentBase`

> -

### `UIComponentBase`

> -

### `DOMComponentBase`

继承自：`UIComponentBase`

> -

### `DOMContainer`

> -

### `ThemeContext`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `cleanup` | `` | - |
| `stopPropagation` | `` | - |
| `createDOMContainer` | `scene: Phaser.Scene, config: DOMContaine` | - |
| `buildSignPayload` | `params: {
  deviceId: string;
  clientId` | - |
| `uint8ArrayToBase64Url` | `bytes: Uint8Array` | - |
| `uint8ArrayToHex` | `bytes: Uint8Array` | - |
| `hexToUint8Array` | `hex: string` | - |
| `tempHandler` | `` | - |
| `cleanup` | `` | - |
| `handler` | `` | - |

## 依赖关系

### 本模块依赖

- ./AgentExecutor
- fs-extra
- ../stratix-protocol
- ./ThemeContext
- ./types
- ../retry/types
- ./StratixIdGenerator
- @/stratix-core/retry
- ./ElectronServiceProvider
- phaser
- ./openclaw/OpenClawWebSocketConnection
- ./ServiceProvider
- ../../core/types/event.types
- ./openclaw/DeviceIdentityManager
- ../../core/types/interaction.types

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释