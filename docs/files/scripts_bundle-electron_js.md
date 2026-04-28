# scripts/bundle-electron.js

> 语言：javascript | 代码行数：34

## 概述

/**
 * Bundle electron main process to avoid ESM require issues.
 * Uses esbuild to bundle the compiled main.js into a single CJS file.
 */
