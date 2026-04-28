# src/stratix-core/services/TextureManager.ts

> 语言：typescript | 代码行数：238

## 概述

/**
 * 纹理管理器 - 统一业务层
 * 
 * 职责：
 * 1. 生成雪碧图（Canvas）
 * 2. 生成头像（Thumbnail）
 * 3. 上传纹理到存储层（跨平台）
 * 4. 管理纹理缓存（LRU 策略）
 * 5. 防止并发重复上传
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `TextureManager` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `generatePromise` | `` | - |

## 依赖

- @/stratix-character-creator/constants
- @/stratix-character-creator/core/CharacterComposer
- @/stratix-core/stratix-protocol
- ./ServiceLocator
