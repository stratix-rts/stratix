# src/stratix-gateway/openclaw/ServerDeviceIdentityManager.ts

> 语言：typescript | 代码行数：169

## 概述

/**
 * ServerDeviceIdentityManager - 服务端设备身份管理器
 * 
 * 功能与 DeviceIdentityManager 相同，但使用 Node.js API：
 * - 使用 node:crypto 替代 crypto.subtle
 * - 使用文件存储替代 localStorage
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `ServerDeviceIdentityManager` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `buildSignPayload` | `params: {
  deviceId: string;
` | - |
| `uint8ArrayToBase64Url` | `bytes: Uint8Array` | - |
| `uint8ArrayToHex` | `bytes: Uint8Array` | - |
| `hexToUint8Array` | `hex: string` | - |

## 依赖

- crypto
- path
- @noble/ed25519
- fs-extra
