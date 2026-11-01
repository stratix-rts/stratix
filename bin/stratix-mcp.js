#!/usr/bin/env node
/**
 * Stratix MCP server —— stdio 独立入口（Node 直接跑）。
 *
 * 职责：把「跑起来」这件事从 TypeScript 源码里剥出来，让 MCP client（Claude Code / OpenCode …）
 *   只需要一条命令：stratix-mcp --transport stdio。
 * 两条路径：
 *   1) 已构建（npm run build:backend）→ 直接跑 dist 产物（生产包里的常规路径）；
 *   2) 未构建 → 用 tsx 的 CJS 加载器就地跑源码（开发路径，tsx 是既有 devDependency，不新增依赖）。
 * 协议与工具语义全在 src/stratix-gateway/mcp/ 里，本文件只做入口选择。
 *
 * 禁止事项：
 *   1. 往 stdout 写任何非协议内容 —— stdout 是 MCP 协议面，混进一行日志就会把 client 的帧解析搞崩；
 *   2. 在这里写工具逻辑 —— 工具面只有一处（src/stratix-gateway/mcp/server.ts）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILT_ENTRY = path.join(ROOT, 'dist', 'stratix-gateway', 'mcp', 'bin', 'stratix-mcp.js');
const SOURCE_ENTRY = path.join(ROOT, 'src', 'stratix-gateway', 'mcp', 'bin', 'stratix-mcp.ts');

function fail(message) {
  process.stderr.write(`[stratix-mcp] ${message}\n`);
  process.exit(1);
}

function main() {
  if (fs.existsSync(BUILT_ENTRY)) {
    require(BUILT_ENTRY);
    return;
  }
  if (!fs.existsSync(SOURCE_ENTRY)) {
    fail('找不到 MCP server 入口（既无 dist 产物也无源码），请检查安装是否完整。');
    return;
  }
  try {
    // tsx 的 CJS 加载器：让 node 能直接 require .ts 源码（开发路径；tsx 是既有 devDependency）。
    require('tsx/cjs');
  } catch (err) {
    fail(
      '未找到构建产物，且 tsx 不可用（开发路径需要 tsx）。' +
        '请先执行 npm run build:backend，或安装 devDependencies。' +
        `（${err && err.message ? err.message : String(err)}）`
    );
    return;
  }
  require(SOURCE_ENTRY);
}

main();
