/**
 * 文件职责：**PERF-01 冷启动基线的「生产产物」构建**（@since v3.3，task_230 / PERF-01）。
 *
 * ============ 这一单要什么 ============
 *   渲染侧基线如果只在 **vite dev server** 上量，量到的大头是「dev 的模块图逐个拉取」
 *   （273 个模块 = 273 次往返 + 逐个转译）⇒ **不是用户拿到的形态**。
 *   本文件把**同一套源码**打成**生产产物**（rollup 单 bundle），
 *   让基线能回答：「用户实际下载/执行的那份代码，冷启动要多久」。
 *
 * ============ 与仓库构建配置的关系（零产品改动）============
 *   - 复用**仓库那份 vite.config.ts**（插件 / 别名 / define / publicDir 全部照搬）⇒ 只换两处：
 *       ① `build.outDir` → `dist/perf-frontend`（不动仓库的 `dist/frontend`）；
 *       ② 追加**场景 create 打点器**（scene-marks.ts，与 dev server 同一份 ⇒ 口径一致）。
 *   - 仓库里的 `vite.config.ts` **一个字节都没改**。
 *
 * ============ fx 素材怎么办 ============
 *   优先用**发布期烘焙**的产物（仓库那个 fxReleaseBakePlugin 在 closeBundle 写进产物根）
 *   ⇒ 与用户拿到的形态一致；
 *   只有烘焙被跳过（`STRATIX_SKIP_FX_BAKE=1`）时，才退回**仓内快照**（assets/fx/，task_161）
 *   并现场生成**与发布期同构**的清单（同一构造器 `buildFxSnapshotManifest`
 *   ⇒ 运行时那套消费代码不感知 dev/release）。
 *
 * 输入：环境变量 ——
 *   SX_PERF_OUT_DIR   产物目录（缺省 `dist/perf-frontend`，相对仓库根）。
 * 输出：stdout 一行 `SX_PERF_BUILD_READY {json}`；失败 ⇒ 非零退出码。
 * 禁止事项：
 *   1. 改仓库的 vite.config.ts —— 生产配置一个字都不动；
 *   2. 往 `dist/frontend/` 写 —— 那是用户实例的产物目录，本单只写自己的 `dist/perf-frontend/`。
 *
 * @since v3.3，task_230。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { build, mergeConfig, type UserConfig } from 'vite';

import { buildFxSnapshotManifest } from '../../scripts/lib/fx-snapshot-manifest';
import baseConfig from '../../vite.config';
import { FX_DIR_NAME } from '../../src/world/appearance/fx-asset-path';
import { perfSceneMarksPlugin } from './scene-marks';

/** 仓库根（本文件在 e2e-tests/perf-baseline/ 下 ⇒ 上溯两级）。 */
const REPO_ROOT = path.resolve(__dirname, '../..');

const OUT_DIR = process.env.SX_PERF_OUT_DIR ?? 'dist/perf-frontend';

/** 仓库那份配置是 `defineConfig(async (env) => ...)` ⇒ 它是个函数，要自己调一次。 */
async function resolveBaseConfig(): Promise<UserConfig> {
  if (typeof baseConfig === 'function') {
    return (await (baseConfig as (env: unknown) => UserConfig | Promise<UserConfig>)({
      command: 'build',
      mode: 'production',
      isSsrBuild: false,
      isPreview: false,
    })) as UserConfig;
  }
  return baseConfig as UserConfig;
}

/**
 * 保证产物根里有可用的 fx 素材 + 清单。
 *
 * 优先用**发布期烘焙**的产物（`dist/perf-frontend/fx/`，由仓库那个 fxReleaseBakePlugin 在
 *   closeBundle 写出来）⇒ 与用户拿到的形态一致；
 * 只有在烘焙被跳过（`STRATIX_SKIP_FX_BAKE=1`）时，才退回**仓内快照**
 *   （assets/fx/，task_161）并现场生成**与发布期同构**的清单（同一构造器
 *   `buildFxSnapshotManifest` ⇒ 运行时那套消费代码不感知 dev/release）。
 */
function ensureFxAssets(outDirAbs: string): { mode: string; files: number; manifest: string } {
  const fxOut = path.join(outDirAbs, FX_DIR_NAME);
  const manifestPath = path.join(fxOut, 'fx-bake-manifest.json');

  const countFiles = (): number =>
    fs
      .readdirSync(fxOut, { recursive: true })
      .filter((entry) => fs.statSync(path.join(fxOut, String(entry))).isFile()).length;

  if (fs.existsSync(manifestPath)) {
    // 发布期烘焙的产物已在（清单 + atlas 都在）⇒ 原样保留，不覆盖。
    return {
      mode: 'release-bake',
      files: countFiles(),
      manifest: path.relative(REPO_ROOT, manifestPath),
    };
  }

  const assetsRoot = path.join(REPO_ROOT, 'assets', FX_DIR_NAME);
  fs.rmSync(fxOut, { recursive: true, force: true });
  fs.mkdirSync(fxOut, { recursive: true });
  fs.cpSync(assetsRoot, fxOut, { recursive: true });

  const manifest = buildFxSnapshotManifest({ rootDir: REPO_ROOT, assetsRoot });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    mode: 'snapshot',
    files: countFiles(),
    manifest: path.relative(REPO_ROOT, manifestPath),
  };
}

async function main(): Promise<void> {
  const base = await resolveBaseConfig();

  const overrides: UserConfig = {
    build: {
      // 产物落自己的目录 ⇒ 绝不碰用户实例的 dist/frontend。
      outDir: OUT_DIR,
      emptyOutDir: true,
      // sourcemap 关掉：它**运行时零成本**（浏览器不加载），
      //   但会把构建时间和产物体积翻倍 —— 本单不量构建，只量运行。
      sourcemap: false,
    },
  };

  const merged = mergeConfig(base, overrides);
  await build({
    ...merged,
    // 配置已由本文件装配好 ⇒ 不让 vite 再去读一遍仓库那份。
    configFile: false,
    // ★ 仓库那份配置的插件**必须原样带上**（vue / sfx 供给 / fx 烘焙 …），
    //   再**追加**一个打点器（不替换任何一个）。
    plugins: [...(merged.plugins ?? []), perfSceneMarksPlugin()],
  });

  const outDirAbs = path.resolve(REPO_ROOT, OUT_DIR);
  const fx = ensureFxAssets(outDirAbs);

  console.log(
    `SX_PERF_BUILD_READY ${JSON.stringify({
      outDir: OUT_DIR,
      fxMode: fx.mode,
      fxFiles: fx.files,
      manifest: fx.manifest,
    })}`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[perf-build] 构建失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
