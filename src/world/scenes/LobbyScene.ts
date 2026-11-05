/**
 * 文件职责：**大厅场景**（@since v3.3，task_186 / M1-12）—— 「workspace 总览」的世界层底景。
 *   方案来源：docs/DESIGN-project-map.md §2.1（大厅态 = 独立世界场景）+ §7.1「M1-12」行。
 * 输入：Phaser 场景自身的显示列表与补间（**不订阅总线、不读 core 状态**）。
 * 输出：一张氛围底（星尘点阵 + 地平线光带 + 一条呼吸补间），随场景停启而生死。
 * 禁止事项：
 *   1. 持有业务状态 —— 大厅卡片由 HUD 画（数据在 WorldState，见 §7.1「M1-14」行），
 *      本场景只画背景/氛围 ⇒ world 零业务状态（铁律 1）；
 *   2. import core / core-bus —— 大厅不认识副本、任务、单位：一个字节都不读；
 *   3. import hud / app —— 铁律：world 只认识 core；
 *   4. 订阅总线 —— 一订阅就等于把业务事实引进 world（铁律 1 的红线）；
 *   5. 留下未清理的显示对象 / 补间 —— shutdown 时统一收（perf：资源必须可清理）。
 *
 * ★ 为什么大厅是**场景**而不是 HUD 屏位（design §2.1）：
 *   大厅要显示每个副本的地图缩略/状态 ⇒ 那是世界层的渲染职责（HUD 零 Phaser 依赖）。
 *   本任务（M1-12）只落地「背景/氛围」这一层；卡片网格是 HUD 的活（M1-14）。
 *
 * ★ 互斥与常驻（design §7.1「M1-12」行）：
 *   `LobbyScene ⇄ BattlefieldScene` 互斥、`FxAssetScene` 常驻不受影响 —— 裁决集中在
 *   scenes/scene-switch.ts（唯一切换入口）。本场景**不自己**停/起别的场景：
 *   切换是策略，不是氛围 —— 策略只有一处说了算，才不会两处各切一半。
 *
 * ★ 为什么开机不进大厅（active: false）：
 *   Phaser 的场景数组**只自动启动第一个**（SceneManager 的 bootQueue：entry.autoStart || settings.active），
 *   本场景排在战场之后 ⇒ 必须显式声明。声明成 false = 开机照旧进战场，
 *   大厅是「退出副本」后的落点（design §2.1 的切换路径）—— 不擅自改开机形态。
 */

import Phaser from 'phaser';

import { WORLD_PALETTE } from '../theme';

/** 大厅场景的 key。 */
export const LOBBY_SCENE_KEY = 'lobby';

/**
 * 大厅氛围参数（本地常量）。
 * why 不进 core 的视觉事实源：氛围是**装饰**，不是业务语义 ——
 *   core/theme/visual-spec.ts 管的是「有意义的那部分颜色与尺寸」（铁律 1 的边界）。
 */
export const LOBBY_AMBIENCE = Object.freeze({
  /** 星尘点数（静态画一次，不逐帧重绘 —— perf）。 */
  moteCount: 160,
  /** 星尘点半径（px）。 */
  moteRadius: 1.6,
  /** 星尘铺开的最小横向范围（px）—— 视口再小也铺得满。 */
  minSpanX: 1600,
  /** 星尘铺开的最小纵向范围（px）。 */
  minSpanY: 1000,
  /** 地平线光带的横向铺开范围（px）—— 盖过视口，缩放窗口也不露边。 */
  spread: 2400,
  /** 地平线光带的层数。 */
  horizonBands: 6,
  /** 地平线光带每层的高度（px）。 */
  bandHeight: 26,
  /** 呼吸补间的单程时长（ms）—— 一个来回约 8s，慢到不抢眼。 */
  breathMs: 4200,
  /** 呼吸补间的透明度区间（起 → 止）。 */
  breathAlpha: Object.freeze({ from: 0.45, to: 1 }),
});

/**
 * 大厅场景：只画背景/氛围，不持任何业务状态。
 *
 * 生命周期：start（显式）→ init → create → （停）→ shutdown → 清理。
 *   why 在 shutdown 清理：Phaser **不会**在场景停机时自动清空显示列表
 *   （node_modules/phaser/src/scene/Systems.js 的 shutdown 只发事件）⇒ 不清就泄漏。
 */
export class LobbyScene extends Phaser.Scene {
  /** 星尘点阵（静态 Graphics）。 */
  private starfield: Phaser.GameObjects.Graphics | null = null;
  /** 地平线光带（静态 Graphics + 呼吸补间）。 */
  private horizon: Phaser.GameObjects.Graphics | null = null;
  /** 呼吸补间（停机时必须摘掉 —— perf：资源必须可清理）。 */
  private breath: Phaser.Tweens.Tween | null = null;

  constructor() {
    // active: false —— 开机不进大厅（见文件头）；场景数组只自动启动第一个。
    super({ key: LOBBY_SCENE_KEY, active: false });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(WORLD_PALETTE.background);

    // 星尘：确定性分布（R2 低差异序列）⇒ 每次进大厅长得一样，且不引入随机源（好复现）。
    this.starfield = this.add.graphics();
    this.drawStarfield();

    // 地平线光带：静态几何 + 一条呼吸补间（氛围的全部动态就这一条 —— perf：不做逐帧重绘）。
    this.horizon = this.add.graphics();
    this.drawHorizon();
    this.breath = this.tweens.add({
      targets: this.horizon,
      alpha: { from: LOBBY_AMBIENCE.breathAlpha.from, to: LOBBY_AMBIENCE.breathAlpha.to },
      duration: LOBBY_AMBIENCE.breathMs,
      yoyo: true,
      repeat: -1,
    });

    // 停机时统一收（显示对象 + 补间）—— 与战场场景同一纪律。
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  /** 场景停机：回收显示对象与补间（perf：资源必须可清理）。 */
  private onShutdown(): void {
    this.breath?.remove();
    this.breath = null;
    this.starfield?.destroy();
    this.starfield = null;
    this.horizon?.destroy();
    this.horizon = null;
  }

  /** 星尘点阵：R2 低差异序列铺点（确定性 ⇒ 无随机源 ⇒ 每次一样）。 */
  private drawStarfield(): void {
    const graphics = this.starfield;
    if (!graphics) return;
    // 铺开范围按视口给（至少一块最小面积）—— 镜头不动也不会看到「点阵的边」。
    const spanX = Math.max(this.scale.width * 1.2, LOBBY_AMBIENCE.minSpanX);
    const spanY = Math.max(this.scale.height * 1.2, LOBBY_AMBIENCE.minSpanY);
    for (let i = 0; i < LOBBY_AMBIENCE.moteCount; i += 1) {
      // R2 序列（Roberts 的广义黄金比）：两个方向各自错开 ⇒ 不会出现单条对角线。
      const u = (i * 0.7548776662466927 + 0.5) % 1;
      const v = (i * 0.5698402909980532 + 0.5) % 1;
      // alpha 分五档：纯随机看着脏，确定性的档位看着像有远近层次。
      const alpha = 0.14 + 0.06 * (i % 5);
      graphics.fillStyle(WORLD_PALETTE.accent, alpha);
      graphics.fillCircle(u * spanX, v * spanY, LOBBY_AMBIENCE.moteRadius);
    }
  }

  /** 地平线光带：自上而下层数递增、alpha 递增 ⇒ 越靠下越浓（远景压深）。 */
  private drawHorizon(): void {
    const graphics = this.horizon;
    if (!graphics) return;
    const bands: number = LOBBY_AMBIENCE.horizonBands;
    const baseY = Math.max(0, this.scale.height - bands * LOBBY_AMBIENCE.bandHeight);
    for (let i = 0; i < bands; i += 1) {
      const t = bands === 1 ? 1 : i / (bands - 1);
      graphics.fillStyle(WORLD_PALETTE.accent, 0.02 + 0.05 * t);
      graphics.fillRect(
        0,
        baseY + i * LOBBY_AMBIENCE.bandHeight,
        LOBBY_AMBIENCE.spread,
        LOBBY_AMBIENCE.bandHeight
      );
    }
  }
}
