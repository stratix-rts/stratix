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
 *   颜色 = v2 colors.status.success，@since v3.3（task_110）起取自唯一事实源的「完成/成功」色，与 TASK_FX_STYLE.done 同源；
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
 *
 * 动画八态（@since v3.3，task_075 / DEMO-PLAN §2）：本层是**八态的渲染兑现方**，
 *   规则与常量全在 appearance/unit-animation.ts（零 Phaser 纯逻辑，单测在那边）——
 *   渲染层每 tick 取一份「姿态」（pose）并写进显示对象，不自己算动画。
 *   - **节点骨架**：container（世界坐标，移动 tween 写它）
 *       └ rig（**动画骨架**：前倾旋转 / bob 位移 / squash·hover 缩放都写它）
 *           ├ thruster（底盘喷口微光，hover 增强）
 *           ├ body（占位体）
 *           ├ face（眼睛 + 天线；仅代码绘制形态可见，见下）
 *           ├ sprite（LPC 形象精灵，可选）
 *           └ head（头顶覆盖：进度弧 / ❗ / z 序列）
 *       └ selectionRing（脚下旋转虚线环）/ ripple（点击涟漪）/ dust（落地星尘）
 *       └ nameTag / lvTag / speakingTag
 *     why 单独一层 rig：移动 tween 写 container.x/y、呼吸写 sprite.scaleY、
 *     动画写 rig 的旋转/位移/缩放 —— 三者属性面互不相交，叠加不打架（perf：无冲突重绘）。
 *   - **眨眼 / 天线只对代码绘制形态（占位体）兑现**：LPC 精灵表是逐帧烘好的位图，
 *     无法只把「眼睛」压成横线（改 sprite 会撕裂整张帧）；故有形象的单位保留其余七态，
 *     脸部的两件套不叠加（取舍写在这里，别后来人以为是漏做）。
 *   - **选中圈换成新规格**：DEMO-PLAN §2 钦定「脚下青色旋转虚线环（直径 64px，2s/圈）」，
 *     与 task_045 的实线椭圆不再是同一件东西 —— 实线椭圆退位为**框选预览**的弱提示，
 *     正式选中一律走虚线环（颜色 = 调色板 unit 青）。
 *
 * 框选波浪（@since v3.3，task_077 / DEMO-PLAN §4）：框选松手后命中的单位**每 40ms 弹一个**
 *   选择环（popSelectionWave）—— 弹环是**一次性**演出（与常驻的选中环分开，
 *   节点里另有一枚 popRing），驱动走一条链（唯一循环定时器），弹完即撤。
 */

import Phaser from 'phaser';

import type { Bounds, CharacterAppearance, UnitStatus } from '../../core/types';
import {
  type UnitAnimationContext,
  type UnitAnimationState,
} from '../appearance/unit-animation';
import { readReducedMotion } from '../motion';
import {
  resolveUnitColor,
  FOCUS_LINK_METRICS,
  INTERACTION_FX_METRICS,
  UNIT_ANIMATION_METRICS,
  WORLD_PALETTE,
} from '../theme';

import { focusOutlineAlpha } from './focus-link';
import { selectionWaveSchedule } from './task-fx';
import {
  UNIT_ENTRANCE_DURATION_MS,
  UNIT_EXIT_DURATION_MS,
  entranceDirection,
  entranceStartPosition,
} from './unit-entrance';
import { UNIT_HIT_RADIUS, type UnitObject } from './unit-object';
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
 * 框选预览圈样式（task_045 遗留）：拖拽中的弱色椭圆，松手前不误导「已选中」。
 * why 不再承担「选中」职责：DEMO-PLAN §2 钦定的选中表现是**脚下旋转虚线环**
 *   （青色、直径 64px、2s/圈），与这枚实线椭圆不是同一件东西 —— 见 ANIM_RING_STYLE。
 */
const SELECTION_RING_STYLE = {
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
 * 动画八态的渲染参数（@since v3.3，task_075）。
 * 尺寸 / 时长一律取自唯一事实源（UNIT_ANIMATION_METRICS）；本块只放**纯渲染**的形状参数
 * （描边粗细、部件大小、位置偏移）—— 这些不是「规格量」而是画法，故留在渲染层本地。
 */
const ANIM_STYLE = {
  /** 头顶覆盖物的锚点 y（容器本地坐标，负 = 头顶方向）。 */
  headY: -46,
  /** 眼睛：位置 / 半径（代码绘制形态专用）。 */
  eye: { offsetX: 5, offsetY: -4, radiusX: 2.4, radiusY: 3.2 },
  /** 眼睛闭合后的最小高度比（压成一条横线，不完全消失）。 */
  eyeClosedScaleY: 0.08,
  /** 天线：根部 y（贴身体顶）+ 长度 + 端点灯半径。 */
  antenna: { rootY: -UNIT_RADIUS, length: 9, tipRadius: 2.6 },
  /** 底盘喷口微光：椭圆半径与常态 / hover 亮度。 */
  thruster: { radiusX: 11, radiusY: 4.5, y: 11, alphaBase: 0.18, alphaHover: 0.55 },
  /** 选中虚线环：描边粗细 + 相对脚下的 y 偏移。 */
  ring: { lineWidth: 2, y: 8 },
  /** 头顶进度弧：半径 + 描边粗细 + 底槽不透明度。 */
  progressArc: { radius: 12, lineWidth: 2.5, trackAlpha: 0.3 },
  /** 卡住态 ❗：三角尺寸 + 感叹号尺寸。 */
  alert: { halfWidth: 7, height: 12, barWidth: 2, barHeight: 5 },
  /** 摸鱼 z：字号 + 相对头顶的横向偏移 + 起始 y。 */
  zzz: { fontSize: 16, x: 22, y: -42 },
  /** 点击涟漪：描边粗细 + 白色（规格钦定「白圈」——白不是语义色，故不进调色板）。 */
  ripple: { lineWidth: 2, color: 0xffffff },
  /** 落地星尘：三角边长基准 + 水平压扁系数（贴地散开）。 */
  dust: { size: 6, flatten: 0.5, speedMin: 30, speedMax: 78 },
} as const;

/** 脸部的「墨色」（眼睛用）：调色板背景色 —— 深色眼睛压在彩色身体上任何底色都读得出。 */
const FACE_INK_COLOR = WORLD_PALETTE.background;
/** 灰度化 50% 的目标中性灰（非语义色，同离线灰口径留在渲染层本地）。 */
const GRAYSCALE_TARGET = 0x808080;

/**
 * 移动动画手感（task_045）。血缘：v2 MovementSystem.DEFAULT_SPEED=300 常速口径 ——
 * 位移 240px ≈ 800ms（规格「800ms ease-out」即此典型距离）；tween 用 Sine.easeOut 收尾。
 * v2 的 ARRIVAL_THRESHOLD=5 对应 MOVE_TWEEN_MIN_DELTA（收紧到 2：阈值内直接贴齐）。
 */
const MOVE_SPEED_PX_PER_SEC = 300;
const MOVE_TWEEN_MIN_DELTA = 2;
const MOVE_TWEEN_MIN_MS = 120;

/**
 * 业务态配色（@since v3.3，task_110：改从唯一事实源取色 —— 调色板 = core/theme/visual-spec.ts）。
 * why offline 不走调色板：离线是**非语义**的中性灰（调色板七色都是语义色），
 *   硬塞一个语义色会让「离线 = 报错色」这类误读成立 —— 中性灰留在本文件本地常量。
 */
const COLOR_BY_STATUS: Record<UnitStatus, number> = {
  idle: WORLD_PALETTE.unit,
  busy: WORLD_PALETTE.progress,
  offline: 0x5c6470,
  error: WORLD_PALETTE.danger,
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
  /** 单位 id（= 本表的主键；退场动画要靠它把自己从表里摘掉）。 */
  readonly id: string;
  readonly container: Phaser.GameObjects.Container;
  /**
   * 动画骨架（task_075）：前倾旋转 / bob 位移 / squash·hover 缩放都写在这里。
   * why 单独一层：移动 tween 写 container.x/y、呼吸写 sprite.scaleY ——
   *   动画写 rig，三者属性面互不相交，叠加不打架。
   */
  readonly rig: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Arc;
  /** 框选预览椭圆（task_045 遗留；正式选中走 selectionRing）。 */
  readonly ring: Phaser.GameObjects.Ellipse;
  /** 底盘喷口微光（hover 增强）。 */
  readonly thruster: Phaser.GameObjects.Ellipse;
  /** 脸部（眼睛 + 天线）：仅代码绘制形态可见（LPC 精灵形态整张脸不可逐部件改形）。 */
  readonly face: Phaser.GameObjects.Container;
  /** 眼睛（两枚，眨眼 = 压扁 scaleY）。 */
  readonly eyes: readonly Phaser.GameObjects.Ellipse[];
  /** 天线（根部为支点，整体旋转 ±5°）。 */
  readonly antenna: Phaser.GameObjects.Container;
  /** 头顶覆盖物容器（进度弧 / ❗ / z 序列）。 */
  readonly head: Phaser.GameObjects.Container;
  /** 头顶环形进度弧（工作态，琥珀）。 */
  readonly progressArc: Phaser.GameObjects.Graphics;
  /** 头顶 ❗（卡住态，红）。 */
  readonly alertIcon: Phaser.GameObjects.Graphics;
  /** 摸鱼 z 序列（三枚 Text）。 */
  readonly zzzIcons: readonly Phaser.GameObjects.Text[];
  /** 脚下旋转虚线选择环（直径 64px，2s/圈）。 */
  readonly selectionRing: Phaser.GameObjects.Graphics;
  /**
   * 波浪式弹选择环（task_077）：框选松手时脚下一次性亮圈（每 40ms 弹一个）。
   * why 独立于 selectionRing：选中环是**常驻**的慢转虚线（跟着选中态），
   *   弹环是**一次性**的仪式感演出（跟着框选动作），两者生命周期不同。
   */
  readonly popRing: Phaser.GameObjects.Graphics;
  /** 点击涟漪（白圈，200ms）。 */
  readonly ripple: Phaser.GameObjects.Graphics;
  /** 落地星尘粒子（8-12 个小三角）。 */
  readonly dust: Phaser.GameObjects.Graphics;
  /**
   * 焦点描边（@since v3.4，task_092）：事件轨点选该单位时套上的**霓虹描边**（外发光 + 亮线）。
   * why 单独一枚 Graphics：描边要盖在身体之上（是「套上去的圈」），且每 tick 按呼吸重画 ——
   *   与脚下三枚 Graphics（选中环 / 弹环 / 涟漪）的属性面互不相干。
   */
  readonly focusOutline: Phaser.GameObjects.Graphics;
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
   * 入场相位（@since v3.8，task_140）：
   *   'waiting' = 刚创建，等形象就位（形象是异步合成的 —— 形象没到位就走位 = 走的是占位圆）；
   *   'walking' = 正在从战场边缘走进格位；
   *   'done'    = 已就位。
   * why 要等形象：走位是"角色上场"的高光时刻，用占位圆走进去等于把高光浪费在替身上。
   */
  entrance: 'waiting' | 'walking' | 'done';
  /** 入场起点（创建节点时算好 —— 走位起点不能随对账漂移）。 */
  entranceStart: { readonly x: number; readonly y: number };
  /** 入场序号（决定从哪一侧走进来 —— 左右交替）。 */
  readonly entranceIndex: number;
  /** 正在退场（淡出中）—— 退场期间节点留在表里，动画结束才真删（task_140 的下场对称）。 */
  exiting: boolean;
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
  /** 上次施加的灰度程度（0..1）：变了才重算填充色 / 精灵 tint（避免每 tick 重复换色）。 */
  grayscale: number;
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
  /** 当前被 hover 的单位（task_075）：hover 态（放大 1.1x + 指针光标 + 喷口微光）的裁决源。 */
  private hovered = new Set<string>();
  /**
   * 当前被「联动锁定」的单位 id（@since v3.4，task_092）：HUD 事件轨点选后，
   * 该单位套上霓虹描边（呼吸）。null = 无锁定。
   * why 本层只存一个 id：锁定至多一个单位（事件轨一次只对一条）—— 规则在
   * objects/focus-link.ts 的 FocusLinkBoard，本层只是它的渲染兑现。
   */
  private focusedUnitId: string | null = null;

  /** 已缓存的形象精灵表（key = 角色 id）。封顶见 MAX_UNIT_SHEET_TEXTURES。 */
  private readonly sheets = new Map<string, SheetEntry>();
  /** 在途的合成请求（key = 角色 id）：同一角色只合成一次。 */
  private readonly pending = new Map<string, Promise<void>>();
  /**
   * 形象合成**失败**过的角色 id（task_140）。
   * why 要记：失败后每次对账都会再发一次合成请求 —— 素材整体缺失时那是**死循环**
   *   （合成 → 失败 → 对账 → 再合成…），既烧 CPU 又让控制台刷屏。
   *   记下来就不再重试（该角色回落到占位形象；素材恢复后由角色 id 变化或重新建档带动重试）。
   */
  private readonly lookFailed = new Set<string>();
  /** 入场序号（决定从哪一侧走进来 —— 左右交替，见 unit-entrance.ts）。 */
  private entranceCounter = 0;
  /** 用户是否要求减少动效（true = 入场直接落位 / 下场直接移除）。 */
  private readonly reducedMotion: boolean;
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
   * 波浪式弹环的驱动（task_077）：待弹的单位队列 + 下一个位次 + **唯一一个**循环定时器。
   * why 单独三个字段而不是一个对象：位次与队列是纯数据，定时器是资源 —— 分开看得清
   *   「什么时候该撤」（撤定时器 + 清队列）。
   */
  private waveQueue: string[] = [];
  private waveIndex = 0;
  private waveTimer: Phaser.Time.TimerEvent | null = null;
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
    // 动效降级（task_140）：flag 由 app 层塞进 game registry（world 零 DOM，见 world/motion.ts）。
    this.reducedMotion = readReducedMotion(scene.registry);
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
      // 被锁定的单位刚入场（节点是本次对账新建的）：补上描边 ——
      // setFocused 可能早于节点存在（点选指令先到、单位后进场的次序）。
      if (object.id === this.focusedUnitId) node.focusOutline.setVisible(true);
      // 移动 tween 活跃时位置真相已在 UnitObject（立即生效），渲染层让 tween 走完 ——
      // 状态广播不该把半路上的单位臈移到终点（tween 只是渲染过渡，task_045）。
      // ★ 入场等待期（task_140）：形象还没就位时，单位**留在战场边缘的起点**等着 ——
      //   对账不能把它贴到格位（那等于"凭空出现"，走位就白做了）。
      if (node.entrance === 'waiting') {
        node.container.setPosition(node.entranceStart.x, node.entranceStart.y);
      } else if (!this.isMoving(node)) {
        node.container.setPosition(object.position.x, object.position.y);
      }
      // 填充色带灰度（task_075）：卡住态的 50% 灰度要在这条路径上也保住，
      // 否则一次对账就把姿态里的灰度冲掉（灰度变化时由 applyAnimationPose 另行重算）。
      node.body.setFillStyle(desaturate(this.fillColorOf(object), node.grayscale));
      // 离线灰显（task_054）：整容 alpha + 精灵灰 tint（占位圆由 fillColorOf 换离线色）。
      // 与位置/填充色同一口径：每次对账无条件设置（幂等，不追踪上一帧 —— 广播频率低，无所谓）。
      node.container.setAlpha(object.online ? 1 : OFFLINE_STYLE_ALPHA);
      if (node.sprite) {
        // 精灵染色同样带灰度（task_075）：对账这条路径不许把卡住态的灰度冲掉。
        node.sprite.setTint(
          object.online
            ? mixColor(ONLINE_SPRITE_TINT, GRAYSCALE_TARGET, node.grayscale)
            : OFFLINE_SPRITE_TINT
        );
      }
      this.refreshRing(node, object.id);
      this.syncSprite(node, object);
      // 名字标签文本（task_062）：name/level 变了才 setText（纹理级开销，判重见 tagKey）。
      this.refreshTags(node, object);
    }

    for (const id of Array.from(this.nodes.keys())) {
      if (live.has(id)) continue;
      const node = this.nodes.get(id);
      if (node) {
        // 下场对称（task_140）：单位撤下时先播一段退场（淡出下沉），再真删。
        // why 不直接删：入场有走位、下场没退场 = "只进不出"，看着像漏删。
        if (node.exiting) continue;
        this.beginExit(node);
        continue;
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
   * hover 态切换（@since v3.3，task_075）：单位被指针悬停时置位，移开时清位。
   * hover 态的三件事（放大 1.1x / 指针光标 / 底盘喷口微光）分别由 presence tick
   * （放大 + 微光）与本方法（光标）兑现 —— 光标是**全局**状态（画布只有一个指针），
   * 不能塞进每单位的姿态里。
   * 传 null = 当前没有任何单位被悬停。
   */
  setHovered(unitId: string | null): void {
    if (this.destroyed) return;
    const next = new Set<string>();
    if (unitId) next.add(unitId);
    const changed =
      next.size !== this.hovered.size || Array.from(next).some((id) => !this.hovered.has(id));
    this.hovered = next;
    // 光标：悬停在单位上用 pointer，其余用默认箭头。
    this.scene.input.setDefaultCursor(unitId ? 'pointer' : 'default');
    if (!changed) return;
  }

  /**
   * 联动锁定（@since v3.4，task_092）：HUD 事件轨点选某单位 → 该单位套上霓虹描边（呼吸）。
   *
   * why 描边画在**单位层**而不是引导弧线层：描边是「这个单位被点了」的本体提示，
   *   要跟着单位走（单位移动 / 转向 / 缩放都带着它）；弧线是屏幕空间的连线，两者职责不同。
   * 传 null = 解除锁定（失焦 / 再次点击）—— 描边褪掉。
   */
  setFocused(unitId: string | null): void {
    if (this.destroyed) return;
    if (this.focusedUnitId === unitId) return;
    this.focusedUnitId = unitId;
    for (const [id, node] of this.nodes) {
      const focused = id === unitId;
      if (focused) {
        node.focusOutline.setVisible(true);
      } else if (node.focusOutline.visible) {
        node.focusOutline.clear().setVisible(false);
      }
    }
  }

  /**
   * 点击涟漪起拍（@since v3.3，task_075）：白圈 200ms 扩散淡出 + squash 一下。
   * why 走 AnimationController 而不是直接起 tween：squash 与姿态里的缩放是同一个量，
   * 两处各写各的会打架（一个 tween 一个 pose 同时写 scaleY）。
   */
  pulseClick(unitId: string): void {
    if (this.destroyed) return;
    const object = this.registry.get(unitId);
    if (!object) return;
    object.animation.triggerClick(this.scene.time.now);
  }

  /**
   * 完成演出起拍（@since v3.3，task_075）：squash → 原地跳 20px → 落地星尘。
   * 生产触发点：任务完成落到该单位时（场景的 syncTaskEvent 转交）。
   */
  triggerCompleted(unitId: string): void {
    if (this.destroyed) return;
    const object = this.registry.get(unitId);
    if (!object) return;
    object.animation.triggerCompleted(this.scene.time.now);
  }

  /**
   * 框选命中的波浪式弹环（@since v3.3，task_077 / DEMO-PLAN §4）：松手后命中的单位
   * **每 40ms 弹一个**选择环，像点亮一排灯。
   *
   * why 走一条链而不是每个单位各开一个定时器：perf 纪律（全场一个驱动）——
   *   链上永远只有一个挂起的循环定时器，弹完即撤。
   */
  popSelectionWave(unitIds: readonly string[]): void {
    if (this.destroyed) return;
    this.cancelSelectionWave();
    const schedule = selectionWaveSchedule(unitIds);
    if (schedule.length === 0) return;
    this.waveQueue = schedule.map((slot) => slot.unitId);
    this.waveIndex = 0;
    // 第一个立刻弹（不等第一个间隔），其余按 40ms 依次弹 —— 波浪从框选边缘往里跑。
    this.popSelectionRing(this.waveQueue[0]);
    this.waveIndex = 1;
    if (this.waveQueue.length > 1) {
      this.waveTimer = this.scene.time.addEvent({
        delay: INTERACTION_FX_METRICS.selectionWave.intervalMs,
        loop: true,
        callback: () => this.advanceSelectionWave(),
      });
    }
  }

  /** 波浪推进一格（每 40ms 一次）。 */
  private advanceSelectionWave(): void {
    if (this.destroyed || this.waveIndex >= this.waveQueue.length) {
      this.cancelSelectionWave();
      return;
    }
    this.popSelectionRing(this.waveQueue[this.waveIndex]);
    this.waveIndex += 1;
  }

  /** 撤掉波浪链（新一轮框选 / 场景 shutdown 时调用）。 */
  private cancelSelectionWave(): void {
    if (this.waveTimer) {
      this.waveTimer.remove(false);
      this.waveTimer = null;
    }
    this.waveQueue = [];
    this.waveIndex = 0;
  }

  /**
   * 单个单位脚下弹一次选择环（task_077）：从内侧半径长到外侧并淡出。
   * why 自己画而不是缩放常驻的虚线环：常驻环是慢转的虚线图案，缩放它会让虚线
   *   跟着变形（虚线宽窄不一）；重画一枚实心亮圈，弹起来干净。
   */
  private popSelectionRing(unitId: string): void {
    const node = this.nodes.get(unitId);
    if (!node) return;
    const wave = INTERACTION_FX_METRICS.selectionWave;
    const baseRadius = UNIT_ANIMATION_METRICS.selection.ringDiameterPx / 2;
    const graphic = node.popRing;
    const state = { progress: 0 };
    graphic.setVisible(true).clear();

    this.scene.tweens.add({
      targets: state,
      progress: 1,
      duration: wave.ringDurationMs,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        const radius =
          baseRadius * (wave.ringFromScale + (wave.ringToScale - wave.ringFromScale) * state.progress);
        const alpha = 1 - state.progress;
        graphic.clear();
        graphic.lineStyle(2.5, WORLD_PALETTE.unit, alpha);
        graphic.strokeCircle(0, 0, radius);
        graphic.fillStyle(WORLD_PALETTE.unit, alpha * 0.14);
        graphic.fillCircle(0, 0, radius);
      },
      onComplete: () => {
        graphic.clear().setVisible(false);
      },
    });
  }

  /**
   * 强制某个单位的动画状态（@since v3.3，task_075）：**dev 逐态验收用**。
   * 传 null 回到业务态自动派生。生产路径不调这个方法。
   */
  setAnimationState(unitId: string, state: UnitAnimationState | null): void {
    if (this.destroyed) return;
    const object = this.registry.get(unitId);
    if (!object) return;
    object.animation.setForcedState(state, this.scene.time.now);
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
    // 波浪弹环链（task_077）：定时器必须撤，不留悬空回调。
    this.cancelSelectionWave();
    for (const node of this.nodes.values()) {
      this.stopMoveTween(node);
      node.container.destroy();
    }
    this.nodes.clear();
    this.selected.clear();
    this.preview.clear();
    // hover 态与光标（task_075）：场景重建时不能把 pointer 光标留在画布上。
    this.hovered.clear();
    this.scene.input.setDefaultCursor('default');
    // 纹理也要收：场景重建时旧纹理会留在纹理管理器里（显存不会自动回收）。
    for (const entry of this.sheets.values()) {
      this.scene.textures.remove(entry.key);
    }
    this.sheets.clear();
    this.pending.clear();
  }

  private createNode(object: UnitObject): UnitNode {
    const id = object.id;
    // 入场起点（task_140）：从可视区域的外沿起步，等形象就位后再走进来。
    const entranceIndex = this.entranceCounter;
    this.entranceCounter += 1;
    const entranceStart = this.computeEntranceStart(object.position, entranceIndex);
    const body = this.scene.add.circle(0, 0, UNIT_RADIUS, COLOR_BY_STATUS.idle);
    // —— 动画骨架（task_075）：rig 装身体与一切跟着身体动的东西 ——
    // 底盘喷口微光：加在 body **之前**（容器内渲染序 = 添加序）→ 垫在身下。
    const thruster = this.scene.add
      .ellipse(
        0,
        ANIM_STYLE.thruster.y,
        ANIM_STYLE.thruster.radiusX * 2,
        ANIM_STYLE.thruster.radiusY * 2,
        WORLD_PALETTE.unit,
        ANIM_STYLE.thruster.alphaBase
      )
      .setVisible(false);
    // 眼睛（两枚）：眨眼 = 把 scaleY 压到 eyeClosedScaleY（视觉上是一条横线）。
    const eyes = [
      this.scene.add.ellipse(
        -ANIM_STYLE.eye.offsetX,
        ANIM_STYLE.eye.offsetY,
        ANIM_STYLE.eye.radiusX * 2,
        ANIM_STYLE.eye.radiusY * 2,
        FACE_INK_COLOR
      ),
      this.scene.add.ellipse(
        ANIM_STYLE.eye.offsetX,
        ANIM_STYLE.eye.offsetY,
        ANIM_STYLE.eye.radiusX * 2,
        ANIM_STYLE.eye.radiusY * 2,
        FACE_INK_COLOR
      ),
    ];
    // 天线：支点贴在身体顶，Graphics 画杆 + 端点灯，整体绕支点旋转（±5°）。
    const antennaGfx = this.scene.add.graphics();
    antennaGfx.lineStyle(1.5, WORLD_PALETTE.accent, 1);
    antennaGfx.lineBetween(0, 0, 0, -ANIM_STYLE.antenna.length);
    antennaGfx.fillStyle(WORLD_PALETTE.accent, 1);
    antennaGfx.fillCircle(0, -ANIM_STYLE.antenna.length, ANIM_STYLE.antenna.tipRadius);
    const antenna = this.scene.add.container(0, ANIM_STYLE.antenna.rootY, [antennaGfx]);
    const face = this.scene.add.container(0, 0, [...eyes, antenna]);
    // 头顶覆盖：进度弧（琥珀）/ ❗（红）/ z 序列（摸鱼）—— 全部代码绘制，随 body 一起动。
    const progressArc = this.scene.add.graphics().setPosition(0, ANIM_STYLE.headY).setVisible(false);
    const alertIcon = this.scene.add.graphics().setPosition(0, ANIM_STYLE.headY).setVisible(false);
    const zzzIcons = [0, 1, 2].map((index) =>
      this.scene.add
        .text(ANIM_STYLE.zzz.x, ANIM_STYLE.zzz.y, index === 0 ? 'z' : 'Z', {
          fontFamily: NAMETAG_STYLE.fontFamily,
          fontSize: `${ANIM_STYLE.zzz.fontSize}px`,
          color: NAMETAG_STYLE.nameColor,
          stroke: NAMETAG_STYLE.strokeColor,
          strokeThickness: NAMETAG_STYLE.strokeWidth,
        })
        .setOrigin(0.5, 1)
        .setVisible(false)
    );
    const head = this.scene.add.container(0, 0, [progressArc, alertIcon, ...zzzIcons]);
    // rig 内层序：thruster → body → face →（精灵后插）→ head。
    // 精灵 attach 时 moveTo 到 index 3（压在脸上、垫在头顶覆盖物下）。
    const rig = this.scene.add.container(0, 0, [thruster, body, face, head]);
    // 框选预览椭圆（task_045 遗留）：正式选中走 selectionRing（虚线环）。
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
    // 脚下旋转虚线环（task_075 / DEMO-PLAN §2）：直径 64px、青色、2s/圈。
    // 虚线图案建一次就够 —— 整环旋转时虚线跟着转，不必每 tick 重画。
    const selectionRing = this.scene.add.graphics().setPosition(0, ANIM_STYLE.ring.y).setVisible(false);
    drawDashedRing(
      selectionRing,
      UNIT_ANIMATION_METRICS.selection.ringDiameterPx / 2,
      UNIT_ANIMATION_METRICS.selection.dashCount,
      UNIT_ANIMATION_METRICS.selection.dashFillRatio,
      WORLD_PALETTE.unit,
      ANIM_STYLE.ring.lineWidth
    );
    // 点击涟漪（白圈，200ms）与落地星尘（8-12 个小三角）：两者都按 tick 重画，故常驻但默认隐藏。
    const ripple = this.scene.add.graphics().setVisible(false);
    // 波浪式弹选择环（task_077）：一次性演出，默认隐藏。
    const popRing = this.scene.add.graphics().setPosition(0, ANIM_STYLE.ring.y).setVisible(false);
    const dust = this.scene.add.graphics().setPosition(0, ANIM_STYLE.ring.y).setVisible(false);
    // 焦点描边（@since v3.4，task_092）：霓虹外发光 + 亮线，默认隐藏（由 setFocused 裁决）。
    const focusOutline = this.scene.add.graphics().setVisible(false);
    // 头顶覆盖物（task_062）：名字 / Lv 小字 / 说话气泡 —— 全部容器内嵌（见文件头），
    // 初始隐藏，可见性由 presence tick 统一裁决（开关 + zoom）。样式常量在 unit-presence.ts
    // （描边色取自唯一事实源的背景色，保证任何底色上都压得住）。名字 origin(0.5,1) 向上长、Lv origin(0.5,0)
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
    // 容器内层序（z 协调见文件头）：rig → 选中环 → 弹环 → 涟漪 → 星尘 → 名字 → Lv → 气泡。
    // 名字/气泡永远在最上（要能压住头顶覆盖物）；选中环垫在身下（读作「地面的圈」）。
    const container = this.scene.add.container(0, 0, [
      rig,
      // 焦点描边压在 rig 之上（它是「套在单位身上的圈」，要盖住身体边缘才读得出高亮）。
      focusOutline,
      selectionRing,
      popRing,
      ripple,
      dust,
      nameTag,
      lvTag,
      speakingTag,
    ]);
    container.setName(`unit:${id}`);

    const node: UnitNode = {
      id,
      container,
      rig,
      body,
      ring,
      thruster,
      face,
      eyes,
      antenna,
      head,
      progressArc,
      alertIcon,
      zzzIcons,
      selectionRing,
      popRing,
      ripple,
      dust,
      focusOutline,
      nameTag,
      lvTag,
      speakingTag,
      sprite: null,
      spriteCharacterId: null,
      frameIndex: 0,
      direction: UNIT_WALK_DIRECTION,
      moveTween: null,
      entrance: 'waiting',
      entranceStart,
      entranceIndex,
      exiting: false,
      breathPhase: breathPhaseFor(id),
      tagKey: '',
      hasLevel: false,
      grayscale: 0,
    };
    this.nodes.set(id, node);
    this.refreshRing(node, id);
    this.refreshTags(node, object);
    return node;
  }

  /**
   * 框选预览椭圆（task_045 遗留）。
   * why 正式选中不再走这枚椭圆：DEMO-PLAN §2 钦定的选中表现是**脚下旋转虚线环**
   *   （青色 / 直径 64px / 2s 一圈），由 presence tick 按选中集合裁决（见 applyAnimationPose）。
   */
  private refreshRing(node: UnitNode, id: string): void {
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
    // 方向的编码口径只有一份（unit-entrance.ts）：0=上 1=左 2=下 3=右。
    const direction = entranceDirection({ x: 0, y: 0 }, { x: dx, y: dy });
    if (direction === node.direction) return;
    node.direction = direction;
    if (node.sprite) {
      const column = UNIT_WALK_CYCLE[node.frameIndex] ?? 0;
      node.sprite.setFrame(unitFrameName(direction, column));
    }
  }

  // ==========================================================================
  // 上场 / 下场走位（@since v3.8，task_140）
  // ==========================================================================

  /**
   * 算入场起点（从可视区域的外沿起步 —— 见 unit-entrance.ts 的口径）。
   *
   * why 用相机可视区域而不是战场边界：战场 3200×2400，默认镜头只看得到中间一块；
   *   从战场边界起步的话单位在屏幕外走完全程，用户只看到"凭空出现"。
   * 取不到相机（场景刚建 / 单测）→ 退回注册表的战场边界（至少有起点，不会原地瞬移）。
   */
  private computeEntranceStart(
    target: { readonly x: number; readonly y: number },
    index: number
  ): { readonly x: number; readonly y: number } {
    const view = this.scene.cameras?.main?.worldView;
    const bounds = view
      ? { x: view.x, y: view.y, width: view.width, height: view.height }
      : this.registry.bounds;
    return entranceStartPosition(target, bounds, index);
  }

  /**
   * 开始入场走位（单位形象就位后调用 —— 幂等，重复调用只生效一次）。
   *
   * 走位：从可视区域外沿的起点走到格位，800ms；走到位后转为普通单位。
   * reduced-motion：直接落位（不播位移 —— 见 world/motion.ts 的降级口径）。
   *
   * why 要等形象就位才走：走位是"角色上场"的高光时刻 —— 用占位圆走进去，
   *   等于把高光浪费在替身上（真正的形象到位后单位已经在格位，用户看不到它走进来）。
   */
  private beginEntrance(node: UnitNode): void {
    if (node.entrance !== 'waiting') return;
    node.entrance = 'done';

    const object = this.registry.get(node.id);
    const target = object ? object.position : node.entranceStart;

    // 降级：直接落位（连位移都不播）。
    if (this.reducedMotion) {
      node.container.setPosition(target.x, target.y);
      return;
    }

    // 起点现算一次：形象是异步合成的，等它就位时相机可能已经动了（起点要贴着当前视野）。
    const start = this.computeEntranceStart(target, node.entranceIndex);
    node.container.setPosition(start.x, start.y);
    // 朝行进方向转面（否则会出现"倒着走进场"）。
    this.faceDirection(node, target.x - start.x, target.y - start.y);
    this.stopMoveTween(node);
    node.moveTween = this.scene.tweens.add({
      targets: node.container,
      x: target.x,
      y: target.y,
      duration: UNIT_ENTRANCE_DURATION_MS,
      // why 不用 easeOut：easeOut 前 100ms 就走掉大半（看着像"瞬移"），
      //   匀入匀出才像人在走。
      ease: 'Sine.easeInOut',
      onComplete: () => {
        node.moveTween = null;
      },
    });
  }

  /**
   * 开始下场（单位从状态里消失时调用）。
   *
   * 表现：原地淡出 + 轻微下沉，260ms 后真删节点。
   * reduced-motion：直接移除（不留残影）。
   *
   * why 不直接删：入场有走位、下场没退场 = "只进不出"，看着像漏删（task_140 的下场对称）。
   */
  private beginExit(node: UnitNode): void {
    if (node.exiting) return;
    node.exiting = true;
    this.stopMoveTween(node);
    this.speakingFlags.delete(node.id);

    const remove = (): void => {
      if (this.destroyed) return;
      node.container.destroy();
      if (this.nodes.get(node.id) === node) this.nodes.delete(node.id);
    };

    if (this.reducedMotion) {
      remove();
      return;
    }

    this.scene.tweens.add({
      targets: node.container,
      alpha: 0,
      y: node.container.y + 12,
      duration: UNIT_EXIT_DURATION_MS,
      ease: 'Sine.easeIn',
      onComplete: remove,
    });
  }

  // ==========================================================================
  // 形象（@since v3.10，task_029）
  // ==========================================================================

  /**
   * 对账一个单位的形象。
   *
   * 流程（@since v3.8，task_140）：单位是角色单位（带 characterId）→ 要么纹理已就绪（贴上去），
   *   要么发起一次合成请求（异步，回来后再对账一次）；合成失败 → 回落到占位形象并放行入场。
   *   非角色单位 → 撤掉精灵、回到占位圆。
   *
   * why 不再要求单位自带 appearance：角色的长相由形象源按 agent 种类裁决
   *   （品牌预设 / 随机合成，见 world/appearance/character-look.ts）——
   *   没自带外观的角色照样能以一张脸出场（这正是"家底全在、缺的是接电"的那根线）。
   */
  private syncSprite(node: UnitNode, object: UnitObject): void {
    const characterId = object.characterId;
    const key = resolveUnitSheetKey(characterId);

    if (!characterId || !key) {
      // 非角色单位：没有形象可言 —— 撤掉精灵、回到占位圆，直接入场。
      this.clearSprite(node);
      this.beginEntrance(node);
      return;
    }

    if (node.sprite && node.spriteCharacterId === characterId) {
      // 已经是这个角色的精灵了：只需刷新"最近使用"（缓存淘汰用）。
      this.touchSheet(characterId);
      this.beginEntrance(node);
      return;
    }

    if (this.scene.textures.exists(key)) {
      this.attachSprite(node, characterId, object.online);
      this.beginEntrance(node);
      return;
    }

    // 合成失败过（素材缺失）：不再重试，回落占位形象并放行入场（战场不空着）。
    if (this.lookFailed.has(characterId)) {
      this.clearSprite(node);
      this.beginEntrance(node);
      return;
    }

    // 纹理还没合成出来：先发请求（同一角色只发一次），此刻继续显示占位圆。
    this.requestSheet(characterId, object.appearance);
  }

  /**
   * 发起一次形象合成（去重：同一角色的并发请求共用一个 promise）。
   *
   * @param characterId 角色 id。
   * @param appearance 角色自带外观（可为 null —— 由形象源按 agent 种类兜底裁决）。
   */
  private requestSheet(characterId: string, appearance: CharacterAppearance | null): void {
    if (this.destroyed) return;
    if (!this.spriteSource) {
      // 没有形象源（dev 入口 / 未接线）：直接记失败 → 回落占位形象（别卡在等待入场）。
      this.lookFailed.add(characterId);
      return;
    }
    if (this.pending.has(characterId)) return;
    if (this.lookFailed.has(characterId)) return;

    const promise = this.spriteSource
      .loadWalkBand(characterId, appearance)
      .then((band) => {
        if (!band) {
          // 素材缺失 / 合成失败：记下来（不再死循环重试），回落占位形象。
          this.lookFailed.add(characterId);
          return;
        }
        this.createSheetTexture(characterId, band);
      })
      .catch((error) => {
        // 合成失败不该炸掉整个战场：单位继续用占位圆。
        this.lookFailed.add(characterId);
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
    node.rig.add(sprite);
    // 垫在头顶覆盖物下（task_075）：rig 内渲染序 = 添加序，精灵后加会盖住进度弧/❗/z，
    // moveTo 到 index 3（thruster、body、face 之后，head 之前）。
    node.rig.moveTo(sprite, 3);

    node.sprite = sprite;
    node.spriteCharacterId = characterId;
    node.frameIndex = 0;
    // 新贴的精灵要继承当前离线位（task_054）：离线期间纹理才合成回来时，不能亮一帧原色。
    sprite.setTint(online ? ONLINE_SPRITE_TINT : OFFLINE_SPRITE_TINT);
    // 占位圆缩成脚下的小色点：业务态 / 皮肤色仍然看得见（形象本身不编码业务态）。
    node.body.setRadius(SPRITE_DOT_RADIUS);
    // 有形象时收起代码绘制的脸（task_075）：LPC 精灵表是烘好的位图，
    // 没法只把眼睛压成横线 —— 硬画两只眼睛盖在像素角色脸上只会更怪。
    node.face.setVisible(false);
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
    // 回到占位体：脸部（眼睛 + 天线）重新可见。
    node.face.setVisible(true);
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
   * presence tick：全场唯一驱动（task_062 + task_075）——
   *   ① 呼吸：在线且有精灵才呼吸（shouldBreathe）；写 sprite.scaleY，与移动 tween
   *      （容器坐标）/ 忙碌 fx（独立 Container）属性面不相交，叠加不冲突；离线 / 无精灵
   *      复位基值（幂等 setScale，静止灰显更「死」）；
   *   ② 名字标签可见性：开关（localStorage 现读 —— 设置屏直写，≤60ms 内生效）AND zoom 阈值；
   *   ③ 说话气泡：speaking 标志 + zoom 可读性，alpha 脉动用场景时钟推进；
   *   ④ **动画八态**（task_075）：向每单位的 AnimationController 取一份姿态并写进显示对象
   *      （规则在 appearance/unit-animation.ts，本层只兑现渲染）。
   * 成本：每单位每步几次三角函数 + 十几次属性写 —— 50 单位单帧计算量级见
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
      if (object) this.applyAnimationPose(node, object, now);
      // 焦点描边呼吸（@since v3.4，task_092）：只有被锁定的那个单位要重画（至多一枚）。
      if (id === this.focusedUnitId) this.drawFocusOutline(node, now);
    }
  }

  /**
   * 画焦点单位的霓虹描边（@since v3.4，task_092）：**外发光 + 亮线**两圈，透明度随呼吸起伏。
   *
   * why 两圈而不是一圈粗线：粗线只有一种亮度，读作「粗边框」；外圈半透明的辉光 +
   *   内圈实亮线才读作「霓虹」（glow 是亮的余晖，不是主体 —— 故辉光透明度按
   *   outlineGlowAlphaRatio 打折）。
   * why 几何随形态而变：占位体是圆，形象精灵是椭圆（框住 64×64 缩放后的角色）。
   */
  private drawFocusOutline(node: UnitNode, now: number): void {
    const alpha = focusOutlineAlpha(now, node.breathPhase);
    const { outlineGlowPx, outlineStrokePx, outlineGlowAlphaRatio } = FOCUS_LINK_METRICS;
    const { radiusX, radiusY, centerY } = focusOutlineGeometry(node.sprite !== null);
    node.focusOutline.clear();
    // 外发光（宽、半透明）：垫在亮线下面 → 读作「辉光漫开」。
    node.focusOutline.lineStyle(outlineGlowPx, WORLD_PALETTE.accent, alpha * outlineGlowAlphaRatio);
    node.focusOutline.strokeEllipse(0, centerY, radiusX * 2, radiusY * 2);
    // 亮线（细、实）：主体。
    node.focusOutline.lineStyle(outlineStrokePx, WORLD_PALETTE.accent, alpha);
    node.focusOutline.strokeEllipse(0, centerY, radiusX * 2, radiusY * 2);
  }

  /**
   * 把一份姿态写进显示对象（task_075 的渲染兑现）。
   *
   * 写入面与其它系统互不相交：
   *   - rig：旋转（前倾）/ 位移（bob、微颤、抖动、跳跃）/ 缩放（squash、hover）；
   *   - face：眼睛 scaleY（眨眼）、天线 rotation（摆动）；
   *   - head：进度弧 / ❗ / z 序列；
   *   - selectionRing / ripple / dust：脚下三个独立 Graphics；
   *   - body / sprite：灰度（卡住态 50%）。
   * 移动 tween 写 container.x/y、呼吸写 sprite.scaleY —— 与上面这些属性面都不相交。
   */
  private applyAnimationPose(node: UnitNode, object: UnitObject, now: number): void {
    const ctx: UnitAnimationContext = {
      status: object.status,
      online: object.online,
      hasMission: object.missionId !== null,
      selected: this.selected.has(object.id),
      hovered: this.hovered.has(object.id),
    };
    const pose = object.animation.pose(ctx, now);

    // —— rig 变换 ——
    node.rig.rotation = Phaser.Math.DegToRad(pose.leanDeg);
    node.rig.x = pose.tremorOffsetX + pose.shakeOffsetX;
    node.rig.y = pose.bobOffsetY + pose.jumpOffsetY;
    node.rig.scaleX = pose.scaleX * pose.hoverScale;
    node.rig.scaleY = pose.scaleY * pose.hoverScale;

    // —— 脸部（眨眼 / 天线）——
    const eyeScaleY = 1 - (1 - ANIM_STYLE.eyeClosedScaleY) * pose.eyeClose;
    for (const eye of node.eyes) eye.setScale(1, eyeScaleY);
    node.antenna.rotation = Phaser.Math.DegToRad(pose.antennaDeg);

    // —— 底盘喷口微光（hover 增强）——
    node.thruster
      .setVisible(pose.thrusterGlow > 0)
      .setAlpha(ANIM_STYLE.thruster.alphaBase + (ANIM_STYLE.thruster.alphaHover - ANIM_STYLE.thruster.alphaBase) * pose.thrusterGlow);

    // —— 头顶：进度弧（工作态）——
    if (pose.progressArc === null) {
      node.progressArc.setVisible(false);
    } else {
      node.progressArc.setVisible(true).clear();
      drawProgressArc(node.progressArc, ANIM_STYLE.progressArc.radius, pose.progressArc, ANIM_STYLE.progressArc.trackAlpha);
    }

    // —— 头顶：❗（卡住态）——
    if (pose.alertOffsetY === null) {
      node.alertIcon.setVisible(false);
    } else {
      node.alertIcon.setVisible(true).setY(ANIM_STYLE.headY + pose.alertOffsetY);
      drawAlertIcon(node.alertIcon);
    }

    // —— 头顶：z 序列（摸鱼态）——
    for (let index = 0; index < node.zzzIcons.length; index += 1) {
      const icon = node.zzzIcons[index];
      const z = pose.zzz.find((item) => item.index === index);
      if (!z) {
        icon.setVisible(false);
        continue;
      }
      icon.setVisible(true).setAlpha(z.alpha).setScale(z.scale);
      icon.setY(ANIM_STYLE.zzz.y + z.offsetY);
    }

    // —— 脚下：旋转虚线选择环 ——
    node.selectionRing.setVisible(pose.selected);
    if (pose.selected) {
      node.selectionRing.rotation = Phaser.Math.DegToRad(pose.selectionRingDeg);
    }

    // —— 脚下：点击涟漪（白圈，200ms 扩散淡出）——
    if (pose.clickRipple === null) {
      if (node.ripple.visible) node.ripple.clear().setVisible(false);
    } else {
      const u = pose.clickRipple;
      const radius = UNIT_ANIMATION_METRICS.click.rippleFromPx +
        (UNIT_ANIMATION_METRICS.click.rippleToPx - UNIT_ANIMATION_METRICS.click.rippleFromPx) * u;
      node.ripple.setVisible(true).clear();
      node.ripple.lineStyle(ANIM_STYLE.ripple.lineWidth, ANIM_STYLE.ripple.color, 1 - u);
      node.ripple.strokeCircle(0, 0, radius);
    }

    // —— 脚下：落地星尘（8-12 个小三角四散淡出）——
    if (pose.dustProgress === null) {
      if (node.dust.visible) node.dust.clear().setVisible(false);
    } else {
      node.dust.setVisible(true).clear();
      drawStarDust(node.dust, object.id, pose.dustProgress);
    }

    // —— 灰度（卡住态 50%）：变了才重算，避免每 tick 重复换色 ——
    if (Math.abs(pose.grayscale - node.grayscale) > 0.001) {
      node.grayscale = pose.grayscale;
      node.body.setFillStyle(desaturate(this.fillColorOf(object), pose.grayscale));
      if (node.sprite) {
        node.sprite.setTint(
          object.online
            ? mixColor(ONLINE_SPRITE_TINT, GRAYSCALE_TARGET, pose.grayscale)
            : OFFLINE_SPRITE_TINT
        );
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

// ============================================================================
// 动画八态的绘制助手（@since v3.3，task_075）
// 纯代码绘制（Graphics），零位图资产 —— DEMO-PLAN §0「全部视觉由代码绘制」。
// ============================================================================

/**
 * 焦点描边的几何（@since v3.4，task_092）：按单位的形态给出一圈描边的半径与中心。
 *
 * why 两种形态：占位体是**圆心在原点**的圆；有形象的是精灵（origin 0.5, 0.75 →
 *   画框中心落在脚上方半格处），用同一个圆去框会框不住人。
 * why 半径要加留白（outlinePaddingPx）：圈要套在**身体外**，不能压住角色。
 */
function focusOutlineGeometry(hasSprite: boolean): { radiusX: number; radiusY: number; centerY: number } {
  const padding = FOCUS_LINK_METRICS.outlinePaddingPx;
  if (!hasSprite) {
    return { radiusX: UNIT_RADIUS + padding, radiusY: UNIT_RADIUS + padding, centerY: 0 };
  }
  const half = (UNIT_FRAME_SIZE * UNIT_SPRITE_SCALE) / 2;
  return { radiusX: half + padding, radiusY: half + padding, centerY: -half / 2 };
}

/**
 * 画一圈虚线（脚下选择环）。
 * why 虚线图案建一次就够：整环旋转时虚线跟着转，不必每 tick 重画（perf）。
 */
function drawDashedRing(
  graphics: Phaser.GameObjects.Graphics,
  radius: number,
  dashCount: number,
  fillRatio: number,
  color: number,
  lineWidth: number
): void {
  graphics.clear();
  graphics.lineStyle(lineWidth, color, 1);
  const step = (Math.PI * 2) / Math.max(1, dashCount);
  for (let index = 0; index < dashCount; index += 1) {
    const start = index * step;
    graphics.beginPath();
    graphics.arc(0, 0, radius, start, start + step * fillRatio, false);
    graphics.strokePath();
  }
}

/**
 * 画头顶环形进度弧（工作态，琥珀 0→360°）。
 * why 带一圈暗色底槽：没有底槽的话，弧转到 90% 时看不出「还剩多少」。
 */
function drawProgressArc(
  graphics: Phaser.GameObjects.Graphics,
  radius: number,
  progress: number,
  trackAlpha: number
): void {
  graphics.clear();
  graphics.lineStyle(ANIM_STYLE.progressArc.lineWidth, WORLD_PALETTE.background, trackAlpha);
  graphics.strokeCircle(0, 0, radius);
  graphics.lineStyle(ANIM_STYLE.progressArc.lineWidth, WORLD_PALETTE.progress, 1);
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * Math.min(1, Math.max(0, progress));
  if (end - start < 0.001) return;
  graphics.beginPath();
  graphics.arc(0, 0, radius, start, end, false);
  graphics.strokePath();
}

/**
 * 画卡住态的 ❗（红色三角 + 感叹号）。
 * why 用 Graphics 画而不用 emoji 文字：❗ emoji 是彩色字形（不受文字颜色控制），
 *   规格钦定的是**红色**❗ —— 自己画才能保证颜色与调色板一致。
 */
function drawAlertIcon(graphics: Phaser.GameObjects.Graphics): void {
  graphics.clear();
  const { halfWidth, height, barWidth, barHeight } = ANIM_STYLE.alert;
  graphics.fillStyle(WORLD_PALETTE.danger, 1);
  graphics.beginPath();
  graphics.moveTo(0, -height / 2);
  graphics.lineTo(halfWidth, height / 2);
  graphics.lineTo(-halfWidth, height / 2);
  graphics.closePath();
  graphics.fillPath();
  graphics.fillStyle(WORLD_PALETTE.background, 1);
  graphics.fillRect(-barWidth / 2, -height / 2 + 3, barWidth, barHeight);
  graphics.fillCircle(0, height / 2 - 3, barWidth / 2);
}

/**
 * 画落地星尘（完成态）：8-12 个小三角四散淡出。
 * why 数量与方向按单位 id 哈希派生：同一单位每次完成的星尘形状一致（可辨认），
 *   不同单位各不相同（不整齐划一）；数量落在规格给的 8-12 区间内。
 */
function drawStarDust(graphics: Phaser.GameObjects.Graphics, unitId: string, progress: number): void {
  graphics.clear();
  const dust = UNIT_ANIMATION_METRICS.completed;
  const count = dust.dustMin + Math.floor(hash01(unitId, 0x5d05) * (dust.dustMax - dust.dustMin + 1));
  const alpha = Math.max(0, 1 - progress);
  const size = ANIM_STYLE.dust.size * (1 - progress * 0.5);
  for (let index = 0; index < count; index += 1) {
    const angle = hash01(unitId, 0x5d00 + index * 4) * Math.PI * 2;
    const speed = ANIM_STYLE.dust.speedMin + hash01(unitId, 0x5d01 + index * 4) * (ANIM_STYLE.dust.speedMax - ANIM_STYLE.dust.speedMin);
    const x = Math.cos(angle) * speed * progress;
    const y = Math.sin(angle) * speed * progress * ANIM_STYLE.dust.flatten;
    // 小三角：朝外的一枚「火星」。
    const px = Math.cos(angle) * size;
    const py = Math.sin(angle) * size * ANIM_STYLE.dust.flatten;
    graphics.fillStyle(WORLD_PALETTE.success, alpha);
    graphics.beginPath();
    graphics.moveTo(x + px, y + py);
    graphics.lineTo(x - px * 0.6, y - py * 0.6);
    graphics.lineTo(x + py, y - px * 0.6);
    graphics.closePath();
    graphics.fillPath();
  }
}

/**
 * 颜色去饱和（卡住态「整体灰度 50%」）。
 * 做法：先算亮度，再按 amount 把颜色往「同亮度的灰」拉 —— amount=0 原样，1 = 全灰。
 */
function desaturate(color: number, amount: number): number {
  if (amount <= 0) return color;
  const t = Math.min(1, amount);
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const gray = Math.round(luma);
  const mix = (channel: number): number => Math.round(channel + (gray - channel) * t);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/** 两色线性混合（t=0 取 a，t=1 取 b）。 */
function mixColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (shift: number): number => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * k);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** 单位 id + 盐 → [0, 1)（星尘的形状/数量派生；同 unit-animation 的哈希口径）。 */
function hash01(unitId: string, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < unitId.length; i += 1) {
    hash ^= unitId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}
