/**
 * 文件职责：**双路由像素一致性测试**（task_193 / AP-03）——
 *   同一效果的「**代码路由现算帧**」（运行时逐像素算出来的 ImageData）
 *   vs「**烘焙帧**」（构建期烘出的 sprite sheet 里的那一帧）逐像素对比。
 *
 * 权威定义：docs/DESIGN-asset-pipelines.md §1.2 约束2
 *   「同一效果 code-route 现算帧 vs 烘焙帧，采样 t 点逐像素 diff（容差内），进 CI。
 *     漂移当场报警，烘焙资产不提交入库。」
 *
 * ★ 这条测试守的是什么：
 *   运行时只读 atlas（DESIGN §0），dev 期走代码路由 —— 两条路由画的是同一个效果，
 *   用户看到的必须一模一样。否则线上是烘的图、dev 是现算的图，同一个特效两种长相，
 *   而这种漂移肉眼不盯着看根本发现不了（CI 里也就没人拦得住）。
 *
 * ★ 为什么两条路由能对上（读代码时容易搞混的三个点）：
 *   ① **帧原点**：pixelfx 的 createFrame(w, h, ox, oy) 里 ox/oy 是「画布左上角在 world
 *      里的位置」，**不是**效果原点；效果原点由 createFx 的 x/y 决定。烘焙链用的是
 *      createFrame(w, h, 0, 0)（tools/lib/fxlib.mjs 的 renderFrames），代码路由必须一致
 *      （src/app/fx/fx-code-pixelfx.ts 已对齐），否则效果会被画到画布角上并被裁掉大半。
 *   ② **步进**：烘焙链按固定步长推进仿真（inst.update(1 / fps)），代码路由按同样的步长推
 *      （handle.update(1000 / fps) → fx.update(1 / fps)）—— 两边必须落在同一时间点上。
 *   ③ **色彩空间**：烘焙产物落 PNG 时走 canvas.paste，那一步把 RGB 按 alpha **预乘**了；
 *      代码路由的 composite 输出的是**直 alpha**。不统一到同一空间，半透明像素会整片误判。
 *
 * ★ 容差为什么这么定（选可判定的逐通道判据，不用感知哈希）：
 *   - **逐通道而不是感知哈希**：感知哈希只给「像不像」的二元结论，阈值任意、不可解释，
 *     报警时说不出「哪一格偏了多少」；逐通道能直接报出「哪个通道偏了几级、在哪个像素」。
 *   - **主体区容差 0**：两条路由在主体区**逐字节相等**（全帧扫描实测：hit-spark 11 帧 +
 *     heal-aoe 59 帧，RGB 与 alpha 的最大偏差都是 0）。容差取 0 = 「任何一像素偏一级就报警」，
 *     这正是「漂移当场报警」要的口径（反证用例就靠它）。
 *   - **边带（画布四边 8px）容差 32**：烘焙链会跑一遍上游的 edgeFade（把贴着画布边的辉光
 *     渐隐，免得贴进场景时露出方框），代码路由没有这一步 —— 这是**已知且有界**的差异
 *     （全帧扫描实测上限：hit-spark 8、heal-aoe 27），给它 32 的容差（留 5 级余量）；
 *     超出即视为真实漂移，照样报警。
 *
 * 禁止事项：
 *   1. 拿 mock 图 / mock 渲染结果当对比对象 —— 必须是真烘焙产物 + 真现算帧；
 *   2. 为了让测试变绿而放宽容差 —— 容差变了要在本文件里写清理由；
 *   3. 改 CharacterComposer（两条烘焙管线禁止互卷，DESIGN §0 铁则）。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as healAoe from 'pixelfx/fx/holy/heal-aoe';
import * as hitSpark from 'pixelfx/fx/impacts/hit-spark';

import { toCodeFxSource, type PixelfxEffectModule } from '../../src/app/fx/fx-code-pixelfx';
import {
  EFFECT_SPECS,
  RENDER_FPS,
  loadSkinTokens,
  renderSheet,
  resolvePixelfxDir,
  resolveToken,
} from '../../scripts/lib/fx-pipeline';
import { decodePng, type DecodedPng } from './png-decode';

/** 仓库根（测试在 tests/asset-pipeline/ 下）。 */
const ROOT = path.resolve(__dirname, '..', '..');

/** 采样点（任务建议）：t = 0% / 25% / 50% / 75% / 100%。 */
const SAMPLE_RATIOS = [0, 0.25, 0.5, 0.75, 1] as const;

/** 主体区（去掉边带）的逐通道容差：0 —— 两条路由必须逐字节相等。 */
const CORE_TOLERANCE = 0;

/** 边带（画布四边）的逐通道容差：32 —— 覆盖上游 edgeFade 的辉光渐隐差（全帧实测上限 27）。 */
const EDGE_TOLERANCE = 32;

/** 边带宽度：上游 edgeFade 的 E = 8（vendor/pixelfx/tools/lib/fxlib.mjs）。 */
const EDGE_BAND_PX = 8;

/** 参与对比的两个效果（任务要求至少两个：hit-spark + heal-aoe）。 */
interface EffectCase {
  /** pixelfx 效果 id。 */
  readonly id: string;
  /** 仓内发布清单里的 kind（不在清单里则 null —— 用效果自带调色板与 seed）。 */
  readonly kind: string | null;
  /** 效果模块（真实 vendor 源码，不是 mock）。 */
  readonly module: PixelfxEffectModule;
}

const CASES: readonly EffectCase[] = [
  {
    id: 'impacts/hit-spark',
    kind: null,
    module: hitSpark as unknown as PixelfxEffectModule,
  },
  {
    id: 'holy/heal-aoe',
    kind: 'levelUp',
    module: healAoe as unknown as PixelfxEffectModule,
  },
];

/** atlas JSON 里的一帧（vendor/pixelfx 的 spriteSheet 产出）。 */
interface AtlasFrame {
  readonly frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

interface AtlasJson {
  readonly frames: readonly AtlasFrame[];
}

/** 一处不一致（哪个像素、哪个通道、偏了多少）。 */
interface Mismatch {
  readonly x: number;
  readonly y: number;
  readonly channel: 'r' | 'g' | 'b' | 'a';
  readonly codeValue: number;
  readonly bakedValue: number;
  readonly delta: number;
  readonly region: 'core' | 'edge';
}

/** 一帧的对比结果。 */
interface Comparison {
  /** 主体区的不一致（超过 CORE_TOLERANCE 的）。 */
  readonly core: readonly Mismatch[];
  /** 边带的不一致（超过 EDGE_TOLERANCE 的）。 */
  readonly edge: readonly Mismatch[];
  /** 主体区实测最大偏差（不论是否超容差）。 */
  readonly maxCoreDelta: number;
  /** 边带实测最大偏差。 */
  readonly maxEdgeDelta: number;
}

/** 一条路由的输入（两条路由必须拿到**同一份**输入，否则对比没有意义）。 */
interface RouteInputs {
  readonly palette: readonly string[];
  readonly seed: number;
}

/** 一个效果的烘焙产物（真烘焙：跑的是仓内共享层的 renderSheet → vendor 的渲染 CLI）。 */
interface BakedArtifact {
  readonly sheet: DecodedPng;
  readonly frames: readonly AtlasFrame[];
  readonly outDir: string;
}

/**
 * 取两条路由共同的输入（调色板 + seed）。
 *
 * why 在发布清单里的效果用**清单口径**（皮肤 token 解析出的调色板 + 钉死的 seed）：
 *   那正是发布期烘焙用的输入 —— 对比的就是发布产物本身。
 * why 不在清单里的效果（hit-spark：方向性打击特效，方向/翻转要运行时算，sheet 路由给不了）
 *   用效果自带的默认 ramp 与 seed：那也是这个效果在本仓里的真实输入，不是编出来的假数据。
 */
function resolveRouteInputs(effect: EffectCase): RouteInputs {
  const spec = effect.kind ? EFFECT_SPECS.find((item) => item.kind === effect.kind) : undefined;
  if (spec) {
    const tokens = loadSkinTokens(ROOT, 'default');
    return {
      palette: spec.paletteTokens.map((name) => resolveToken(tokens, name)),
      seed: spec.seed,
    };
  }
  const options = (effect.module.meta as unknown as {
    options?: { palette?: string[]; seed?: number };
  }).options ?? {};
  return { palette: options.palette ?? [], seed: options.seed ?? 0 };
}

/** 真烘焙一次（跑仓内共享层 renderSheet → vendor/pixelfx 的渲染 CLI → PNG + atlas JSON）。 */
function bakeEffect(effect: EffectCase, inputs: RouteInputs): BakedArtifact {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-fx-dual-'));
  const rendered = renderSheet({
    pixelfxDir: resolvePixelfxDir(ROOT),
    pixelfxId: effect.id,
    palette: inputs.palette,
    outDir,
    fps: RENDER_FPS,
    seed: inputs.seed,
  });
  const atlas = JSON.parse(fs.readFileSync(rendered.json, 'utf8')) as AtlasJson;
  return { sheet: decodePng(fs.readFileSync(rendered.png)), frames: atlas.frames, outDir };
}

/**
 * 代码路由：把效果推进到第 index 帧并渲染进 RGBA 缓冲（走**仓内真实适配器**）。
 *
 * why 用适配器（toCodeFxSource）而不是自己调 pixelfx：适配器就是线上代码路由的入口，
 *   自己复刻一遍等于测「我抄的那份代码」，抄错了测试照样绿。
 */
function renderCodeFrame(
  effect: EffectCase,
  inputs: RouteInputs,
  frameIndex: number,
): Uint8ClampedArray {
  const source = toCodeFxSource(effect.module, {
    kind: effect.kind ?? effect.id,
    scale: 1,
    // 调色板由调用方直接给（paletteRoles 是 CodeFxLayer 的槽位口径，本测试不走那一层）。
    paletteRoles: [],
  });
  const handle = source.create({
    palette: inputs.palette,
    seed: inputs.seed,
    flip: false,
    angle: 0,
  });
  const rgba = new Uint8ClampedArray(source.width * source.height * 4);
  for (let i = 0; i <= frameIndex; i += 1) {
    // 步长与烘焙链一致（inst.update(1 / fps)）：适配器把 ms 换算成秒。
    if (i > 0) handle.update(1000 / RENDER_FPS);
    handle.render(rgba);
  }
  return rgba;
}

/** 从烘焙 sheet 里裁出第 index 帧（格子位置取自 atlas JSON，不自己推算布局）。 */
function extractBakedFrame(
  artifact: BakedArtifact,
  index: number,
  width: number,
  height: number,
): Uint8Array {
  const rect = artifact.frames[index]?.frame;
  if (!rect) throw new Error(`[fx] atlas 里没有第 ${index} 帧`);
  if (rect.w !== width || rect.h !== height) {
    throw new Error(`[fx] 帧尺寸对不上（atlas ${rect.w}×${rect.h} vs 效果 ${width}×${height}）`);
  }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const source = ((rect.y + y) * artifact.sheet.width + rect.x) * 4;
    out.set(artifact.sheet.data.subarray(source, source + width * 4), y * width * 4);
  }
  return out;
}

/**
 * 逐像素比较两帧。
 *
 * why 先把代码路由的直 alpha **预乘**再比：烘焙产物里的 RGB 是预乘色（canvas.paste 那一步），
 *   两边不在同一色彩空间就没法比 —— 半透明像素会整片误判成不一致。
 * why 边带单独一档容差：烘焙链多跑一步上游的 edgeFade（辉光渐隐），代码路由没有 ——
 *   这是已知且有界的差异，不该让它淹没真漂移，也不该假装它不存在。
 */
function compareFrames(
  code: Uint8ClampedArray,
  baked: Uint8Array,
  width: number,
  height: number,
): Comparison {
  const core: Mismatch[] = [];
  const edge: Mismatch[] = [];
  let maxCoreDelta = 0;
  let maxEdgeDelta = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = code[offset + 3] ?? 0;
      const codeValues = [
        Math.round(((code[offset] ?? 0) * alpha) / 255),
        Math.round(((code[offset + 1] ?? 0) * alpha) / 255),
        Math.round(((code[offset + 2] ?? 0) * alpha) / 255),
        alpha,
      ];
      const bakedValues = [
        baked[offset] ?? 0,
        baked[offset + 1] ?? 0,
        baked[offset + 2] ?? 0,
        baked[offset + 3] ?? 0,
      ];
      const isEdge =
        x < EDGE_BAND_PX ||
        y < EDGE_BAND_PX ||
        x >= width - EDGE_BAND_PX ||
        y >= height - EDGE_BAND_PX;
      const tolerance = isEdge ? EDGE_TOLERANCE : CORE_TOLERANCE;

      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs((codeValues[channel] ?? 0) - (bakedValues[channel] ?? 0));
        if (isEdge) {
          if (delta > maxEdgeDelta) maxEdgeDelta = delta;
        } else if (delta > maxCoreDelta) {
          maxCoreDelta = delta;
        }
        if (delta > tolerance) {
          const mismatch: Mismatch = {
            x,
            y,
            channel: (['r', 'g', 'b', 'a'] as const)[channel] ?? 'r',
            codeValue: codeValues[channel] ?? 0,
            bakedValue: bakedValues[channel] ?? 0,
            delta,
            region: isEdge ? 'edge' : 'core',
          };
          if (isEdge) edge.push(mismatch);
          else core.push(mismatch);
        }
      }
    }
  }

  return { core, edge, maxCoreDelta, maxEdgeDelta };
}

/** 采样帧序号（t = 0% / 25% / 50% / 75% / 100%）。 */
function sampleFrameIndexes(frameCount: number): number[] {
  return SAMPLE_RATIOS.map((ratio) => Math.round(ratio * (frameCount - 1)));
}

/** 一个效果的完整对比材料（烘焙产物 + 尺寸/帧数）。 */
interface PreparedCase {
  readonly effect: EffectCase;
  readonly inputs: RouteInputs;
  readonly artifact: BakedArtifact;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
}

describe('双路由像素一致性（task_193 / AP-03 · DESIGN §1.2 约束2）', () => {
  const prepared: PreparedCase[] = [];

  beforeAll(() => {
    for (const effect of CASES) {
      const inputs = resolveRouteInputs(effect);
      const artifact = bakeEffect(effect, inputs);
      const [width, height] = effect.module.meta.size;
      prepared.push({
        effect,
        inputs,
        artifact,
        width,
        height,
        frameCount: artifact.frames.length,
      });
    }
  });

  afterAll(() => {
    for (const item of prepared) {
      fs.rmSync(item.artifact.outDir, { recursive: true, force: true });
    }
  });

  it('烘焙产物是真实渲染出来的（帧数 / 尺寸 / 调色板都对得上）', () => {
    expect(prepared.length).toBe(CASES.length);
    for (const item of prepared) {
      expect(item.frameCount).toBeGreaterThan(1);
      expect(item.artifact.sheet.width).toBeGreaterThan(0);
      expect(item.artifact.sheet.data.length).toBe(
        item.artifact.sheet.width * item.artifact.sheet.height * 4,
      );
      // 帧格子尺寸 = 效果画布尺寸（sheet 是网格排布：列数 × 行数 × 帧尺寸）。
      expect(item.artifact.frames[0]?.frame.w).toBe(item.width);
      expect(item.artifact.frames[0]?.frame.h).toBe(item.height);
      expect(item.inputs.palette.length).toBeGreaterThan(0);
    }
  });

  for (const effect of CASES) {
    it(`${effect.id}：采样 t 点逐像素一致（代码路由现算帧 vs 烘焙帧）`, () => {
      const item = prepared.find((entry) => entry.effect.id === effect.id);
      if (!item) throw new Error(`[fx] 没准备 ${effect.id}`);
      const indexes = sampleFrameIndexes(item.frameCount);

      // 采样点确实是「首帧 → 尾帧」的五个时间点。
      expect(indexes).toHaveLength(SAMPLE_RATIOS.length);
      expect(indexes[0]).toBe(0);
      expect(indexes[indexes.length - 1]).toBe(item.frameCount - 1);
      expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);

      for (const index of indexes) {
        const code = renderCodeFrame(effect, item.inputs, index);
        const baked = extractBakedFrame(item.artifact, index, item.width, item.height);
        const comparison = compareFrames(code, baked, item.width, item.height);

        // 主体区：逐字节相等（容差 0）—— 差一像素就是漂移，当场报警。
        expect({
          effect: effect.id,
          frame: index,
          coreMismatches: comparison.core.slice(0, 5),
        }).toEqual({ effect: effect.id, frame: index, coreMismatches: [] });
        // 边带：允许上游 edgeFade 的辉光渐隐差，但超出 32 仍然是漂移。
        expect({
          effect: effect.id,
          frame: index,
          edgeMismatches: comparison.edge.slice(0, 5),
        }).toEqual({ effect: effect.id, frame: index, edgeMismatches: [] });

        console.log(
          `[fx 双路由] ${effect.id} 第 ${index} 帧：主体区最大偏差 ${comparison.maxCoreDelta}、` +
            `边带最大偏差 ${comparison.maxEdgeDelta}（容差 ${CORE_TOLERANCE} / ${EDGE_TOLERANCE}）`,
        );
      }
    });
  }

  it('反证：烘焙帧里改动一个像素（±1 级）→ 比较器当场报出该像素', () => {
    // why 要有这条：一个从不报警的测试等于没有测试。这里人为把烘焙帧的一个像素改 1 级，
    //   断言比较器**必须**把它抓出来（并指出是哪个像素、哪个通道）。
    const item = prepared[0];
    if (!item) throw new Error('[fx] 没有准备好的效果');
    const index = Math.floor(item.frameCount / 2);
    const code = renderCodeFrame(item.effect, item.inputs, index);
    const baked = extractBakedFrame(item.artifact, index, item.width, item.height);

    // 先确认未改动时是干净的（否则「报警」没有说服力）。
    const clean = compareFrames(code, baked, item.width, item.height);
    expect(clean.core).toEqual([]);

    // 挑一个主体区里**不透明**的像素改 R 通道（+1 级 —— 最小可能的改动）。
    // why 挑不透明的：透明像素的 RGB 预乘后恒为 0，改它不会产生任何可观测差异 ——
    //   那样的「反证」是假的（报警的不是漂移，是运气）。
    let targetX = -1;
    let targetY = -1;
    for (let y = EDGE_BAND_PX; y < item.height - EDGE_BAND_PX && targetX < 0; y += 1) {
      for (let x = EDGE_BAND_PX; x < item.width - EDGE_BAND_PX; x += 1) {
        const offset = (y * item.width + x) * 4;
        const alpha = baked[offset + 3] ?? 0;
        const red = baked[offset] ?? 0;
        if (alpha >= 200 && red < 255) {
          targetX = x;
          targetY = y;
          break;
        }
      }
    }
    expect(targetX).toBeGreaterThanOrEqual(0);

    const mutated = baked.slice();
    const targetOffset = (targetY * item.width + targetX) * 4;
    mutated[targetOffset] = (mutated[targetOffset] ?? 0) + 1;

    const comparison = compareFrames(code, mutated, item.width, item.height);
    // 只报了那一个像素（其余仍然一致）—— 说明比较器是「精确定位」而不是「整体崩了」。
    expect(comparison.core).toHaveLength(1);
    expect(comparison.core[0]).toMatchObject({
      x: targetX,
      y: targetY,
      channel: 'r',
      delta: 1,
      region: 'core',
    });
  });
});
