/**
 * 文件职责：**代码路由特效的 dev 验收入口**（@since v3.3，task_162）——
 *   起一个挂 CodeFxLayer 的 Phaser.Game，把「世界锚定 / 皮肤联动 / 预算护栏」三件事当场演出来。
 *
 * ★ 本页扮演**组合根**的角色：唯一同时认识 hud（皮肤）与 world（特效层）的地方。
 *   - hud 侧：真主题控制器（切皮肤 = 翻各皮肤 <style> 的 disabled 属性）→
 *     读 CSS 变量（hud/theme/fx-palette-reader.ts）→ 塞进 Phaser game.registry；
 *   - world 侧：CodeFxLayer 从 registry 读调色板 → 算像素 → putImageData → 动态纹理 →
 *     挂在世界坐标（scrollFactor=1）上的 Image。
 *   why 组合根不能省：hud ↔ world 零直接调用是铁律，中间必须有一层「两边都认识」的地方。
 *
 * 禁止事项：
 *   1. 被任何生产入口 import —— 本文件只配 fx-code-dev.html，不进正式产物；
 *   2. 自己实现特效 —— 算像素的是 pixelfx，贴上屏的是 world 层（objects/code-fx-layer.ts）；
 *   3. 写死色值 —— 调色板一律来自皮肤 token（热读）。
 *
 * 启动方式：npm run dev 后访问 /src/app/dev/fx-code-dev.html
 */


import { clearFrame, composite, createFrame, createFx } from 'pixelfx';
import * as healAoeModule from 'pixelfx/fx/holy/heal-aoe';
import * as hitSparkModule from 'pixelfx/fx/impacts/hit-spark';
import * as empBlastModule from 'pixelfx/fx/scifi/emp-blast';
import * as poofModule from 'pixelfx/fx/spawn/poof';
import * as confettiModule from 'pixelfx/fx/ui/confetti';

import Phaser from 'phaser';

import type { FxPalette } from '../../core/theme/fx-palette';
import { VISUAL_PALETTE, hexToNumber } from '../../core/theme/visual-spec';
import { readFxPaletteTokens } from '../../hud/theme/fx-palette-reader';
import { createThemeController } from '../../hud/theme/theme-controller';
import defaultCss from '../../hud/theme/tokens-default.css?inline';
import pixelCss from '../../hud/theme/tokens-pixel.css?inline';
import { FX_PALETTE_KEY, readFxPalette } from '../../world/appearance/fx-palette';
import { CodeFxLayer, type CodeFxSource } from '../../world/objects/code-fx-layer';
import { toCodeFxSource, type PixelfxEffectModule } from '../fx/fx-code-pixelfx';

/** 沙盒世界尺寸（世界 px）—— 比视口大，相机能平移（证明世界锚定）。 */
const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;
/** 演示用的「单位」位置（世界坐标）—— 特效挂在它头上。 */
const UNIT_X = 420;
const UNIT_Y = 320;
/** 本页支持的两套皮肤。 */
type DemoSkin = 'default' | 'pixel';

/**
 * 示范效果（≤2 个，走代码路由）—— 评审文档 §5 结论清单里点名的两类：
 *   ① 镜像向（hit-spark）：方向性打击特效，flip / angle / seed 全是**免费的程序化变体**
 *      —— 这正是 sheet 路由给不了的（一期那张 sheet 只有一种朝向）；
 *   ② 皮肤联动（heal-aoe）：调色板直接从皮肤 token 热读 —— 切皮肤后下一个实例立刻换色。
 */
const SOURCES: readonly CodeFxSource[] = [
  toCodeFxSource(hitSparkModule as unknown as PixelfxEffectModule, {
    kind: 'hit',
    scale: 0.6,
    // 命中火花：暗红 → 橙 → 亮黄 → 白（7 槽位，与 hit-spark 的默认 ramp 等长）
    paletteRoles: ['danger', 'danger', 'warn', 'warn', 'accent', 'text', 'text'],
  }),
  toCodeFxSource(healAoeModule as unknown as PixelfxEffectModule, {
    kind: 'heal',
    scale: 0.4,
    // 治疗光环：暗绿 → 亮绿 → 白（8 槽位，与 heal-aoe 的 GREEN ramp 等长）
    paletteRoles: ['success', 'success', 'success', 'success', 'success', 'accent', 'text', 'text'],
  }),
];

/** 基准用的效果集（与 scripts/bench-pixelfx-runtime.mjs 同一批，便于两边对照）。 */
const BENCH_EFFECTS: readonly { readonly id: string; readonly mod: PixelfxEffectModule }[] = [
  { id: 'impacts/hit-spark', mod: hitSparkModule as unknown as PixelfxEffectModule },
  { id: 'spawn/poof', mod: poofModule as unknown as PixelfxEffectModule },
  { id: 'scifi/emp-blast', mod: empBlastModule as unknown as PixelfxEffectModule },
  { id: 'holy/heal-aoe', mod: healAoeModule as unknown as PixelfxEffectModule },
  { id: 'ui/confetti', mod: confettiModule as unknown as PixelfxEffectModule },
];

/** 基准的并发档位。 */
const BENCH_CONCURRENCY = [1, 2, 4, 8];
/** 基准的采样帧数。 */
const BENCH_FRAMES = 60;
/** 基准的预热帧数（不计入统计）。 */
const BENCH_WARMUP = 150;
/** 基准用的兜底调色板（基准不关心皮肤，只关心成本）。 */
const BENCH_PALETTE = ['#4a1712', '#c9281f', '#f2561d', '#ff8a2a', '#ffe26b', '#fff3a6', '#ffffff'];
/** 60fps 的单帧预算（ms）—— 占比的分母。 */
const FRAME_BUDGET_MS = 1000 / 60;

/**
 * 沙盒场景：一个网格 + 一个「单位」方块 + 特效层。
 *
 * why 自己起一个场景而不是挂生产战场：生产战场当前**没有**代码路由特效源
 *   （依赖分发方案还没定，见评审文档 §5.3）—— PoC 不去改生产行为。
 */
class CodeFxSandboxScene extends Phaser.Scene {
  /** 特效层（公开：dev 观测要读它的账本）。 */
  layer!: CodeFxLayer;

  /**
   * 显式给场景一个 key。
   * why 必须显式：Phaser 只把**配置数组里第 0 个**场景的 key 设成 'default'，
   *   其余的类名场景一律叫 'default' —— 按类名 getScene() 会取不到（取到 null，
   *   表现是「按钮点了没反应」，很难查）。
   */
  constructor() {
    super('codefx-sandbox');
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    // 色值只此一份（core/theme/visual-spec.ts 的 VISUAL_PALETTE）——
    //   本仓有纪律「world 与 hud 的源码里不再出现调色板色值字面量」，dev 入口也在其列。
    this.cameras.main.setBackgroundColor(VISUAL_PALETTE.background);

    // 网格（世界坐标）—— 平移相机时它会动，用来看清"世界"在哪儿。
    const grid = this.add.graphics();
    grid.lineStyle(1, hexToNumber(VISUAL_PALETTE.grid), 1);
    for (let x = 0; x <= WORLD_WIDTH; x += 64) grid.lineBetween(x, 0, x, WORLD_HEIGHT);
    for (let y = 0; y <= WORLD_HEIGHT; y += 64) grid.lineBetween(0, y, WORLD_WIDTH, y);
    grid.setDepth(0);

    // 演示用的「单位」（特效挂在它头上）。
    const unit = this.add.rectangle(
      UNIT_X,
      UNIT_Y - 24,
      24,
      32,
      hexToNumber(VISUAL_PALETTE.unit),
      0.9,
    );
    unit.setDepth(1);

    this.layer = new CodeFxLayer(this, SOURCES);

    // 拖动平移相机（世界锚定的直观证据）。
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      dragging = true;
      lastX = pointer.x;
      lastY = pointer.y;
    });
    this.input.on('pointerup', () => {
      dragging = false;
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!dragging) return;
      this.cameras.main.scrollX -= (pointer.x - lastX) / this.cameras.main.zoom;
      this.cameras.main.scrollY -= (pointer.y - lastY) / this.cameras.main.zoom;
      lastX = pointer.x;
      lastY = pointer.y;
    });
  }

  override update(): void {
    this.layer.tick(this.time.now);
  }
}

/** dev 观测句柄（Playwright 验收用）。 */
interface CodeFxDevHandle {
  readonly play: (kind: string, x?: number, y?: number, flip?: boolean) => boolean;
  readonly activeCount: () => number;
  readonly renderHz: () => number;
  readonly lastCostMs: () => number;
  readonly pan: (dx: number, dy: number) => void;
  readonly cameraScroll: () => { readonly x: number; readonly y: number };
  readonly instanceSnapshots: () => readonly {
    readonly kind: string;
    readonly x: number;
    readonly y: number;
    readonly palette: readonly string[];
  }[];
  /** 屏幕位置（由世界坐标与相机滚动推出 —— 相机一动它就该动，这就是"锚在世界"的证据）。 */
  readonly screenPositions: () => readonly { readonly kind: string; readonly x: number; readonly y: number }[];
  readonly palette: () => FxPalette;
  readonly tokenTable: () => Readonly<Record<string, string>>;
  readonly skin: () => string;
  readonly setSkin: (id: string) => void;
  /** 跑浏览器内基准；display=false 时纹理不上屏（对照用）。 */
  readonly bench: (display?: boolean) => Promise<string>;
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'battlefield',
  backgroundColor: VISUAL_PALETTE.background,
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [CodeFxSandboxScene],
});

// 真主题控制器（与生产同一套：切皮肤 = 翻 <style> 的 disabled）。
// 不给 storage —— dev 沙箱不记忆皮肤（省得把评审现场搅乱）。
const themeController = createThemeController<DemoSkin>({
  sources: { default: defaultCss, pixel: pixelCss },
  initial: 'default',
});

/**
 * 皮肤 → 调色板 → registry 的那条通路。
 *
 * why 这条链在**组合根**里：hud 侧能读 DOM、world 侧不能；两边唯一的公共面是 registry
 *   （与 reduced-motion 同款口径，见 world/motion.ts）。
 */
function pushPalette(): void {
  game.registry.set(FX_PALETTE_KEY, readFxPaletteTokens(document));
}
pushPalette();
// 皮肤一变就重推：下一个特效实例立刻用新色（不需要重跑任何生成脚本）。
themeController.subscribe(() => {
  pushPalette();
});

/** 取场景（就绪后才有）。 */
function scene(): CodeFxSandboxScene | null {
  return (game.scene.getScene('codefx-sandbox') as CodeFxSandboxScene | null) ?? null;
}

/**
 * 浏览器内基准：量「纯 JS 逐像素」「putImageData + GPU 上传」两段。
 *
 * why 要拆两段：护栏要定的是「贵在哪」——
 *   合成（纯 JS）随画布面积走，GPU 上传随面积 + 频率走，两者的上限不一样。
 * why 在浏览器里测：Node 侧测不到 putImageData / WebGL 上传，那正是「真实上屏成本」的一半。
 *
 * @param display 纹理上屏时是否挂一个可见的 Image（= 运行时形态）。
 *   why 要这个开关：用来验证「纹理正被 Image 用着」会不会触发驱动侧同步等待
 *   —— 实测两者差异在噪声内（结论：上传那段不是瓶颈，别再往那儿优化）。
 *
 * ★ 三条测量纪律（都是被数据教会的，别改）：
 *   ① **逐帧对齐 rAF**：紧循环跑出来的数好看 2-3 倍（缓存热、没有渲染插在中间），
 *      但运行时是每帧都夹着 Phaser 渲染的 —— 只有 rAF 对齐的数才是运行时真相；
 *   ② **每个效果先预热**：前 ~150 帧是冷代码，成本虚高数倍（实测 heal-aoe 冷 0.93ms → 热 0.19ms，Node 侧）；
 *   ③ **预热每个效果只做一次**：预热的是**代码路径**不是实例状态。
 */
async function bench(display = true): Promise<string> {
  const host = scene();
  if (!host) return '（场景还没起来）';
  const lines: string[] = [];
  lines.push(
    `基准：每档 ${BENCH_FRAMES} 帧（每效果预热 ${BENCH_WARMUP} 帧）· 60fps rAF 对齐 · ` +
      `帧预算 ${FRAME_BUDGET_MS.toFixed(2)}ms · 纹理${display ? '上屏中（挂可见 Image）' : '未上屏（无 Image 引用）'}`,
  );
  lines.push('effect              px    并发     js ms   上传 ms   合计 ms   占预算%');
  lines.push('-'.repeat(76));

  for (const effect of BENCH_EFFECTS) {
    const [w, h] = effect.mod.meta.size;
    const [ox, oy] = effect.mod.meta.origin;
    const areaPx = w * h;
    // 预热（丢弃）：把 JIT 烤热，之后每一档量到的才是稳态成本。
    await warmupEffect(host, effect);
    for (const n of BENCH_CONCURRENCY) {
      // 每个实例：一份帧缓冲 + 一块画布纹理 + 一份 ImageData（与运行时同构：合成直接写进 ImageData 的内存）。
      const frames = Array.from({ length: n }, () => createFrame(w, h, ox, oy));
      const instances = Array.from({ length: n }, (_, i) =>
        createFx(effect.mod as unknown as Record<string, unknown>, {
          x: ox,
          y: oy,
          palette: BENCH_PALETTE,
          seed: 11 + i,
        }),
      );
      const textures = Array.from({ length: n }, (_, i) =>
        host.textures.createCanvas(`bench:${effect.id}:${i}`, w, h),
      );
      const images = textures.map((texture) => {
        const context = texture?.getContext();
        return context ? context.createImageData(w, h) : null;
      });
      // 上屏形态：每块纹理挂一个可见的 Image（与运行时的 CodeFxLayer 同构）。
      const sprites = display
        ? textures.map((texture, i) =>
            texture ? host.add.image(200 + i * 60, 200, texture.key) : null,
          )
        : [];

      const jsTimes: number[] = [];
      const uploadTimes: number[] = [];
      for (let f = 0; f < BENCH_FRAMES; f += 1) {
        const t0 = performance.now();
        for (let i = 0; i < n; i += 1) {
          const image = images[i];
          if (!image) continue;
          instances[i].update(1 / 60);
          clearFrame(frames[i]);
          instances[i].draw(frames[i]);
          composite(frames[i], image.data, null);
        }
        const t1 = performance.now();
        for (let i = 0; i < n; i += 1) {
          const texture = textures[i];
          const image = images[i];
          if (!texture || !image) continue;
          const context = texture.getContext();
          if (!context) continue;
          context.putImageData(image, 0, 0);
          texture.refresh();
        }
        const t2 = performance.now();
        jsTimes.push(t1 - t0);
        uploadTimes.push(t2 - t1);
        // 让渲染循环有机会把 Image 画出去（否则「上屏中」只是名义上的）。
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      for (const sprite of sprites) if (sprite) sprite.destroy();
      for (const texture of textures) if (texture) host.textures.remove(texture.key);

      const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
      const js = avg(jsTimes);
      const upload = avg(uploadTimes);
      const total = js + upload;
      lines.push(
        `${effect.id.padEnd(20)}${String(areaPx).padStart(5)}${String(n).padStart(5)}` +
          `${js.toFixed(3).padStart(9)}${upload.toFixed(3).padStart(10)}` +
          `${total.toFixed(3).padStart(10)}${((total / FRAME_BUDGET_MS) * 100).toFixed(1).padStart(10)}`,
      );
      // 让出主线程：基准跑在页面里，不能把渲染循环堵死（测量窗口本身是同步的，不受影响）。
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return lines.join('\n');
}

/**
 * 预热一个效果：跑 BENCH_WARMUP 帧同样的活儿，结果丢弃。
 *
 * why 单独一个函数：预热必须走**与测量完全相同**的代码路径
 *   （update → clearFrame → draw → composite → putImageData → refresh），
 *   否则热起来的不是同一段代码，测出来的还是冷成本。
 */
async function warmupEffect(
  host: Phaser.Scene,
  effect: { readonly id: string; readonly mod: PixelfxEffectModule },
): Promise<void> {
  const [w, h] = effect.mod.meta.size;
  const [ox, oy] = effect.mod.meta.origin;
  const frame = createFrame(w, h, ox, oy);
  const instance = createFx(effect.mod as unknown as Record<string, unknown>, {
    x: ox,
    y: oy,
    palette: BENCH_PALETTE,
    seed: 7,
  });
  const texture = host.textures.createCanvas(`warmup:${effect.id}`, w, h);
  const context = texture?.getContext() ?? null;
  const image = context ? context.createImageData(w, h) : null;
  for (let f = 0; f < BENCH_WARMUP; f += 1) {
    instance.update(1 / 60);
    clearFrame(frame);
    instance.draw(frame);
    if (image) composite(frame, image.data, null);
    if (context && image) {
      context.putImageData(image, 0, 0);
      texture?.refresh();
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  if (texture) host.textures.remove(texture.key);
}

// ==========================================================================
// 面板接线
// ==========================================================================

const statusEl = document.getElementById('status');
const benchEl = document.getElementById('bench-out');
const paletteEl = document.getElementById('palette-out');

/** 当前皮肤。 */
let skin: DemoSkin = 'default';

function updateStatus(): void {
  const host = scene();
  if (!statusEl || !host) return;
  const layer = host.layer;
  if (!layer) return;
  statusEl.textContent =
    `实例 ${layer.activeCount} · 渲染 ${layer.currentRenderHz}Hz · 上一帧 ${layer.lastTickCostMs.toFixed(2)}ms`;
}

function updatePalette(): void {
  if (!paletteEl) return;
  const raw = game.registry.get(FX_PALETTE_KEY) as Record<string, string> | undefined;
  const table = raw ?? {};
  paletteEl.textContent = Object.entries(table)
    .map(([token, value]) => `${token} ${value}`)
    .join('\n');
}

document.querySelectorAll<HTMLButtonElement>('#controls button').forEach((button) => {
  button.addEventListener('click', () => {
    const host = scene();
    if (!host) return;
    const layer = host.layer;
    if (!layer) return;
    const act = button.dataset.act;
    if (act === 'hit') layer.play('hit', UNIT_X, UNIT_Y - 24);
    else if (act === 'hit-flip') layer.play('hit', UNIT_X, UNIT_Y - 24, { flip: true });
    else if (act === 'heal') layer.play('heal', UNIT_X, UNIT_Y);
    else if (act === 'burst') {
      for (let i = 0; i < 8; i += 1) {
        layer.play(i % 2 === 0 ? 'hit' : 'heal', UNIT_X + i * 24 - 96, UNIT_Y - 24);
      }
    } else if (act === 'skin') {
      skin = skin === 'default' ? 'pixel' : 'default';
      themeController.apply(skin);
      pushPalette();
      updatePalette();
    } else if (act === 'pan') {
      host.cameras.main.scrollX += 160;
    } else if (act === 'bench') {
      if (benchEl) benchEl.textContent = '（跑基准中…）';
      void bench().then((text) => {
        if (benchEl) benchEl.textContent = text;
      });
    }
    updateStatus();
  });
});

// 状态行常驻刷新（渲染频率会被护栏自适应改掉）。
setInterval(updateStatus, 250);
updatePalette();

// dev 观测句柄（Playwright 验收用）。
(window as unknown as { __srfCodeFx?: CodeFxDevHandle }).__srfCodeFx = {
  play: (kind, x = UNIT_X, y = UNIT_Y - 24, flip = false) => {
    const host = scene();
    if (!host || !host.layer) return false;
    return host.layer.play(kind, x, y, { flip });
  },
  activeCount: () => scene()?.layer?.activeCount ?? 0,
  renderHz: () => scene()?.layer?.currentRenderHz ?? 0,
  lastCostMs: () => scene()?.layer?.lastTickCostMs ?? 0,
  pan: (dx, dy) => {
    const host = scene();
    if (!host) return;
    host.cameras.main.scrollX += dx;
    host.cameras.main.scrollY += dy;
  },
  cameraScroll: () => {
    const host = scene();
    return host ? { x: host.cameras.main.scrollX, y: host.cameras.main.scrollY } : { x: 0, y: 0 };
  },
  instanceSnapshots: () => scene()?.layer?.instanceSnapshots() ?? [],
  screenPositions: () => {
    const host = scene();
    if (!host) return [];
    const zoom = host.cameras.main.zoom;
    const scrollX = host.cameras.main.scrollX;
    const scrollY = host.cameras.main.scrollY;
    return (host.layer?.instanceSnapshots() ?? []).map((instance) => ({
      kind: instance.kind,
      x: instance.x - scrollX * zoom,
      y: instance.y - scrollY * zoom,
    }));
  },
  palette: () => readFxPalette(game.registry),
  tokenTable: () => (game.registry.get(FX_PALETTE_KEY) ?? {}) as Readonly<Record<string, string>>,
  skin: () => skin,
  setSkin: (id) => {
    skin = id as DemoSkin;
    themeController.apply(skin);
    pushPalette();
    updatePalette();
  },
  bench: (display = true) => bench(display),
};
