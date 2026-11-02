/**
 * 文件职责：**单位动画八态的 dev-only 验收场景**（task_075）——
 *   在一个独立页面里并排摆 8 个样例单位，逐态强制播放 DEMO-PLAN §2 的八种状态，
 *   供人工肉眼验收（八态是否可辨、相位是否错开）。
 *   方案来源：docs/DEMO-PLAN.md §2「单位动画八态」。
 * 输入：DOM 按钮的点击（由 dev/animation-main.ts 转交）。
 * 输出：8 个样例单位（每个强制一种状态）+ 状态标签 + 一行当前态提示。
 * 禁止事项：
 *   1. 被生产入口 import —— 本文件只配 animation-dev.html，vite 不会把它打进正式产物；
 *   2. 灌假单位进**生产战场** —— 假单位只存在于这个 dev 沙盒里，主场景一个都不加；
 *   3. import hud / vue / legacy(stratix-rts) —— 与 world 层同一条铁律；
 *   4. 自己实现动画 —— 本场景只**强制状态**，动画规则全在 appearance/unit-animation.ts。
 *
 * ★ 为什么单独开一个 dev 页而不是往 world-dev.html 上加：
 *   world-dev.html 的契约是「战场上看到什么必须完全来自真实 store，不塞假单位」；
 *   而八态验收恰恰需要**确定性的样例单位**（一个一个状态摆开看）。
 *   两个诉求打架，故另起一页，各守各的契约 —— 别把验收沙盒混进真实数据流。
 *
 * @since v3.3（task_075）。
 */

import Phaser from 'phaser';

import type { UnitView } from '../../core/types';
import { UNIT_ANIMATION_STATES, type UnitAnimationState } from '../appearance/unit-animation';
import { UnitLayer } from '../objects/unit-layer';
import { UnitRegistry } from '../objects/unit-registry';
import { WORLD_PALETTE } from '../theme';

/** 场景 key（dev 专用，不与生产场景重名）。 */
export const ANIMATION_DEV_SCENE_KEY = 'animation-dev';

/** 八态的中文标签（dev 按钮与单位名牌共用一份，避免两处对不上）。 */
export const ANIMATION_STATE_LABELS: Readonly<Record<UnitAnimationState, string>> = Object.freeze({
  idle: '待机',
  working: '工作',
  stuck: '卡住',
  completed: '完成',
  slacking: '摸鱼',
  selected: '选中',
  hover: 'hover',
  clicked: '点击',
});

/** 样例单位的业务态：让「回到自动」模式下八种基态都能看到。 */
const SAMPLE_STATUS: readonly ('idle' | 'busy' | 'error')[] = [
  'idle',
  'busy',
  'error',
  'idle',
  'idle',
  'idle',
  'idle',
  'idle',
];

/** 样例单位的排布：横向一行，单位间距（世界坐标 px）。 */
const SAMPLE_GAP = 170;
/** 样例单位所在的行（世界坐标 y）。 */
const SAMPLE_Y = 1200;

export class AnimationDevScene extends Phaser.Scene {
  private readonly units = new UnitRegistry();
  private unitLayer!: UnitLayer;

  constructor() {
    super(ANIMATION_DEV_SCENE_KEY);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(WORLD_PALETTE.background);
    this.drawStage();

    this.unitLayer = new UnitLayer(this, this.units, null);
    this.units.sync(this.sampleViews());
    this.layoutSamples();
    this.unitLayer.sync();

    // 相机：把一排样例单位框进视野（视野宽度不够时自动降 zoom）。
    const viewWidth = this.scale.width;
    const totalWidth = SAMPLE_GAP * (UNIT_ANIMATION_STATES.length - 1);
    const zoom = Math.max(0.4, Math.min(1, (viewWidth - 160) / (totalWidth + 200)));
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(this.sampleCenterX(), SAMPLE_Y);
    this.unitLayer.setCameraZoom(zoom);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unitLayer.destroy();
      this.units.destroy();
    });
  }

  /**
   * 把某种状态强制给全部样例单位（dev 逐态验收）。
   * 传 null = 回到业务态自动派生。
   */
  applyStateToAll(state: UnitAnimationState | null): void {
    for (const id of this.sampleIds()) this.unitLayer.setAnimationState(id, state);
  }

  /**
   * 「同屏八态」：第 i 个单位强制播放第 i 种状态 —— 一眼看完八态是否各自可辨。
   */
  showcaseAllStates(): void {
    const ids = this.sampleIds();
    UNIT_ANIMATION_STATES.forEach((state, index) => {
      const id = ids[index];
      if (id) this.unitLayer.setAnimationState(id, state);
    });
  }

  /** 样例单位 id（按展示顺序）。 */
  private sampleIds(): string[] {
    return this.units.list().map((object) => object.id);
  }

  /** 样例单位的 UnitView（**dev 沙盒专用**：名字即状态标签，便于对号入座）。 */
  private sampleViews(): UnitView[] {
    return UNIT_ANIMATION_STATES.map((state, index) => ({
      id: `anim_demo_${index}`,
      name: ANIMATION_STATE_LABELS[state],
      status: SAMPLE_STATUS[index] ?? 'idle',
      // 有任务 → 待机基态；无任务 → 摸鱼基态（自动模式下两者要能分别看到）。
      missionId: index === 0 || index === 1 || index === 2 ? `demo_mission_${index}` : null,
      power: 50,
    }));
  }

  /** 样例单位的落位：横向一行（注册表默认是网格落位，dev 页要的是「一排摆开」）。 */
  private layoutSamples(): void {
    const objects = this.units.list();
    objects.forEach((object, index) => {
      object.setPosition(this.sampleX(index), SAMPLE_Y);
    });
  }

  /** 第 index 个样例单位的 x。 */
  private sampleX(index: number): number {
    return this.sampleCenterX() + (index - (UNIT_ANIMATION_STATES.length - 1) / 2) * SAMPLE_GAP;
  }

  /** 一排样例单位的中点 x。 */
  private sampleCenterX(): number {
    return 1600;
  }

  /** 舞台底纹：一条基线 + 每单位一个站位圈（让「脚下的环 / 落地星尘」有参照物）。 */
  private drawStage(): void {
    const g = this.add.graphics();
    g.lineStyle(1, WORLD_PALETTE.grid, 1);
    g.lineBetween(0, SAMPLE_Y + 40, 3200, SAMPLE_Y + 40);
    UNIT_ANIMATION_STATES.forEach((_state, index) => {
      g.lineStyle(1, WORLD_PALETTE.grid, 1);
      g.strokeCircle(this.sampleX(index), SAMPLE_Y + 18, 26);
    });
  }
}
