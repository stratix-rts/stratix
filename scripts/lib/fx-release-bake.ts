/**
 * 文件职责：**发布期特效烘焙器**（task_192 / AP-02）—— 构建期把 pixelfx 特效烘成 sprite sheet，
 *   产物落进**构建产物目录**（不入库），运行时只读 atlas（不引 pixelfx 运行时代码）。
 *
 * 权威定义：docs/DESIGN-asset-pipelines.md §1.1（release 烘焙 / 参数面翻译表）+ §1.2 约束1（确定性）。
 *
 * ★ 三条硬约束怎么落地：
 *   1. 烘焙确定性（同输入必同输出）：seed **钉死**（效果自带默认 seed 记在共享层 effects 清单里，
 *      变体 seed 由固定步长派生），渲染参数（fps / 调色板 / seed）全部来自代码常量，
 *      manifest 里**不写时间戳、不写绝对路径** —— 同输入两次烘焙，产物与 manifest 逐字节一致。
 *   2. 产物不入库：产物目录由调用方给（默认 dist/frontend/fx —— 构建产物目录，已被 .gitignore 覆盖）；
 *      本层**拒绝**往 assets/（入库资产目录）里写。
 *   3. 运行时只读 atlas：烘焙器只在构建期跑，产物是 PNG + atlas JSON，
 *      运行时按 world/appearance/fx-asset-path.ts 的相对规则取图，不碰 pixelfx。
 *
 * ★ 参数面翻译表（DESIGN §1.1）—— 本批 6 个效果的实际落法：
 *   | 运行时参数 | 烘焙表达 | 本批落地 |
 *   |---|---|---|
 *   | palette | 按皮肤烘变体 | ✅ 每个皮肤一套调色板（皮肤闭集 = modern / pixel） |
 *   | flip    | GPU setFlipX（不烘） | ✅ 不烘（GPU 免费镜像） |
 *   | angle   | 离散方向桶 / 收敛镜像 | ⚠️ 本批效果**不消费 angle**（无 o.angle）→ 0 桶，标 runtime-only |
 *   | seed    | 烘 K 变体随机选 | ✅ K = 2（基础变体 + 1 个固定 seed 变体） |
 *
 * 禁止事项：
 *   1. import CharacterComposer 及其部件库 —— 两条烘焙管线禁止互卷（DESIGN §0 铁则）；
 *   2. 把产物写进 assets/ —— 那是入库资产目录（发布期产物按构造就不入库）；
 *   3. 在 manifest 里写时间戳 / 绝对路径 —— 会破坏「两次烘焙产物逐字节一致」；
 *   4. 引入 npm 依赖 —— 只用 node 内置模块 + 仓内 vendor/pixelfx。
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  EFFECT_SPECS,
  RENDER_FPS,
  assertSkinId,
  loadSkinTokens,
  readAtlasMeta,
  renderSheet,
  resolvePixelfxDir,
  resolveToken,
} from './fx-pipeline';
import { SKIN_IDS, type SkinId } from '../../src/core/theme/skin-registry';

/**
 * **发布期皮肤闭集**（DESIGN §1.1「皮肤为 build 期闭集 modern/pixel」）。
 *
 * why 是闭集而不是全部 8 套皮肤：发布产物是**烘出来的图**，每套皮肤都要一份调色板 + 一整套 sheet，
 *   体积与构建时间线性增长；而真正发布的两套长相是「现代深色」与「像素风」。
 * why 'default' 就是 modern：仓内现代深色皮肤的 id 叫 default（core/theme/skin-registry.ts），
 *   闭集语义（modern / pixel）与仓内 id（default / pixel）一一对应，注释写清楚即可，不必改皮肤 id。
 * 其余皮肤（crimson / forest / …）不在发布闭集内 —— 运行时回落到 default 的 sheet（近似色），
 *   与 task_161 的现状一致，不在 AP-02 的改动面内。
 */
export const FX_BAKE_SKINS: readonly SkinId[] = ['default', 'pixel'];

/**
 * 每个效果烘几个 seed 变体（DESIGN §1.1「seed → 烘 K 变体随机选」）。
 * why K = 2：变体 0 是**基础变体**（seed = 效果自带默认 seed），文件名与运行时索引对得上
 *   （`<kind>.png`），可直接被 sheet 路由消费；变体 1 是同效果的另一套随机分布，
 *   供运行时随机挑选（避免同一特效反复播放看起来一模一样）。
 */
export const FX_BAKE_SEED_VARIANTS = 2;

/**
 * 变体 seed 的固定步长（变体 i 的 seed = 基础 seed + i × 步长）。
 * why 要步长而不是 +1：步长足够大时不同变体的随机序列不会与别的效果的默认 seed 撞上，
 *   撞上也不影响正确性（seed 只是随机源），但拉开更利于人工比对两张图。
 */
export const FX_BAKE_SEED_STRIDE = 1000;

/** 烘焙 manifest 的文件名（落在烘焙产物目录里，供排查与后续接线用）。 */
export const FX_BAKE_MANIFEST_NAME = 'fx-bake-manifest.json';

/** manifest 结构版本（字段口径变了就 +1，消费者据此判别）。 */
export const FX_BAKE_MANIFEST_VERSION = 1;

/** 参数面翻译表（烘焙表达口径 —— 见文件头表格）。 */
export const FX_BAKE_PARAM_PLAN = {
  /** palette → 按皮肤烘变体。 */
  palette: 'bake-by-skin',
  /** flip → GPU setFlipX，不烘。 */
  flip: 'runtime-gpu',
  /** angle → 本批效果不消费，标 runtime-only（0 桶）。 */
  angle: 'runtime-only',
  /** seed → 烘 K 变体。 */
  seed: 'bake-k-variants',
} as const;

/** 一个待烘的变体（皮肤 × 效果 × seed 变体）。 */
export interface FxBakeVariantPlan {
  /** 皮肤 id。 */
  readonly skin: SkinId;
  /** 语义 kind。 */
  readonly kind: string;
  /** pixelfx 效果 id。 */
  readonly pixelfxId: string;
  /** 变体序号（0 = 基础变体）。 */
  readonly variantIndex: number;
  /** 变体标识（'base' / 's1' / …）。 */
  readonly variantId: string;
  /** 钉死的 seed。 */
  readonly seed: number;
  /** 产物文件名主干（'celebrate' / 'celebrate__s1'）。 */
  readonly fileBase: string;
}

/**
 * 变体文件名主干。
 *
 * why 基础变体不加后缀：运行时索引（src/world/appearance/fx-sources.generated.ts）指的就是
 *   `<kind>.png` —— 基础变体沿用同名，发布期产物落位后**运行时零改动**即可命中。
 * why 变体用 `__s1` 而不是 `-v1`：双下划线不会与 kind 名冲突（kind 全是驼峰字母）。
 */
export function fxBakeFileBase(kind: string, variantIndex: number): string {
  return variantIndex === 0 ? kind : `${kind}__s${variantIndex}`;
}

/** 变体标识（与文件名主干同源：`base` / `s1`）。 */
export function fxBakeVariantId(variantIndex: number): string {
  return variantIndex === 0 ? 'base' : `s${variantIndex}`;
}

/** 烘焙计划（纯函数 —— 不碰磁盘，便于单测穷举）。 */
export interface FxBakePlanOptions {
  /** 皮肤闭集（默认 FX_BAKE_SKINS）。 */
  readonly skins?: readonly SkinId[];
  /** 每个效果的 seed 变体数（默认 FX_BAKE_SEED_VARIANTS）。 */
  readonly seedVariants?: number;
  /** 只烘这些 kind（默认全部；单测用来看板裁剪）。 */
  readonly kinds?: readonly string[];
}

/**
 * 列出本次要烘的全部变体（顺序固定：皮肤 → kind → 变体 —— 顺序固定才能让 manifest 逐字节可比）。
 */
export function planFxBakeVariants(options: FxBakePlanOptions = {}): readonly FxBakeVariantPlan[] {
  const skins = options.skins ?? FX_BAKE_SKINS;
  const seedVariants = options.seedVariants ?? FX_BAKE_SEED_VARIANTS;
  if (!Number.isInteger(seedVariants) || seedVariants < 1) {
    throw new Error(`[fx:bake] seedVariants 必须是 ≥1 的整数，收到 ${seedVariants}`);
  }
  if (options.kinds) {
    for (const kind of options.kinds) {
      if (!EFFECT_SPECS.some((spec) => spec.kind === kind)) {
        throw new Error(
          `[fx:bake] 未知效果 kind ${kind}（可选：${EFFECT_SPECS.map((spec) => spec.kind).join(' / ')}）`,
        );
      }
    }
  }
  const kinds = options.kinds ? new Set(options.kinds) : null;
  const plans: FxBakeVariantPlan[] = [];
  for (const skin of skins) {
    assertSkinId(skin);
    for (const spec of EFFECT_SPECS) {
      if (kinds && !kinds.has(spec.kind)) continue;
      for (let variantIndex = 0; variantIndex < seedVariants; variantIndex += 1) {
        plans.push({
          skin,
          kind: spec.kind,
          pixelfxId: spec.pixelfxId,
          variantIndex,
          variantId: fxBakeVariantId(variantIndex),
          seed: spec.seed + variantIndex * FX_BAKE_SEED_STRIDE,
          fileBase: fxBakeFileBase(spec.kind, variantIndex),
        });
      }
    }
  }
  return plans;
}

/** 烘焙产物的一条记录（manifest 的一行）。 */
export interface FxBakeArtifact {
  /** 皮肤 id。 */
  readonly skin: string;
  /** 语义 kind。 */
  readonly kind: string;
  /** pixelfx 效果 id。 */
  readonly pixelfxId: string;
  /** 变体标识。 */
  readonly variantId: string;
  /** 变体序号。 */
  readonly variantIndex: number;
  /** 钉死的 seed。 */
  readonly seed: number;
  /** PNG 相对产物根的路径。 */
  readonly png: string;
  /** atlas JSON 相对产物根的路径。 */
  readonly json: string;
  /** PNG 的 sha256（确定性证据）。 */
  readonly pngSha256: string;
  /** atlas JSON 的 sha256。 */
  readonly jsonSha256: string;
  /** PNG 字节数。 */
  readonly pngBytes: number;
  /** atlas JSON 字节数。 */
  readonly jsonBytes: number;
  /** 本次用的调色板（色值序列）。 */
  readonly palette: readonly string[];
  /** 本次用的调色板 token 名序列（人能看懂「这张图为什么是这个色」）。 */
  readonly paletteTokens: readonly string[];
  /** 帧数。 */
  readonly frames: number;
  /** 帧率。 */
  readonly fps: number;
  /** 单帧宽。 */
  readonly frameWidth: number;
  /** 单帧高。 */
  readonly frameHeight: number;
  /** 枢轴 x。 */
  readonly pivotX: number;
  /** 枢轴 y。 */
  readonly pivotY: number;
  /** 是否循环。 */
  readonly loop: boolean;
  /** 战场显示缩放。 */
  readonly scale: number;
}

/** 烘焙 manifest（随产物落盘；**不含时间戳与绝对路径**，两次烘焙逐字节一致）。 */
export interface FxBakeManifest {
  /** manifest 结构版本。 */
  readonly bakeVersion: number;
  /** 渲染帧率。 */
  readonly fps: number;
  /** 本次烘的皮肤。 */
  readonly skins: readonly string[];
  /** 每个效果的 seed 变体数。 */
  readonly seedVariants: number;
  /** 变体 seed 步长。 */
  readonly seedStride: number;
  /** 参数面翻译表（palette / flip / angle / seed 的烘焙表达）。 */
  readonly paramPlan: typeof FX_BAKE_PARAM_PLAN;
  /** 产物清单（顺序固定）。 */
  readonly artifacts: readonly FxBakeArtifact[];
}

/** 烘焙入参。 */
export interface FxBakeOptions {
  /** 仓库根（vendor 路径、皮肤样式表都从这里找）。 */
  readonly rootDir: string;
  /** 产物目录（**构建产物目录**，如 dist/frontend/fx）。 */
  readonly outDir: string;
  /** 皮肤闭集（默认 FX_BAKE_SKINS）。 */
  readonly skins?: readonly SkinId[];
  /** seed 变体数（默认 FX_BAKE_SEED_VARIANTS）。 */
  readonly seedVariants?: number;
  /** 只烘这些 kind（默认全部）。 */
  readonly kinds?: readonly string[];
}

/** 文件内容的 sha256（十六进制）。 */
export function fileSha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * 闸门：产物目录不得落在**入库资产目录**（assets/）里。
 *
 * why：发布期烘焙的产物按构造就不入库（DESIGN §0「构建期现烘，不入库提交」）；
 *   写进 assets/ 会让构建产物污染版本库 —— 而 assets/ 正是 vite 的 publicDir，
 *   一次误写就把烘焙图带进了 git（下次提交被无声带进库里）。宁可报错，不给机会。
 */
export function assertBakeOutDir(rootDir: string, outDir: string): void {
  const assetsDir = path.resolve(rootDir, 'assets');
  const target = path.resolve(outDir);
  const relativeToAssets = path.relative(assetsDir, target);
  const insideAssets =
    relativeToAssets === '' ||
    (!relativeToAssets.startsWith('..') && !path.isAbsolute(relativeToAssets));
  if (insideAssets) {
    throw new Error(
      `[fx:bake] 产物目录不能落在入库资产目录里（${assetsDir}）—— ` +
        `发布期产物按构造不入库，请指向构建产物目录（如 dist/frontend/fx）`,
    );
  }
}

/**
 * 构造 manifest（**发布期烘焙与 dev 快照共用同一份口径** —— @since v3.3，task_211 / AP-05）。
 *
 * why 抽成共用构造器：manifest 是运行时的**唯一契约面**（src/world/appearance/fx-variants.ts
 *   按 `artifacts[]` 逐条解析）。发布期与 dev 态若各写各的字段清单，早晚会漂 ——
 *   漂的表现是「dev 好好的，release 解析不出来」这种只在发布当天现形的问题。
 *   共用一个构造器 ⇒ 字段口径只有一份，dev/release 的消费代码天然同一套。
 *
 * @param params 产物清单 / 皮肤闭集 / 变体数。
 * @returns manifest（不含时间戳与绝对路径 ⇒ 同输入同字节）。
 */
export function buildFxBakeManifest(params: {
  readonly artifacts: readonly FxBakeArtifact[];
  readonly skins: readonly string[];
  readonly seedVariants: number;
}): FxBakeManifest {
  return {
    bakeVersion: FX_BAKE_MANIFEST_VERSION,
    fps: RENDER_FPS,
    skins: [...params.skins],
    seedVariants: params.seedVariants,
    seedStride: FX_BAKE_SEED_STRIDE,
    paramPlan: FX_BAKE_PARAM_PLAN,
    artifacts: params.artifacts,
  };
}

/**
 * 烘焙一次（发布期）。
 *
 * 幂等：产物目录先清空再重写 —— 同样的输入跑两次，目录内容与文件内容逐字节相同。
 *
 * @returns 烘焙 manifest（同时落盘到 `<outDir>/fx-bake-manifest.json`）。
 */
export function bakeFxRelease(options: FxBakeOptions): FxBakeManifest {
  const rootDir = path.resolve(options.rootDir);
  const outDir = path.resolve(options.outDir);
  assertBakeOutDir(rootDir, outDir);

  const pixelfxDir = resolvePixelfxDir(rootDir);
  if (!fs.existsSync(path.join(pixelfxDir, 'tools', 'render.mjs'))) {
    throw new Error(`[fx:bake] 找不到 pixelfx 库（${pixelfxDir}）—— 用 PIXELFX_DIR 指定路径`);
  }

  const plans = planFxBakeVariants({
    skins: options.skins,
    seedVariants: options.seedVariants,
    kinds: options.kinds,
  });

  // 清掉上一轮的产物（幂等的前提）：**只清自己写过的东西** ——
  //   皮肤子目录（皮肤登记表里的 id）+ 本烘焙器的 manifest；
  //   目录里其它不认识的东西一律不碰（宁可多留一份垃圾，也不误删别人的文件）。
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(outDir)) {
    const isSkinDir = entry !== FX_BAKE_MANIFEST_NAME && SKIN_IDS.includes(entry as SkinId);
    if (!isSkinDir && entry !== FX_BAKE_MANIFEST_NAME) continue;
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-fx-bake-'));
  const artifacts: FxBakeArtifact[] = [];
  const tokensBySkin = new Map<SkinId, ReturnType<typeof loadSkinTokens>>();

  try {
    for (const plan of plans) {
      let tokens = tokensBySkin.get(plan.skin);
      if (!tokens) {
        tokens = loadSkinTokens(rootDir, plan.skin);
        tokensBySkin.set(plan.skin, tokens);
      }
      const spec = EFFECT_SPECS.find((item) => item.kind === plan.kind);
      if (!spec) throw new Error(`[fx:bake] 效果清单里没有 ${plan.kind}`);

      const palette = spec.paletteTokens.map((name) => resolveToken(tokens, name));
      const rendered = renderSheet({
        pixelfxDir,
        pixelfxId: plan.pixelfxId,
        palette,
        outDir: tmpRoot,
        fps: RENDER_FPS,
        seed: plan.seed,
      });
      const meta = readAtlasMeta(rendered.json);

      const skinDir = path.join(outDir, plan.skin);
      fs.mkdirSync(skinDir, { recursive: true });
      const pngTarget = path.join(skinDir, `${plan.fileBase}.png`);
      const jsonTarget = path.join(skinDir, `${plan.fileBase}.json`);
      fs.copyFileSync(rendered.png, pngTarget);
      fs.copyFileSync(rendered.json, jsonTarget);
      // 拷贝会带上临时目录的 600 权限；产物该是 644（打包/读取都按常规权限来）。
      fs.chmodSync(pngTarget, 0o644);
      fs.chmodSync(jsonTarget, 0o644);

      artifacts.push({
        skin: plan.skin,
        kind: plan.kind,
        pixelfxId: plan.pixelfxId,
        variantId: plan.variantId,
        variantIndex: plan.variantIndex,
        seed: plan.seed,
        png: `${plan.skin}/${plan.fileBase}.png`,
        json: `${plan.skin}/${plan.fileBase}.json`,
        pngSha256: fileSha256(pngTarget),
        jsonSha256: fileSha256(jsonTarget),
        pngBytes: fs.statSync(pngTarget).size,
        jsonBytes: fs.statSync(jsonTarget).size,
        palette,
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
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const skins = options.skins ?? FX_BAKE_SKINS;
  const manifest = buildFxBakeManifest({
    artifacts,
    skins,
    seedVariants: options.seedVariants ?? FX_BAKE_SEED_VARIANTS,
  });
  fs.writeFileSync(
    path.join(outDir, FX_BAKE_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}
