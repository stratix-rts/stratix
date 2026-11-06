/**
 * 文件职责：v3 **唯一主场景** —— 装配相机控制、单位渲染层、框选框与总线桥，并处理鼠标交互。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/scenes BattlefieldScene（唯一主场景起步）」。
 * 输入：
 *   - core/bus 的 state 通道（经 bridge/bus-adapter 转发到本场景的 WorldScenePort 回调）；
 *   - core/bus 的 world 通道上的 task.started/completed/failed（@since v3.17，task_038，
 *     经同一个桥接层筛出并转发到 syncTaskEvent）——驱动单位头顶的工作表现（objects/task-fx*）；
 *   - core/bus 的 world 通道上的 unit.position（@since v3.21，task_045，转发到 syncUnitPosition）
 *     —— 右击移动时 runtime 把编队终值广播回来，场景立即写进 UnitObject 并 tween 过渡；
 *   - core/bus 的 world 通道上的 camera.center（@since v3.33，task_057，转发到 syncCameraCenter）
 *     —— 小地图点击/拖拽的跳转指令，场景把相机对中到目标世界点；
 *   - core/bus 的 world 通道上的 camera.shake（@since v3.3，task_080，转发到 syncCameraShake，
 *     里程碑大字落下时的一记小震）
 *   - core/bus 的 world 通道上的 unit.speaking（@since v3.37，task_062，转发到 syncUnitSpeaking，
 *     单位层头顶「···」说话气泡）
 *   - core/bus 的 world 通道上的 focus.unit（@since v3.4，task_092，转发到 syncFocusUnit）
 *     —— HUD 事件轨条目点选 → 被点单位描边高亮（霓虹 + 呼吸）+ 左下事件轨到中屏的引导弧线；
 *   - core/bus 的 world 通道上的 camera.director（@since v3.3，task_081，转发到 syncDirectorMode）
 *     —— 导演模式开合：镜头接管 + 中屏取景框标识（task_092 的 L3 提示）；
 *   - core/bus 的 state 通道上的 missions + tasks（@since v3.3，task_078，转发到 syncTasks，
 *     地图上的任务建筑三态与区域点亮 —— 区域 = 编组任务，建筑 = 角色任务）；
 *   - core/bus 的 world 通道上的 task.queued / started / completed / failed（@since v3.3，task_076，
 *     转发到 syncTaskSpeech）—— 单位头顶冒离线模板气泡（派活 / 开工 / 完成 / 报错）；
 *   - core/bus 的 world 通道上的 unit.bubble（@since v3.3，task_076，转发到 syncUnitBubble）
 *     —— world 层当场指挥的原话气泡（「收到」「来了来了」），按原话冒泡；
 *   - core/bus 的 world 通道上的 replay.beat（@since v3.3，task_082，转发到 syncReplayBeat）
 *     —— 当日回放的重演指令：化身出现 / 干活 / 插旗 / 半频冒泡；
 *   - core/bus 的 world 通道上的 level.up（@since v3.3，task_161，转发到 syncLevelUp）
 *     —— 角色升级 → 在该角色所在单位脚下播升级光环；
 *   - 浏览器指针输入（按下 / 移动 / 松开 / 滚轮）+ 键盘 ESC（@since v3.3，task_079：回全景；
 *     @since v3.3 task_217 / IX-04：ESC 的归属链 = 仪式 > 输入焦点 > 画布 ——
 *     聊天框里打字时画布让路，见 keyboard-priority.ts）。
 * 输出：把交互转成 WorldEvent（unit.click / selection.box / unit.move / camera.moved），
 *   经桥接层发回 core。
 * 镜头编排（@since v3.3，task_079）：拖拽平移带**橡皮筋回弹**（拉出边界 → 松手弹回）；
 *   滚轮缩放夹在 0.6-1.6x；双击单位 = 跟随镜头（再双击解除）；ESC = 回全景
 *   （@since v3.3，task_217 / IX-04：ESC 先过归属链 —— 仪式在演就归仪式、输入框持焦就归输入框）；
 *   氛围彩蛋：每 30-60s 飘过一朵小云 + 真实时间 19-24 点背景格网微微变暖（都不发总线事件）。
 * RTS 操作语义（@since v3.21，task_045。血缘：交互口径移植 v2 StratixRTSGameScene 的
 *   右击移动惯例，判定参数自 v2 MovementSystem / FormationSystem 考古）：
 *   - 框选闭环：拖拽中本地预览命中（弱色圈，不经总线），松手把命中 id 补在 selection.box
 *     事件上（core 无坐标算不出命中）；拖空框 / 点空地 = 清空选择；Shift 拖 = 加选；
 *   - 右击移动：右键短按（位移 < DRAG_THRESHOLD_PX）= 对选中编队发 unit.move（目标点涟漪反馈），
 *     右键拖远仍归平移；无选中 = 纯无操作；中键始终纯平移。
 * 精灵特效触点（@since v3.3，task_161）：本场景是首批特效的**接线处**，播什么由语义 kind 决定：
 *   - 任务完成 → celebrate（彩带）；任务报错 → error（冲击爆闪）—— 走 task.* 事件；
 *   - 单位上场 → spawn（传送门）；单位退场 → despawn（消散）—— 走 state 通道的单位对账；
 *   - 任务建筑完工 → celebrate（彩带落在楼顶）—— 走 state 通道的任务全景；
 *   - 指令下达 → command（信号弹）—— 走右键移动指令；
 *   - 角色升级 → levelUp（治疗光环）—— 走 level.up 事件。
 *   素材是 pixelfx 导出的 sheet（PNG + JSON），运行时只走 Phaser 纹理帧动画，零新增依赖。
 *   素材由**独立场景**（scenes/fx-asset-scene.ts）并行预载 —— 本场景不 preload：
 *   战场是主屏，等素材才出画面等于给启动加延迟，还会错过「首帧补发状态」的手势（见该文件注释）。
 *
 * 代码路由触点（@since v3.3，task_194 / AP-04）：触点不再直接调 sheet 路由，而是过**特效路由**
 *   （objects/fx-router.ts）—— 走代码路由（运行时逐像素算，护栏全开）还是 sheet 路由，由路由裁决：
 *   - pixelfx 没加载 / 效果缺失 / 效果自己炸了 ⇒ **静默回落 sheet 路由**（不弹错、不少演）；
 *   - 用户开了 reduced-motion ⇒ 不播代码路由（沿用 world/motion.ts 的口径）；
 *   - 其余 ⇒ 走代码路由（目前只有「角色升级」这一个触点 —— 它需要皮肤联动调色板与运行时变体）。
 *
 * 禁止事项：
 *   1. import 任何 hud / vue / legacy(stratix-rts) 代码 —— 铁律：world 只认识 core/types 与 core/bus；
 *   2. 持有业务状态 —— 业务真相在 core；本场景只渲染 UnitView，并只把单位 id 回传上去；
 *   3. 在本文件里写钳制 / 命中 / 编队规则 —— 规则分别住在 camera/camera-math.ts、
 *      objects/unit-registry.ts 与 core/unit/formation.ts，这里只负责调用与编排；
 *   4. 自己缓存 WorldState 再 diff —— 对账由 UnitRegistry 统一负责；
 *   5. 留下未清理的监听 / 显示对象 —— shutdown 时统一销毁（perf：资源必须可清理）。
 */

import Phaser from 'phaser';

// 副本展示口径（@since v3.3，task_188 / M1-14）：「路径尾段」「在办任务数」搬到 core ——
//   HUD 的大厅卡片（M1-14）要用**同一份**口径，而 HUD 不得 import world（铁律）⇒ 共同口径落 core。
import { countActiveTasks, pathTailOf } from '../../core/project/instance-display';
import type {
  Bounds,
  CharacterTask,
  ClickMods,
  MissionView,
  Point,
  ProjectInstanceView,
  ReplayBeat,
  SelectionState,
  UnitView,
} from '../../core/types';
import { readCodeFxSources } from '../appearance/code-fx-sources';
import { SPRITE_FX_SOURCES } from '../appearance/fx-sources.generated';
import { taskPhaseView } from '../appearance/task-animation';
import type { UnitTaskPhase } from '../appearance/unit-animation';
import {
  CAMERA_EVENT_INTERVAL_MS,
  createWorldBridge,
  type TaskFxPhase,
  type WorldBridge,
  type WorldScenePort,
} from '../bridge/bus-adapter';
import {
  CameraController,
  DEFAULT_WORLD_BOUNDS,
  clampCameraCenter,
  overviewPose,
  rubberBandDisplay,
  rubberBandOffset,
  zoomWithUserLimits,
  type CameraPose,
  type ClickStamp,
} from '../camera';
import { DirectorController, type DirectorHost } from '../camera/director';
import type { DirectorEventKind } from '../camera/director-policy';
// 点击语义判定（@since v3.3，task_214 / IX-03）：单击 = 选中 / 双击 = 打开单独聊天框（纯逻辑，可单测）。
import { resolveCanvasClick } from '../click-semantics';
// 键盘归属裁决 + 输入焦点读口（@since v3.3，task_217 / IX-04）：ESC 收权与焦点让路。
import { readInputFocus } from '../input-focus';
import { resolveKeyboardOwner, type KeyboardOwner } from '../keyboard-priority';
// 动效降级标志（@since v3.3，task_194 / AP-04）：reduced-motion ⇒ 不播代码路由（DESIGN §1.3）。
import { readReducedMotion } from '../motion';
import { isWarmHour } from '../objects/ambience-layout';
import { BuildingLayer } from '../objects/building-layer';
import { CloudLayer } from '../objects/cloud-layer';
// 代码路由特效层（@since v3.3，task_194 / AP-04）：运行时逐像素算出来的特效（DESIGN §1.3）。
import { CodeFxLayer } from '../objects/code-fx-layer';
import { DirectorFrameLayer } from '../objects/director-frame-layer';
import { FocusLinkLayer } from '../objects/focus-link-layer';
// 特效路由（@since v3.3，task_194 / AP-04）：代码路由优先，播不成静默回落 sheet 路由。
import { FxRouter } from '../objects/fx-router';
import { GroundLayer, GROUND_DEPTH } from '../objects/ground-layer';
import {
  InstanceNameplate,
  type InstanceNameplateData,
} from '../objects/instance-nameplate';
import { ReplayBoard, replayAnchorId, replayAvatarPosition } from '../objects/replay-board';import { ReplayLayer } from '../objects/replay-layer';
import { SelectionBox } from '../objects/selection-box';
import { SpeechBubbleBoard } from '../objects/speech-bubble';
import { SpeechBubbleLayer } from '../objects/speech-bubble-layer';
import { MapBoard, BUILDING_SIZE, type MapSyncResult } from '../objects/task-building';
import { INTERACTION_BUBBLE_TEXT, TaskFxBoard, applyTaskFxEvent, fxKindForTaskPhase } from '../objects/task-fx';
import { TaskFxLayer } from '../objects/task-fx-layer';
import { UnitLayer } from '../objects/unit-layer';
import { UnitRegistry, resolvePositionSeed } from '../objects/unit-registry';
import { UNIT_SPRITE_SOURCE_KEY, type UnitSpriteSource } from '../objects/unit-sprite-source';
import type { SpeechKind } from '../speech-templates';
import { CAMERA_METRICS, REPLAY_METRICS, WORLD_PALETTE } from '../theme';

export const BATTLEFIELD_SCENE_KEY = 'battlefield';

/**
 * 战场底色 / 边界（@since v3.3，task_110）—— 全部取自唯一事实源
 *   core/theme/visual-spec.ts（world 门面 = ../theme 的 WORLD_PALETTE）。
 * why 不写色值字面量：调色板改一处即可，world 各文件不再各抄一份。
 * 网格线（格距 64px）与扫描光带、四角刻度、边缘渐晕已由 objects/ground-layer.ts 接手（task_078）。
 */
const BACKGROUND_COLOR = WORLD_PALETTE.background;
/** 战场外框描边 = 装饰色（紫）。 */
const BOUNDS_COLOR = WORLD_PALETTE.accent;
/**
 * 战场底板底衬 = 背景基底色（@since v3.3，task_078 改）。
 * why 不再是网格色：格网线的色值就是网格色 —— 底板若也用它，格网线会与底板同色而彻底看不见。
 *   调色板的语义本就是「背景基底 = 地面 / 网格线 = 低亮度网格」（§1 表），改回基底色即回到该语义。
 */
const BOUNDS_FILL = WORLD_PALETTE.background;
/** 超过该屏幕位移才算"拖拽"，否则按点击处理。 */
const DRAG_THRESHOLD_PX = 4;

/** 拖拽模式：pan = 平移镜头，box = 框选，click = 候选点击（尚未松手）。 */
type DragMode = 'none' | 'pan' | 'box' | 'click';

/** 指针原生事件里的修饰键；TouchEvent 没有这些字段，故用可选结构收窄。 */
interface ModifierBag {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * v3 唯一主场景：装配相机、单位渲染层、框选框与总线桥，并把指针交互转成 WorldEvent 发回 core。
 * 本类同时是总线桥的 WorldScenePort —— core 广播的 state 经桥接层回调 syncUnits / syncSelection。
 */
export class BattlefieldScene extends Phaser.Scene implements WorldScenePort {
  /** why 叫 view 不叫 camera：Phaser.Scene 自带一个只读的 camera 属性，同名会覆盖掉父类成员。 */
  private view!: CameraController;
  private bridge!: WorldBridge;
  private readonly units = new UnitRegistry({ worldBounds: DEFAULT_WORLD_BOUNDS });
  private unitLayer!: UnitLayer;
  /**
   * 引导弧线层（@since v3.4，task_092）：HUD 事件轨条目 → 中屏单位的屏幕空间连线。
   * 弧线的起终点换算与焦点裁决都在层内（objects/focus-link*），场景只喂相机与单位位置。
   */
  private focusLink!: FocusLinkLayer;
  /**
   * 导演取景框层（@since v3.4，task_092）：导演模式开启时中屏四角出现取景框标识（L3 层，
   * 提示镜头已被接管）。开合由 camera.director 事件驱动（同导演控制器同一信号源）。
   */
  private directorFrame!: DirectorFrameLayer;
  /** 任务表现状态板（task_038）：瞬态浮标（✓/!）的唯一真相，环由 busy 派生裁决。 */
  private readonly taskFx = new TaskFxBoard();
  private taskFxLayer!: TaskFxLayer;
  /**
   * 代码路由特效层（@since v3.3，task_194 / AP-04）：运行时逐像素算出来的特效。
   * 效果源由组合根登记在 game.registry（world 不认 pixelfx，见 appearance/code-fx-sources.ts）；
   * 没登记 ⇒ 这一层没有源 ⇒ 路由全程走 sheet 路由（静默，不缺演出）。
   */
  private codeFxLayer!: CodeFxLayer;
  /** 特效路由（@since v3.3，task_194 / AP-04）：代码路由优先，播不成静默回落 sheet 路由。 */
  private fxRouter!: FxRouter;
  private selectionBox!: SelectionBox;
  /** 地面层（@since v3.3，task_078）：格网 + 四角刻度 + 边缘渐晕（扫描光带已于 task_086 迁到 HUD）。 */
  private groundLayer!: GroundLayer;
  /** 地图对账板（@since v3.3，task_078）：core 任务状态 → 建筑/区域布局与跳变事件。 */
  private readonly mapBoard = new MapBoard({ bounds: DEFAULT_WORLD_BOUNDS });
  /** 建筑层（@since v3.3，task_078）：任务建筑三态 + 区域点亮。 */
  private buildingLayer!: BuildingLayer;
  /**
   * 气泡板（@since v3.3，task_076）：同屏 ≤3 / 同单位 5s 冷却 / 存活 4s 的频率规则真相。
   * why 在 create() 里建（而不是字段初始化器）：时钟取场景时钟（this.time.now），
   *   构造期拿不到场景实例。
   */
  private speechBoard!: SpeechBubbleBoard;
  /** 气泡渲染层（@since v3.3，task_076）：单位头顶的圆角气泡。 */
  private speechLayer!: SpeechBubbleLayer;
  /**
   * 小云层（@since v3.3，task_079）：每 30-60s 从地图边缘飘过一朵慢速小云（氛围彩蛋）。
   * why 是装饰层：它不发总线事件（彩蛋不改变任何业务状态）。
   */
  private cloudLayer!: CloudLayer;
  /**
   * 导演控制器（@since v3.3，task_081）：任务事件 → 镜头编排（缓动到事件点 → 停留 → 回全景，
   * 静默则缓慢巡视）。开启 / 关闭由 core 经 camera.director 事件驱动（hud 顶栏「🎬 导演」按钮）。
   */
  private director!: DirectorController;
  /**
   * 回放表现态板（@since v3.3，task_082）：回放节拍 → 每个角色的相位（裁决真相在板子里）。
   */
  private readonly replayBoard = new ReplayBoard();
  /** 回放化身层（@since v3.3，task_082）：把相位画成战场上的化身。 */
  private replayLayer!: ReplayLayer;
  /** 回放气泡节流计数（@since v3.3，task_082）：气泡按 REPLAY_METRICS.bubbleEveryN 半频触发。 */
  private replayBubbleTick = 0;
  /**
   * 回放镜头待落位点（@since v3.3，task_082）：一帧内多拍只落最后一次（perf 硬约束）。
   */
  private replayFocusTarget: Point | null = null;
  /** 回放镜头落位是否已排期（一帧只排一次）。 */
  private replayFocusScheduled = false;
  /**
   * 拖拽平移的目标中心（世界坐标，**未钳制**）—— 橡皮筋的真相。
   * why 单独记一份：钳制后的中心丢了「用户想拉到哪」的信息，越界量就无从算起。
   */
  private panDesired: Point | null = null;
  /** 当前橡皮筋外显偏移（世界坐标；松手回弹时归零）。 */
  private rubberOffset: Point = { x: 0, y: 0 };
  /** 跟随镜头的目标单位 id（双击单位 = 跟随；再双击解除）。 */
  private followUnitId: string | null = null;
  /** 上一次点击单位的时间戳与位置（双击判定用）。 */
  private lastClick: ClickStamp | null = null;
  /** 镜头移动补间（回全景 / 进入跟随）：同一时刻只留一个。 */
  private cameraTween: Phaser.Tweens.Tween | null = null;
  /** 橡皮筋回弹补间（松手后越界位移归零）。 */
  private rubberTween: Phaser.Tweens.Tween | null = null;
  /** 入夜变暖的巡检定时器（每分钟看一眼真实时间）。 */
  private warmthTimer: Phaser.Time.TimerEvent | null = null;
  /**
   * 本次进入的**副本 id**（@since v3.3，task_187 / M1-13；design §2.5 破除点 #1）。
   *
   * 来源 = Phaser 的 scene data（`scene.start('battlefield', { instanceId })`）——
   *   **不走全局变量**（那是解除「BattlefieldScene 单例假设」的抓手）。
   * null = 不是「进副本」这一回（开机直接进战场）⇒ 不演仪式。
   * why 冻结在 init()：场景实例会被 Phaser 复用（scene.start 不重建）⇒
   *   每次启动都得重新读一次 scene data，不能沿用上一次的值。
   */
  private instanceId: string | null = null;
  /** 副本名牌板（进副本仪式，@since v3.3，task_187 / M1-13）；null = 本次没进副本。 */
  private nameplate: InstanceNameplate | null = null;
  /** 活跃副本的实例视图（@since v3.3，task_187 / M1-13；桥接层转发）。 */
  private instanceView: ProjectInstanceView | null = null;
  /** 在办任务数（未终结的任务条数；null = 还没收到任务快照）。 */
  private activeTaskCount: number | null = null;

  private dragMode: DragMode = 'none';
  private dragStartScreen: Point = { x: 0, y: 0 };
  /** 拖拽平移用屏幕空间增量：不依赖相机位姿，避免"测量-修正-再测量"反馈环导致的抖动。 */
  private dragLastScreen: Point = { x: 0, y: 0 };
  private dragStartWorld: Point = { x: 0, y: 0 };
  private draggedFar = false;
  private cameraFlushScheduled = false;
  /** 平移起手的键（task_045）：右键短按 = 移动指令候选；中键纯平移。 */
  private panButton: 'right' | 'middle' | null = null;
  /** 框选拖拽中的本地预览命中（task_045）：null = 当前没有拖拽。 */
  private boxPreviewIds: readonly string[] | null = null;
  /**
   * 最新选择集镜像（task_045）：右键移动指令的载荷来源。不另立真相 —— 每次 syncSelection
   * 覆盖，与 core 广播严格一致（拖拽中的预览不算选中）。
   */
  private selectedUnitIds: readonly string[] = [];

  constructor() {
    super(BATTLEFIELD_SCENE_KEY);
  }

  /** 当前在播的精灵特效实例数（@since v3.3，task_161；dev 观测并发上限用）。 */
  get activeFxCount(): number {
    return this.taskFxLayer?.activeFxCount ?? 0;
  }

  /** 场上单位数（@since v3.3，task_161；dev 观测触点落点用 —— 特效落在单位头上，没单位就没落点）。 */
  get unitCount(): number {
    return this.units.size;
  }

  /**
   * 场景启动前的显式清理（@since v3.3，task_183 / M1-09）。
   *
   * why 必须显式清：Phaser 的 `scene.start` **不重建场景实例**（SceneManager 取已有实例，
   *   见 node_modules/phaser/src/scene/SceneManager.js 的 start → bootScene）⇒ 字段初始化器
   *   只跑一次 ⇒ 同一批 board 会跨副本复用 ⇒ A 副本的残留会直接串到 B 副本。
   * why 放在 init() 而不是 create()：init() 跑在 create() 之前 ⇒ 清完之后 create() 才注入
   *   当前副本的数据（含恢复站位 applyRestoredPositions）——放 create() 会把刚灌的数据一起清掉。
   * why 是「四板各清一次」而不是清整个场景：四块板是跨副本复用的表现态真相，
   *   渲染层（taskFxLayer / unitLayer / buildingLayer …）在 shutdown 时已逐层析构，不重复回收。
   * why speechBoard 不清：它在 create() 里 new（构造期拿不到场景时钟 this.time.now），
   *   每次 create() 都是全新实例 ⇒ 天然零残留，无需清理。
   */
  init(data?: unknown): void {
    // 本次进入的副本 id（@since v3.3，task_187 / M1-13；design §2.5 破除点 #1）：
    //   从 Phaser 的 scene data 读出并**冻结**（不走全局变量 —— 那是解除单例假设的抓手）。
    //   没有 instanceId = 这次不是「进副本」（开机直接进战场）⇒ 不演进副本仪式。
    //   why 每次启动都重读：Phaser 复用场景实例 ⇒ 上一次的 instanceId 不能沿用。
    const raw = (data as { instanceId?: unknown } | undefined)?.instanceId;
    this.instanceId = typeof raw === 'string' && raw.length > 0 ? raw : null;
    // 仪式态复位（Phaser 复用场景实例 ⇒ 上一次的值不能带进下一次）：
    //   视图 / 在办任务数都是**本副本**的投影，换副本就得清零。
    this.instanceView = null;
    this.activeTaskCount = null;
    // 单位注册表：清 objects / restoredPositions / spawnCursor（已有析构方法，此前全仓无调用方）。
    this.units.destroy();
    // 任务表现板：清浮标（working / done / failed / awaiting 四态）。
    this.taskFx.clearAll();
    // 回放表现板：清化身 / 相位 / 占位（拖动回放时的那次 reset 走的是同一份清场逻辑）。
    this.replayBoard.reset();
    // 地图对账板：清区域占格 / nextSlot / 上次态 / 已点亮区域（M1-08 的对称析构）。
    this.mapBoard.reset();
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
    this.drawWorldBounds();
    // 地面层（@since v3.3，task_078）：格网 / 四角刻度 / 边缘渐晕。
    // 必须在底板之后建（渲染次序靠 depth 与添加序双保险）。
    this.groundLayer = new GroundLayer(this, { bounds: DEFAULT_WORLD_BOUNDS });
    // 空状态不再画在世界层（@since v3.8，task_136）：战场空态改由 HUD 的专用空态层承担
    //   （雷达 + 人话 + 行动引导 + 皮肤 token）。why 挪走：世界层的提示是开发者口径
    //   （"单位来自 gateway 真实数据流"），且它没法承载可点击的行动引导。

    // 单位联动层（@since v3.4，task_092）：引导弧线（屏幕空间）+ 焦点裁决的渲染兑现。
    // 导演取景框层（task_092）：导演模式开启时中屏四角的取景框。
    // why 建在桥接层**之前**：桥一订阅总线，事件随时可能到达 —— 层必须先在场，
    //   否则第一条 focus.unit / camera.director 就会打空引用。
    this.focusLink = new FocusLinkLayer(this);
    this.directorFrame = new DirectorFrameLayer(this);

    // 桥接层先建：相机控制器的 onChange 会立刻回调它上报初始位姿
    this.bridge = createWorldBridge(this);

    // 导演控制器（@since v3.3，task_081）：默认关闭，由 core 经 camera.director 事件开启。
    // 宿主把 Phaser 能力（补间 / 场景时钟 / 延时）注入 —— 编排逻辑本身零渲染依赖（可单测）。
    // why 建在桥接层之后、相机控制器之前：导演被开启后第一个动作就是动镜头，
    //   但那一定发生在 create() 走完之后（事件是异步到达的），此刻建它最稳。
    this.director = new DirectorController(this.directorHost());

    this.selectionBox = new SelectionBox(this);
    // 形象精灵源由组合根放在 game.registry 里（场景由 Phaser 实例化，构造器拿不到注入）。
    // 没接上 → 单位一律走占位形体（老单位 / dev 页都是这样）。
    const spriteSource = (this.registry.get(UNIT_SPRITE_SOURCE_KEY) as UnitSpriteSource | undefined) ?? null;
    this.unitLayer = new UnitLayer(this, this.units, spriteSource);

    // 任务表现层（@since v3.17，task_038）：单位头顶的 working 环 / ✓ / ! 浮标。
    // 订阅在桥接层（bridge/bus-adapter 的 syncTaskEvent 转发），场景只被驱动。
    // 精灵特效（task_161）也由这一层播（sheet 动画：庆祝 / 报错 / 上场 / 下场 / 指令 / 升级）——
    // 战场表现归一处管，不另起炉灶。
    this.taskFxLayer = new TaskFxLayer(this, this.units, this.taskFx, {
      spriteFxSources: SPRITE_FX_SOURCES,
    });

    // 代码路由特效层（@since v3.3，task_194 / AP-04）：运行时逐像素算的特效。
    // 效果源从 registry 读（组合根装配 —— 只有它认识 pixelfx，world 只认契约）。
    // 没有源（pixelfx 没加载 / 效果缺失）⇒ 本层空转 ⇒ 路由全程走 sheet 路由。
    this.codeFxLayer = new CodeFxLayer(this, readCodeFxSources(this.registry));

    // 特效路由（@since v3.3，task_194 / AP-04）：代码路由优先，播不成**静默**回落 sheet 路由
    // （DESIGN §1.3「pixelfx 加载失败 / 效果缺失 ⇒ 静默回落 sheet 路由（不弹错不少演）」）。
    // reduced-motion ⇒ 不播代码路由（沿用 world/motion.ts 的口径：每次现取，开关随时能改）。
    this.fxRouter = new FxRouter({
      codePlay: (codeKind, x, y) => this.codeFxLayer.play(codeKind, x, y),
      sheetPlay: (sheetKind, x, y) => this.taskFxLayer.playFx(sheetKind, x, y),
      hasCodeSource: (codeKind) => this.codeFxLayer.hasKind(codeKind),
      reducedMotion: () => readReducedMotion(this.registry),
    });

    // 气泡层（@since v3.3，task_076）：单位头顶的说话气泡（离线模板句库）。
    // 板子用场景时钟（this.time.now）—— 与渲染层的 tick 同一把钟，不混用墙钟。
    this.speechBoard = new SpeechBubbleBoard({ now: () => this.time.now });
    this.speechLayer = new SpeechBubbleLayer(this, this.units, this.speechBoard);

    // 任务建筑层（@since v3.3，task_078）：地图上的任务建筑三态 + 区域点亮。
    // 数据源是 core 广播的 missions/tasks（经桥接层 syncTasks 转发），场景只被驱动。
    this.buildingLayer = new BuildingLayer(this);

    // 回放化身层（@since v3.3，task_082）：回放节拍（经桥接层 syncReplayBeat 转发）驱动的
    // 战场重演。相位裁决在 ReplayBoard，本层只画。
    this.replayLayer = new ReplayLayer(this);

    // 氛围彩蛋（@since v3.3，task_079）：小云层 + 入夜变暖的格网。
    // 纯装饰：不发总线事件（彩蛋不改变任何业务状态）。
    this.cloudLayer = new CloudLayer(this);
    this.applyAmbientWarmth();
    this.warmthTimer = this.time.addEvent({
      delay: 60_000,
      loop: true,
      callback: () => this.applyAmbientWarmth(),
    });

    // 恢复站位种子（@since v3.12，task_033；@since v3.3 task_185 / M1-11 **按副本分区**）：
    //   组合根启动读档后，把**当前副本**的站位放在 game.registry 的分区键
    //   （`stratix:unit-position-seed:<instanceId>`）里；场景只取自己这一副本的那份
    //   ⇒ A 副本的位置不会漏进 B 副本（旧实现是全局单键，design §2.5 #6/#18/#22）。
    // 没接上（纯 vite dev / 读档失败）→ undefined，注册表全部按网格落位，行为与从前一致。
    // why 用 this.instanceId 优先（@since v3.3，task_190 / M1-16 验收发现的真实缺陷）：
    //   桥接层的 scope 初值恒是**默认沙盒**（它是本场景刚 new 出来的，要等下一次 state
    //   广播才拿到本次的 activeInstanceId）⇒ 切到第二个副本时 create() 读种子会读到
    //   **沙盒那份** ⇒ A 副本的单位 id 漏进 B 副本（种子键分家失效）。
    //   本次真正切进去的副本 id 是 init() 从 scene data 冻结下来的 ⇒ 以它为准；
    //   没有 instanceId（开机直接进战场）才回落桥接层 scope（= 默认沙盒，老行为不变）。
    const seedScope = this.instanceId ?? this.bridge.scope();
    const restoredPositions = resolvePositionSeed(this.registry, seedScope);
    this.units.applyRestoredPositions(restoredPositions);

    this.view = new CameraController(this.cameras.main, {
      viewport: () => ({ width: this.scale.width, height: this.scale.height }),
      worldBounds: DEFAULT_WORLD_BOUNDS,
      // 姿态变化两路消费：上报总线（camera.moved 合并窗口）+ 喂单位层（task_062：名字
      // 标签/气泡的低缩放自动隐藏阈值要读 zoom；只存值，可见性裁决在 presence tick）。
      onChange: (pose) => {
        this.bridge.cameraMoved(pose.center, pose.zoom);
        this.unitLayer.setCameraZoom(pose.zoom);
      },
    });
    // 初始位姿补报（task_057）：相机控制器构造时不回调 onChange，不补这一声的话，
    // 小地图要等到第一次交互才有视口框 —— 桥的合并窗口对首个事件直接放行（lastCameraEmitAt=null）。
    this.bridge.cameraMoved(this.view.current.center, this.view.current.zoom);
    // 初始 zoom 同样要补喂（task_062）：onChange 不回放初始姿态，不补的话名字标签的
    // 可见性要等第一次拖拽/滚轮才被纠正。
    this.unitLayer.setCameraZoom(this.view.current.zoom);

    // 进副本仪式（@since v3.3，task_187 / M1-13；design §2.2 两拍表）：
    //   本次是「进副本」（scene data 带了 instanceId）才演 —— 开机直接进战场不演（老行为不变）。
    // why 排在相机控制器之后：仪式的第一拍就要把相机送回 overviewPose（位姿真相在相机控制器）。
    if (this.instanceId) {
      this.nameplate = new InstanceNameplate(this, {
        cameraHome: (durationMs) => this.cameraHome(durationMs),
        cameraHomeNow: () => this.cameraHomeNow(),
      });
      this.nameplate.start(this.nameplateData());
    }

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('pointerupoutside', this.onPointerUp, this);
    this.input.on('wheel', this.onWheel, this);
    // ESC 回全景（@since v3.3，task_079）：镜头编排的「归位」键。
    // why 要先问归属（@since v3.3，task_217 / IX-04）：仪式在演 ⇒ 这次 ESC 归仪式；
    //   输入框持焦 ⇒ 这次 ESC 归输入框（画布让路，镜头不动）—— 见 onEscape 的裁决。
    this.input.keyboard?.on('keydown-ESC', this.onEscape, this);
    // 任意按键 = 跳过进副本仪式（@since v3.3，task_187 / M1-13：「任意输入即跳到末态」）。
    // why 排在 ESC 之后：Phaser 先发键专属事件再发通用 'keydown'（KeyboardPlugin.update）
    //   ⇒ ESC 走 onEscape（它自己也会吃掉仪式），别的键才落到这里。
    this.input.keyboard?.on('keydown', this.onKeyDown, this);
    // 右键语义（task_045）：浏览器默认的右键菜单会吃掉 pointerup，短按判定就废了 ——
    // 顺手也让右键拖拽平移不再被菜单打断（战场是全屏画布，没有"右键菜单"的正当需求）。
    this.input.mouse?.disableContextMenu();

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  // ==========================================================================
  // WorldScenePort：state → 场景同步（由桥接层调用）
  // ==========================================================================

  syncUnits(units: readonly UnitView[]): void {
    // 退场特效要用的坐标（@since v3.3，task_161）：单位被删掉后就查不到了 —— 先记下来。
    const positionsBefore = new Map<string, Point>();
    for (const object of this.units.list()) {
      positionsBefore.set(object.id, { x: object.position.x, y: object.position.y });
    }
    const result = this.units.sync(units);
    this.unitLayer.sync();
    // 单位离场，浮标一并收掉：表现不许悬在已不存在的单位头顶（task_038）。
    for (const id of result.removed) {
      this.taskFx.clear(id);
      // 气泡同理（task_076）：单位没了，它的话也该收掉。
      this.speechLayer.clearUnit(id);
      // 退场特效（task_161）：消散演出，落在单位最后的位置上。
      const position = positionsBefore.get(id);
      if (position) this.fxRouter.play('despawn', position.x, position.y);
    }
    this.taskFxLayer.sync();
    // 失焦（@since v3.4，task_092）：被锁定的单位离场 → 弧线与描边一并收掉
    // （表现不许指着一个已经不存在的单位）。
    const focusedId = this.focusLink.unitId;
    if (focusedId !== null && result.removed.includes(focusedId)) {
      this.focusLink.clear();
      this.unitLayer.setFocused(null);
    }
    // 落位上报（@since v3.12，task_033）：新增单位的坐标（恢复位或网格位）发回 core 方向，
    // 由 app 层持久化订阅者防抖落库。只对新增单位发：位置真相在本层，后续移动由移动链路上报。
    for (const id of result.added) {
      const object = this.units.get(id);
      if (!object) continue;
      this.bridge.unitPosition(id, object.position.x, object.position.y);
      // 上场特效（task_161）：传送门开启，落在单位的落位点上。
      this.fxRouter.play('spawn', object.position.x, object.position.y);
    }
  }

  /**
   * 任务全景同步（@since v3.3，task_078；由桥接层转发 state 通道的 missions + tasks）。
   * 区域 = 编组任务（mission），建筑 = 角色任务（task）：三态与点亮全部由 core 的相位派生，
   * 场景只负责把结果画出来（objects/task-building 的纯映射 + objects/building-layer 的绘制）。
   */
  syncTasks(missions: readonly MissionView[], tasks: readonly CharacterTask[]): void {
    const result = this.mapBoard.sync(missions, tasks);
    this.buildingLayer.sync(result);
    this.playTaskPointFx(result);
    // 动画八态（@since v3.8，task_141）：快照路的任务相位 → 单位基态。
    this.syncUnitTaskPhases(tasks);
    // 在办任务数（@since v3.3，task_187 / M1-13）：副本名牌第三行。
    // why 在这里算：桥接层转发过来的 tasks **已按副本过滤**（M1-10 的 scope 过滤）
    //   ⇒ 这里的条数就是「本副本在办几条」，不需要场景再判归属。
    this.activeTaskCount = countActiveTasks(tasks);
    this.refreshNameplate();
  }

  /**
   * 活跃副本视图同步（@since v3.3，task_187 / M1-13；由桥接层转发 state 通道的实例视图）。
   *
   * why 场景只存不解释：视图是 core 的事实（注册表的投影）⇒ 场景只把它画成名牌，
   *   不自己从整份清单里挑「哪个是活跃副本」（那是转发层的活，见 bridge/bus-adapter）。
   */
  syncInstanceView(view: ProjectInstanceView | null): void {
    this.instanceView = view;
    this.refreshNameplate();
  }

  /**
   * 任务点的演出（@since v3.3，task_077 / DEMO-PLAN §4）：
   *   - 任务被**认领**（地基 → 施工）→ 3D 翻卡（背面灰 → 正面亮色 + 图标）；
   *   - 任务**完成**（→ 完工）→ 插旗（旗杆升起 + 旗面 Back.Out 弹性展开，旗子驻留）。
   * why 挂在状态同步上：认领 / 完成都是**状态跳变**，而跳变正是 MapBoard 的产物
   *   （它记着上次的相位）—— 场景不自己比对状态，只把跳变翻译成演出。
   */
  private playTaskPointFx(result: MapSyncResult): void {
    if (result.claimedBuildingIds.length === 0 && result.completedBuildingIds.length === 0) return;
    const byId = new Map(result.buildings.map((building) => [building.id, building]));

    for (const id of result.claimedBuildingIds) {
      const building = byId.get(id);
      if (!building) continue;
      // 卡片浮在建筑上方（卡片比楼小，叠在楼上会糊在一起）。
      this.taskFxLayer.flipCard(building.x, building.y - BUILDING_SIZE);
      this.bridge.soundCue('claim');
    }

    for (const id of result.completedBuildingIds) {
      const building = byId.get(id);
      if (!building) continue;
      // 旗子插在建筑脚下（旗杆从地面升起）。
      this.taskFxLayer.raiseFlag(id, building.x, building.y + BUILDING_SIZE / 2);
      // 庆祝特效（task_161）：任务建筑完工 —— 彩带落在楼顶。
      this.fxRouter.play('celebrate', building.x, building.y - BUILDING_SIZE);
      this.bridge.soundCue('complete');
    }
  }

  /** 空状态提示：居中置于世界中心，首单位接入即隐藏（零假数据，不是种子单位）。 */

  syncSelection(selection: SelectionState): void {
    // 选择集镜像（task_045）：右键移动的载荷来源，与广播严格一致。
    this.selectedUnitIds = selection.unitIds;
    this.unitLayer.setSelection(selection.unitIds, selection.previewUnitIds);
    // 拖拽中的本地预览优先于状态投影（状态里的 previewUnitIds 恒空 —— 预览不出总线）：
    // 广播会重置预览集，拖拽未结束时补一次本地预览，弱色圈不至于闪没。
    if (this.boxPreviewIds) this.unitLayer.setPreviewHighlights(this.boxPreviewIds);
  }

  /**
   * 单位位置同步（@since v3.21，task_045；由桥接层转发 world 通道的 unit.position）。
   * 来源两路：runtime 广播的右击移动编队终值（→ tween 过渡）；场景自己上报的回环
   * （新单位落位，位置相同即 no-op）。浮标跟人走：位置真相已更新，表现层重对账一次。
   */
  syncUnitPosition(unitId: string, x: number, y: number): void {
    this.unitLayer.applyUnitPosition(unitId, x, y);
    this.taskFxLayer.sync();
  }

  /**
   * 单位说话状态（@since v3.37，task_062；由桥接层转发 world 通道的 unit.speaking）。
   * app 层 chat-service 在流式期间发 true / 收尾发 false —— 场景只转交给单位层
   * （头顶「···」气泡起止），不持有第二份状态。
   */
  syncUnitSpeaking(unitId: string, speaking: boolean): void {
    this.unitLayer.setSpeaking(unitId, speaking);
  }

  /**
   * 相机跳转（@since v3.33，task_057；由桥接层转发 world 通道的 camera.center）。
   * 小地图点击/拖拽的目标点：保持 zoom 只动中心，落位仍过 camera-math 的视口钳制
   * （apply 内部）；位姿真变了才回调 onChange → cameraMoved（合并窗口照常）。
   * 拖拽小地图是连续一串 center —— 每次都补排一次 flush：合并窗口吞掉的末位姿
   * 在停手后 ~CAMERA_EVENT_INTERVAL_MS 内补发（同滚轮的 scheduleCameraFlush 口径），
   * 小地图视口框才不会停在倒数第二帧。
   */
  syncCameraCenter(x: number, y: number): void {
    this.view.apply({ center: { x, y }, zoom: this.view.current.zoom });
    this.scheduleCameraFlush();
  }

  /**
   * 镜头震动（@since v3.3，task_080；由桥接层转发 world 通道的 camera.shake）。
   * 里程碑大字落下时的一记小震：走 Phaser 相机的 shake 效果 —— 它在渲染期给相机矩阵加偏移，
   * 不动 scroll，故与 CameraController 的位姿写入互不干扰（相机停哪儿，震的就是哪儿）。
   * 参数已由 core 的 clampShake 钳过（时长 ≤ 500ms、强度 ≤ 2% 视口），这里不再二次判断。
   */
  syncCameraShake(durationMs: number, intensity: number): void {
    this.cameras.main.shake(durationMs, intensity);
  }

  /**
   * 任务生命周期 → 战场表现（@since v3.17，task_038；由桥接层转发 task.started/completed/failed）。
   * 事件带 characterId，战场认单位：applyTaskFxEvent 反查 + 落板，表现层对账重画。
   */
  syncTaskEvent(task: CharacterTask, phase: TaskFxPhase): void {
    const hitUnitIds = applyTaskFxEvent(this.taskFx, this.units.list(), task, phase);
    // 动画八态（@since v3.8，task_141）：任务生命周期 → 单位的动画基态。
    //   开工 → 工作态（前倾 + 微颤 + 头顶进度弧）；
    //   完成 → 收工站直（庆祝演出是**正交瞬态**，由 triggerCompleted 单独起拍）；
    //   失败 → 卡住态（❗ + 灰度 + 抖动，驻留到下一条任务事件）；
    //   挂起（awaiting_approval）→ 撤相位 —— 挂起不算忙（core 已回收 busy，基态自然回静息）。
    //
    // why 事件与快照两路都走同一块相位板：一次跳变只演一次庆祝（板按 taskId 去重），
    //   谁先到都行（本地直连模式事件先到，远程模式快照先到）。
    for (const unitId of hitUnitIds) {
      const next: UnitTaskPhase =
        phase === 'started'
          ? 'running'
          : phase === 'completed'
            ? 'completed'
            : phase === 'failed'
              ? 'failed'
              : 'none';
      const transition = this.unitLayer.setTaskPhase(unitId, next, task.id);
      // 完成演出（@since v3.3，task_075）：任务落到谁头上，谁就 squash → 跳 20px → 落地星尘。
      //   'unchanged' = 这单已经演过（快照路先到并演掉了）→ 不重复演。
      if (next === 'completed' && transition !== 'unchanged') {
        this.unitLayer.triggerCompleted(unitId);
      }
      // 精灵特效（@since v3.3，task_161）：任务完成 → 庆祝；报错 → 冲击爆闪。
      //   播什么由 fxKindForTaskPhase 裁决（映射只有一处），落在干活的那个单位脚下。
      const fxKind = fxKindForTaskPhase(phase);
      if (fxKind) {
        const unit = this.units.get(unitId);
        if (unit) this.fxRouter.play(fxKind, unit.position.x, unit.position.y);
      }
    }
    this.taskFxLayer.sync();
  }

  /**
   * 任务清单 → 单位动画相位（@since v3.8，task_141；快照路）。
   *
   * why 需要这一路：真相持有者（gateway / service 进程）里的 core 才发 task.* 事件，
   *   视图壳（远程模式）只拿到**全量快照**（WorldState.tasks —— 与任务面板同源的那份清单）。
   *   没有这一路，远程壳上「派了活儿的单位」不会动。
   *
   * 口径：只有 running 才算在干活（与 core 的 busy 派生一致）；completed 只在**跳变**时演庆祝
   *   （客户端不在场时收到的旧完成单不补演）；failed 驻留（❗ 挂着，与 task-fx 同款语义）。
   */
  private syncUnitTaskPhases(tasks: readonly CharacterTask[]): void {
    for (const unit of this.units.list()) {
      if (!unit.characterId) continue;
      const view = taskPhaseView(tasks, unit.characterId);
      // 没有前相位就不落 'completed'：客户端不在场 → 不补演庆祝（免得开局集体跳一下）。
      const next: UnitTaskPhase =
        view.phase === 'completed' && !this.unitLayer.hasTaskPhase(unit.id) ? 'none' : view.phase;
      const transition = this.unitLayer.setTaskPhase(unit.id, next, view.taskId);
      if (transition === 'entered-completed') this.unitLayer.triggerCompleted(unit.id);
    }
  }

  /**
   * 任务生命周期 → 说话气泡（@since v3.3，task_076；由桥接层转发 task.queued / started /
   * completed / failed）。事件带的是 characterId，战场认单位 —— 按 characterId 反查，
   * 命中的单位各自冒一句（句库见 world/speech-templates.ts）。
   * 频率规则（同屏 ≤3 / 同单位 5s 冷却）由气泡板裁决，本层只管「谁说」。
   */
  syncTaskSpeech(task: CharacterTask, kind: SpeechKind): void {
    for (const unit of this.units.list()) {
      if (unit.characterId !== task.characterId) continue;
      this.speechLayer.speak(unit.id, kind);
    }
  }

  /**
   * 导演镜头事件（@since v3.3，task_081；由桥接层转发 task.started / completed / failed）。
   *
   * 事件点 = **干活的那个单位**所在的位置（任务按 characterId 落到人身上，
   *   战场认单位的方式与气泡系统同口径）。找不到对应单位 → 没有点可看，
   *   传 null（导演据此不动镜头；报错仍会闪一次红光）。
   */
  syncDirectorEvent(task: CharacterTask, kind: DirectorEventKind): void {
    const unit = this.units.list().find((item) => item.characterId === task.characterId);
    const target = unit ? { x: unit.position.x, y: unit.position.y } : null;
    this.director.receive(kind, target);
  }

  /**
   * 导演模式开关（@since v3.3，task_081；由桥接层转发 core → world 的 camera.director 事件）。
   * 开启 = 镜头交给导演；关闭 = 完全交还手动（导演停手，在飞的补间一并撤掉）。
   */
  syncDirectorMode(enabled: boolean): void {
    // 导演接管镜头 → 跟随镜头让位（两者不能同时写镜头）。
    if (enabled) this.releaseFollow();
    this.director.setEnabled(enabled);
    // 取景框（@since v3.4，task_092）：导演接管镜头时，中屏四角出现取景框标识 ——
    // 画面回显「镜头已经不是你的了」（L3 层提示）。关掉导演 → 取景框收掉。
    this.directorFrame.setEnabled(enabled);
    this.directorFrame.sync(this.viewport());
  }

  /**
   * 角色升级（@since v3.3，task_161；由桥接层转发 world 通道的 level.up）。
   * 战场认单位的方式与任务事件一致：按 characterId 反查 → 在该单位脚下播治疗光环。
   * 角色不在场上（没接单位 / 已退场）→ 没有落点，不播（不凭空造位置）。
   */
  syncLevelUp(characterId: string, _toLevel: number): void {
    const unit = this.units.list().find((item) => item.characterId === characterId);
    if (!unit) return;
    this.fxRouter.play('levelUp', unit.position.x, unit.position.y);
  }

  /**
   * 单位联动（@since v3.4，task_092；由桥接层转发 world 通道的 focus.unit）。
   *
   * HUD 事件轨条目点击 → 被点单位**描边高亮**（霓虹描边 + 呼吸）+ 左下事件轨到中屏单位的
   * **引导弧线**（800ms 淡入，镜头移动实时跟随）。
   * 再次点击同一条 = 取消锁定（弧线收掉、描边褪掉 —— 规格「持续到失焦/再次点击」）；
   * 被锁定的单位离场 = 失焦（同样收掉，见 syncUnits）。
   */
  syncFocusUnit(unitId: string): void {
    const outcome = this.focusLink.focus(unitId);
    if (!outcome.changed) return;
    // 描边高亮跟着焦点走（outcome.unitId 为 null = 已取消 → 描边褪掉）。
    this.unitLayer.setFocused(outcome.unitId);
  }

  /**
   * 指定文案气泡（@since v3.3，task_076；由桥接层转发 world 通道的 unit.bubble）。
   * 原话已经定好（例如「收到」「来了来了」）—— 按原话冒泡，不抽句库。
   */
  syncUnitBubble(unitId: string, text: string): void {
    this.speechLayer.speakText(unitId, text);
  }

  /**
   * 回放节拍（@since v3.3，task_082；由桥接层转发 world 通道的 replay.beat）。
   *
   * 战场怎么演这一拍：
   *   ① reset → 清场（化身收掉，拖回早的时刻不能叠着后来的画面）；
   *   ② 落化身 → 优先站在**真实单位**的位置（角色还在场上就站在他那儿），
   *      角色不在场 → 走稳定槽位（同一角色每次回放落在同一格）；
   *   ③ 完成 → 插旗（复用 task_077 的旗子；key 带时刻 → 每次重演都插得出来）；
   *   ④ 镜头 → 跟到这一拍的角色身上（**自动导演镜头**；化身铺在网格上，
   *      镜头不跟就等于什么也没演）；
   *   ⑤ 气泡 → **半频**（REPLAY_METRICS.bubbleEveryN = 每 2 拍才冒一次），
   *      走既有气泡系统（离线模板句库 + 同屏上限 + 同单位冷却）。
   *
   * why 气泡挂在「回放锚点」而不是真实单位上：回放演的是**历史**角色 ——
   *   他今天多半已经不在战场上了。气泡必须挂在说话方头上（凭空造单位 = 骗观众），
   *   所以用 `replay:<characterId>` 当说话方 id，位置由回放化身给（锚点覆盖）。
   */
  syncReplayBeat(beat: ReplayBeat): void {
    if (beat.kind === 'reset') {
      for (const avatar of this.replayBoard.list()) {
        const anchorId = replayAnchorId(avatar.characterId);
        this.speechLayer.clearUnit(anchorId);
        this.speechLayer.clearAnchor(anchorId);
      }
      this.replayBoard.reset();
      this.replayLayer.clear();
      this.replayBubbleTick = 0;
      // 回放插的旗子跟着收（画面要回到那一刻的样子，不是那一刻 + 后来）。
      this.taskFxLayer.clearFlagsWithPrefix('replay:');
      return;
    }
    const avatar = this.replayBoard.apply(beat);
    if (!avatar) return;

    const unit = this.units.list().find((item) => item.characterId === avatar.characterId);
    const position = replayAvatarPosition(
      avatar,
      unit ? unit.position : null,
      DEFAULT_WORLD_BOUNDS
    );
    this.replayLayer.upsert(avatar, position);

    // 自动导演镜头：镜头跟到这一拍的角色身上（合并到帧末落位 —— 见 focusReplay）。
    this.focusReplay(position);

    // 气泡锚点：角色不在场上时，气泡挂在回放化身头顶。
    const anchorId = replayAnchorId(avatar.characterId);
    this.speechLayer.setAnchor(anchorId, position);

    if (avatar.phase === 'done') {
      // 插旗（复用 task_077 的旗子：驻留式成就陈列）。
      this.taskFxLayer.raiseFlag(`replay:${avatar.characterId}:${avatar.at}`, position.x, position.y + 10);
    }

    // 半频气泡：每 N 拍才冒一次（规格钦定 2）。计数在 reset 时归零（一次回放一套节奏）。
    this.replayBubbleTick += 1;
    if (this.replayBubbleTick % REPLAY_METRICS.bubbleEveryN !== 0) return;
    if (avatar.phase === 'spawn') this.speechLayer.speak(anchorId, 'start');
    else if (avatar.phase === 'done') this.speechLayer.speak(anchorId, 'complete');
    else if (avatar.phase === 'error') this.speechLayer.speak(anchorId, 'error');
    else if (avatar.label) this.speechLayer.speakText(anchorId, avatar.label);
  }

  /**
   * 回放镜头跟到某个点（@since v3.3，task_082：「60 秒看完今天」的自动导演镜头）。
   *
   * why 归 world 而不是 hud：化身的确切落位只有 world 知道（真实单位位置 / 稳定槽位），
   *   让 hud 隔着总线反推位置只会得到「大概在哪」——镜头追不准就是没导演。
   * why 合并到帧末：拖动 scrubber 时一帧内会灌进几十拍 —— 每拍都补间一次纯属浪费
   *   （perf 硬约束）；合并后一帧只补间一次，落到最后一拍的位置。
   */
  private focusReplay(position: Point): void {
    this.replayFocusTarget = position;
    if (this.replayFocusScheduled) return;
    this.replayFocusScheduled = true;
    this.time.delayedCall(0, () => {
      this.replayFocusScheduled = false;
      const target = this.replayFocusTarget;
      this.replayFocusTarget = null;
      if (!target) return;
      // 跟随镜头让位（两处镜头控制不能同时开 —— 同手动优先的口径）。
      this.releaseFollow();
      this.tweenCameraTo({ center: { x: target.x, y: target.y }, zoom: this.view.current.zoom });
    });
  }

  // ==========================================================================
  // 输入处理：场景交互 → WorldEvent（经桥接层发回 core）
  // ==========================================================================

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 仪式在演 ⇒ 这次点击用来跳过仪式（不吃掉的话会顺手选中单位）。
    if (this.consumeCeremonyInput()) return;
    // 右键 / 中键拖拽 = 平移候选；左键留给框选与点击。
    // 右键在 pointerup 才分流（task_045）：短按 = 移动指令（对选中编队），拖远 = 平移。
    if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
      this.dragMode = 'pan';
      this.panButton = pointer.rightButtonDown() ? 'right' : 'middle';
      this.draggedFar = false;
      this.dragStartScreen = { x: pointer.x, y: pointer.y };
      this.dragLastScreen = { x: pointer.x, y: pointer.y };
      // 橡皮筋起手（@since v3.3，task_079）：记住「用户想拉到哪」（未钳制的中心），
      // 并把上一次回弹残留的越界量清零 —— 新的拖拽从当前真实位置开始。
      this.panDesired = { ...this.view.current.center };
      this.rubberOffset = { x: 0, y: 0 };
      this.rubberTween?.remove();
      this.rubberTween = null;
      this.view.clearOvershoot();
      // 手动平移 = 交还镜头控制权（跟随镜头让位）。
      this.releaseFollow();
      // 手动优先（task_081）：用户一碰镜头，导演模式立刻退出（本次切换）。
      this.releaseDirector();
      return;
    }

    const world = this.toWorldPoint(pointer);
    this.dragStartScreen = { x: pointer.x, y: pointer.y };
    this.dragStartWorld = world;
    this.draggedFar = false;

    // 起点落在单位上就先按"点击"处理；落在空地才是框选
    this.dragMode = this.unitLayer.hitTest(world.x, world.y) === null ? 'box' : 'click';
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    // hover 态（@since v3.3，task_075）：指针悬停在单位上 → 放大 1.1x + pointer 光标 + 喷口微光。
    // why 拖拽中不判 hover：拖拽是在操作（框选 / 平移），不是悬停 —— 边拖边放大很吵。
    if (this.dragMode === 'none') {
      const hoverWorld = this.toWorldPoint(pointer);
      const hovered = this.unitLayer.hitTest(hoverWorld.x, hoverWorld.y);
      this.unitLayer.setHovered(hovered ? hovered.id : null);
      return;
    }

    if (this.dragMode === 'pan') {
      // 屏幕空间增量拖拽：相机反向跟随指针（内容跟手），每步只看屏幕位移，与相机当前位姿无关。
      const zoom = this.view.current.zoom;
      this.applyPanDelta(
        (this.dragLastScreen.x - pointer.x) / zoom,
        (this.dragLastScreen.y - pointer.y) / zoom
      );
      this.dragLastScreen = { x: pointer.x, y: pointer.y };
      // 起手以来的累计位移超阈值才算"拖拽平移"；没超就保持短按候选（pointerup 分流用，task_045）
      if (this.screenDistance(pointer) > DRAG_THRESHOLD_PX) this.draggedFar = true;
      return;
    }

    if (this.screenDistance(pointer) > DRAG_THRESHOLD_PX) this.draggedFar = true;
    if (this.dragMode === 'box' && this.draggedFar) {
      const bounds = this.boxBounds(this.dragStartWorld, this.toWorldPoint(pointer));
      this.selectionBox.show(bounds);
      // 框选预览（task_045）：命中本地直出弱色圈（高频，不经总线），松手才上报终值 id。
      this.updateBoxPreview(bounds);
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    // 仪式在演 ⇒ 这次松手用来跳过仪式（不吃掉的话会顺手框选 / 发移动指令）。
    if (this.consumeCeremonyInput()) return;
    const mode = this.dragMode;
    this.dragMode = 'none';

    if (mode === 'pan') {
      this.bridge.flushCamera();
      // 橡皮筋回弹（@since v3.3，task_079）：松手后越界位移弹回边界内。
      this.releaseRubberBand();
      // 右键短按（没拖成平移）= 移动指令：选中编队 → 目标点（task_045）。
      // 无选中 = 纯无操作（不硬凑聚焦）；中键短按 = 无操作。
      if (this.panButton === 'right' && !this.draggedFar) this.issueMoveCommand(pointer);
      this.panButton = null;
      return;
    }

    if (mode === 'box') {
      const bounds = this.boxBounds(this.dragStartWorld, this.toWorldPoint(pointer));
      const hits = this.draggedFar ? this.unitLayer.queryBounds(bounds) : [];
      // 松手收尾（task_077）：边框收缩 + 霓虹闪一下后消失（不是直接抹掉 —— 收尾本身是演出）。
      this.selectionBox.release();
      this.clearBoxPreview();
      // 框选闭环（task_045）：命中判定在本层（core 无坐标），终值 id 补在事件上。
      // 拖空框 = 清空选择（拖了个空框也是一次明确的选择动作）；点空地 = 零面积框选，
      // 同样清空（RTS 惯例的取消选择；Shift 按住 = 加选语义，命中空自然是 no-op，core 也不广播）。
      const additive = readModifiers(pointer).shift;
      this.bridge.selectionBox(bounds, hits, additive);
      // 波浪式弹选择环（task_077 / DEMO-PLAN §4）：命中的单位每 40ms 弹一个。
      if (hits.length > 0) {
        this.unitLayer.popSelectionWave(hits);
        this.bridge.soundCue('select');
      }
      return;
    }

    if (mode === 'click' && !this.draggedFar) {
      const hit = this.unitLayer.hitTest(this.dragStartWorld.x, this.dragStartWorld.y);
      if (hit) {
        // 点击涟漪 + squash（@since v3.3，task_075）：白圈 200ms 扩散淡出。
        this.unitLayer.pulseClick(hit.id);
        // 单击 = **选中**（task_214 / IX-03）：unit.click 是选择的锚 —— 右键移动、键盘操作都建立在它之上。
        // why 每一击都发：第一击就是一次普通单击选中，双击的第一击**照常选中**（不产生第二种选中态）。
        this.bridge.unitClick(hit.id, readModifiers(pointer));
        // 点击语义判定（task_214 / IX-03）：单击 = 选中 / 双击 = 打开该 agent 的单独聊天框。
        //   双击窗口复用 CAMERA_METRICS.doubleClickWindowMs 同源常量（判定在 click-semantics 纯函数里）。
        const stamp: ClickStamp = {
          unitId: hit.id,
          timeMs: this.time.now,
          x: pointer.x,
          y: pointer.y,
        };
        const decision = resolveCanvasClick(this.lastClick, stamp);
        this.lastClick = decision.nextStamp;
        if (decision.action === 'chat-open') {
          // 双击单位 = 打开该 agent 的**单独聊天框**（task_214 / IX-03）。
          // why 走事件不直调 HUD：world 不直调 hud（铁律 1）—— 事件 → core 裁决 →
          //   WorldState.chatTarget → HUD 聊天抽屉订阅后开框（design §5.2 扩展点 E-1）。
          this.bridge.unitChatOpen(hit.id);
          // 跟随镜头保留（@since v3.3，task_079；跟随中再双击解除）——
          //   task_079 的「跟随/解除/回全景可用」不能因双击语义改绑而失效。
          this.toggleFollow(hit.id);
        }
      } else {
        // 点空地 = 没有下一次双击的对象（避免隔空双击把镜头带走）。
        this.lastClick = null;
      }
    }
  }

  /**
   * 右键短按 → unit.move（task_045）+ 下达指令的特效（task_077 / DEMO-PLAN §4）：
   *   ① 每个选中单位脚下到目标点拉**流动虚线**（青→目标色渐变，800ms 后淡出）；
   *   ② 目标点**双重涟漪**（两圈先后 300ms 扩散）；
   *   ③ 单位头顶统一冒「收到」类气泡（气泡系统 task_076 未合入 → 这里只发事件）；
   *   ④ 右键落在**卡住**的单位上 = 集火支援：气泡换成「来了来了」+ 脚下位移脉冲一次。
   *   ⑤ 目标点升起**信号弹**（@since v3.3，task_161：sheet 动画特效）。
   * 指令上报（编队落位在 core 算）与特效同一次动作发出 —— 画面与逻辑同帧，不分先后。
   */
  private issueMoveCommand(pointer: Phaser.Input.Pointer): void {
    if (this.selectedUnitIds.length === 0) return;
    this.issueMoveCommandAt(this.toWorldPoint(pointer));
  }

  /**
   * 下达移动指令（世界坐标目标点）—— 右键短按与外部调用共用这一条路径。
   *
   * why 拆成两个方法：「目标点从哪来」（指针换算）与「指令怎么发」（选中集 → 流线 / 气泡 /
   *   涟漪 / 信号弹 / unit.move）是两件事 —— 拆开后 dev 验收页可以按世界坐标发起同一条指令，
   *   走的仍是生产路径（不另起一条"给特效用"的捷径）。
   */
  issueMoveCommandAt(target: Point): void {
    if (this.selectedUnitIds.length === 0) return;

    // 集火判定：右键命中一个**卡住**（error）的单位 = 支援它（不是单纯移动）。
    const hit = this.unitLayer.hitTest(target.x, target.y);
    const focusFire = hit !== null && hit.status === 'error';
    const bubbleText = focusFire ? INTERACTION_BUBBLE_TEXT.focus : INTERACTION_BUBBLE_TEXT.command;

    for (const unitId of this.selectedUnitIds) {
      const unit = this.units.get(unitId);
      if (!unit) continue;
      this.taskFxLayer.commandFlow(unit.position, target);
      this.bridge.unitBubble(unitId, bubbleText);
      if (focusFire) this.taskFxLayer.footPulse(unit.position.x, unit.position.y);
    }

    this.taskFxLayer.doubleRipple(target.x, target.y);
    // 指令特效（@since v3.3，task_161）：信号弹在目标点升起 —— 叠加在流动虚线之上。
    this.fxRouter.play('command', target.x, target.y);
    this.bridge.soundCue(focusFire ? 'focus' : 'command');
    this.bridge.unitMove(this.selectedUnitIds, target.x, target.y);
  }

  /** 框选拖拽中的预览命中更新（task_045）：命中集没变就不重画（弱化高频重绘）。 */
  private updateBoxPreview(bounds: Bounds): void {
    const hits = this.unitLayer.queryBounds(bounds);
    const nextKey = hits.join('\u0000');
    const prevKey = this.boxPreviewIds === null ? null : this.boxPreviewIds.join('\u0000');
    if (nextKey === prevKey) return;
    this.boxPreviewIds = hits;
    this.unitLayer.setPreviewHighlights(hits);
  }

  /** 收掉框选预览（task_045）：松手 / 场景关闭时调用；终值选中由 core 广播回来驱动。 */
  private clearBoxPreview(): void {
    this.boxPreviewIds = null;
    this.unitLayer.setPreviewHighlights([]);
  }

  private onWheel(
    pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number
  ): void {
    // 仪式在演 ⇒ 这次滚轮用来跳过仪式（不吃掉的话会顺手缩放镜头）。
    if (this.consumeCeremonyInput()) return;
    // Phaser 的 wheel 事件只给增量，没有"滚轮停止"信号；用一次延时补发收尾
    void pointer;
    // 缩放区间 0.6-1.6x（@since v3.3，task_079）：越界即夹住（缩放没有回弹 ——
    // 滚轮是离散的，硬夹住比弹回来更利落）。
    const factor = deltaY > 0 ? 1 / CAMERA_METRICS.zoomStep : CAMERA_METRICS.zoomStep;
    const zoom = zoomWithUserLimits(this.view.current, factor);
    // 手动缩放 = 交还镜头控制权（跟随镜头让位）。
    this.releaseFollow();
    // 手动优先（task_081）：导演让位，本次切换退出。
    this.releaseDirector();
    this.view.apply({ center: this.view.current.center, zoom });
    this.scheduleCameraFlush();
  }

  private onResize(): void {
    this.view.syncViewport();
    // 取景框几何跟着视口走（@since v3.4，task_092）：中屏变了，框的位置也要变。
    this.directorFrame.sync(this.viewport());
    // 副本名牌（@since v3.3，task_187 / M1-13）：遮罩要重新铺满，名牌要回到正中。
    this.nameplate?.resize(this.scale.width, this.scale.height);
  }

  /**
   * 引导弧线的每帧同步（@since v3.4，task_092）：把被锁定单位的**世界坐标**按当前相机
   * 换算成屏幕坐标，交给弧线层重画。
   *
   * why 用 visualCenter 而不是 current.center：橡皮筋回弹时相机**视觉上**已经越界，
   *   位姿（current.center）还钳在边界内 —— 用它算弧线末端，线会跟画面差那一点。
   * why 每帧都算：镜头在动、单位也在动（移动补间），两者都会改末端位置。
   */
  private syncFocusLink(): void {
    const unitId = this.focusLink.unitId;
    if (unitId === null) return;
    const unit = this.units.get(unitId);
    if (!unit) {
      // 目标单位不在场（还没接入 / 已离场）：失焦 —— 弧线与描边一并收掉
      //（表现不许指着一个不存在的单位）。
      this.focusLink.clear();
      this.unitLayer.setFocused(null);
      return;
    }
    this.focusLink.sync(
      { center: this.view.visualCenter, zoom: this.view.current.zoom },
      this.viewport(),
      unit.position
    );
  }

  // ==========================================================================
  // 摄像机编排（@since v3.3，task_079）：橡皮筋回弹 / 跟随镜头 / 回全景
  // ==========================================================================

  /** 视口尺寸（世界坐标换算的基准；与相机控制器读同一份）。 */
  private viewport(): { width: number; height: number } {
    return { width: this.scale.width, height: this.scale.height };
  }

  /**
   * 拖拽平移的一步（橡皮筋）。
   *
   * 口径：目标中心（**未钳制**）累加位移 → 钳制后的中心落进相机 → 越界量按阻力外显。
   * why 分两份：钳制后的中心丢了「用户想拉到哪」，越界量就无从算起；
   *   而相机位姿必须始终在边界内（上报 / 小地图视野框都按它算）。
   */
  private applyPanDelta(dx: number, dy: number): void {
    const desired = this.panDesired ?? { ...this.view.current.center };
    this.panDesired = { x: desired.x + dx, y: desired.y + dy };
    const zoom = this.view.current.zoom;
    const clamped = clampCameraCenter(this.panDesired, zoom, this.viewport(), DEFAULT_WORLD_BOUNDS);
    const display = rubberBandDisplay(rubberBandOffset(this.panDesired, clamped));
    this.rubberOffset = display;
    this.view.apply({ center: clamped, zoom });
    this.view.setOvershoot(display);
  }

  /**
   * 松手：越界位移弹回边界内（橡皮筋回弹）。
   * why 用补间而不是瞬移：瞬移是「啪一下」跳回去，回弹才是「被弹回来」的手感。
   */
  private releaseRubberBand(): void {
    this.panDesired = null;
    if (this.rubberOffset.x === 0 && this.rubberOffset.y === 0) return;
    const from = { ...this.rubberOffset };
    this.rubberTween?.remove();
    this.rubberTween = this.tweens.addCounter({
      from: 1,
      to: 0,
      duration: CAMERA_METRICS.rubberBandReturnMs,
      ease: 'Cubic.Out',
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        const k = tween.getValue() ?? 0;
        this.rubberOffset = { x: from.x * k, y: from.y * k };
        this.view.setOvershoot(this.rubberOffset);
      },
      onComplete: () => {
        this.rubberOffset = { x: 0, y: 0 };
        this.view.clearOvershoot();
        this.rubberTween = null;
      },
    });
  }

  /** 双击单位 = 跟随镜头；跟随中再双击**同一个**单位 = 解除跟随。 */
  private toggleFollow(unitId: string): void {
    // 手动优先（task_081）：双击跟随也是手动操作 —— 导演让位。
    this.releaseDirector();
    if (this.followUnitId === unitId) {
      this.releaseFollow();
      return;
    }
    const unit = this.units.get(unitId);
    if (!unit) return;
    this.followUnitId = unitId;
    this.tweenCameraTo({
      center: { x: unit.position.x, y: unit.position.y },
      zoom: this.view.current.zoom,
    });
  }

  /** 解除跟随：镜头停在原处，控制权交还手动。 */
  private releaseFollow(): void {
    this.followUnitId = null;
  }

  /**
   * 手动优先（@since v3.3，task_081）：用户碰了镜头（拖拽 / 滚轮 / 双击 / ESC）→ 导演让位。
   * why 由 world 主动退出而不是「等 core 下一条命令」：导演模式的价值在于
   *   「主播只解说，不碰镜头」—— 一旦碰了，就必须立刻把手感还回去，不能有半秒的抢镜头。
   * 退出后导演会发一次 camera.director=false（经宿主回调）→ core 写回状态 → HUD 开关熄灭。
   */
  private releaseDirector(): void {
    this.director.releaseByManual();
  }

  /**
   * 导演宿主（@since v3.3，task_081）：把场景的镜头能力注入导演控制器。
   * why 注入而不是让导演直接拿相机：导演的编排逻辑（优先级 / 静默 / 巡视）由此可脱离
   *   Phaser 单测 —— 换渲染引擎时导演一行不用改。
   */
  private directorHost(): DirectorHost {
    return {
      viewport: () => this.viewport(),
      bounds: DEFAULT_WORLD_BOUNDS,
      now: () => this.time.now,
      tweenTo: (pose, durationMs) => this.tweenCameraTo(pose, durationMs),
      place: (pose) => {
        this.view.apply(pose);
      },
      schedule: (ms, fn) => {
        const timer = this.time.delayedCall(ms, fn);
        return () => timer.remove(false);
      },
      cancelTween: () => {
        this.cameraTween?.remove();
        this.cameraTween = null;
      },
      onManualRelease: () => this.bridge.directorMode(false),
    };
  }

  /**
   * 镜头补间到目标位姿（回全景 / 进入跟随）：600ms Cubic.easeInOut（通用摄像机移动口径）。
   * why 自己插值而不直接补间相机属性：相机位姿要过一遍钳制（camera-math），
   *   中间帧也得落在边界内 —— 补间相机 scroll 会绕过钳制。
   */
  private tweenCameraTo(target: CameraPose, durationMs: number = CAMERA_METRICS.moveDurationMs): void {
    this.cameraTween?.remove();
    const from = this.view.current;
    const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
    this.cameraTween = this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: durationMs,
      ease: 'Cubic.easeInOut',
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        const k = tween.getValue() ?? 0;
        this.view.apply({
          center: {
            x: lerp(from.center.x, target.center.x, k),
            y: lerp(from.center.y, target.center.y, k),
          },
          zoom: lerp(from.zoom, target.zoom, k),
        });
      },
      onComplete: () => {
        this.cameraTween = null;
        // 补间途中的位姿被桥接层的合并窗口吞掉了最后一个 —— 收尾补发一次
        // （小地图视野框要落在最终位姿上，不然它会停在半路）。
        this.scheduleCameraFlush();
      },
    });
  }

  /**
   * ESC = 回全景：整个战场装进视口（同时解除跟随）。
   *
   * 归属裁决（@since v3.3，task_217 / IX-04）：**仪式 > 输入焦点 > 画布**（keyboard-priority.ts）。
   *   - 仪式在演 ⇒ ESC = 跳过仪式（跳到末态），不回全景（回全景正是仪式的收尾动作）；
   *   - 输入框持焦（聊天框在打字）⇒ 画布**让路**：镜头不动、选择不动（design §3 C-04）；
   *   - 其余 ⇒ 回全景（task_079）。
   */
  private onEscape(): void {
    const owner = this.resolveKeyOwner();
    // 仪式在演 ⇒ ESC = 跳过仪式（跳到末态），不回全景（回全景正是仪式的收尾动作）。
    if (owner === 'ceremony') {
      this.consumeCeremonyInput();
      return;
    }
    // 输入焦点在输入框里 ⇒ 这次 ESC 归输入框：画布不动。
    if (owner === 'input') return;
    this.releaseFollow();
    // 手动优先（task_081）：ESC 回全景也是手动操作 —— 导演让位。
    this.releaseDirector();
    this.view.clearOvershoot();
    this.rubberOffset = { x: 0, y: 0 };
    this.tweenCameraTo(overviewPose(this.viewport(), DEFAULT_WORLD_BOUNDS));
  }

  /**
   * 任意按键（@since v3.3，task_187 / M1-13）：仪式在演就跳过它。
   *
   * why 单独一个监听：验收②「任意输入即跳到末态」—— 不只是鼠标，键盘也算输入。
   * why 非仪式期画布**不拦**任何键：矩阵 §2 的键盘面里，除 ESC 外画布没有键位
   *   ⇒ 未定义的键一律**无操作**（不 preventDefault、不吞字符）。
   */
  private onKeyDown(): void {
    if (this.resolveKeyOwner() !== 'ceremony') return;
    this.consumeCeremonyInput();
  }

  /**
   * 这一次键击归谁（@since v3.3，task_217 / IX-04）：仪式 > 输入焦点 > 画布。
   *
   * why 焦点是「现取」而不是缓存：焦点随时会变（用户点一下聊天框就变了）
   *   —— 读口每次现取（见 world/input-focus.ts）。
   */
  private resolveKeyOwner(): KeyboardOwner {
    return resolveKeyboardOwner({
      ceremonyPlaying: this.ceremonyPlaying(),
      inputFocused: readInputFocus(this.registry),
    });
  }

  /** 进场仪式在不在演（@since v3.3，task_217 / IX-04：归属链的第一档）。 */
  private ceremonyPlaying(): boolean {
    return this.nameplate?.active === true;
  }

  /**
   * 吃掉「仪式期间」的一次输入（@since v3.3，task_187 / M1-13）。
   *
   * @returns true = 这次输入被仪式吃掉了（调用方别再处理它 ——
   *   仪式期间的一次点击不该顺手选中单位）。
   */
  private consumeCeremonyInput(): boolean {
    const plate = this.nameplate;
    if (!plate?.active) return false;
    plate.skip();
    return true;
  }

  /** 相机归位（进副本仪式的正常收尾）：补间回 `overviewPose()`。 */
  private cameraHome(durationMs: number): void {
    this.tweenCameraTo(overviewPose(this.viewport(), DEFAULT_WORLD_BOUNDS), durationMs);
  }

  /** 相机归位（进副本仪式被跳过）：**瞬跳**回 `overviewPose()`（跳到末态，不补间）。 */
  private cameraHomeNow(): void {
    this.cameraTween?.remove();
    this.cameraTween = null;
    this.view.apply(overviewPose(this.viewport(), DEFAULT_WORLD_BOUNDS));
  }

  /**
   * 副本名牌的数据（@since v3.3，task_187 / M1-13）—— **投影自 WorldState**。
   *
   * why 每一项都可能缺省：state 通道的快照可能后于仪式第一帧到达（远程模式）
   *   ⇒ 不知道的项留 null（名牌不画那一段），数据到了再补（不重演仪式）。
   */
  private nameplateData(): InstanceNameplateData {
    const view = this.instanceView;
    return {
      name: view?.title || this.instanceId || '副本',
      branch: view?.vcs?.branch ?? null,
      pathTail: view ? pathTailOf(view.path) : null,
      activeTaskCount: this.activeTaskCount,
    };
  }

  /** 把最新的名牌数据推给牌子板（只在仪式还在演时推 —— 演完了牌子已撤）。 */
  private refreshNameplate(): void {
    const plate = this.nameplate;
    if (!plate?.active) return;
    plate.setData(this.nameplateData());
  }

  /**
   * 入夜变暖（氛围彩蛋）：真实本地时间 19-24 点，背景格网微微变暖。
   * why 用真实时间：这是「直播时段的隐藏彩蛋」—— 观众在晚上看直播时才撞见。
   */
  private applyAmbientWarmth(): void {
    const hour = new Date().getHours();
    this.groundLayer.setWarmth(isWarmHour(hour) ? 1 : 0);
  }

  /**
   * 跟随镜头：每帧把镜头对到目标单位。
   * why 补间进行中不抢：进入跟随时有一段 600ms 的移动补间，补间与跟随同时写相机
   *   会互相拉扯（画面抖）。补间结束后由跟随接管。
   */
  update(): void {
    // 代码路由特效层推进（@since v3.3，task_194 / AP-04）：仿真每帧走，画面按 30Hz 抽帧
    //   （护栏在层内自适应，见 objects/code-fx-layer.ts）。
    // why 排在最前：下面的分支有提前 return（无跟随目标时）—— 特效不能因此停推。
    this.codeFxLayer.tick(this.time.now);
    // 导演巡视（@since v3.3，task_081）：静默超过 8s 时镜头缓慢漂移（漂移 pan）。
    // why 先于跟随判定：导演开启时跟随已让位（见 syncDirectorMode），两者不会同时写镜头。
    this.director.update();
    // 引导弧线跟随镜头（@since v3.4，task_092）：每帧按当前相机把单位的世界坐标换算成屏幕坐标。
    this.syncFocusLink();
    if (!this.followUnitId) return;
    if (this.cameraTween?.isPlaying()) return;
    const unit = this.units.get(this.followUnitId);
    if (!unit) {
      // 目标单位离场：跟随自动解除（镜头停在原处）。
      this.followUnitId = null;
      return;
    }
    this.view.apply({
      center: { x: unit.position.x, y: unit.position.y },
      zoom: this.view.current.zoom,
    });
  }

  private onShutdown(): void {
    this.bridge.destroy();
    this.unitLayer.destroy();
    // 单位联动层（task_092）：弧线的 Graphics + 补间、取景框的 Graphics + 标注 + 补间一并回收。
    this.focusLink.destroy();
    this.directorFrame.destroy();
    this.taskFxLayer.destroy();
    // 代码路由特效层（task_194 / AP-04）：显示对象 + 动态纹理一并回收（perf：资源必须可清理）。
    this.codeFxLayer.destroy();
    // 气泡层（task_076）：定时器与显示对象一并回收（perf：资源必须可清理）。
    this.speechLayer.destroy();
    this.selectionBox.destroy();
    // 地面层与建筑层的显示对象 / tween / 定时器一并回收（perf：资源必须可清理）。
    this.buildingLayer.destroy();
    this.groundLayer.destroy();
    // 氛围彩蛋层（task_079）：小云的 tween / 定时器 + 入夜巡检定时器一并回收。
    this.cloudLayer.destroy();
    // 导演控制器（task_081）：延时回调 / 补间一并回收（资源必须可清理）。
    // 注：报错红光晕已于 task_086 迁到 HUD 屏幕空间，战场侧不再持有该层。
    this.director.destroy();
    // 回放化身层（task_082）：tick 定时器 + 化身显示对象一并回收（资源必须可清理）。
    this.replayLayer.destroy();
    for (const avatar of this.replayBoard.list()) {
      this.speechLayer.clearAnchor(replayAnchorId(avatar.characterId));
    }
    this.replayBoard.reset();
    this.warmthTimer?.remove(false);
    this.warmthTimer = null;
    this.cameraTween?.remove();
    this.cameraTween = null;
    this.rubberTween?.remove();
    this.rubberTween = null;
    this.input.keyboard?.off('keydown-ESC', this.onEscape, this);
    // 副本名牌板（@since v3.3，task_187 / M1-13）：遮罩 / 名牌 / 淡出补间一并回收。
    this.nameplate?.destroy();
    this.nameplate = null;
    this.input.keyboard?.off('keydown', this.onKeyDown, this);
    this.units.destroy();
    // 交互态复位（task_045）：场景重启（Phaser 复用场景实例）时不携带上一次的拖拽残留。
    this.dragMode = 'none';
    this.panButton = null;
    this.boxPreviewIds = null;
    this.draggedFar = false;
    // 镜头编排态复位（task_079）：跟随 / 橡皮筋 / 双击痕迹都不带入下一次启动。
    this.followUnitId = null;
    this.panDesired = null;
    this.rubberOffset = { x: 0, y: 0 };
    this.lastClick = null;
  }

  // ==========================================================================
  // 内部工具
  // ==========================================================================

  /** 补发被合并窗口吞掉的最后一次相机位姿；同一时刻只挂一个延时任务，避免滚轮时任务堆积。 */
  private scheduleCameraFlush(): void {
    if (this.cameraFlushScheduled) return;
    this.cameraFlushScheduled = true;
    // 场景销毁时 Phaser 会清掉未触发的 time 事件，这里无需额外清理
    this.time.delayedCall(CAMERA_EVENT_INTERVAL_MS, () => {
      this.cameraFlushScheduled = false;
      this.bridge.flushCamera();
    });
  }

  private toWorldPoint(pointer: Phaser.Input.Pointer): Point {
    return { x: pointer.worldX, y: pointer.worldY };
  }

  private screenDistance(pointer: Phaser.Input.Pointer): number {
    return Math.hypot(pointer.x - this.dragStartScreen.x, pointer.y - this.dragStartScreen.y);
  }

  /** 拖拽起止点归一化成左上角 + 宽高（反向拖拽也要得到正面积矩形）。 */
  private boxBounds(from: Point, to: Point): Bounds {
    return {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    };
  }

  /** 画出战场边界框：相机钳制是"看不见"的，画条边线才能在 dev 页上直接验证。 */
  private drawWorldBounds(): void {
    this.add
      .rectangle(
        DEFAULT_WORLD_BOUNDS.x + DEFAULT_WORLD_BOUNDS.width / 2,
        DEFAULT_WORLD_BOUNDS.y + DEFAULT_WORLD_BOUNDS.height / 2,
        DEFAULT_WORLD_BOUNDS.width,
        DEFAULT_WORLD_BOUNDS.height,
        BOUNDS_FILL
      )
      .setStrokeStyle(2, BOUNDS_COLOR)
      // 地面各层压在底板之下（task_078 的深度口径）。
      .setDepth(GROUND_DEPTH.bounds);
  }
}

/**
 * 在办任务数 / 路径尾段（@since v3.3，task_187 / M1-13 建，task_188 / M1-14 搬家）。
 *
 * ★ 这两个纯函数的**定义**搬到了 `core/project/instance-display.ts`：
 *   HUD 的大厅卡片（M1-14）要同一份口径，而 HUD 不得 import world（铁律）⇒ 共同口径落 core。
 *   这里保留 re-export：world 侧的既有单测（task_187）与调用点不必改 import 路径。
 */
export { countActiveTasks, pathTailOf };

/** 读出点击修饰键，供 core 决定 set / toggle 语义（见 core/types.ts 的 ClickMods）。 */
function readModifiers(pointer: Phaser.Input.Pointer): ClickMods {
  // 指针事件的联合类型含 TouchEvent（无修饰键字段），先擦成 unknown 再收窄成可选结构
  const bag = pointer.event as unknown as ModifierBag | undefined;
  return {
    shift: bag?.shiftKey === true,
    ctrl: bag?.ctrlKey === true,
    meta: bag?.metaKey === true,
    alt: bag?.altKey === true,
  };
}
