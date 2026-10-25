/**
 * 文件职责：把 UnitRegistry 里的单位对象画到 Phaser 画面上，并显示选择态。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/objects 单位」。
 * 输入：Phaser 场景 + UnitRegistry（单位真相）+ 选择集 / 预览集 id + 形象精灵源（可选）。
 * 输出：屏幕上与单位一一对应的显示对象；命中测试委托给 UnitRegistry。
 * 禁止事项：
 *   1. 持有业务状态 —— 业务真相在 core，本层只读 UnitView 的 status 决定颜色；
 *   2. import hud / vue / legacy(stratix-rts) —— 铁律：world 不认识 hud，HUD 才认识 world；
 *   3. 每帧全量重建 GameObject —— sync() 按 id 增删改，稳定的单位复用同一显示对象（perf）；
 *   4. 现在就画业务态文字 / 徽标 —— 本任务只出最小可辨形体，文字与徽标留给后续任务。
 *
 * 配色：普通单位按业务态上色（idle / busy / offline / error，见下方常量）；
 *   带皮肤的 agent 单位（@since v3.9，角色单位）按**皮肤徽标色**上色 ——
 *   颜色换算在 world/theme.ts（皮肤登记表在 core/theme/skin-registry.ts，world 不认识 hud）。
 *
 * 形象（@since v3.10，task_029）：单位带 appearance 时，用合成好的 LPC 精灵表当身体，
 *   并播走路动画；没有形象（或合成失败）→ 回落到占位圆。合成在 app 层做
 *   （见 objects/unit-sprite-source.ts 的端口），本层只管贴图与帧步进。
 *
 * RTS 操作表现（@since v3.21，task_045）。血缘（v2 考古）：选中圈与移动手感移植自
 *   master 分支 stratix-rts —— 选中圈 = sprites/AgentSprite.drawSelectionRing（主圈 2.5px，
 *   颜色 = v2 colors.status.success，镜像 srf-success #6fcf97，与 TASK_FX_STYLE.done 同源；
 *   v3 压成脚下椭圆）；移动 = systems/MovementSystem 的常速口径（300px/s，ease-out 收尾），
 *   v2 的逐帧位移积分换成 Phaser tween，到向朝向保留为 4 行简化版（精灵表只有 4 行）。
 *   ★ 位置立即生效于状态（UnitObject），tween 只是渲染过渡 —— 状态广播不会把半路上的
 *   单位臈移到终点（sync 对活跃 tween 跳过位置贴齐）。
 *
 * 战场生命感（@since v3.37，task_062）：呼吸微动画 / 头顶名字标签（名字+Lv 小字，开关
 *   + zoom 阈值见 unit-presence.ts）/ 说话气泡（unit.speaking 事件驱动）。全部由**一个**
 *   presence tick（约 60ms/步）驱动，非每单位独立 tween（≤50 单位满帧预算）；规则与常量
 *   全在 objects/unit-presence.ts（零 Phaser 纯逻辑，单测在那边），本层只兑现渲染：
 *   - 呼吸写 sprite.scaleY，与 moveTo tween（容器坐标）/ task-fx（独立 Container）属性面
 *     不相交，叠加不冲突；离线（online=false）呼吸与走路帧都停（静止灰显更「死」）；
 *   - 名字 / Lv / 气泡 Text 内嵌在单位 Container（随 tween / 离线 alpha / 对账生命周期走，
 *     不另立节点池）；层序：容器内 body→ring→精灵→名字→Lv→气泡，全局层面任务浮标
 *     （depth 5）仍压在单位容器（depth 0）之上 —— z 协调注释见 unit-presence.ts 文件头。
 */

import Phaser from 'phaser';

import type { Bounds, UnitStatus } from '../../core/types';
import { resolveUnitColor } from '../theme';

import { UNIT_HIT_RADIUS, type UnitObject } from './unit-object';
import type { UnitRegistry } from './unit-registry';
import {
  MAX_UNIT_SHEET_TEXTURES,
  UNIT_FRAME_SIZE,
  UNIT_SHEET_ROWS,
  UNIT_SPRITE_SCALE,
  UNIT_WALK_CYCLE,
  UNIT_WALK_DIRECTION,
  UNIT_WALK_FPS,
  unitFrameName,
  unitSheetTextureKey,
  resolveUnitSheetKey,
} from './unit-sprite-sheet';
import {
  BREATH_STYLE,
  breathPhaseFor,
  breathScaleY,
  NAMETAG_STYLE,
  nametagVisible,
  overlayVisible,
  readNametagsToggle,
  shouldBreathe,
  SPEAKING_BUBBLE_STYLE,
  speakingDotAlpha,
  type NametagStorage,
} from './unit-presence';
import type { UnitSpriteSource } from './unit-sprite-source';

const UNIT_RADIUS = UNIT_HIT_RADIUS * 0.8;

/**
 * 选中圈样式（task_045）：脚下椭圆，单选/多选统一一套。
 * 血缘：v2 AgentSprite.drawSelectionRing 的三层同心圈口径（主圈 2.5px）—— v3 压成
 * 单层椭圆（俯视透视感，rx=2ry）；颜色 = v2 colors.status.success（镜像 srf-success）。
 * 颜色可调常量：换色只改这里（皮肤 token 镜像纪律，同 TASK_FX_STYLE 先例）。
 */
const SELECTION_RING_STYLE = {
  /** 选中色（srf-success #6fcf97 —— 与 task-fx 的 done ✓ 同族「正反馈」色）。 */
  color: 0x6fcf97,
  lineWidth: 2.5,
  /** 椭圆半轴（世界坐标 px）。 */
  radiusX: 24,
  radiusY: 12,
  /** 椭圆中心相对容器原点的 y 偏移：精灵脚≈+13、占位圆心=0，取中兼顾两种形体。 */
  offsetY: 6,
  /** 框选预览（拖拽中）：弱色细圈，松手前不误导「已选中」。 */
  previewColor: 0x9ca3af,
  previewLineWidth: 1.5,
  previewAlpha: 0.8,
} as const;

/**
 * 移动动画手感（task_045）。血缘：v2 MovementSystem.DEFAULT_SPEED=300 常速口径 ——
 * 位移 240px ≈ 800ms（规格「800ms ease-out」即此典型距离）；tween 用 Sine.easeOut 收尾。
 * v2 的 ARRIVAL_THRESHOLD=5 对应 MOVE_TWEEN_MIN_DELTA（收紧到 2：阈值内直接贴齐）。
 */
const MOVE_SPEED_PX_PER_SEC = 300;
const MOVE_TWEEN_MIN_DELTA = 2;
const MOVE_TWEEN_MIN_MS = 120;

const COLOR_BY_STATUS: Record<UnitStatus, number> = {
  idle: 0x4f9cf9,
  busy: 0xf5a524,
  offline: 0x5c6470,
  error: 0xef4444,
};

const DEFAULT_STATUS_COLOR = 0x94a3b8;

/**
 * 离线视觉常量（@since v3.30，task_054，agent 健康监测）：CLI 掉线时单位灰显 ——
 * 与 HUD 角色卡的 CSS filter 同档（那边是 grayscale(1) opacity(0.55)；Phaser 没有
 * CSS filter，用 alpha + 灰 tint 近似同一视觉档位）。**皮肤 token 常量**：改档位只动这里，
 * 两侧（这里与 hud 的 --srf-offline-filter）同步改。
 */
const OFFLINE_STYLE_ALPHA = 0.55;
/** 离线精灵 tint（灰化形象；白色 = 无 tint 原色）。 */
const OFFLINE_SPRITE_TINT = 0x8a8f98;
/** 在线 tint（无染色原色）。 */
const ONLINE_SPRITE_TINT = 0xffffff;

/** 有形象时，占位圆缩成脚下的小色点（业务态 / 皮肤色仍然可见）。 */
const SPRITE_DOT_RADIUS = 5;

interface UnitNode {
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Arc;
  /** 选中/预览圈（task_045：脚下椭圆，替代旧圆形环）。 */
  readonly ring: Phaser.GameObjects.Ellipse;
  /** 形象精灵（合成成功后才有；null = 走占位圆）。 */
  sprite: Phaser.GameObjects.Sprite | null;
  /** 当前精灵对应的角色 id（换角色 → 换精灵）。 */
  spriteCharacterId: string | null;
  /** 走路动画的帧下标（cycle 里的下标，不是精灵表列号）。 */
  frameIndex: number;
  /** 当前朝向行号（task_045：随移动方向转面；血缘 = v2 getDirection 的 4 行简化版）。 */
  direction: number;
  /** 进行中的移动 tween（null = 静止）；新目标会顶掉旧的（重下令就改道）。 */
  moveTween: Phaser.Tweens.Tween | null;
  /**
   * 头顶名字标签（task_062）：容器内嵌 Text，随 tween / 离线 alpha 一起走。
   * 名字主行（origin 0.5,1 向上长）与 Lv 小字（origin 0.5,0 向下长）同锚拼两行。
   */
  readonly nameTag: Phaser.GameObjects.Text;
  readonly lvTag: Phaser.GameObjects.Text;
  /** 说话气泡（task_062）：「···」三点脉动，unit.speaking 事件驱动。 */
  readonly speakingTag: Phaser.GameObjects.Text;
  /** 呼吸相位（task_062）：按单位 id 派生，全场相位错开（见 unit-presence.breathPhaseFor）。 */
  readonly breathPhase: number;
  /** 上次渲染的标签文本键（name|level）：变了才 setText（文本重渲是纹理级开销，不能每次对账都写）。 */
  tagKey: string;
  /** 名字标签是否带 Lv 段（level == null 的单位只显名字，不编造数值）。 */
  hasLevel: boolean;
}

/** 一张已缓存的形象精灵表（纹理 key + 最近使用时间）。 */
interface SheetEntry {
  readonly key: string;
  lastUsed: number;
}

/**
 * 单位的 Phaser 显示层：把 UnitRegistry 里的单位画出来，并显示选择 / 预览环。
 * 单位状态与命中判定一律取自 UnitRegistry，本类不持有第二份真相。
 */
export class UnitLayer {
  private readonly nodes = new Map<string, UnitNode>();
  private readonly scene: Phaser.Scene;
  private readonly registry: UnitRegistry;
  private readonly spriteSource: UnitSpriteSource | null;
  private selected = new Set<string>();
  private preview = new Set<string>();

  /** 已缓存的形象精灵表（key = 角色 id）。封顶见 MAX_UNIT_SHEET_TEXTURES。 */
  private readonly sheets = new Map<string, SheetEntry>();
  /** 在途的合成请求（key = 角色 id）：同一角色只合成一次。 */
  private readonly pending = new Map<string, Promise<void>>();
  /** 走路动画的帧步进定时器（全场一个，不给每个单位各开一个）。 */
  private animTimer: Phaser.Time.TimerEvent | null = null;
  /**
   * presence tick（task_062）：全场唯一驱动呼吸 / 气泡脉动 / 名字标签可见性
   * （约 60ms/步 —— 非每单位独立 tween，≤50 单位满帧预算；规则见 unit-presence.ts）。
   */
  private presenceTimer: Phaser.Time.TimerEvent | null = null;
  /** 当前相机 zoom（task_062：名字/气泡的低缩放自动隐藏阈值用；场景喂进来）。 */
  private cameraZoom = 1;
  /** 正在说话的单位集合（task_062：unit.speaking 事件的本地镜像，对账时随节点清理）。 */
  private readonly speakingFlags = new Set<string>();
  /**
   * 本层是否已销毁（场景 shutdown 时置位）。
   * why 需要：形象合成是异步的（要拉几十张精灵图，可能一两秒），
   *   场景在这期间被关掉的话，合成 promise 回来后还会去建纹理 / 重建显示对象 ——
   *   那是在已销毁的场景上操作，会抛错。置位后一律早退。
   */
  private destroyed = false;

  constructor(scene: Phaser.Scene, registry: UnitRegistry, spriteSource: UnitSpriteSource | null = null) {
    this.scene = scene;
    this.registry = registry;
    this.spriteSource = spriteSource;
    // presence tick（task_062）：构造即起（名字标签可见性不依赖精灵，得有人在推进）；
    // 场景 shutdown 由 destroy() 收定时器（同 animTimer / task-fx-layer 口径）。
    this.ensurePresenceTimer();
  }

  /** 对账显示对象：新增建、移除销、位置/状态变化才改属性。 */
  sync(): void {
    if (this.destroyed) return;
    const live = new Set<string>();

    for (const object of this.registry.list()) {
      live.add(object.id);
      const node = this.nodes.get(object.id) ?? this.createNode(object);
      // 移动 tween 活跃时位置真相已在 UnitObject（立即生效），渲染层让 tween 走完 ——
      // 状态广播不该把半路上的单位臈移到终点（tween 只是渲染过渡，task_045）。
      if (!this.isMoving(node)) node.container.setPosition(object.position.x, object.position.y);
      node.body.setFillStyle(this.fillColorOf(object));
      // 离线灰显（task_054）：整容 alpha + 精灵灰 tint（占位圆由 fillColorOf 换离线色）。
      // 与位置/填充色同一口径：每次对账无条件设置（幂等，不追踪上一帧 —— 广播频率低，无所谓）。
      node.container.setAlpha(object.online ? 1 : OFFLINE_STYLE_ALPHA);
      if (node.sprite) node.sprite.setTint(object.online ? ONLINE_SPRITE_TINT : OFFLINE_SPRITE_TINT);
      this.refreshRing(node, object.id);
      this.syncSprite(node, object);
      // 名字标签文本（task_062）：name/level 变了才 setText（纹理级开销，判重见 tagKey）。
      this.refreshTags(node, object);
    }

    for (const id of Array.from(this.nodes.keys())) {
      if (live.has(id)) continue;
      const node = this.nodes.get(id);
      if (node) {
        this.stopMoveTween(node); // 销毁前先停 tween，不给 tween 管理器留死目标
        node.container.destroy();
      }
      this.nodes.delete(id);
      this.speakingFlags.delete(id); // 说话镜像随节点清理（task_062）：单位离场气泡不留残迹
    }
  }

  /** 选择集与框选预览集分开渲染：预览用弱色，松手前不误导用户以为已经选中。 */
  setSelection(unitIds: readonly string[], previewUnitIds: readonly string[]): void {
    this.selected = new Set(unitIds);
    this.preview = new Set(previewUnitIds);
    for (const [id, node] of this.nodes) {
      this.refreshRing(node, id);
    }
  }

  /**
   * 拖拽中的本地框选预览（@since v3.21，task_045）：命中集合直出弱色圈。
   * why 不走总线：拖拽中 pointermove 高频，命中变化经 core 广播一整份 WorldState 太贵；
   * 松手才把终值 id 发给 core（框选闭环，见场景 onPointerUp）。
   */
  setPreviewHighlights(unitIds: readonly string[]): void {
    this.preview = new Set(unitIds);
    for (const [id, node] of this.nodes) {
      this.refreshRing(node, id);
    }
  }

  /** 点击命中：判定规则在 UnitRegistry，这里只做转发，保持命中逻辑可单测。 */
  hitTest(x: number, y: number): UnitObject | null {
    return this.registry.hitTest({ x, y });
  }

  /** 框选命中（@since v3.21，task_045）：判定规则在 UnitRegistry（相交即中），这里只转发。 */
  queryBounds(bounds: Bounds): string[] {
    return this.registry.queryBounds(bounds);
  }

  /**
   * 应用一条 unit.position 同步（@since v3.21，task_045）：位置真相（UnitObject）立即更新，
   * 渲染层用 tween 过渡过去（★ 位置立即生效于状态，动画只是渲染过渡）。
   * 同单位新目标会打断旧 tween（重下令就改道）；位移 ≤ 2px 直接贴齐（不值得起动画）。
   * 手感参数见 MOVE_SPEED_PX_PER_SEC 注释（v2 血缘：常速 300px/s + ease-out 收尾）。
   */
  applyUnitPosition(unitId: string, x: number, y: number): void {
    if (this.destroyed) return;
    const object = this.registry.get(unitId);
    if (!object) return; // 单位不在场：位置丢弃（下次 syncUnits 对账后才有视图）
    const node = this.nodes.get(unitId);
    const moved = object.setPosition(x, y);
    if (!node || !moved) return;

    const dx = x - node.container.x;
    const dy = y - node.container.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= MOVE_TWEEN_MIN_DELTA) {
      this.stopMoveTween(node);
      node.container.setPosition(x, y);
      return;
    }

    this.faceDirection(node, dx, dy);
    this.stopMoveTween(node);
    const duration = Math.max(MOVE_TWEEN_MIN_MS, Math.round((distance / MOVE_SPEED_PX_PER_SEC) * 1000));
    node.moveTween = this.scene.tweens.add({
      targets: node.container,
      x,
      y,
      duration,
      ease: 'Sine.easeOut',
    });
  }

  /**
   * 单位填充色（@since v3.9）：带皮肤的 agent 单位按**皮肤徽标色**上色（身份标识），
   * 没有皮肤的普通单位按业务态颜色（idle / busy / offline / error）。
   * 换肤只需改 skinId —— 颜色换算集中在 world/theme.ts，本层只取结果。
   * @since v3.30（task_054）：离线时无视皮肤色统一用离线灰 —— 灰显是健康信号，
   * 不该被皮肤色盖住（掉线了还在亮皮肤色 = 用户看不出它挂了）。
   */
  private fillColorOf(object: UnitObject): number {
    if (!object.online) return COLOR_BY_STATUS.offline;
    const statusColor = COLOR_BY_STATUS[object.status] ?? DEFAULT_STATUS_COLOR;
    return resolveUnitColor(object.skinId, statusColor);
  }

  destroy(): void {
    // 先置位：让在途的合成 promise 回来后早退（不再碰已销毁的场景）。
    this.destroyed = true;
    if (this.animTimer) {
      this.animTimer.remove(false);
      this.animTimer = null;
    }
    if (this.presenceTimer) {
      this.presenceTimer.remove(false);
      this.presenceTimer = null;
    }
    for (const node of this.nodes.values()) {
      this.stopMoveTween(node);
      node.container.destroy();
    }
    this.nodes.clear();
    this.selected.clear();
    this.preview.clear();
    // 纹理也要收：场景重建时旧纹理会留在纹理管理器里（显存不会自动回收）。
    for (const entry of this.sheets.values()) {
      this.scene.textures.remove(entry.key);
    }
    this.sheets.clear();
    this.pending.clear();
  }

  private createNode(object: UnitObject): UnitNode {
    const id = object.id;
    const body = this.scene.add.circle(0, 0, UNIT_RADIUS, COLOR_BY_STATUS.idle);
    // 选中/预览圈：脚下椭圆（task_045，v2 血缘见 SELECTION_RING_STYLE 注释）——
    // 透明填充打底、样式只走描边，可见性由 refreshRing 按选择/预览集合裁决。
    const ring = this.scene.add
      .ellipse(
        0,
        SELECTION_RING_STYLE.offsetY,
        SELECTION_RING_STYLE.radiusX * 2,
        SELECTION_RING_STYLE.radiusY * 2,
        0x000000,
        0
      )
      .setVisible(false);
    // 头顶覆盖物（task_062）：名字 / Lv 小字 / 说话气泡 —— 全部容器内嵌（见文件头），
    // 初始隐藏，可见性由 presence tick 统一裁决（开关 + zoom）。样式常量在 unit-presence.ts
    // （token 镜像纪律：色值与 hud/theme 同步改）。名字 origin(0.5,1) 向上长、Lv origin(0.5,0)
    // 向下长，两行同锚：名字 [-66-行高, -66]、Lv [-66, 约-54]，刚好让开任务浮标（世界 -44，
    // 半径 11 → 顶到 -55）；气泡悬在名字上方（-84），位置恒定不随开关跳变。
    const nameTag = this.scene.add
      .text(0, NAMETAG_STYLE.yAboveUnit, '', {
        fontFamily: NAMETAG_STYLE.fontFamily,
        fontSize: `${NAMETAG_STYLE.nameFontSize}px`,
        color: NAMETAG_STYLE.nameColor,
        stroke: NAMETAG_STYLE.strokeColor,
        strokeThickness: NAMETAG_STYLE.strokeWidth,
      })
      .setOrigin(0.5, 1)
      .setVisible(false);
    const lvTag = this.scene.add
      .text(0, NAMETAG_STYLE.yAboveUnit, '', {
        fontFamily: NAMETAG_STYLE.fontFamily,
        fontSize: `${NAMETAG_STYLE.lvFontSize}px`,
        color: NAMETAG_STYLE.lvColor,
        stroke: NAMETAG_STYLE.strokeColor,
        strokeThickness: NAMETAG_STYLE.strokeWidth,
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    const speakingTag = this.scene.add
      .text(0, SPEAKING_BUBBLE_STYLE.yAboveUnit, SPEAKING_BUBBLE_STYLE.text, {
        fontFamily: SPEAKING_BUBBLE_STYLE.fontFamily,
        fontSize: `${SPEAKING_BUBBLE_STYLE.fontSize}px`,
        color: SPEAKING_BUBBLE_STYLE.color,
        stroke: NAMETAG_STYLE.strokeColor,
        strokeThickness: NAMETAG_STYLE.strokeWidth,
        backgroundColor: SPEAKING_BUBBLE_STYLE.backgroundColor,
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setVisible(false);
    // 容器内层序（z 协调见文件头）：body → ring → 名字 → Lv → 气泡；精灵 attach 时
    // moveTo 到 index 2（压住圈、垫在文字下 —— 容器内渲染序 = 添加序，无独立 depth）。
    const container = this.scene.add.container(0, 0, [body, ring, nameTag, lvTag, speakingTag]);
    container.setName(`unit:${id}`);

    const node: UnitNode = {
      container,
      body,
      ring,
      nameTag,
      lvTag,
      speakingTag,
      sprite: null,
      spriteCharacterId: null,
      frameIndex: 0,
      direction: UNIT_WALK_DIRECTION,
      moveTween: null,
      breathPhase: breathPhaseFor(id),
      tagKey: '',
      hasLevel: false,
    };
    this.nodes.set(id, node);
    this.refreshRing(node, id);
    this.refreshTags(node, object);
    return node;
  }

  private refreshRing(node: UnitNode, id: string): void {
    if (this.selected.has(id)) {
      node.ring
        .setStrokeStyle(SELECTION_RING_STYLE.lineWidth, SELECTION_RING_STYLE.color, 1)
        .setVisible(true);
      return;
    }
    if (this.preview.has(id)) {
      node.ring
        .setStrokeStyle(
          SELECTION_RING_STYLE.previewLineWidth,
          SELECTION_RING_STYLE.previewColor,
          SELECTION_RING_STYLE.previewAlpha
        )
        .setVisible(true);
      return;
    }
    node.ring.setVisible(false);
  }

  /** 移动 tween 是否还在走（位置真相已到终点，画面还在过渡）。 */
  private isMoving(node: UnitNode): boolean {
    return node.moveTween !== null && node.moveTween.isActive();
  }

  private stopMoveTween(node: UnitNode): void {
    if (!node.moveTween) return;
    node.moveTween.stop();
    node.moveTween = null;
  }

  /**
   * 朝移动方向转面（血缘：v2 MovementSystem.getDirection 的 4 行简化版 —— 精灵表只有
   * 上下左右 4 行，斜向就近取轴分量大的那侧；0=上 1=左 2=下 3=右，见 unit-sprite-sheet）。
   */
  private faceDirection(node: UnitNode, dx: number, dy: number): void {
    const direction = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 3 : 1) : dy >= 0 ? 2 : 0;
    if (direction === node.direction) return;
    node.direction = direction;
    if (node.sprite) {
      const column = UNIT_WALK_CYCLE[node.frameIndex] ?? 0;
      node.sprite.setFrame(unitFrameName(direction, column));
    }
  }

  // ==========================================================================
  // 形象（@since v3.10，task_029）
  // ==========================================================================

  /**
   * 对账一个单位的形象。
   *
   * 流程：单位有 appearance + characterId → 要么纹理已就绪（贴上去），
   *   要么发起一次合成请求（异步，回来后再对账一次）。没有形象 → 撤掉精灵、回到占位圆。
   */
  private syncSprite(node: UnitNode, object: UnitObject): void {
    const appearance = object.appearance;
    const characterId = object.characterId;
    const key = resolveUnitSheetKey(appearance, characterId);

    if (!appearance || !characterId || !key) {
      this.clearSprite(node);
      return;
    }

    if (node.sprite && node.spriteCharacterId === characterId) {
      // 已经是这个角色的精灵了：只需刷新"最近使用"（缓存淘汰用）。
      this.touchSheet(characterId);
      return;
    }

    if (this.scene.textures.exists(key)) {
      this.attachSprite(node, characterId, object.online);
      return;
    }

    // 纹理还没合成出来：先发请求（同一角色只发一次），此刻继续显示占位圆。
    this.requestSheet(characterId, appearance);
  }

  /** 发起一次形象合成（去重：同一角色的并发请求共用一个 promise）。 */
  private requestSheet(characterId: string, appearance: NonNullable<UnitObject['appearance']>): void {
    if (this.destroyed) return;
    if (!this.spriteSource) return;
    if (this.pending.has(characterId)) return;

    const promise = this.spriteSource
      .loadWalkBand(characterId, appearance)
      .then((band) => {
        if (!band) return;
        this.createSheetTexture(characterId, band);
      })
      .catch((error) => {
        // 合成失败不该炸掉整个战场：单位继续用占位圆（下次广播还会再试）。
        console.warn(`[UnitLayer] 角色 ${characterId} 的形象合成失败：`, error);
      })
      .then(() => {
        this.pending.delete(characterId);
        // 场景已销毁就别再对账了（会在死场景上重建显示对象）。
        if (this.destroyed) return;
        // 纹理可能已经就绪：对账一次，把精灵贴上去。
        this.sync();
      });

    this.pending.set(characterId, promise);
  }

  /**
   * 把合成好的精灵带变成 Phaser 纹理，并登记进缓存。
   *
   * why 拷进 Phaser 自己的画布：Phaser 的 CanvasTexture 直接引用源画布，
   * 源画布一旦被复用（下一张精灵带）画面就会串。这里拷贝一份，各角色互不影响。
   */
  private createSheetTexture(characterId: string, band: HTMLCanvasElement): void {
    if (this.destroyed) return;
    const key = unitSheetTextureKey(characterId);
    if (this.scene.textures.exists(key)) return;

    // 缓存封顶：超了就淘汰最久未用的一张（perf：纹理不许无限增长）。
    if (this.sheets.size >= MAX_UNIT_SHEET_TEXTURES) {
      this.evictOldestSheet();
    }

    const texture = this.scene.textures.createCanvas(key, band.width, band.height);
    if (!texture) return;
    const ctx = texture.getContext();
    if (!ctx) return;
    ctx.drawImage(band, 0, 0);
    texture.refresh();

    // 帧：方向行 × 走路列（名字与 unit-sprite-sheet 的约定一致）。
    for (let row = 0; row < UNIT_SHEET_ROWS; row += 1) {
      for (const column of UNIT_WALK_CYCLE) {
        texture.add(
          unitFrameName(row, column),
          0,
          column * UNIT_FRAME_SIZE,
          row * UNIT_FRAME_SIZE,
          UNIT_FRAME_SIZE,
          UNIT_FRAME_SIZE
        );
      }
    }

    this.sheets.set(characterId, { key, lastUsed: Date.now() });
  }

  /** 淘汰最久未用的一张精灵表（用它的那几个单位回落到占位圆）。 */
  private evictOldestSheet(): void {
    let oldestId: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [id, entry] of this.sheets) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId === null) return;

    const entry = this.sheets.get(oldestId);
    this.sheets.delete(oldestId);
    if (entry) this.scene.textures.remove(entry.key);
    for (const node of this.nodes.values()) {
      if (node.spriteCharacterId === oldestId) this.clearSprite(node);
    }
    console.warn(
      `[UnitLayer] 形象精灵表超过 ${MAX_UNIT_SHEET_TEXTURES} 张，淘汰最久未用的一张：${oldestId}`
    );
  }

  /** 贴上精灵（纹理已就绪）。 */
  /**
   * 把合成好的精灵贴上单位容器（@since v3.30，task_054：online 参数 —— 新精灵要继承
   * 当前离线位，离线期间纹理才回来时不能亮一帧原色）。
   */
  private attachSprite(node: UnitNode, characterId: string, online: boolean): void {
    const key = unitSheetTextureKey(characterId);
    const firstColumn = UNIT_WALK_CYCLE[0] ?? 0;
    // 帧行取 node.direction（task_045：单位转面后换精灵时保持当前朝向）
    const sprite = this.scene.add.sprite(0, 0, key, unitFrameName(node.direction, firstColumn));
    sprite.setOrigin(0.5, 0.75);
    sprite.setScale(UNIT_SPRITE_SCALE);
    node.container.add(sprite);
    // 垫在文字下（task_062）：容器内渲染序 = 添加序，精灵是后加的会盖住名字/气泡，
    // moveTo 到 index 2（body、ring 之后，名字/Lv/气泡之前）。
    node.container.moveTo(sprite, 2);

    node.sprite = sprite;
    node.spriteCharacterId = characterId;
    node.frameIndex = 0;
    // 新贴的精灵要继承当前离线位（task_054）：离线期间纹理才合成回来时，不能亮一帧原色。
    sprite.setTint(online ? ONLINE_SPRITE_TINT : OFFLINE_SPRITE_TINT);
    // 占位圆缩成脚下的小色点：业务态 / 皮肤色仍然看得见（形象本身不编码业务态）。
    node.body.setRadius(SPRITE_DOT_RADIUS);
    this.touchSheet(characterId);
    this.ensureAnimTimer();
  }

  /** 撤掉精灵（回到占位圆）。 */
  private clearSprite(node: UnitNode): void {
    if (node.sprite) {
      node.sprite.destroy();
      node.sprite = null;
    }
    node.spriteCharacterId = null;
    node.frameIndex = 0;
    node.body.setRadius(UNIT_RADIUS);
  }

  /** 标记某张精灵表"刚刚用过"（LRU 淘汰用）。 */
  private touchSheet(characterId: string): void {
    const entry = this.sheets.get(characterId);
    if (entry) entry.lastUsed = Date.now();
  }

  /** 走路动画：一个定时器推进所有精灵的帧（不给每个单位各开一个定时器）。 */
  private ensureAnimTimer(): void {
    if (this.animTimer) return;
    this.animTimer = this.scene.time.addEvent({
      delay: Math.round(1000 / UNIT_WALK_FPS),
      loop: true,
      callback: () => this.advanceFrames(),
    });
  }

  /** 推进一帧（全体单位同一套节奏，看起来像一支队伍；各行各面，task_045）。 */
  private advanceFrames(): void {
    for (const [id, node] of this.nodes) {
      if (!node.sprite) continue;
      // 离线静止（task_062）：掉线单位不再迈步（与呼吸同步停 —— 静止灰显更「死」，
      // 规格①；在线位是健康信号，不该被走路帧的「活着感」盖住）。
      if (this.registry.get(id)?.online === false) continue;
      node.frameIndex = (node.frameIndex + 1) % UNIT_WALK_CYCLE.length;
      const column = UNIT_WALK_CYCLE[node.frameIndex] ?? 0;
      node.sprite.setFrame(unitFrameName(node.direction, column));
    }
  }

  // ==========================================================================
  // 战场生命感（@since v3.37，task_062）：呼吸 / 名字标签 / 说话气泡
  // 规则与常量全在 unit-presence.ts（零 Phaser，单测在那边）；本段只兑现渲染。
  // ==========================================================================

  /**
   * 名字标签文本刷新：name / level 变了才 setText（Text 重渲是纹理级开销，
   * 每次对账盲写会让 50 单位的广播面变成 50 次纹理重绘）。无 Lv（level==null）
   * 只显名字，不编造数值。
   */
  private refreshTags(node: UnitNode, object: UnitObject): void {
    const level = object.level;
    const key = `${object.name}|${level === null ? '' : String(level)}`;
    if (key === node.tagKey) return;
    node.tagKey = key;
    node.nameTag.setText(object.name);
    node.hasLevel = level !== null;
    if (node.hasLevel) node.lvTag.setText(`Lv.${level as number}`);
  }

  /**
   * presence tick：全场唯一驱动（task_062）——
   *   ① 呼吸：在线且有精灵才呼吸（shouldBreathe）；写 sprite.scaleY，与移动 tween
   *      （容器坐标）/ 忙碌 fx（独立 Container）属性面不相交，叠加不冲突；离线 / 无精灵
   *      复位基值（幂等 setScale，静止灰显更「死」）；
   *   ② 名字标签可见性：开关（localStorage 现读 —— 设置屏直写，≤60ms 内生效）AND zoom 阈值；
   *   ③ 说话气泡：speaking 标志 + zoom 可读性，alpha 脉动用场景时钟推进。
   * 成本：每单位每步一次三角函数 + 两次 setVisible —— 50 单位单帧计算量级见
   * unit-presence.test.ts 的打桩测试（微秒级，远低于 16.6ms 预算）。
   */
  private presenceTick(): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    const tagsOn = nametagVisible(readNametagsToggle(this.safeStorage()), this.cameraZoom);
    const bubblesOn = overlayVisible(this.cameraZoom);
    for (const [id, node] of this.nodes) {
      const object = this.registry.get(id);
      if (node.sprite) {
        if (shouldBreathe(object?.online ?? true, true)) {
          node.sprite.setScale(UNIT_SPRITE_SCALE, breathScaleY(UNIT_SPRITE_SCALE, node.breathPhase, now));
        } else {
          node.sprite.setScale(UNIT_SPRITE_SCALE);
        }
      }
      node.nameTag.setVisible(tagsOn);
      node.lvTag.setVisible(tagsOn && node.hasLevel);
      if (this.speakingFlags.has(id) && bubblesOn) {
        node.speakingTag.setAlpha(speakingDotAlpha(now)).setVisible(true);
      } else {
        node.speakingTag.setVisible(false);
      }
    }
  }

  /** presence tick 定时器（构造即起，全场一个；destroy 收 —— 同 animTimer 口径）。 */
  private ensurePresenceTimer(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = this.scene.time.addEvent({
      delay: BREATH_STYLE.tickMs,
      loop: true,
      callback: () => this.presenceTick(),
    });
  }

  /**
   * 相机 zoom 回报（task_062）：场景在相机姿态变化 / 初始创建时喂进来；
   * 可见性裁决交给 presence tick（≤60ms 生效，不在相机事件路径上做全量遍历）。
   */
  setCameraZoom(zoom: number): void {
    if (this.destroyed || !Number.isFinite(zoom)) return;
    this.cameraZoom = zoom;
  }

  /**
   * 说话气泡起止（task_062）：unit.speaking 事件的落点（bridge 转发，场景转交）。
   * 事件可能早于首帧对账到达（节点未建）—— 先记标志，节点建好后的 presence tick
   * 自然补上；单位不在场时标志留存也无害（对账清理随节点销毁）。
   */
  setSpeaking(unitId: string, speaking: boolean): void {
    if (this.destroyed) return;
    if (speaking) this.speakingFlags.add(unitId);
    else this.speakingFlags.delete(unitId);
    const node = this.nodes.get(unitId);
    if (!node) return;
    node.speakingTag.setVisible(speaking && overlayVisible(this.cameraZoom));
    if (speaking) node.speakingTag.setAlpha(1);
  }

  /** localStorage 的安全读（无 DOM 环境 / 隐私模式抛错 → null → 调用方回落默认开）。 */
  private safeStorage(): NametagStorage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }
}
