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
 *   - 浏览器指针输入（按下 / 移动 / 松开 / 滚轮）+ 键盘 ESC（@since v3.3，task_079：回全景）。
 * 输出：把交互转成 WorldEvent（unit.click / selection.box / unit.move / camera.moved），
 *   经桥接层发回 core。
 * 镜头编排（@since v3.3，task_079）：拖拽平移带**橡皮筋回弹**（拉出边界 → 松手弹回）；
 *   滚轮缩放夹在 0.6-1.6x；双击单位 = 跟随镜头（再双击解除）；ESC = 回全景；
 *   氛围彩蛋：每 30-60s 飘过一朵小云 + 真实时间 19-24 点背景格网微微变暖（都不发总线事件）。
 * RTS 操作语义（@since v3.21，task_045。血缘：交互口径移植 v2 StratixRTSGameScene 的
 *   右击移动惯例，判定参数自 v2 MovementSystem / FormationSystem 考古）：
 *   - 框选闭环：拖拽中本地预览命中（弱色圈，不经总线），松手把命中 id 补在 selection.box
 *     事件上（core 无坐标算不出命中）；拖空框 / 点空地 = 清空选择；Shift 拖 = 加选；
 *   - 右击移动：右键短按（位移 < DRAG_THRESHOLD_PX）= 对选中编队发 unit.move（目标点涟漪反馈），
 *     右键拖远仍归平移；无选中 = 纯无操作；中键始终纯平移。
 * 禁止事项：
 *   1. import 任何 hud / vue / legacy(stratix-rts) 代码 —— 铁律：world 只认识 core/types 与 core/bus；
 *   2. 持有业务状态 —— 业务真相在 core；本场景只渲染 UnitView，并只把单位 id 回传上去；
 *   3. 在本文件里写钳制 / 命中 / 编队规则 —— 规则分别住在 camera/camera-math.ts、
 *      objects/unit-registry.ts 与 core/unit/formation.ts，这里只负责调用与编排；
 *   4. 自己缓存 WorldState 再 diff —— 对账由 UnitRegistry 统一负责；
 *   5. 留下未清理的监听 / 显示对象 —— shutdown 时统一销毁（perf：资源必须可清理）。
 */

import Phaser from 'phaser';

import type {
  Bounds,
  CharacterTask,
  ClickMods,
  MissionView,
  Point,
  ReplayBeat,
  SelectionState,
  UnitView,
} from '../../core/types';
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
  isDoubleClick,
  overviewPose,
  rubberBandDisplay,
  rubberBandOffset,
  zoomWithUserLimits,
  type CameraPose,
  type ClickStamp,
} from '../camera';
import { DirectorController, type DirectorHost } from '../camera/director';
import type { DirectorEventKind } from '../camera/director-policy';
import { isWarmHour } from '../objects/ambience-layout';
import { BuildingLayer } from '../objects/building-layer';
import { CloudLayer } from '../objects/cloud-layer';
import { DirectorFrameLayer } from '../objects/director-frame-layer';
import { FocusLinkLayer } from '../objects/focus-link-layer';
import { GroundLayer, GROUND_DEPTH } from '../objects/ground-layer';
import { ReplayBoard, replayAnchorId, replayAvatarPosition } from '../objects/replay-board';
import { ReplayLayer } from '../objects/replay-layer';
import { SelectionBox } from '../objects/selection-box';
import { SpeechBubbleBoard } from '../objects/speech-bubble';
import { SpeechBubbleLayer } from '../objects/speech-bubble-layer';
import { MapBoard, BUILDING_SIZE, type MapSyncResult } from '../objects/task-building';
import { INTERACTION_BUBBLE_TEXT, TaskFxBoard, applyTaskFxEvent } from '../objects/task-fx';
import { TaskFxLayer } from '../objects/task-fx-layer';
import { UnitLayer } from '../objects/unit-layer';
import { UnitRegistry, UNIT_POSITION_SEED_KEY } from '../objects/unit-registry';
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
    this.taskFxLayer = new TaskFxLayer(this, this.units, this.taskFx);

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

    // 恢复站位种子（@since v3.12，task_033）：组合根启动读档后放在 game.registry 里。
    // 没接上（纯 vite dev / 读档失败）→ undefined，注册表全部按网格落位，行为与从前一致。
    const restoredPositions = this.registry.get(UNIT_POSITION_SEED_KEY) as ReadonlyMap<string, Point> | undefined;
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

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('pointerupoutside', this.onPointerUp, this);
    this.input.on('wheel', this.onWheel, this);
    // ESC 回全景（@since v3.3，task_079）：镜头编排的「归位」键。
    this.input.keyboard?.on('keydown-ESC', this.onEscape, this);
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
    const result = this.units.sync(units);
    this.unitLayer.sync();
    // 单位离场，浮标一并收掉：表现不许悬在已不存在的单位头顶（task_038）。
    for (const id of result.removed) {
      this.taskFx.clear(id);
      // 气泡同理（task_076）：单位没了，它的话也该收掉。
      this.speechLayer.clearUnit(id);
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
      if (object) this.bridge.unitPosition(id, object.position.x, object.position.y);
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
    // 完成演出（@since v3.3，task_075）：任务落到谁头上，谁就 squash → 跳 20px → 落地星尘。
    if (phase === 'completed') {
      for (const unitId of hitUnitIds) this.unitLayer.triggerCompleted(unitId);
    }
    this.taskFxLayer.sync();
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
        this.bridge.unitClick(hit.id, readModifiers(pointer));
        // 双击单位 = 跟随镜头（@since v3.3，task_079；跟随中再双击解除）。
        const stamp: ClickStamp = {
          unitId: hit.id,
          timeMs: this.time.now,
          x: pointer.x,
          y: pointer.y,
        };
        if (isDoubleClick(this.lastClick, stamp)) {
          this.lastClick = null;
          this.toggleFollow(hit.id);
        } else {
          this.lastClick = stamp;
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
   * 指令上报（编队落位在 core 算）与特效同一次动作发出 —— 画面与逻辑同帧，不分先后。
   */
  private issueMoveCommand(pointer: Phaser.Input.Pointer): void {
    if (this.selectedUnitIds.length === 0) return;
    const target = this.toWorldPoint(pointer);

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

  /** ESC = 回全景：整个战场装进视口（同时解除跟随）。 */
  private onEscape(): void {
    this.releaseFollow();
    // 手动优先（task_081）：ESC 回全景也是手动操作 —— 导演让位。
    this.releaseDirector();
    this.view.clearOvershoot();
    this.rubberOffset = { x: 0, y: 0 };
    this.tweenCameraTo(overviewPose(this.viewport(), DEFAULT_WORLD_BOUNDS));
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
