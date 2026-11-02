/**
 * Bundle electron main process to avoid ESM require issues.
 * Uses esbuild to bundle the compiled main.js into a single CJS file.
 *
 * @since task_099：bundle 之后补跑一次 fix-electron-require（幂等遍历）+ 残留校验。
 *   why：tsc-alias 会把 `require('electron')` 改写成相对路径（`require('../electron')` /
 *   `require('../../electron')`），修器原本只在 bundle **前**跑一遍 ——
 *   而 esbuild 会把整条依赖图内联进 main.js，任何一条漏网的相对路径 electron require
 *   都会被带进产物，Electron 启动时直接报 `Cannot find module '../../electron'`
 *   （2026-11-02 12:43 构建事故）。故 bundle 落地后再修一次并校验残留，
 *   让「产物本身干净」成为硬约束，而不依赖上游某一次修复是否跑到了。
 */
const { build } = require('esbuild');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const srcMain = path.join(__dirname, '..', 'dist', 'electron', 'electron', 'main.js');
const outFile = path.join(__dirname, '..', 'dist', 'electron', 'electron', 'main.cjs');
const fixScript = path.join(__dirname, 'fix-electron-require.js');

/** 相对路径的 electron require（tsc-alias 的错误改写产物）。 */
const RELATIVE_ELECTRON_REQUIRE = /require\((['"])(?:\.\.\/)+electron\1\)/g;

/**
 * 跑修复器（幂等：重复执行结果一致，无命中则零改动）。
 * @param {boolean} [bestEffort] - true 时不抛异常（失败路径用：产物仍要尽力修干净）
 */
function fixElectronRequires(bestEffort = false) {
  try {
    execFileSync(process.execPath, [fixScript], { stdio: 'inherit' });
  } catch (err) {
    if (!bestEffort) throw err;
    console.error('[bundle-electron] 修复 electron require 失败：', err?.message ?? err);
  }
}

/**
 * 残留校验：产物里不允许再有相对路径的 electron require —— 有就直接让构建失败，
 * 免得问题拖到 Electron 启动时才炸（事故当时的报错就来自运行时）。
 * @param {string} filePath - 产物路径
 */
function assertNoRelativeElectronRequire(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  const hits = content.match(RELATIVE_ELECTRON_REQUIRE);
  if (hits) {
    throw new Error(
      `bundle 产物仍残留 ${hits.length} 处相对路径 electron require：${[...new Set(hits)].join(', ')}`
    );
  }
}

build({
  entryPoints: [srcMain],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  external: ['electron', 'electron/app', 'electron/common', 'sql.js/dist/sql-wasm.wasm'],
  logLevel: 'info',
}).then(() => {
  // Replace main.js with the bundled version
  const origPath = srcMain.replace('.js', '.js.bak');
  if (fs.existsSync(origPath)) {
    fs.unlinkSync(origPath);
  }
  fs.renameSync(srcMain, origPath);
  fs.copyFileSync(outFile, srcMain);
  fs.unlinkSync(outFile);
  // bundle 产物落地后再修一次 —— 内联进来的相对路径 electron require 只有这里能兜住
  fixElectronRequires();
  assertNoRelativeElectronRequire(srcMain);
  console.log('[bundle-electron] Bundled main.js -> main.cjs');
}).catch((err) => {
  // bundle 失败时 srcMain 还是 tsc-alias 的产物（带着相对路径 electron require）——
  //   顺手修一次，免得失败后残留的 main.js 把 Electron 启动带崩。
  fixElectronRequires(true);
  console.error('[bundle-electron] Bundle failed:', err);
  process.exit(1);
});
