/**
 * 文件职责：**world 场景切换策略**（@since v3.3，task_186 / M1-12）——
 *   「大厅 ⇄ 战场」互斥 + 「特效素材场景常驻」的唯一裁决点。
 *   方案来源：docs/DESIGN-project-map.md §2.1「切换路径」+ §7.1「M1-12」行。
 * 输入：Phaser 的 SceneManager（组合根持有）+ 场景键 / scene data。
 * 输出：一次切换（停一个场景、起另一个场景）。
 * 禁止事项：
 *   1. 碰常驻场景 —— FxAssetScene（特效素材管线，task_161 的 pixelfx 素材建在上面）
 *      **永不**随切换停启：切一次战场就把它一起停了，素材管线当场断掉；
 *   2. 携带业务状态 —— 只搬场景键与 scene data（instanceId 走 Phaser 的 scene data 通道，
 *      战场自己取；本模块不存任何一份）；
 *   3. import core / app —— 纯 Phaser 策略；core 的 project.changed 由组合根接进来再调这里；
 *   4. 自己写第二套切换口径 —— 互斥只有一处说了算，才不会两处各切一半。
 *
 * ★ 为什么要「互斥」而不是「两个都亮着」（design §2.1）：
 *   副本间的单位互不可见靠「一进程一活跃实例 + 切换即全量重载」保证，
 *   靠"隐藏"实现 = 两份状态同时在内存 = 真相分裂（撞铁律 1）。
 */

import Phaser from 'phaser';

import { BATTLEFIELD_SCENE_KEY } from './BattlefieldScene';
import { LOBBY_SCENE_KEY } from './LobbyScene';
import { FX_ASSET_SCENE_KEY } from './fx-asset-scene';

/**
 * 常驻场景键：**不随大厅 ⇄ 战场切换停启**（design §7.1「M1-12」行）。
 * 语义：常驻场景 = 常驻 effect（dsh 的 plugin-manager 同款：注册即 effect，卸载才回收）。
 */
export const RESIDENT_SCENE_KEYS: readonly string[] = Object.freeze([FX_ASSET_SCENE_KEY]);

/**
 * 切到**大厅态**：战场停摆 ⇒ 大厅起（互斥的前一半）。
 *
 * why 停战场在前、起大厅在后：先让战场把表现态收干净（shutdown → 桥接层退订），
 *   大厅起来时不会与残留的战场单位同屏。
 */
export function switchToLobby(sceneManager: Phaser.Scenes.SceneManager): void {
  sceneManager.stop(BATTLEFIELD_SCENE_KEY);
  sceneManager.start(LOBBY_SCENE_KEY);
}

/**
 * 切到**战场态**：大厅停摆 ⇒ 战场起（互斥的后一半）。
 *
 * instanceId 走 Phaser 的 scene data 通道（design §2.1）—— **不走全局变量**：
 *   这是解除「BattlefieldScene 单例假设」的抓手；战场读它的时机在 design §2.5 那条任务里。
 */
export function switchToBattlefield(
  sceneManager: Phaser.Scenes.SceneManager,
  instanceId?: string | null
): void {
  sceneManager.stop(LOBBY_SCENE_KEY);
  // 恒传对象（哪怕空）—— Phaser 的 start(key, undefined) 会保留上一次的 scene data，
  //   那会让「上一次进的是哪个副本」悄悄渗进下一次。
  sceneManager.start(BATTLEFIELD_SCENE_KEY, instanceId ? { instanceId } : {});
}
