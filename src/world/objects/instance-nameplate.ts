/**
 * 文件职责：**进副本仪式**（@since v3.3，task_187 / M1-13）的表现层 ——
 *   ① 黑场 + 副本名牌（名字 / 分支 / 路径尾段 / 在办 N 条任务）→ ② 淡出 + 相机回 `overviewPose()`。
 *
 * 方案来源：docs/DESIGN-project-map.md §2.2「进入副本的仪式与加载语义」（两拍表）
 *   + §7.1「M1-13」行（验收：① 总时长 ≤ 700ms；② 任意输入即跳到末态；③ 无「地块点亮」「单位入场」两拍）。
 *
 * 输入：场景（Phaser 显示对象与补间）+ 副本名牌数据（**投影自 WorldState**，
 *   由场景经桥接层递进来）+ 两个相机钩子（归位补间 / 归位瞬跳）。
 * 输出：一次性的仪式演出（遮罩 + 名牌 → 淡出 → 交还控制）。
 *
 * 禁止事项：
 *   1. 订阅总线 / import core —— 数据由场景经桥接层递进来（world 侧进出 core 只有桥这一个口子）；
 *   2. import hud / app —— 铁律：world 只认识 core 与 core/bus；
 *   3. 加「地块点亮」「单位入场」两拍 —— **已推迟**（design §2.2 r1 裁决 R1-34）：
 *      每多一拍 = 多一处与 core 状态的耦合，而 M1 的验收点是「切副本不串数据」，不是「切副本好看」；
 *   4. 自己算业务事实 —— 在办任务数由场景按 scope 过滤后的任务数给出，本层只画；
 *   5. 留下未清理的补间 / 显示对象 —— 场景停机时统一收（perf：资源必须可清理）。
 */

import Phaser from 'phaser';

import { VISUAL_PALETTE, WORLD_PALETTE, hexToRgba } from '../theme';

/**
 * 仪式的两拍时长（design §2.2 表 + §7.1 M1-13 行验收①）。
 *
 * why 两拍而不是五拍：r1 评审 R1-34 砍掉了「黑场落下」「地块点亮」「单位入场」——
 *   黑场与遮罩合并（遮罩本身就是黑的），后两拍移入推迟清单（DESIGN-workspace.md §7 P6）。
 */
export const INSTANCE_CEREMONY_METRICS = Object.freeze({
  /** ① 副本名牌那一拍（ms）：遮罩落下 + 名牌停留。 */
  plateMs: 400,
  /** ② 交还控制（ms）：遮罩淡出。 */
  fadeMs: 200,
});

/**
 * 仪式总时长（ms）= 两拍之和。
 *
 * ★ 验收①：总时长 **≤ 700ms**（§7.1 M1-13 行）。这里由两个分拍**算**出来，
 *   不写死 —— 改任一拍时长不会悄悄破掉上限（要破上限得先改这个加法）。
 */
export const INSTANCE_CEREMONY_TOTAL_MS =
  INSTANCE_CEREMONY_METRICS.plateMs + INSTANCE_CEREMONY_METRICS.fadeMs;

/** 遮罩深度：压在一切之上（取景框 200/210 之上 ⇒ 盖住整个战场）。 */
export const INSTANCE_CEREMONY_DEPTH = 1000;

/**
 * 副本名牌的数据（**投影自 WorldState**，不含任何新业务状态）。
 *
 * why 每项都可缺省：state 通道的快照可能先于 / 后于仪式的第一帧到达
 *   （远程模式下快照是异步推来的）⇒ 名牌按「知道的画出来」渲染，
 *   不知道的**先不画**（不拿占位值糊弄），数据到了再补上。
 */
export interface InstanceNameplateData {
  /** 副本名（展示标题；缺省时场景回落到 instanceId）。 */
  readonly name: string;
  /** 分支短名；null = 未知（不在 git 仓库 / 没探测到）。 */
  readonly branch: string | null;
  /** 路径尾段（目录名）；null = 未知（视图还没到）。 */
  readonly pathTail: string | null;
  /** 在办任务数；null = 还没收到任务快照（**不是** 0）。 */
  readonly activeTaskCount: number | null;
}

/** 仪式的相机钩子（相机归位归场景管 —— 位姿真相在场景的相机控制器）。 */
export interface InstanceCeremonyHooks {
  /** 相机归位（正常收尾）：补间回 `overviewPose()`，时长 = 仪式总长。 */
  cameraHome(durationMs: number): void;
  /** 相机归位（跳过）：**瞬跳**到 `overviewPose()`（跳到末态，不补间）。 */
  cameraHomeNow(): void;
}

/** 名牌样式（改观感只动这里）。 */
interface NameplateStyle {
  /** 遮罩色（战场底色 = 深夜蓝；遮罩本身就是那层「黑场」）。 */
  readonly maskColor: number;
  /** 遮罩不透明度（1 = 完全盖住战场）。 */
  readonly maskAlpha: number;
  /** 副本名文字色（我方主色青蓝）。 */
  readonly nameColor: string;
  /** 分支 / 路径文字色（装饰紫，弱一档）。 */
  readonly metaColor: string;
  /** 在办任务数文字色（进度琥珀）。 */
  readonly countColor: string;
  /** 字体族（含中文回退，避免方框字）。 */
  readonly fontFamily: string;
  /** 副本名字号（px）。 */
  readonly nameFontSize: string;
  /** 副行字号（px）。 */
  readonly metaFontSize: string;
  /** 三行之间的行距（px）。 */
  readonly lineGapPx: number;
}

/** 默认样式（色值全部取自唯一事实源，本文件不另抄一份）。 */
const NAMEPLATE_STYLE: NameplateStyle = Object.freeze({
  maskColor: WORLD_PALETTE.background,
  maskAlpha: 1,
  nameColor: VISUAL_PALETTE.unit,
  metaColor: hexToRgba(VISUAL_PALETTE.accent, 0.85),
  countColor: VISUAL_PALETTE.progress,
  fontFamily: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
  nameFontSize: '30px',
  metaFontSize: '15px',
  lineGapPx: 26,
});

/** 仪式状态机（world 内部的表现态，不进 core —— 铁律 1）。 */
type CeremonyState = 'idle' | 'playing' | 'settled';

/**
 * 副本名牌板：**进副本仪式**的两拍演出。
 *
 * 生命周期：`start`（场景进副本时）→ （数据陆续到 → `setData` 补内容）
 *   → 末态（淡出收尾）或 `skip`（任意输入）→ `destroy`（场景停机）。
 */
export class InstanceNameplate {
  private readonly scene: Phaser.Scene;
  private readonly hooks: InstanceCeremonyHooks;
  /** 全屏遮罩（= 黑场 + 遮罩，合并成一层）。 */
  private mask: Phaser.GameObjects.Rectangle | null = null;
  /** 名牌三行：副本名 / 分支 + 路径 / 在办任务数。 */
  private title: Phaser.GameObjects.Text | null = null;
  private meta: Phaser.GameObjects.Text | null = null;
  private count: Phaser.GameObjects.Text | null = null;
  /** 淡出补间（名牌那一拍结束后才开始跑 ⇒ delay = plateMs）。 */
  private fadeTween: Phaser.Tweens.Tween | null = null;
  /** 当前名牌数据（null = 还没收到视图）。 */
  private data: InstanceNameplateData | null = null;
  /** 仪式状态（表现态私有）。 */
  private state: CeremonyState = 'idle';

  constructor(scene: Phaser.Scene, hooks: InstanceCeremonyHooks) {
    this.scene = scene;
    this.hooks = hooks;
  }

  /** 仪式是否**还在演**（场景据此吞掉输入：仪式期间的一次点击不该选中单位）。 */
  get active(): boolean {
    return this.state === 'playing';
  }

  /** 仪式是否已到末态（遮罩淡出 / 相机归位都办完了）。 */
  get settled(): boolean {
    return this.state === 'settled';
  }

  /**
   * 开始仪式（场景在 `create()` 里按「这次是进副本」调用）。
   *
   * 时间线（一条补间表达两拍）：
   *   t=0        遮罩落下（不透明黑场）+ 名牌就位；
   *   t=0..400   名牌那一拍（淡出补间的 delay 段）；
   *   t=400..600 遮罩淡出（② 交还控制）⇒ t=600 末态（相机也恰好归位）。
   *
   * @param data 名牌初始数据（视图可能还没到 ⇒ 场景传它手上有的那份）。
   */
  start(data: InstanceNameplateData): void {
    if (this.state !== 'idle') return;
    this.state = 'playing';
    this.data = data;

    const { width, height } = this.viewport();
    this.mask = this.scene.add
      .rectangle(0, 0, width, height, NAMEPLATE_STYLE.maskColor, NAMEPLATE_STYLE.maskAlpha)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(INSTANCE_CEREMONY_DEPTH);
    this.title = this.makeLine(width / 2, height / 2 - NAMEPLATE_STYLE.lineGapPx, NAMEPLATE_STYLE.nameFontSize, NAMEPLATE_STYLE.nameColor);
    this.meta = this.makeLine(width / 2, height / 2, NAMEPLATE_STYLE.metaFontSize, NAMEPLATE_STYLE.metaColor);
    this.count = this.makeLine(width / 2, height / 2 + NAMEPLATE_STYLE.lineGapPx, NAMEPLATE_STYLE.metaFontSize, NAMEPLATE_STYLE.countColor);
    this.renderPlate();

    // 相机与遮罩**并行**归位：t=600 时两者同时到位（总时长仍是 600ms ≤ 700ms）。
    this.hooks.cameraHome(INSTANCE_CEREMONY_TOTAL_MS);

    // 两拍 = 一条补间（delay = 名牌那一拍，duration = 淡出）。
    this.fadeTween = this.scene.tweens.add({
      targets: [this.mask, this.title, this.meta, this.count],
      alpha: 0,
      delay: INSTANCE_CEREMONY_METRICS.plateMs,
      duration: INSTANCE_CEREMONY_METRICS.fadeMs,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.fadeTween = null;
        this.settle();
      },
    });
  }

  /**
   * 补 / 改名牌内容（数据后到时调用）。
   *
   * why 允许「后到」：远程模式下世界态是异步推来的，第一帧可能还没有视图
   *   ⇒ 名牌按「知道的画」渲染，数据到了再补上（不重演仪式）。
   */
  setData(data: InstanceNameplateData): void {
    this.data = data;
    this.renderPlate();
  }

  /**
   * 跳过（任意输入 / ESC）—— 立即到末态。
   *
   * why 是「瞬跳」而不是「等剩下的时长」：验收②「任意输入即跳到末态」——
   *   输入那一刻遮罩就撤掉、相机就瞬跳回 `overviewPose()`，
   *   用户不必看完剩下几百毫秒的仪式。
   */
  skip(): void {
    if (this.state !== 'playing') return;
    // 末态：遮罩与名牌撤掉、补间收掉（与「演完」走同一条收尾路径 —— 两种末态长得一样）。
    this.settle();
    // 相机瞬跳回全景（不走补间 —— 跳到末态就是末态）。
    this.hooks.cameraHomeNow();
  }

  /** 视口变了（窗口 resize）：遮罩跟着铺满，名牌回到正中。 */
  resize(width: number, height: number): void {
    this.mask?.setSize(width, height);
    this.title?.setPosition(width / 2, height / 2 - NAMEPLATE_STYLE.lineGapPx);
    this.meta?.setPosition(width / 2, height / 2);
    this.count?.setPosition(width / 2, height / 2 + NAMEPLATE_STYLE.lineGapPx);
  }

  /** 场景停机：补间与显示对象一并回收（perf：资源必须可清理）。 */
  destroy(): void {
    this.settle();
    this.data = null;
  }

  /**
   * 收尾（末态）：撤补间、撤显示对象、状态置 `settled`。
   *
   * why 两条路径（演完 / 被跳过）共用它：**末态必须长得一样** ——
   *   战场露出来、名牌和遮罩都不在场上、没有孤儿补间还在改 alpha。
   */
  private settle(): void {
    this.state = 'settled';
    // 撤掉还没跑完的淡出补间（不留下一个还在改 alpha 的孤儿补间）。
    this.fadeTween?.remove();
    this.fadeTween = null;
    // 遮罩与名牌撤掉（末态 = 战场直接露出来）。
    this.mask?.destroy();
    this.mask = null;
    this.title?.destroy();
    this.title = null;
    this.meta?.destroy();
    this.meta = null;
    this.count?.destroy();
    this.count = null;
  }

  /** 造一行名牌文字（居中 / 屏幕空间 / 压在遮罩之上）。 */
  private makeLine(
    x: number,
    y: number,
    fontSize: string,
    color: string
  ): Phaser.GameObjects.Text {
    return this.scene.add
      .text(x, y, '', {
        fontFamily: NAMEPLATE_STYLE.fontFamily,
        fontSize,
        color,
        align: 'center',
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(INSTANCE_CEREMONY_DEPTH + 1);
  }

  /** 渲染名牌三行（知道的画出来，不知道的不画）。 */
  private renderPlate(): void {
    const data = this.data;
    if (!data) {
      this.title?.setText('');
      this.meta?.setText('');
      this.count?.setText('');
      return;
    }
    this.title?.setText(data.name);
    const meta: string[] = [];
    if (data.branch) meta.push(`分支 ${data.branch}`);
    if (data.pathTail) meta.push(data.pathTail);
    this.meta?.setText(meta.join(' · '));
    this.count?.setText(
      data.activeTaskCount === null ? '' : `在办 ${data.activeTaskCount} 条任务`
    );
  }

  /** 当前视口尺寸（遮罩要铺满 ⇒ 读场景的 scale）。 */
  private viewport(): { width: number; height: number } {
    return { width: this.scene.scale.width, height: this.scene.scale.height };
  }
}
