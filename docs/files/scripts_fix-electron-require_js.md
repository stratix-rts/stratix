# scripts/fix-electron-require.js

> 语言：javascript | 代码行数：46

## 概述

/**
 * Fix incorrect electron require in compiled JS
 * tsc-alias sometimes converts require('electron') to require('../electron')
 * which is wrong - 'electron' is an npm package, not a relative path
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `walk` | `dir` | - |
| `fixFile` | `filePath` | - |
