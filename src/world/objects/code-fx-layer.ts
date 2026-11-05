/**
 * 文件职责：**代码路由特效层** —— 运行时逐像素算出来的特效怎么落到战场上（@since v3.3，task_162）。
 *   一期（task_161）走 sprite sheet：贴图在生成期烘好，运行时只换纹理帧。
 *   二期走代码路由：效果在运行时被**算**出来（pixelfx 的逐像素 sim），
 *   算完的像素经「离屏画布 → putImageData → Phaser 动态纹理 → 世界坐标上的 Image」上屏。
 *
 * ★ 世界锚定（本文件存在的理由）：
 *   pixelfx 画的是 ImageData —— **屏幕空间语义**（一张与相机无关的位图）。
 *   Stratix 的特效必须**锚在世界坐标**（跟着单位走、跟着相机走）。
 *   本层的做法是：**每个实例一块「效果本地尺寸」的离屏画布**，算完贴到
 *   Phaser 的 CanvasTexture 上，再用一个 `scrollFactor = 1` 的 Image 挂到世界坐标 ——
 *   于是"相机怎么动，特效就怎么动"是 Phaser 的常规语义，不需要在特效里算任何相机矩阵。
 *   （选型对比与全屏 overlay 方案的取舍见 docs/research/pixelfx-runtime-poc.md §2。）
 *
 * 输入：Phaser 场景 + 特效源（CodeFxSource）+ 宿主层的每帧 tick。
 * 输出：若干 Image（每个实例一个）+ 预算护栏的自我调节（渲染频率）。
 * 禁止事项：
 *   1. import hud / app —— 铁律：world 只认识 core；
 *   2. 自己开定时器 —— 回收与推进由宿主层的全场一个 tick 驱动（perf：不给每条特效各开一个定时器）；
 *   3. 自己读 DOM —— world 零 DOM（调色板走 registry，见 appearance/fx-palette.ts）；
 *   4. 引用具体的效果文件名 —— 只认语义 kind。
 *
 * 生命周期：宿主在 create() 里建本层 → 每帧 tick() 推进 → shutdown 时 destroy()。
 */

import Phaser from 'phaser';

import type { FxPaletteRole } from '../../core/theme/fx-palette';
import { CODE_FX_METRICS } from '../../core/theme/visual-spec';
import {
  admitCodeFx,
  isCodeFxOnScreen,
  nextRenderHz,
  shouldEvictForBudget,
  type CodeFxBudget,
} from '../appearance/code-fx-policy';
import { readFxPalette } from '../appearance/fx-palette';

/** 传给效果实现的创建参数（调色板已按效果的槽位顺序解析成色值）。 */
export interface CodeFxOptions {
  /** 调色板（按源声明的槽位顺序）—— 来自 hud 皮肤 token 的热读取结果。 */
  readonly palette: readonly string[];
  /** 随机种子（同一 kind 不同 seed = 不同变体，不用重做素材）。 */
  readonly seed: number;
  /** 水平镜像（面向翻转）。 */
  readonly flip: boolean;
  /** 旋转（弧度）。 */
  readonly angle: number;
}

/** 一个活着的特效实例（由效果实现自己驱动）。 */
export interface CodeFxHandle {
  /** 推进仿真（dt 毫秒；效果实现内部按 120Hz 切子步，所以掉帧率不损仿真精度）。 */
  update(dtMs: number): void;
  /** 把当前这一帧写进 RGBA 缓冲（长度 = 宽 × 高 × 4）。 */
  render(rgba: Uint8ClampedArray): void;
  /** 是否演完了。 */
  readonly done: boolean;
}

/** 一个代码路由特效源（语义 kind → 怎么算出来）。 */
export interface CodeFxSource {
  /** 语义 kind（契约里只说「要什么演出」）。 */
  readonly kind: string;
  /** 画布宽（原生像素）。 */
  readonly width: number;
  /** 画布高（原生像素）。 */
  readonly height: number;
  /** 效果原点在画布内的位置（贴图时要按它对齐挂载点）。 */
  readonly originX: number;
  /** 效果原点在画布内的位置。 */
  readonly originY: number;
  /** 演出时长（ms）。 */
  readonly durationMs: number;
  /** 是否循环播放。 */
  readonly loop: boolean;
  /** 上屏缩放（1 = 原生像素尺寸）。 */
  readonly scale: number;
  /** 这个效果用到哪些调色板槽位（按顺序取色）。 */
  readonly paletteRoles: readonly FxPaletteRole[];
  /** 建一个实例。 */
  readonly create: (options: CodeFxOptions) => CodeFxHandle;
}

/** 播放时可覆盖的参数。 */
export interface CodeFxPlayOptions {
  /** 水平镜像。 */
  readonly flip?: boolean;
  /** 旋转（弧度）。 */
  readonly angle?: number;
  /** 随机种子。 */
  readonly seed?: number;
}

/** 本层的可调项。 */
export interface CodeFxLayerOptions {
  /** 并发上限（缺省取唯一事实源的 CODE_FX_METRICS.maxConcurrent）。 */
  readonly maxConcurrent?: number;
  /** 渲染深度（缺省取 CODE_FX_METRICS.depth）。 */
  readonly depth?: number;
  /** 预算（缺省取 CODE_FX_METRICS）。 */
  readonly budget?: Partial<CodeFxBudget>;
}

/** 一个在播的实例（账本条目 + 显示对象）。 */
interface CodeFxInstance {
  readonly id: number;
  readonly source: CodeFxSource;
  readonly handle: CodeFxHandle;
  /** 挂载点（世界坐标）。 */
  readonly x: number;
  readonly y: number;
  /** 上屏时刻（ms；用来挤掉最老的）。 */
  readonly startedAt: number;
  /** 该实例出生时解析到的调色板（按源声明的槽位顺序）。 */
  readonly palette: readonly string[];
  /** 纹理键（每个实例一张 —— 纹理不许共享：内容每帧都不同）。 */
  readonly textureKey: string;
  /** 动态纹理。 */
  readonly texture: Phaser.Textures.CanvasTexture;
  /** 上屏的图（scrollFactor = 1 → 锚在世界坐标）。 */
  readonly image: Phaser.GameObjects.Image;
  /** 像素缓冲（合成结果直接写这里，不额外分配）。 */
  readonly rgba: Uint8ClampedArray;
  /** 上屏用的 ImageData（与 rgba 是同一块内存 —— 合成完直接 putImageData，零拷贝）。 */
  readonly imageData: ImageData;
  /** 上一次渲染的时刻（ms）—— 渲染按 renderHz 抽帧，仿真不抽。 */
  lastRenderAt: number;
}

/**
 * 代码路由特效层：把「算出来的特效」挂到战场上，并守住预算 ——
 *   ① 同时最多 N 个实例（超出挤掉最老的）；② 画布面积超限直接不播；
 *   ③ 每帧占用超预算 → 降渲染频率，降到底还超 → 挤掉最老的；④ 离屏即停并回收。
 */
export class CodeFxLayer {
  private readonly scene: Phaser.Scene;
  /** 特效源（按 kind 索引）。 */
  private readonly sources = new Map<string, CodeFxSource>();
  /** 在播实例。 */
  private readonly instances = new Map<number, CodeFxInstance>();
  /** 预算。 */
  private readonly budget: CodeFxBudget;
  /** 渲染深度。 */
  private readonly depth: number;
  /** 当前渲染频率（Hz）—— 会按实测帧耗时自适应。 */
  private renderHz: number;
  /** 上一次 tick 的时刻（ms）。 */
  private lastTickAt = 0;
  /** 实例 id 计数。 */
  private nextId = 1;
  /** 上一次 tick 的实测耗时（ms）—— dev 观测用。 */
  private lastCostMs = 0;
  /** 上一次「真正画了东西」的帧的实测耗时（ms）—— 护栏自适应看的是它。 */
  private lastRenderCostMs = 0;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    sources: readonly CodeFxSource[],
    options: CodeFxLayerOptions = {},
  ) {
    this.scene = scene;
    this.depth = options.depth ?? CODE_FX_METRICS.depth;
    this.budget = {
      maxConcurrent: options.maxConcurrent ?? CODE_FX_METRICS.maxConcurrent,
      maxCanvasAreaPx: CODE_FX_METRICS.maxCanvasAreaPx,
      renderHz: CODE_FX_METRICS.renderHz,
      minRenderHz: CODE_FX_METRICS.minRenderHz,
      frameBudgetMs: CODE_FX_METRICS.frameBudgetMs,
      offscreenMarginPx: CODE_FX_METRICS.offscreenMarginPx,
    };
    this.renderHz = this.budget.renderHz;
    for (const source of sources) this.sources.set(source.kind, source);
  }

  /** 当前在播的实例数（dev 观测用）。 */
  get activeCount(): number {
    return this.instances.size;
  }

  /** 当前渲染频率（Hz；dev 观测用）。 */
  get currentRenderHz(): number {
    return this.renderHz;
  }

  /** 上一次 tick 的实测耗时（ms；dev 观测用）。 */
  get lastTickCostMs(): number {
    return this.lastCostMs;
  }

  /** 上一次「真正画了东西」的帧的实测耗时（ms；dev 观测用 —— 这才是护栏看的那个数）。 */
  get lastRenderFrameCostMs(): number {
    return this.lastRenderCostMs;
  }

  /**
   * 在播实例的快照（dev 观测用 —— 用来当场证明"锚在世界坐标"与"用的是皮肤色"）。
   *
   * why 需要它：世界锚定是个**看不见**的性质 —— 光看画面分不出"贴在屏幕上"还是"挂在世界里"。
   *   快照给出实例挂载点的世界坐标，配合相机 scrollX/scrollY 就能算出它的屏幕位置；
   *   相机一动、屏幕位置变了而世界坐标不变 = 锚定成立。
   *   快照里的 palette 是该实例**出生时**解析到的调色板 —— 切皮肤后新实例的 palette 变了，
   *   就证明"皮肤 → 特效"这条热读通路真的通了（而不是碰巧颜色看着对）。
   *
   * @returns 快照列表（新数组，调用方改了不影响层内状态）。
   */
  instanceSnapshots(): readonly {
    readonly kind: string;
    readonly x: number;
    readonly y: number;
    readonly palette: readonly string[];
  }[] {
    return Array.from(this.instances.values(), (instance) => ({
      kind: instance.source.kind,
      x: instance.x,
      y: instance.y,
      palette: instance.palette,
    }));
  }

  /**
   * 播一个特效。
   *
   * @param kind 语义 kind。
   * @param x 挂载点 x（世界坐标）。
   * @param y 挂载点 y（世界坐标）。
   * @param options 可覆盖的参数（镜像 / 旋转 / 种子）。
   * @returns 是否真的播了（种类未知 / 面积超限 / 画布建不起来 → false）。
   */
  play(kind: string, x: number, y: number, options: CodeFxPlayOptions = {}): boolean {
    if (this.destroyed) return false;
    const source = this.sources.get(kind);
    if (!source) return false;

    const areaPx = source.width * source.height;
    const admission = admitCodeFx(areaPx, this.instances.size, this.budget);
    // 面积超限永远不播：成本与面积成正比，放进来就是白烧 CPU。
    if (!admission.admitted && admission.reason === 'area-too-large') return false;
    // 并发满 → 挤掉最老的一条再播（先来的先让位，与一期 sheet 路由同一条纪律）。
    if (!admission.admitted) this.evictOldest();

    const palette = readFxPalette(this.scene.registry);
    const slotColors = source.paletteRoles.map((role) => palette[role]);
    const seed = options.seed ?? this.nextId * 7919;
    let handle: CodeFxHandle;
    try {
      handle = source.create({
        palette: slotColors,
        seed,
        flip: options.flip ?? false,
        angle: options.angle ?? 0,
      });
    } catch {
      // 效果实现自己炸了不该拖垮战场 —— 这一条不播，别的照旧。
      return false;
    }

    const id = this.nextId;
    this.nextId += 1;
    const textureKey = `codefx:${kind}:${id}`;
    const texture = this.scene.textures.createCanvas(textureKey, source.width, source.height);
    if (!texture) return false;
    // 像素画要最近邻：线性插值会把像素特效糊成马赛克。
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    // ImageData 直接从纹理的 2D 上下文要 —— 它的 .data 就是我们要写的那块内存，
    // 于是「合成 → 上屏」零拷贝、每帧零分配（perf 硬约束：渲染路径不许造对象）。
    const context = texture.getContext();
    if (!context) {
      this.scene.textures.remove(textureKey);
      return false;
    }
    const imageData = context.createImageData(source.width, source.height);

    const image = this.scene.add.image(x, y, textureKey);
    // 原点对齐效果的原点：挂载点 = 效果的原点（与一期 sheet 路由的枢轴口径一致）。
    image.setOrigin(source.originX / source.width, source.originY / source.height);
    image.setScale(source.scale);
    image.setDepth(this.depth);
    // scrollFactor 默认就是 1 —— 显式写出来是为了让"锚在世界坐标"这件事在代码里看得见。
    image.setScrollFactor(1);

    this.instances.set(id, {
      id,
      source,
      handle,
      x,
      y,
      startedAt: this.scene.time.now,
      palette: slotColors,
      textureKey,
      texture,
      image,
      rgba: imageData.data,
      imageData,
      lastRenderAt: 0,
    });
    return true;
  }

  /**
   * 推进一帧：仿真每 tick 都走（时间是真的），画面按 renderHz 抽帧。
   *
   * @param nowMs 当前时刻（ms；缺省取场景时钟）。
   */
  tick(nowMs: number = this.scene.time.now): void {
    if (this.destroyed) return;
    const started = performance.now();
    const dt = this.lastTickAt === 0 ? 16.667 : Math.min(100, nowMs - this.lastTickAt);
    this.lastTickAt = nowMs;
    const renderInterval = 1000 / this.renderHz;
    let rendered = 0;

    for (const instance of Array.from(this.instances.values())) {
      // 离屏：不画也不算了（白烧 CPU），直接回收 —— 与一期 sheet 路由同一条纪律。
      if (!this.isOnScreen(instance)) {
        this.recycle(instance.id);
        continue;
      }
      instance.handle.update(dt);
      if (nowMs - instance.lastRenderAt < renderInterval) continue;
      instance.lastRenderAt = nowMs;
      this.renderFrame(instance);
      rendered += 1;
      if (instance.handle.done) this.recycle(instance.id);
    }

    this.lastCostMs = performance.now() - started;
    // ★ 预算自适应只看「真正画了东西的帧」。
    // why：渲染是抽帧的（renderHz），没画东西的帧只跑仿真，成本天然低一个量级 ——
    //   拿它当预算信号会让频率在两档之间来回抖（实测：30Hz ↔ 15Hz 每几帧翻一次），
    //   画面反而更难看。护栏该管的是「画一帧要花多少」。
    if (rendered > 0) {
      this.lastRenderCostMs = this.lastCostMs;
      this.renderHz = nextRenderHz(this.renderHz, this.lastCostMs, this.budget);
      if (shouldEvictForBudget(this.lastCostMs, this.renderHz, this.budget)) this.evictOldest();
    }
  }

  /** 场景关闭：销毁所有显示对象、纹理与账本（资源必须可清理）。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const instance of this.instances.values()) {
      instance.image.destroy();
      this.scene.textures.remove(instance.textureKey);
    }
    this.instances.clear();
    this.sources.clear();
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  /** 把实例的当前帧贴上屏（画布 → 动态纹理 → 世界坐标上的 Image）。 */
  private renderFrame(instance: CodeFxInstance): void {
    const { handle, texture, rgba, imageData } = instance;
    handle.render(rgba);
    const context = texture.getContext();
    if (!context) return;
    // putImageData 是「替换」语义：整帧都写了，不需要先 clear。
    context.putImageData(imageData, 0, 0);
    // refresh 把画布重新上传到 GPU —— WebGL 下不刷新就看不到变化。
    texture.refresh();
  }

  /** 回收一个实例（销毁显示对象与纹理，从账本摘掉）。 */
  private recycle(id: number): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    instance.image.destroy();
    this.scene.textures.remove(instance.textureKey);
    this.instances.delete(id);
  }

  /** 挤掉最老的一条（并发满 / 超预算时）。 */
  private evictOldest(): void {
    let oldestId: number | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const instance of this.instances.values()) {
      if (instance.startedAt < oldestAt) {
        oldestAt = instance.startedAt;
        oldestId = instance.id;
      }
    }
    if (oldestId !== null) this.recycle(oldestId);
  }

  /**
   * 可见性判定：特效挂载点是否还在视口（含留边）里。
   *
   * why 用相机的 worldView：它已经含了缩放与平移，换算成世界坐标最省事。
   */
  private isOnScreen(instance: CodeFxInstance): boolean {
    const view = this.scene.cameras.main.worldView;
    return isCodeFxOnScreen(
      instance.x,
      instance.y,
      { x: view.x, y: view.y, right: view.right, bottom: view.bottom },
      this.budget.offscreenMarginPx,
    );
  }
}
