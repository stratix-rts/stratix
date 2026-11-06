/**
 * 文件职责：**发布期特效烘焙的 CLI**（task_192 / AP-02）—— 构建期把 pixelfx 特效烘成 sprite sheet，
 *   产物落进构建产物目录（不入库），运行时只读 atlas。
 *
 * 权威定义：docs/DESIGN-asset-pipelines.md §1.1（release 烘焙）+ §1.2 约束1（确定性）。
 *
 * 跑法：
 *   npm run fx:bake                        # 烘到 dist/frontend/fx（默认构建产物目录）
 *   npm run fx:bake -- --out <dir>         # 指定产物目录
 *   npm run fx:bake -- --skins default,pixel
 *   npm run fx:bake -- --seed-variants 2   # 每个效果烘几个 seed 变体（K）
 *   npm run fx:bake -- --kinds celebrate   # 只烘部分效果（排查用）
 *   npm run fx:bake -- --verify            # 确定性自检：烘两份到临时目录，逐字节比对
 *
 * ★ 为什么不把烘焙写进 vite 插件就完事：插件那条路（vite.config.ts 的 closeBundle 钩子）
 *   只保证「构建会烘」，而**确定性是要能单独拿出来验的** —— 所以这里留一条独立可跑的
 *   `--verify`：同一输入烘两份，逐字节比对，输出证据。
 *
 * 输入：仓库根（ROOT = path.resolve(__dirname, '..')，用于定位 vendor/pixelfx 与 src/hud/theme/tokens-*.css）
 *   + 命令行参数：--out（产物目录，默认 dist/frontend/fx）、--skins（默认 default,pixel）、
 *   --seed-variants（默认 2，须为 ≥1 的整数）、--kinds（只烘部分效果）、--verify（确定性自检）。
 * 输出：产物目录下的 PNG + atlas JSON + fx-bake-manifest.json（字段口径由 fx-release-bake.ts 的
 *   buildFxBakeManifest 统一构造）+ stdout 上的逐条产物清单（皮肤 / kind / 变体 / seed / 帧数 / sha256）；
 *   退出码 0 = 烘焙或 --verify 自检通过；1 = 失败（参数非法 / 产物目录越界 / 渲染失败 / 两次烘焙不一致，
 *   都以 throw 冒泡成未捕获异常）。
 *
 * 禁止事项：
 *   1. 产物写进 assets/ —— 那是入库资产目录（烘焙器内部有闸门，见 fx-release-bake.ts）；
 *   2. manifest 里写时间戳 —— 会破坏「两次烘焙逐字节一致」。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FX_BAKE_MANIFEST_NAME,
  FX_BAKE_SEED_VARIANTS,
  FX_BAKE_SKINS,
  bakeFxRelease,
  fileSha256,
} from './lib/fx-release-bake';
import { assertSkinId } from './lib/fx-pipeline';
import type { SkinId } from '../src/core/theme/skin-registry';

/** 仓库根（脚本在 scripts/ 下）。 */
const ROOT = path.resolve(__dirname, '..');
/** 默认产物目录：vite 构建产物根下的 fx/（与运行时 fx-asset-path.ts 的相对规则对得上）。 */
const DEFAULT_OUT_DIR = path.join(ROOT, 'dist', 'frontend', 'fx');

interface CliOptions {
  readonly outDir: string;
  readonly skins: readonly SkinId[];
  readonly seedVariants: number;
  readonly kinds?: readonly string[];
  readonly verify: boolean;
}

/** 解析命令行参数。 */
function parseArgs(args: readonly string[]): CliOptions {
  const readValue = (flag: string, fallback?: string): string | undefined => {
    const index = args.indexOf(flag);
    if (index < 0) return fallback;
    return args[index + 1] ?? fallback;
  };

  const outDir = path.resolve(readValue('--out', DEFAULT_OUT_DIR) as string);
  const skinsRaw = readValue('--skins');
  const skins = (skinsRaw ?? FX_BAKE_SKINS.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (const skin of skins) assertSkinId(skin);

  const seedVariantsRaw = readValue('--seed-variants', String(FX_BAKE_SEED_VARIANTS));
  const seedVariants = Number(seedVariantsRaw);
  if (!Number.isInteger(seedVariants) || seedVariants < 1) {
    throw new Error(`[fx:bake] --seed-variants 必须是 ≥1 的整数，收到 ${seedVariantsRaw}`);
  }

  const kindsRaw = readValue('--kinds');
  const kinds = kindsRaw
    ? kindsRaw.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
    : undefined;

  return {
    outDir,
    skins: skins as readonly SkinId[],
    seedVariants,
    kinds,
    verify: args.includes('--verify'),
  };
}

/** 列出一个目录下的全部文件（相对路径 → sha256），用于确定性比对。 */
function hashTree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(path.relative(dir, full).split(path.sep).join('/'), fileSha256(full));
    }
  };
  walk(dir);
  return files;
}

/** 确定性自检：同一输入烘两份，逐字节比对（产物树 + manifest）。 */
function verifyDeterminism(options: CliOptions): void {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-fx-verify-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-fx-verify-b-'));
  try {
    console.log(`[fx:bake] 确定性自检：烘两份到 ${dirA} / ${dirB}`);
    const manifestA = bakeFxRelease({
      rootDir: ROOT,
      outDir: dirA,
      skins: options.skins,
      seedVariants: options.seedVariants,
      kinds: options.kinds,
    });
    const manifestB = bakeFxRelease({
      rootDir: ROOT,
      outDir: dirB,
      skins: options.skins,
      seedVariants: options.seedVariants,
      kinds: options.kinds,
    });

    const treeA = hashTree(dirA);
    const treeB = hashTree(dirB);
    const names = [...new Set([...treeA.keys(), ...treeB.keys()])].sort();

    let mismatched = 0;
    for (const name of names) {
      const hashA = treeA.get(name);
      const hashB = treeB.get(name);
      const same = hashA !== undefined && hashA === hashB;
      if (!same) mismatched += 1;
      console.log(
        `  ${same ? 'OK  ' : 'DIFF'} ${name}  ${(hashA ?? '-').slice(0, 16)}  ${(hashB ?? '-').slice(0, 16)}`,
      );
    }

    const manifestSame =
      fs.readFileSync(path.join(dirA, FX_BAKE_MANIFEST_NAME), 'utf8') ===
      fs.readFileSync(path.join(dirB, FX_BAKE_MANIFEST_NAME), 'utf8');
    console.log(`[fx:bake] manifest 逐字节一致：${manifestSame ? '是' : '否'}`);
    console.log(`[fx:bake] 产物条目数：${manifestA.artifacts.length}（差异 ${mismatched} 处）`);

    if (mismatched > 0 || !manifestSame) {
      throw new Error('[fx:bake] 确定性自检失败：两次烘焙产物不一致');
    }
    console.log('[fx:bake] 确定性自检通过：同输入两次烘焙，逐字节一致');
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.verify) {
    verifyDeterminism(options);
    return;
  }

  const manifest = bakeFxRelease({
    rootDir: ROOT,
    outDir: options.outDir,
    skins: options.skins,
    seedVariants: options.seedVariants,
    kinds: options.kinds,
  });

  console.log(
    `[fx:bake] 产物目录 ${path.relative(ROOT, options.outDir) || '.'}/ ` +
      `皮肤 ${options.skins.join(' / ')} / seed 变体 ${options.seedVariants} 个`,
  );
  for (const artifact of manifest.artifacts) {
    console.log(
      `  ${artifact.skin}/${artifact.kind}`.padEnd(28) +
        `${artifact.variantId.padEnd(6)}seed=${String(artifact.seed).padEnd(6)}` +
        `${String(artifact.frames).padStart(3)}帧@${artifact.fps}fps  ` +
        `${artifact.pngSha256.slice(0, 12)}  ${artifact.png}`,
    );
  }
  console.log(
    `[fx:bake] 共 ${manifest.artifacts.length} 个 atlas（PNG + atlas JSON）` +
      ` + ${FX_BAKE_MANIFEST_NAME}`,
  );
}

main();
