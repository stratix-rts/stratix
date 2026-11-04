/**
 * 文件职责：战场单位**形象精灵带**的取图端口 —— world 侧只认这个接口，合成在 app 层。
 *   任务：.long-run-agent/tasks/task_029.md「战场单位渲染用 AgentProfile.appearance 合成形象」。
 * 输入：角色 id + 该角色的外观（core 广播的 UnitView.appearance）。
 * 输出：一张**走路精灵带**画布（4 个方向 × 走路帧），或 null（取不到）。
 * 禁止事项：
 *   1. import hud / app —— world 不认识组合根；实现由 app 层注入（见 app/services/unit-sprite-source.ts）；
 *   2. 在 world 层自己合成 —— world/appearance 是零 DOM 模块，画布与图片对象要 app 层注入；
 *   3. 无上限缓存 —— 缓存由渲染层（unit-layer）按角色 id 持有并封顶。
 *
 * ★ 为什么走端口而不是 world 直接调合成器：
 *   LPC 素材在浏览器里合成需要 canvas / Image 两个 DOM 能力，而 world 层零 DOM（world/README 铁律）。
 *   于是"取图"这件事由 app 层（唯一能同时认识 hud 与 world 的组合根）实现，
 *   world 只拿到一张画布 —— 铁律不破，职责也不串。
 */

import type { CharacterAppearance } from '../../core/types';

/**
 * 形象精灵源在 Phaser game registry 里的键。
 * why 走 registry：BattlefieldScene 由 Phaser 自己实例化（构造器拿不到注入），
 *   组合根把实现放进 game.registry，场景按 key 取 —— 不引入模块级全局状态。
 */
export const UNIT_SPRITE_SOURCE_KEY = 'strat.unit-sprite-source';

/** 形象精灵源（world 侧的依赖面）。 */
export interface UnitSpriteSource {
  /**
   * 取某角色的走路精灵带。
   *
   * @param characterId 角色 id（world 侧用它做纹理 key 与缓存键）。
   * @param appearance 角色外观（体型 + 部位变体）。
   *   **可为 null**（@since v3.8，task_140）：角色没自带外观（老档案 / 没绑种类）时，
   *   由**实现方**按 agent 种类取品牌预设或随机合成（见 world/appearance/character-look.ts）——
   *   world 层不认"品牌预设"这份知识，端口只负责"给我一张能看的脸"。
   * @returns 精灵带画布；null = 取不到（素材缺失 / 合成失败 / 素材全是空的）
   *   —— 渲染侧据此回落到占位形体，不画空白。
   */
  loadWalkBand(
    characterId: string,
    appearance: CharacterAppearance | null
  ): Promise<HTMLCanvasElement | null>;
}
