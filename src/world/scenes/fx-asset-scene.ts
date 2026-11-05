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
 */

import Phaser from 'phaser';

import { FX_ASSET_BASE_URL_KEY, fxAssetUrl } from '../appearance/fx-asset-path';
import { SPRITE_FX_SOURCES } from '../appearance/fx-sources.generated';

/** 素材加载场景的 key。 */
export const FX_ASSET_SCENE_KEY = 'fx-assets';

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
  }

  /** 加载完就没什么可做的了（留着场景实例，方便观测加载状态）。 */
  create(): void {
    // 刻意为空：本场景只负责把素材放进 texture manager。
  }
}
