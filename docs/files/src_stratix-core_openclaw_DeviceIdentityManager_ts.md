# src/stratix-core/openclaw/DeviceIdentityManager.ts

> 语言：typescript | 代码行数：347

## 概述

/**
 * DeviceIdentityManager - 设备身份管理器
 * 
 * 职责：
 * - 生成/加载 Ed25519 密钥对（与 OpenClaw 兼容）
 * - 计算 deviceId（公钥 SHA256 前16位）
 * - 签名 challenge（按 OpenClaw 格式）
 * - 存储/读取 deviceToken
 * - 管理多个连接配置
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `DeviceIdentityManager` | 0 | - |

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

- @noble/ed25519
