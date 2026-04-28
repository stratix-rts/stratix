# src/composables/useKeyboardNav.ts

> 语言：typescript | 代码行数：473

## 概述

（待补充）

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `parseShortcut` | `shortcut: string` | - |
| `matchesShortcut` | `event: KeyboardEvent, shortcut` | - |
| `normalizeKey` | `key: string, _code: string` | - |
| `getNextIndex` | `currentIndex: number, listLeng` | - |
| `getSpatialNextIndex` | `currentIndex: number, directio` | - |
| `getTabTrapNextIndex` | `currentIndex: number, focusabl` | - |
| `useKeyboardNav` | `options: KeyboardNavOptions = ` | - |
| `setListLength` | `length: number` | - |
| `navigate` | `direction: 'up' | 'down' | 'le` | - |
| `handleGlobalKeydown` | `event: KeyboardEvent` | - |
| `registerShortcut` | `shortcut: string, handler: (e:` | - |
| `unregisterShortcut` | `shortcut: string` | - |
| `enableVimMode` | `` | - |
| `disableVimMode` | `` | - |
| `setModalMode` | `enabled: boolean` | - |
| `reset` | `` | - |
| `focusElement` | `element: HTMLElement | null` | - |

## 依赖

- vue
