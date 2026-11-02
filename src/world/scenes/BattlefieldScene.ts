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
 *   - core/bus 的 world 通道上的 unit.speaking（@since v3.37，task_062，转发到 syncUnitSpeaking，
 *     单位层头顶「···」说话气泡）
 *     —— 小地图点击/拖拽的跳转指令，场景把相机对中到目标世界点；
 *   - 浏览器指针输入（按下 / 移动 / 松开 / 滚轮）。
 * 输出：把交互转成 WorldEvent（unit.click / selection.box / unit.move / camera.moved），
 *   经桥接层发回 core。
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

import type { Bounds, CharacterTask, ClickMods, Point, SelectionState, UnitView } from '../../core/types';
import {
  CAMERA_EVENT_INTERVAL_MS,
  createWorldBridge,
  type TaskFxPhase,
  type WorldBridge,
  type WorldScenePort,
} from '../bridge/bus-adapter';
import { CameraController, DEFAULT_WORLD_BOUNDS } from '../camera';
import { SelectionBox } from '../objects/selection-box';
import { TaskFxBoard, applyTaskFxEvent } from '../objects/task-fx';
import { TaskFxLayer } from '../objects/task-fx-layer';
import { UnitLayer } from '../objects/unit-layer';
import { UnitRegistry, UNIT_POSITION_SEED_KEY } from '../objects/unit-registry';
import { UNIT_SPRITE_SOURCE_KEY, type UnitSpriteSource } from '../objects/unit-sprite-source';
import { WORLD_PALETTE } from '../theme';

export const BATTLEFIELD_SCENE_KEY = 'battlefield';

/**
 * 战场底色 / 网格 / 边界（@since v3.3，task_110）—— 全部取自唯一事实源
 *   core/theme/visual-spec.ts（world 门面 = ../theme 的 WORLD_PALETTE）。
 * why 不写色值字面量：调色板改一处即可，world 各文件不再各抄一份。
 */
const BACKGROUND_COLOR = WORLD_PALETTE.background;
/** 战场外框描边 = 装饰色（紫）。 */
const BOUNDS_COLOR = WORLD_PALETTE.accent;
/** 战场外框底衬 = 网格色（比底色亮一档的区块底）。 */
const BOUNDS_FILL = WORLD_PALETTE.grid;
/** 空状态网格线：让零单位时的战场不再是“纯色虚空”，也为拖拽/缩放提供参照物。 */
const GRID_COLOR = WORLD_PALETTE.grid;
const GRID_STEP = 200;
/** 空状态提示文字（世界坐标层，随镜头移动；有单位后自动隐藏）。 */
const EMPTY_HINT = '空战场 · 0 单位接入（单位来自 gateway 真实数据流）\n左键拖框选 · 右键短按移动选中 · 右/中键拖平移 · 滚轮缩放';

/** 超过该屏幕位移才算"拖拽"，否则按点击处理。 */
const DRAG_THRESHOLD_PX = 4;

/** 滚轮一格的缩放倍率。 */
const ZOOM_STEP = 1.12;

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
  /** 任务表现状态板（task_038）：瞬态浮标（✓/!）的唯一真相，环由 busy 派生裁决。 */
  private readonly taskFx = new TaskFxBoard();
  private taskFxLayer!: TaskFxLayer;
  private emptyHint?: Phaser.GameObjects.Text;
  private selectionBox!: SelectionBox;

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
    this.drawGrid();
    this.drawEmptyHint();

    // 桥接层先建：相机控制器的 onChange 会立刻回调它上报初始位姿
    this.bridge = createWorldBridge(this);

    this.selectionBox = new SelectionBox(this);
    // 形象精灵源由组合根放在 game.registry 里（场景由 Phaser 实例化，构造器拿不到注入）。
    // 没接上 → 单位一律走占位形体（老单位 / dev 页都是这样）。
    const spriteSource = (this.registry.get(UNIT_SPRITE_SOURCE_KEY) as UnitSpriteSource | undefined) ?? null;
    this.unitLayer = new UnitLayer(this, this.units, spriteSource);

    // 任务表现层（@since v3.17，task_038）：单位头顶的 working 环 / ✓ / ! 浮标。
    // 订阅在桥接层（bridge/bus-adapter 的 syncTaskEvent 转发），场景只被驱动。
    this.taskFxLayer = new TaskFxLayer(this, this.units, this.taskFx);

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
    }
    this.taskFxLayer.sync();
    this.emptyHint?.setVisible(units.length === 0);
    // 落位上报（@since v3.12，task_033）：新增单位的坐标（恢复位或网格位）发回 core 方向，
    // 由 app 层持久化订阅者防抖落库。只对新增单位发：位置真相在本层，后续移动由移动链路上报。
    for (const id of result.added) {
      const object = this.units.get(id);
      if (object) this.bridge.unitPosition(id, object.position.x, object.position.y);
    }
  }

  /** 空战场网格：横纵每 GRID_STEP 世界单位一条低对比线，给镜头运动提供参照。 */
  private drawGrid(): void {
    const g = this.add.graphics();
    g.lineStyle(1, GRID_COLOR, 1);
    for (let x = DEFAULT_WORLD_BOUNDS.x; x <= DEFAULT_WORLD_BOUNDS.x + DEFAULT_WORLD_BOUNDS.width; x += GRID_STEP) {
      g.lineBetween(x, DEFAULT_WORLD_BOUNDS.y, x, DEFAULT_WORLD_BOUNDS.y + DEFAULT_WORLD_BOUNDS.height);
    }
    for (let y = DEFAULT_WORLD_BOUNDS.y; y <= DEFAULT_WORLD_BOUNDS.y + DEFAULT_WORLD_BOUNDS.height; y += GRID_STEP) {
      g.lineBetween(DEFAULT_WORLD_BOUNDS.x, y, DEFAULT_WORLD_BOUNDS.x + DEFAULT_WORLD_BOUNDS.width, y);
    }
  }

  /** 空状态提示：居中置于世界中心，首单位接入即隐藏（零假数据，不是种子单位）。 */
  private drawEmptyHint(): void {
    this.emptyHint = this.add
      .text(
        DEFAULT_WORLD_BOUNDS.x + DEFAULT_WORLD_BOUNDS.width / 2,
        DEFAULT_WORLD_BOUNDS.y + DEFAULT_WORLD_BOUNDS.height / 2,
        EMPTY_HINT,
        {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#8fa0b8',
          align: 'center',
        }
      )
      .setOrigin(0.5)
      .setDepth(1);
  }

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
   * 任务生命周期 → 战场表现（@since v3.17，task_038；由桥接层转发 task.started/completed/failed）。
   * 事件带 characterId，战场认单位：applyTaskFxEvent 反查 + 落板，表现层对账重画。
   */
  syncTaskEvent(task: CharacterTask, phase: TaskFxPhase): void {
    applyTaskFxEvent(this.taskFx, this.units.list(), task, phase);
    this.taskFxLayer.sync();
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
    if (this.dragMode === 'none') return;

    if (this.dragMode === 'pan') {
      // 屏幕空间增量拖拽：相机反向跟随指针（内容跟手），每步只看屏幕位移，与相机当前位姿无关。
      const zoom = this.view.current.zoom;
      this.view.panBy(
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
      // 右键短按（没拖成平移）= 移动指令：选中编队 → 目标点（task_045）。
      // 无选中 = 纯无操作（不硬凑聚焦）；中键短按 = 无操作。
      if (this.panButton === 'right' && !this.draggedFar) this.issueMoveCommand(pointer);
      this.panButton = null;
      return;
    }

    if (mode === 'box') {
      const bounds = this.boxBounds(this.dragStartWorld, this.toWorldPoint(pointer));
      this.selectionBox.hide();
      this.clearBoxPreview();
      // 框选闭环（task_045）：命中判定在本层（core 无坐标），终值 id 补在事件上。
      // 拖空框 = 清空选择（拖了个空框也是一次明确的选择动作）；点空地 = 零面积框选，
      // 同样清空（RTS 惯例的取消选择；Shift 按住 = 加选语义，命中空自然是 no-op，core 也不广播）。
      const additive = readModifiers(pointer).shift;
      this.bridge.selectionBox(bounds, this.draggedFar ? this.unitLayer.queryBounds(bounds) : [], additive);
      return;
    }

    if (mode === 'click' && !this.draggedFar) {
      const hit = this.unitLayer.hitTest(this.dragStartWorld.x, this.dragStartWorld.y);
      if (hit) this.bridge.unitClick(hit.id, readModifiers(pointer));
    }
  }

  /** 右键短按 → unit.move（task_045）：目标点涟漪（视觉反馈）+ 指令上报（编队落位在 core 算）。 */
  private issueMoveCommand(pointer: Phaser.Input.Pointer): void {
    if (this.selectedUnitIds.length === 0) return;
    const target = this.toWorldPoint(pointer);
    this.taskFxLayer.ripple(target.x, target.y);
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
    this.view.zoomBy(deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP);
    this.scheduleCameraFlush();
  }

  private onResize(): void {
    this.view.syncViewport();
  }

  private onShutdown(): void {
    this.bridge.destroy();
    this.unitLayer.destroy();
    this.taskFxLayer.destroy();
    this.selectionBox.destroy();
    this.units.destroy();
    // 交互态复位（task_045）：场景重启（Phaser 复用场景实例）时不携带上一次的拖拽残留。
    this.dragMode = 'none';
    this.panButton = null;
    this.boxPreviewIds = null;
    this.draggedFar = false;
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
      .setStrokeStyle(2, BOUNDS_COLOR);
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
