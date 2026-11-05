/**
 * 文件职责：**Phaser SceneManager 的最小替身**（@since v3.3，task_190 / §7.1「M1-16」行）。
 *
 * ============ 为什么需要它 ============
 *   M1-16 验收要断言「切副本零残留」—— 单位表 / 地图槽是**战场场景**的表现态。
 *   而场景的生死在 Phaser 的 SceneManager 手里（`scene.start` / `scene.stop`）。
 *   node 里没有 Phaser ⇒ 本文件按 **Phaser 3.90 的真实语义**（见下）复刻这一小段。
 *
 * ============ 复刻的是哪几条语义（对着 node_modules/phaser/src/scene/SceneManager.js 核过）============
 *   ① `start(key, data)`：
 *      - 场景**已在跑** ⇒ 先 `sys.shutdown()`（⇒ 触发 SHUTDOWN 事件）再重启
 *        （SceneManager.js:1225-1232）；
 *      - 场景不在跑 ⇒ 直接启动；
 *      - 启动 = **同步**走 `init(data)` → `create()`（bootScene:477-513）。
 *   ② `stop(key)`：触发 SHUTDOWN 事件（SceneManager.js:1300 ⇒ `sys.shutdown(data)`）。
 *   ③ **场景实例被复用**：`start` 不新建场景对象 ⇒ 字段初始化器只跑一次
 *      ⇒ 跨副本残留的根因（这正是 M1-09「四板显式清理」要对抗的那件事）。
 *   ④ `game.registry` 是**全游戏共享**的一份（所有场景的 `this.registry` 是同一口）。
 *
 * 输入：场景类（真类）+ 一份共享键仓。
 * 输出：一个能 `start` / `stop` / `get` 的场景管理器。
 * 禁止事项：
 *   1. 在这里实现任何 Stratix 业务 —— 本文件只复刻 Phaser 的场景生命周期；
 *   2. 偷偷替场景「修好」什么 —— 场景跑出什么问题，本文件如实呈现（那正是要验的）。
 *
 * @since v3.3，task_190。
 */

import { StubRegistry } from './phaser-stub';

/** Phaser 的 SHUTDOWN 事件名（Phaser.Scenes.Events.SHUTDOWN）。 */
const SHUTDOWN = 'shutdown';

/** 场景的最小结构面（本替身只碰这几个成员）。 */
interface StubSceneLike {
  init?: (data?: unknown) => void;
  create?: () => void;
  events?: { emit?: (event: string, payload?: unknown) => unknown };
  registry?: StubRegistry;
}

/** 场景类的构造形状。 */
type SceneClass = new () => StubSceneLike;

export class StubSceneManager {
  /** 场景实例表（key → 场景对象；**实例被复用**，与 Phaser 同形）。 */
  private readonly scenes = new Map<string, StubSceneLike>();
  /** 当前在跑的场景 key 集合（Phaser 用 `sys.settings.status` 表达同一件事）。 */
  private readonly running = new Set<string>();
  /** 全游戏共享的键仓（Phaser 的 `game.registry`）。 */
  readonly registry: StubRegistry;

  constructor(registry: StubRegistry = new StubRegistry()) {
    this.registry = registry;
  }

  /** 登记一个场景（Phaser 的 `scene: [BattlefieldScene, ...]`）。 */
  add(key: string, sceneClass: SceneClass): void {
    const scene = new sceneClass();
    // Phaser：所有场景的 `this.registry` 是同一口 `game.registry`。
    scene.registry = this.registry;
    this.scenes.set(key, scene);
  }

  /** 取场景实例（Phaser 的 `scene.get(key)`）。 */
  get(key: string): StubSceneLike | undefined {
    return this.scenes.get(key);
  }

  /** 该场景当前在不在跑（Phaser 的 `sys.isActive()`）。 */
  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  /**
   * 起一个场景（Phaser 的 `scene.start(key, data)`）。
   * 语义见文件头①：已在跑 ⇒ 先 shutdown 再重启；启动 = 同步 init(data) → create()。
   */
  start(key: string, data?: unknown): void {
    const scene = this.scenes.get(key);
    if (!scene) throw new Error(`场景未登记：${key}`);
    if (this.running.has(key)) this.shutdownScene(key);
    scene.init?.(data);
    scene.create?.();
    this.running.add(key);
  }

  /** 停一个场景（Phaser 的 `scene.stop(key)`；对没在跑的场景是 no-op）。 */
  stop(key: string): void {
    this.shutdownScene(key);
  }

  /** 关停：发 SHUTDOWN 事件（场景的 `onShutdown` 在那里退订总线、析构表现层）。 */
  private shutdownScene(key: string): void {
    const scene = this.scenes.get(key);
    if (!scene) return;
    if (!this.running.has(key)) return;
    scene.events?.emit?.(SHUTDOWN);
    this.running.delete(key);
  }
}
