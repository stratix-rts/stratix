# src/composables/useSound.ts

> 语言：typescript | 代码行数：57

## 概述

/**
 * useSound composable
 *
 * Provides sound feedback API for Vue components.
 * Wraps the singleton SoundService with reactive settings synced to UIStore.
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `useSound` | `` | - |
| `setEnabled` | `enabled: boolean` | - |
| `setVolume` | `volume: number` | - |
| `playClick` | `` | - |
| `playTaskComplete` | `` | - |
| `playAgentStatusChange` | `` | - |
| `playWarning` | `` | - |

## 依赖

- vue
- @/services/SoundService
