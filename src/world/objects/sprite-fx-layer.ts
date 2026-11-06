/**
 * 文件职责：把「精灵特效」（sprite sheet 动画）**播到战场上**（@since v3.3，task_161）。
 *   一期只用 Phaser 的纹理帧动画（scene.anims），不引任何 pixelfx 运行时代码 ——
 *   运行时零新增依赖是 task_161 的硬要求（requirement 4）。
 * 输入：Phaser 场景 + 生成索引里的特效源（appearance/fx-sources.generated.ts）+ 池的裁决（appearance/fx-atlas.ts）。
 * 输出：若干 PlayAnim 播放的 Sprite（每个特效实例一个）+ 一个实例账本（SpriteFxPool）。
 * 禁止事项：
 *   1. import hud / app / vue —— 铁律：world 只认识 core；
 *   2. 自己开定时器 —— 回收由宿主层的全场一个 tick 驱动（perf：不给每条特效各开一个定时器）；
 *   3. 自己裁决并发上限 / 何时回收 —— 规则全在 appearance/fx-atlas.ts 的池里（单测只测那一处）；
 *   4. 引用具体的效果文件名 —— 只认语义 kind（celebrate / levelUp / error / spawn / despawn / command）。
 *
 * ★ 为什么在 objects/ 而不是 appearance/：这一层要碰 Phaser 显示对象；
 *   appearance/ 是零渲染依赖的纯逻辑层（appearance/fx-atlas.ts），两者分工同 unit-animation。
 *
 * 生命周期：宿主（TaskFxLayer）在 create() 里建本层 → 每帧 tick() 推进回收 → shutdown 时 destroy()。
 *
 * ============ 变体消费（@since v3.3，task_194 / AP-04）============
 * 同一个 kind 可以有多套 seed 变体（发布期烘焙，DESIGN §1.1「烘 K 变体随机选」）：
 * 播放时在「基础变体 + 变体」里**随机挑一套**播 ⇒ 同一条特效反复播不会一模一样。
 * 变体清单由素材加载场景从烘焙 manifest 登记进 game.registry（appearance/fx-variants.ts），
 * 本层每次播放现读（变体是并行加载的，晚到的变体下一次播放就参与挑选）。
 */

import Phaser from 'phaser';

import {
  SpriteFxPool,
  spriteFxFrameNames,
  spriteFxOrigin,
  type SpriteFxInstance,
  type SpriteFxKind,
  type SpriteFxSource,
} from '../appearance/fx-atlas';
import {
  pickSpriteFxCandidate,
  readSpriteFxVariants,
  spriteFxCandidates,
} from '../appearance/fx-variants';
import { SPRITE_FX_METRICS } from '../theme';

export interface SpriteFxLayerOptions {
  /** 并发上限（个；缺省取唯一事实源的 SPRITE_FX_METRICS.maxConcurrent）。 */
  readonly maxConcurrent?: number;
  /** 渲染深度（缺省取 SPRITE_FX_METRICS.depth）。 */
  readonly depth?: number;
}

/**
 * 精灵特效层：把特效源变成屏幕上的动画，并守住三条纪律 ——
 *   ① 同时最多 N 个实例（超出挤掉最老的）；② 播完即回收；③ 离屏即停并回收。
 *
 * why 离屏要**停**而不是"播完再说"：镜头拉走时，画面上没有任何东西在动，
 *   可那些动画还在逐帧换纹理 —— 白烧 CPU（perf 硬约束）。
 */
export class SpriteFxLayer {
  private readonly scene: Phaser.Scene;
  /** 特效源（按 kind 索引）。 */
  private readonly sources = new Map<SpriteFxKind, SpriteFxSource>();
  /** 实例账本（规则裁决在 appearance/fx-atlas.ts 的池里）。 */
  private readonly pool: SpriteFxPool;
  /** 实例 id → 显示对象。 */
  private readonly sprites = new Map<number, Phaser.GameObjects.Sprite>();
  /** 渲染深度。 */
  private readonly depth: number;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    sources: readonly SpriteFxSource[],
    options: SpriteFxLayerOptions = {}
  ) {
    this.scene = scene;
    this.depth = options.depth ?? SPRITE_FX_METRICS.depth;
    this.pool = new SpriteFxPool(options.maxConcurrent ?? SPRITE_FX_METRICS.maxConcurrent);
    for (const source of sources) {
      this.sources.set(source.kind, source);
      this.ensureAnimation(source);
    }
  }

  /** 当前正在播放的实例数（dev 观测用）。 */
  get activeCount(): number {
    return this.pool.size;
  }

  /**
   * 播一个特效。
   *
   * ★ 变体消费（@since v3.3，task_194 / AP-04）：同一个 kind 有多套 seed 变体时
   *   **随机挑一套播**（DESIGN §1.1「seed → 烘 K 变体随机选」）——
   *   否则同一条特效反复播看起来一模一样。
   *   变体清单来自发布期烘焙的 manifest（见 appearance/fx-variants.ts）；
   *   没有变体（dev / 未烘焙）⇒ 候选只剩基础变体 ⇒ 行为与 task_161 完全一致。
   *
   * @param kind 语义 kind。
   * @param x 挂载点 x（世界坐标）。
   * @param y 挂载点 y（世界坐标）。
   * @returns 是否真的播了（种类未知 / 素材没加载 / 已销毁 → false）。
   */
  play(kind: SpriteFxKind, x: number, y: number): boolean {
    if (this.destroyed) return false;
    const base = this.sources.get(kind);
    if (!base) return false;
    // 候选 = 基础变体 + 已到位的变体（变体是并行加载的，没到位的当它不存在）。
    const variants = readSpriteFxVariants(this.scene.registry);
    const ready = spriteFxCandidates(base, variants).filter((candidate) =>
      this.scene.textures.exists(candidate.atlasKey),
    );
    // 素材没到位（加载失败 / 还在路上）→ 不播，也不假装播了。
    if (ready.length === 0) return false;
    const source = pickSpriteFxCandidate(ready);
    if (!source) return false;
    // 动画按需登记：素材是**并行**加载的（见 scenes/fx-asset-scene.ts），
    // 战场 create() 跑在素材到位之前 —— 首次播放时纹理才到，动画这时才建。
    this.ensureAnimation(source);

    const now = this.scene.time.now;
    const spawn = this.pool.spawn(kind, x, y, now, source.durationMs);
    // 并发上限挤掉的实例：它们的显示对象要立刻销毁（否则画面上留着"停住"的特效）。
    for (const evicted of spawn.evicted) this.destroyInstance(evicted.id);

    const origin = spriteFxOrigin(source);
    const sprite = this.scene.add.sprite(x, y, source.atlasKey, spriteFxFrameNames(source)[0]);
    sprite.setOrigin(origin.x, origin.y);
    sprite.setScale(source.scale);
    sprite.setDepth(this.depth);
    sprite.play(source.animKey);
    this.sprites.set(spawn.instance.id, sprite);
    return true;
  }

  /**
   * 推进回收：到期（播完）与离屏（滚出视口）的实例就地销毁。
   *
   * @param nowMs 当前时刻（ms；缺省取场景时钟）。
   */
  tick(nowMs: number = this.scene.time.now): void {
    if (this.destroyed) return;
    const removed = this.pool.collect(nowMs, (instance) => this.isOnScreen(instance));
    for (const instance of removed) this.destroyInstance(instance.id);
  }

  /** 场景关闭：销毁所有显示对象与账本（资源必须可清理）。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
    this.pool.clear();
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  /**
   * 登记一条 Phaser 动画（atlas 的帧表 → anim）；已存在则什么都不做。
   *
   * why 帧表在运行时现推而不是读 JSON：帧名可推导（"<prefix> <序号>"），
   *   而帧率 / 帧数在生成索引里 —— 索引是唯一的真相源（见 appearance/fx-atlas.ts）。
   * why 幂等：素材并行加载，构造器与首次播放都可能先后来到 —— 谁先谁建，不许建两遍。
   */
  private ensureAnimation(source: SpriteFxSource): void {
    // 纹理还没到时建动画只会得到一条 "Texture not found" 警告 —— 不建。
    if (!this.scene.textures.exists(source.atlasKey)) return;
    if (this.scene.anims.exists(source.animKey)) return;
    this.scene.anims.create({
      key: source.animKey,
      frames: spriteFxFrameNames(source).map((frame) => ({ key: source.atlasKey, frame })),
      frameRate: source.fps,
      // repeat: 0 = 播一遍就停（一次性演出）；循环效果用 -1。
      repeat: source.loop ? -1 : 0,
    });
  }

  /** 销毁一个实例的显示对象并从账本摘掉。 */
  private destroyInstance(id: number): void {
    const sprite = this.sprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.sprites.delete(id);
    }
    this.pool.remove(id);
  }

  /**
   * 可见性判定：特效挂载点是否还在视口（含留边）里。
   *
   * why 用相机的 worldView：它已经含了缩放与平移，换算成世界坐标最省事。
   * why 视口尺寸为 0 时一律算"可见"：相机还没算出可视区（首帧前后），
   *   那时判成"离屏"会把刚播的特效秒收掉 —— 首帧误杀的坑不踩。
   */
  private isOnScreen(instance: SpriteFxInstance): boolean {
    const view = this.scene.cameras.main.worldView;
    if (view.width <= 0 || view.height <= 0) return true;
    const margin = SPRITE_FX_METRICS.offscreenMarginPx;
    return (
      instance.x >= view.x - margin &&
      instance.x <= view.right + margin &&
      instance.y >= view.y - margin &&
      instance.y <= view.bottom + margin
    );
  }
}
