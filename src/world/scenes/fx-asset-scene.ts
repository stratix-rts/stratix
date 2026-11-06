/**
 * 文件职责：**精灵特效素材的加载场景**（@since v3.3，task_161）——
 *   单独把 pixelfx sheet（PNG + atlas JSON）预载进 texture manager，自己不画任何东西。
 * 输入：game.registry 里的特效素材根 URL（app 层 / dev 入口在 preBoot 注入）。
 * 输出：texture manager 里多出六张 sheet 纹理（atlas key = 'fx:<kind>'）。
 * 禁止事项：
 *   1. 自己播特效 —— 演出归 objects/sprite-fx-layer.ts；
 *   2. import hud / app / vue —— 铁律：world 只认识 core；
 *   3. 让战场场景等素材 —— 见下（这是本文件存在的全部理由）。
 *
 * ★ 为什么单独一个场景，而不是战场场景自己 preload（task_161 的一个真实教训）：
 *   Phaser 的规矩是「场景有 preload → 战场 create() 等素材加载完才跑」。
 *   战场是主屏 —— 让它等六张图（dev 几百毫秒、electron 几十毫秒）才出画面，
 *   等于给启动延迟加了一笔。更糟的是它会连带打断**首帧补发状态**的手势：
 *   app 层靠「第一个 POST_RENDER 补发一次 WorldState」把初始快照补给刚订阅好的桥接层，
 *   而战场 create() 被推迟后，桥接层在那次补发**还没订阅** → 战场开局是空的。
 *   把素材挪到这个独立场景：战场 create() 依旧同步跑（启动语义不变），素材在旁边并行加载；
 *   纹理到位的瞬间，精灵特效层按纹理事件补登记动画（见 objects/sprite-fx-layer.ts）。
 *
 * 场景本身是个"一次性加载器"：加载完就闲在那儿（无 update、无渲染开销）。
 *
 * ============ 变体加载（@since v3.3，task_194 / AP-04）============
 * 发布期烘焙（task_192 / AP-02）每个效果还烘了 `__s1` 变体（同效果、另一套 seed 分布）——
 *   运行时在「基础变体 + 变体」里随机挑一套播（见 objects/sprite-fx-layer.ts）。
 *   变体清单来自烘焙 manifest（fx-bake-manifest.json）：**清单说有、文件才在** ——
 *   dev 态的清单由 vite 中间件从仓内快照如实派生（@since v3.3，task_211 / AP-05），
 *   快照只有基础变体 ⇒ dev 没有变体 ⇒ 行为与 task_161 完全一致（release 才有 `__s1` 变体）。
 */

import Phaser from 'phaser';

import { FX_ASSET_BASE_URL_KEY, fxAssetUrl } from '../appearance/fx-asset-path';
import { SPRITE_FX_SOURCES } from '../appearance/fx-sources.generated';
import {
  FX_BAKE_MANIFEST_NAME,
  SPRITE_FX_RUNTIME_SKIN,
  SPRITE_FX_VARIANTS_KEY,
  spriteFxVariantsFromManifest,
} from '../appearance/fx-variants';

/** 素材加载场景的 key。 */
export const FX_ASSET_SCENE_KEY = 'fx-assets';

/** 烘焙 manifest 在 Phaser 缓存里的 key（只是缓存键，不进 registry）。 */
const FX_BAKE_MANIFEST_CACHE_KEY = 'fx:bake-manifest';

/**
 * 特效素材加载场景：只预载 sheet，不参与演出。
 *
 * why 没注入素材根就什么都不做：没素材的世界（老入口 / 纯 dev 骨架）照常跑 ——
 *   特效是演出，不是功能。
 */
export class FxAssetScene extends Phaser.Scene {
  constructor() {
    // active: true —— Phaser 的场景数组**只自动启动第一个**（SceneManager 的 bootQueue：
    // entry.autoStart || settings.active）。本场景排在战场后面，必须自己声明 active 才启动。
    super({ key: FX_ASSET_SCENE_KEY, active: true });
  }

  preload(): void {
    const base = this.registry.get(FX_ASSET_BASE_URL_KEY) as string | undefined;
    if (!base) return;
    for (const source of SPRITE_FX_SOURCES) {
      this.load.atlas(
        source.atlasKey,
        fxAssetUrl(base, source.pngPath),
        fxAssetUrl(base, source.jsonPath)
      );
    }
    // 变体清单（发布期烘焙产物）：
    //   dev 态由 vite 中间件供真 JSON（@since v3.3，task_211 / AP-05 —— 此前 dev 拿到的是
    //   SPA 兜底的 index.html，JSON.parse 直接抛 'Unexpected token <'，loader 永不完成）；
    //   release 态是构建产物里的真文件。
    //   清单里没有变体（快照只有基础变体）⇒ 运行时只播基础变体（行为与 task_161 一致）。
    this.load.json(FX_BAKE_MANIFEST_CACHE_KEY, fxAssetUrl(base, FX_BAKE_MANIFEST_NAME));
  }

  /**
   * 加载变体（同一 kind 的另一套 seed 分布），并把清单登记进 registry。
   *
   * why 在 create() 里加载而不是 preload：变体清单**本身**是 preload 拉回来的 JSON，
   *   拉到之后才知道有哪些变体文件 ⇒ 加载顺序天然是「先清单、后图」。
   * why 登记进 registry 而不是构造函数注入：变体是**并行**到达的（战场 create() 早于它们），
   *   精灵特效层每次播放现读 registry（见 objects/sprite-fx-layer.ts）。
   */
  create(): void {
    const base = this.registry.get(FX_ASSET_BASE_URL_KEY) as string | undefined;
    if (!base) return;
    const manifest = this.cache.json.get(FX_BAKE_MANIFEST_CACHE_KEY);
    const variants = spriteFxVariantsFromManifest(manifest, SPRITE_FX_RUNTIME_SKIN);
    // 没有变体（dev / 未烘焙 / manifest 缺失）⇒ 什么都不做，基础变体照播。
    if (variants.length === 0) return;

    for (const variant of variants) {
      this.load.atlas(
        variant.atlasKey,
        fxAssetUrl(base, variant.pngPath),
        fxAssetUrl(base, variant.jsonPath)
      );
    }
    // 监听器先挂再启动：LoaderPlugin 在 preload 之外需要显式 start()（Phaser 文档口径）。
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.registry.set(SPRITE_FX_VARIANTS_KEY, variants);
    });
    this.load.start();
  }
}
