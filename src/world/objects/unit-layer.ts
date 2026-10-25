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
  }

  /** 对账显示对象：新增建、移除销、位置/状态变化才改属性。 */
  sync(): void {
    if (this.destroyed) return;
    const live = new Set<string>();

    for (const object of this.registry.list()) {
      live.add(object.id);
      const node = this.nodes.get(object.id) ?? this.createNode(object.id);
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
    }

    for (const id of Array.from(this.nodes.keys())) {
      if (live.has(id)) continue;
      const node = this.nodes.get(id);
      if (node) {
        this.stopMoveTween(node); // 销毁前先停 tween，不给 tween 管理器留死目标
        node.container.destroy();
      }
      this.nodes.delete(id);
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

  private createNode(id: string): UnitNode {
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
    const container = this.scene.add.container(0, 0, [body, ring]);
    container.setName(`unit:${id}`);

    const node: UnitNode = {
      container,
      body,
      ring,
      sprite: null,
      spriteCharacterId: null,
      frameIndex: 0,
      direction: UNIT_WALK_DIRECTION,
      moveTween: null,
    };
    this.nodes.set(id, node);
    this.refreshRing(node, id);
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
    for (const node of this.nodes.values()) {
      if (!node.sprite) continue;
      node.frameIndex = (node.frameIndex + 1) % UNIT_WALK_CYCLE.length;
      const column = UNIT_WALK_CYCLE[node.frameIndex] ?? 0;
      node.sprite.setFrame(unitFrameName(node.direction, column));
    }
  }
}
