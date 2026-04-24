/**
 * Bundle electron main process to avoid ESM require issues.
 * Uses esbuild to bundle the compiled main.js into a single CJS file.
 */
const { build } = require('esbuild');
const path = require('path');

const srcMain = path.join(__dirname, '..', 'dist', 'electron', 'electron', 'main.js');
const outFile = path.join(__dirname, '..', 'dist', 'electron', 'electron', 'main.cjs');

build({
  entryPoints: [srcMain],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  external: ['electron', 'electron/app', 'electron/common'],
  logLevel: 'info',
}).then(() => {
  // Replace main.js with the bundled version
  const fs = require('fs');
  const origPath = srcMain.replace('.js', '.js.bak');
  if (fs.existsSync(origPath)) {
    fs.unlinkSync(origPath);
  }
  fs.renameSync(srcMain, origPath);
  fs.copyFileSync(outFile, srcMain);
  fs.unlinkSync(outFile);
  console.log('[bundle-electron] Bundled main.js -> main.cjs');
}).catch((err) => {
  console.error('[bundle-electron] Bundle failed:', err);
  process.exit(1);
});
