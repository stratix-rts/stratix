# tests/jest.setup.ts

> 语言：typescript | 代码行数：278

## 概述

/**
 * Jest setup file - Global polyfills for Node.js 16 compatibility
 *
 * Some dependencies (like LangChain) require ReadableStream which is
 * only available in Node.js 18+. This file provides a minimal polyfill.
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `ReadableStream` | 0 | - |
| `DOMParser` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `parseXML` | `xml: string` | - |
| `extractText` | `el: any, parentText: string` | - |
| `createQuerySelector` | `el: any` | - |
| `search` | `node: any` | - |
| `createQuerySelectorAll` | `el: any` | - |
| `search` | `node: any` | - |
