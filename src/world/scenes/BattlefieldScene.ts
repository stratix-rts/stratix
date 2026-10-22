/**
 * 文件职责：v3 **唯一主场景** —— 装配相机控制、单位渲染层、框选框与总线桥，并处理鼠标交互。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/scenes BattlefieldScene（唯一主场景起步）」。
 * 输入：
 *   - core/bus 的 state 通道（经 bridge/bus-adapter 转发到本场景的 WorldScenePort 回调）；
 *   - 浏览器指针输入（按下 / 移动 / 松开 / 滚轮）。
 * 输出：把交互转成 WorldEvent（unit.click / selection.box / camera.moved），经桥接层发回 core。
 * 禁止事项：
 *   1. import 任何 hud / vue / legacy(stratix-rts) 代码 —— 铁律：world 只认识 core/types 与 core/bus；
 *   2. 持有业务状态 —— 业务真相在 core；本场景只渲染 UnitView，并只把单位 id 回传上去；
 *   3. 在本文件里写钳制 / 命中规则 —— 规则分别住在 camera/camera-math.ts 与 objects/unit-registry.ts，
 *      这里只负责调用与编排；
 *   4. 自己缓存 WorldState 再 diff —— 对账由 UnitRegistry 统一负责；
 *   5. 留下未清理的监听 / 显示对象 —— shutdown 时统一销毁（perf：资源必须可清理）。
 */

import Phaser from 'phaser';

import type { Bounds, ClickMods, Point, SelectionState, UnitView } from '../../core/types';
import {
  CAMERA_EVENT_INTERVAL_MS,
  createWorldBridge,
  type WorldBridge,
  type WorldScenePort,
} from '../bridge/bus-adapter';
import { CameraController, DEFAULT_WORLD_BOUNDS } from '../camera';
import { SelectionBox } from '../objects/selection-box';
import { UnitLayer } from '../objects/unit-layer';
import { UnitRegistry } from '../objects/unit-registry';
import { UNIT_SPRITE_SOURCE_KEY, type UnitSpriteSource } from '../objects/unit-sprite-source';

export const BATTLEFIELD_SCENE_KEY = 'battlefield';

const BACKGROUND_COLOR = 0x0f131b;
const BOUNDS_COLOR = 0x3a4557;
const BOUNDS_FILL = 0x161c27;
/** 空状态网格线：让零单位时的战场不再是“纯色虚空”，也为拖拽/缩放提供参照物。 */
const GRID_COLOR = 0x232c3d;
const GRID_STEP = 200;
/** 空状态提示文字（世界坐标层，随镜头移动；有单位后自动隐藏）。 */
const EMPTY_HINT = '空战场 · 0 单位接入（单位来自 gateway 真实数据流）\n拖拽平移 · 滚轮缩放 · 空框选无害';

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
  private emptyHint?: Phaser.GameObjects.Text;
  private selectionBox!: SelectionBox;

  private dragMode: DragMode = 'none';
  private dragStartScreen: Point = { x: 0, y: 0 };
  /** 拖拽平移用屏幕空间增量：不依赖相机位姿，避免"测量-修正-再测量"反馈环导致的抖动。 */
  private dragLastScreen: Point = { x: 0, y: 0 };
  private dragStartWorld: Point = { x: 0, y: 0 };
  private draggedFar = false;
  private cameraFlushScheduled = false;

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

    this.view = new CameraController(this.cameras.main, {
      viewport: () => ({ width: this.scale.width, height: this.scale.height }),
      worldBounds: DEFAULT_WORLD_BOUNDS,
      onChange: (pose) => this.bridge.cameraMoved(pose.center, pose.zoom),
    });

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('pointerupoutside', this.onPointerUp, this);
    this.input.on('wheel', this.onWheel, this);

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  // ==========================================================================
  // WorldScenePort：state → 场景同步（由桥接层调用）
  // ==========================================================================

  syncUnits(units: readonly UnitView[]): void {
    this.units.sync(units);
    this.unitLayer.sync();
    this.emptyHint?.setVisible(units.length === 0);
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
    this.unitLayer.setSelection(selection.unitIds, selection.previewUnitIds);
  }

  // ==========================================================================
  // 输入处理：场景交互 → WorldEvent（经桥接层发回 core）
  // ==========================================================================

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 右键 / 中键拖拽 = 平移；左键留给框选与点击
    if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
      this.dragMode = 'pan';
      this.draggedFar = false;
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
      return;
    }

    if (this.screenDistance(pointer) > DRAG_THRESHOLD_PX) this.draggedFar = true;
    if (this.dragMode === 'box' && this.draggedFar) {
      this.selectionBox.show(this.boxBounds(this.dragStartWorld, this.toWorldPoint(pointer)));
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const mode = this.dragMode;
    this.dragMode = 'none';

    if (mode === 'pan') {
      this.bridge.flushCamera();
      return;
    }

    if (mode === 'box') {
      const bounds = this.boxBounds(this.dragStartWorld, this.toWorldPoint(pointer));
      this.selectionBox.hide();
      // 没拖动就是点在空地上：契约里没有"点击空地"事件，不硬凑一个 selection.box 上去
      if (this.draggedFar) this.bridge.selectionBox(bounds);
      return;
    }

    if (mode === 'click' && !this.draggedFar) {
      const hit = this.unitLayer.hitTest(this.dragStartWorld.x, this.dragStartWorld.y);
      if (hit) this.bridge.unitClick(hit.id, readModifiers(pointer));
    }
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
    this.selectionBox.destroy();
    this.units.destroy();
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
