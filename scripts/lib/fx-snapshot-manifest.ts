/**
 * 文件职责：**仓内 fx 快照**（`assets/fx/`）→ **发布期同构的 fx 清单**（@since v3.3，task_211 / AP-05）。
 *
 * ★ 为什么需要它（dev 态 fx 清单断链的根因，实测口径）：
 *   发布期烘焙（task_192 / AP-02）的产物落在**构建产物目录**（`dist/frontend/fx/`），按构造不入库。
 *   dev 态（vite 7523）没有那份产物 ⇒ 渲染层请求 `<素材根>/fx-bake-manifest.json` 时，
 *   vite 的静态中间件找不到文件 → **SPA 兜底把它改写成 index.html**（200 text/html），
 *   Phaser 的 JSONFile 拿到 HTML 后 `JSON.parse` 抛 `Unexpected token '<'`，
 *   而 JSONFile 解析失败会**rethrow**（node_modules/phaser/src/loader/filetypes/JSONFile.js:109）。
 *   实测（Playwright 探针）：renderer 报错，且因为 rethrow 发生在 `onProcessComplete` 之前，
 *   LoaderPlugin 不推进这个文件 ⇒ **素材加载场景的 loader 永不完成 ⇒ create() 不跑**
 *   （变体清单的登记就在那一步）。所以这不是「特效没资源」，是**清单这一段管线半瘫**。
 *
 * ★ 本模块的口径：**dev 的清单 = 仓内快照的如实描述**。
 *   - 清单里有的文件**一定在磁盘上**（「清单说有、文件才在」—— 与发布期同一句话）；
 *   - 磁盘上有的 sheet **一定被列出来**（图在、atlas 不在的不列：半份产物等于没有）。
 *   - 字段口径与发布期 manifest **逐字段同构**（同一个构造器 `buildFxBakeManifest`）——
 *     于是运行时那一套消费代码（src/world/appearance/fx-variants.ts 的
 *     `spriteFxVariantsFromManifest`）**不需要知道自己在 dev 还是 release**，
 *     这正是 AP-05 要的「dev/release 共享同一消费代码（CodeFxLayer 不感知模式）」。
 *
 * ★ 为什么选「仓内快照」而不是「dev 态即时烘焙」：
 *   即时烘焙要跑一遍 pixelfx 渲染（两套皮肤 24 张 sheet，实测 24s，还要 spawn 24 个 node 进程），
 *   挂在 dev server 启动路径上等于给每次起服务加冷启动 —— 而快照是**入库的既有事实**，
 *   读盘 + 算哈希只要几十毫秒。
 *   关键前提（已实测）：快照里的 PNG 与发布期烘焙产物**逐像素相同**（六个效果全帧 0 字节差，
 *   只有 PNG 编码不同）⇒ dev 看到的画面与线上一致，不存在「两套图」的漂移。
 *   快照里目前只有**基础变体**（`<kind>.png`，task_161 的入库产物），
 *   所以 dev 的变体清单为空 ⇒ 运行时只播基础变体（与 task_161/194 的 dev 行为完全一致，
 *   不是新引入的差异）。**一旦仓内出现 `__s1` 变体 sheet，本模块会自动把它列进清单**，
 *   dev 立刻与 release 同规格（变体命名规则见 fx-release-bake.ts 的 `fxBakeFileBase`）。
 *
 * 禁止事项：
 *   1. 在清单里写时间戳 / 绝对路径 —— 清单必须可复现（同输入 → 同字节）；
 *   2. 把本模块引进运行时（src/）—— 它是 node 侧读盘的工具，运行时只读 JSON；
 *   3. 另写一份 manifest 的字段口径 —— 口径变了要改共用的 `buildFxBakeManifest`。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { SKIN_IDS, type SkinId } from '../../src/core/theme/skin-registry';
import {
  EFFECT_SPECS,
  loadSkinTokens,
  readAtlasMeta,
  resolveToken,
} from './fx-pipeline';
import {
  FX_BAKE_SEED_STRIDE,
  buildFxBakeManifest,
  fileSha256,
  fxBakeVariantId,
  type FxBakeArtifact,
  type FxBakeManifest,
} from './fx-release-bake';

/** 变体文件名后缀（`<kind>__s1` → 变体序号 1）。 */
const VARIANT_SUFFIX = /__s(\d+)$/;

/** 快照入参。 */
export interface FxSnapshotManifestOptions {
  /** 仓库根（皮肤样式表在 `src/hud/theme/` 下 —— 调色板要从那里取）。 */
  readonly rootDir: string;
  /** 快照根（缺省 `<rootDir>/assets/fx` —— vite 的 publicDir 挂站点根的 `/fx/`）。 */
  readonly assetsRoot?: string;
}

/**
 * 派生一份**发布期同构**的 manifest（字段口径见 fx-release-bake.ts 的 `FxBakeManifest`）。
 *
 * @param options 入参。
 * @returns manifest（确定性：同输入 → 同字节）。
 */
export function buildFxSnapshotManifest(options: FxSnapshotManifestOptions): FxBakeManifest {
  const rootDir = path.resolve(options.rootDir);
  const assetsRoot = path.resolve(options.assetsRoot ?? path.join(rootDir, 'assets', 'fx'));

  const artifacts: FxBakeArtifact[] = [];
  const skins: string[] = [];
  let maxVariants = 1;

  for (const skin of listSnapshotSkins(assetsRoot)) {
    const tokens = loadSkinTokens(rootDir, skin);
    const skinDir = path.join(assetsRoot, skin);
    for (const artifact of readSkinArtifacts(skin, skinDir, tokens)) {
      artifacts.push(artifact);
      if (artifact.variantIndex + 1 > maxVariants) maxVariants = artifact.variantIndex + 1;
    }
    skins.push(skin);
  }

  // 顺序固定 = 皮肤 → 效果（效果清单的顺序）→ 变体序号 —— 与发布期烘焙同一套排序口径，
  //   manifest 才可逐条比对（顺序不固定 = 每次 diff 都像改过）。
  const skinOrder = new Map<string, number>(skins.map((skin, index) => [skin, index]));
  const kindOrder = new Map<string, number>(EFFECT_SPECS.map((spec, index) => [spec.kind, index]));
  artifacts.sort((a, b) => {
    const bySkin = (skinOrder.get(a.skin) ?? 0) - (skinOrder.get(b.skin) ?? 0);
    if (bySkin !== 0) return bySkin;
    const byKind = (kindOrder.get(a.kind) ?? 0) - (kindOrder.get(b.kind) ?? 0);
    if (byKind !== 0) return byKind;
    return a.variantIndex - b.variantIndex;
  });

  return buildFxBakeManifest({ artifacts, skins, seedVariants: maxVariants });
}

/**
 * 快照指纹（文件清单 + mtime + 字节数）—— 用来判断缓存的清单是否过期。
 *
 * why 要它：dev server 起来之后用户可能重跑 `npm run fx:generate`（换了图）——
 *   清单必须跟着变，而重算一次清单要读全部 PNG 算哈希（几十毫秒）。指纹便宜得多。
 *
 * @param assetsRoot 快照根。
 */
export function fxSnapshotFingerprint(assetsRoot: string): string {
  const parts: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      try {
        const stat = fs.statSync(full);
        parts.push(`${rel}:${stat.mtimeMs}:${stat.size}`);
      } catch {
        parts.push(`${rel}:missing`);
      }
    }
  };
  walk(path.resolve(assetsRoot), '');
  return parts.join('|');
}

/**
 * 列出快照里的皮肤目录（只认**皮肤登记表**里的 id）。
 *
 * why 过滤：目录名拼错时不该把整个 dev server 带崩（loadSkinTokens 会找不到样式表）——
 *   认不出的目录直接不认，清单里也就不可能有它。
 */
function listSnapshotSkins(assetsRoot: string): readonly SkinId[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(assetsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name): name is SkinId => (SKIN_IDS as readonly string[]).includes(name))
    .sort();
}

/**
 * 读一个皮肤目录下的全部 sheet 产物（图 + atlas 都在才算一份产物）。
 *
 * @param skin 皮肤 id。
 * @param skinDir 皮肤目录（绝对路径）。
 * @param tokens 皮肤 token 表（取调色板用 —— 与发布期同一套取色口径）。
 */
function readSkinArtifacts(
  skin: SkinId,
  skinDir: string,
  tokens: ReturnType<typeof loadSkinTokens>,
): readonly FxBakeArtifact[] {
  const artifacts: FxBakeArtifact[] = [];
  const files = fs
    .readdirSync(skinDir)
    .filter((name) => name.endsWith('.png'))
    .sort();

  for (const pngName of files) {
    const fileBase = pngName.slice(0, -'.png'.length);
    const jsonName = `${fileBase}.json`;
    const jsonPath = path.join(skinDir, jsonName);
    const pngPath = path.join(skinDir, pngName);
    // 图在、atlas 不在 = 半份产物 —— 不列（Phaser 的 load.atlas 要两个都要）。
    if (!fs.existsSync(jsonPath) || !fs.existsSync(pngPath)) continue;

    const parsed = parseVariantFileBase(fileBase);
    if (!parsed) continue;
    const spec = EFFECT_SPECS.find((item) => item.kind === parsed.kind);
    // 效果清单里没有的 kind 不列：清单是给运行时消费的，运行时只认那六个 kind。
    if (!spec) continue;

    const meta = readAtlasMeta(jsonPath);
    artifacts.push({
      skin,
      kind: spec.kind,
      pixelfxId: spec.pixelfxId,
      variantId: fxBakeVariantId(parsed.variantIndex),
      variantIndex: parsed.variantIndex,
      // seed 口径与发布期一致：变体 i 的 seed = 基础 seed + i × 固定步长。
      seed: spec.seed + parsed.variantIndex * FX_BAKE_SEED_STRIDE,
      png: `${skin}/${pngName}`,
      json: `${skin}/${jsonName}`,
      pngSha256: fileSha256(pngPath),
      jsonSha256: fileSha256(jsonPath),
      pngBytes: fs.statSync(pngPath).size,
      jsonBytes: fs.statSync(jsonPath).size,
      palette: spec.paletteTokens.map((name) => resolveToken(tokens, name)),
      paletteTokens: spec.paletteTokens,
      frames: meta.frames,
      fps: meta.fps,
      frameWidth: meta.frameSize[0],
      frameHeight: meta.frameSize[1],
      pivotX: meta.pivot[0],
      pivotY: meta.pivot[1],
      loop: meta.loop,
      scale: spec.scale,
    });
  }
  return artifacts;
}

/**
 * 解析产物文件名主干 → （kind, 变体序号）。
 *
 * why 变体序号从**文件名**来而不是从目录里猜：文件名就是发布期烘焙器的落位口径
 *   （`fxBakeFileBase`）—— 快照里出现什么名字，清单里就写什么名字，两边不会错位。
 */
function parseVariantFileBase(fileBase: string): { kind: string; variantIndex: number } | null {
  const match = VARIANT_SUFFIX.exec(fileBase);
  if (!match) return { kind: fileBase, variantIndex: 0 };
  const variantIndex = Number(match[1]);
  if (!Number.isInteger(variantIndex) || variantIndex < 1) return null;
  return { kind: fileBase.slice(0, match.index), variantIndex };
}
