/**
 * 回归测试：**交互矩阵 §2.2「交互原语 × 命中对象」—— 世界侧**（@since v3.3，task_220 / IX-07）。
 *
 * 依据：docs/DESIGN-canvas-interactions.md §2 事件矩阵（IX-07 的定性：**矩阵即测试清单**）。
 * 本文件是矩阵的**世界侧**那一半 —— 每个手势落到画布上，桥接层（world/bridge）**应该**发什么
 * 事件、**不应该**发什么事件。同一张矩阵的另外两半：
 *   - core 侧（选择语义 / 双击裁决 / 编队落位）→ src/core/__tests__/interaction-matrix.test.ts
 *   - HUD 侧（抽屉开合 / 快捷键）→ src/hud/__tests__/interaction-matrix.test.ts
 *
 * ============ 为什么打桩场景而不是跑真 Phaser ============
 *   node 环境跑不起 Phaser（无 window / document）⇒ 把 'phaser' 换成最小桩，
 *   并把场景的**渲染成员**（桥接层 / 单位层 / 相机 / 补间 / 气泡板…）换成记录器。
 *   但**输入处理本身是真代码**：`onPointerDown` / `onPointerMove` / `onPointerUp` /
 *   `onWheel` / `onEscape` / `onKeyDown` 全部是 BattlefieldScene 的真实实现，
 *   被驱动的分流规则（4px 阈值、双击窗口、框选 vs 平移、仪式独占、焦点让路）都是真的在跑。
 *
 * ============ 本文件覆盖的矩阵行 ============
 *   P1×O1 / P1×O2 / P1×O3·O4 / P2×O1 / P2×O2 / P3×O1 / P3×O2 / P3×O3·O4 /
 *   P4×O1 / P4×O2 / P5 / P6 / P7 / P8 / P9 / P10×O1 / P10×O2 / P10×O3·O4 / P1+P10×O1
 *   ＋ 消解规则：双击窗口同源常量 / 修饰键不影响双击判定 / 仪式独占 / 焦点让路
 *   ＋ 未定义组合：中键短按、非仪式期任意键 ⇒ 无操作
 *
 * ★ 行为漂移（矩阵目标 vs 现状）集中在文件末尾的「行为漂移（记账）」一组：
 *   本单是**测试单**，不为凑绿改产品代码 —— 漂移如实记账（见 docs/rubric/agent_task_220_interaction_matrix.md）。
 *
 * @jest-environment node
 */

jest.mock('phaser', () => {
  class Scene {
    constructor(_config?: unknown) {}
  }
  return {
    __esModule: true,
    default: { Scene, Scenes: { Events: { SHUTDOWN: 'shutdown' } } },
  };
});

import * as fs from 'fs';
import * as path from 'path';

import { SPEECH_EVENT_POOLS, createSpeechCopyPicker, type SpeechCopyPicker } from '../../core/theme/bubble-copy';
import type { Bounds, UnitView } from '../../core/types';
import { CAMERA_METRICS } from '../theme';
import { INPUT_FOCUS_KEY } from '../input-focus';
import { BattlefieldScene } from '../scenes/BattlefieldScene';

// ============================================================================
// 夹具：指针 / 桥接层记录器 / 场景打桩
// ============================================================================

/** 指针替身（只保留场景真正读的那几个字段）。 */
interface PointerStub {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  rightButtonDown(): boolean;
  middleButtonDown(): boolean;
  event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean };
}

interface PointerOptions {
  x?: number;
  y?: number;
  right?: boolean;
  middle?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

function makePointer(options: PointerOptions = {}): PointerStub {
  const x = options.x ?? 100;
  const y = options.y ?? 100;
  return {
    x,
    y,
    // 世界坐标与屏幕坐标 1:1（打桩只关心「命中 / 不命中」，不关心相机换算）
    worldX: x,
    worldY: y,
    rightButtonDown: () => options.right === true,
    middleButtonDown: () => options.middle === true,
    event: {
      shiftKey: options.shift === true,
      ctrlKey: options.ctrl === true,
      metaKey: options.meta === true,
      altKey: false,
    },
  };
}

/** 命中判定返回的单位替身（只需要 id / status / position）。 */
interface FakeUnit {
  id: string;
  status: string;
  position: { x: number; y: number };
}

/** 桥接层记录器：矩阵断言看的就是「这一手到底发没发事件」。 */
interface BridgeRecorder {
  unitClick: jest.Mock;
  unitChatOpen: jest.Mock;
  selectionBox: jest.Mock;
  unitMove: jest.Mock;
  unitBubble: jest.Mock;
  soundCue: jest.Mock;
  flushCamera: jest.Mock;
  cameraMoved: jest.Mock;
  directorMode: jest.Mock;
  unitPosition: jest.Mock;
}

/** 场景内部形状（只取本单要碰的那些成员）。 */
interface SceneInternals {
  bridge: BridgeRecorder;
  unitLayer: {
    hitTest: jest.Mock;
    queryBounds: jest.Mock;
    pulseClick: jest.Mock;
    setPreviewHighlights: jest.Mock;
    popSelectionWave: jest.Mock;
    setHovered: jest.Mock;
  };
  view: {
    current: { center: { x: number; y: number }; zoom: number };
    visualCenter: { x: number; y: number };
    apply: jest.Mock;
    setOvershoot: jest.Mock;
    clearOvershoot: jest.Mock;
  };
  scale: { width: number; height: number };
  /** Phaser 的 Clock.now 是**数字属性**（不是方法）—— 双击判定的时间戳取自它。 */
  time: { readonly now: number; delayedCall: jest.Mock };
  tweens: { addCounter: jest.Mock };
  registry: { get: (key: string) => unknown };
  nameplate: { active: boolean; skip: jest.Mock } | null;
  director: { releaseByManual: jest.Mock };
  selectionBox: { show: jest.Mock; release: jest.Mock };
  taskFxLayer: { commandFlow: jest.Mock; footPulse: jest.Mock; doubleRipple: jest.Mock };
  fxRouter: { play: jest.Mock };
  speechLayer: { speak: jest.Mock };
  speechPicker: SpeechCopyPicker;
  selectedUnitIds: readonly string[];
  units: {
    sync: (units: readonly UnitView[]) => unknown;
    get: (id: string) => { position: { x: number; y: number } } | undefined;
  };
  onPointerDown(pointer: unknown): void;
  onPointerMove(pointer: unknown): void;
  onPointerUp(pointer: unknown): void;
  onWheel(pointer: unknown, objects: unknown[], deltaX: number, deltaY: number): void;
  onEscape(): void;
  onKeyDown(): void;
}

interface HarnessOptions {
  /** 仪式在演（进副本仪式的遮罩期）。 */
  ceremony?: boolean;
  /** 此刻有输入焦点（聊天框持焦）。 */
  inputFocused?: boolean;
  /** 命中判定（默认：屏幕 (100,100) 附近命中 u1）。 */
  hit?: (x: number, y: number) => FakeUnit | null;
  /** 框选命中（默认：框不到任何单位）。 */
  inBounds?: (bounds: Bounds) => string[];
}

interface Harness {
  internals: SceneInternals;
  bridge: BridgeRecorder;
  /** 一次完整的「按下 → 松手」。 */
  click: (options?: PointerOptions) => void;
  /** 一次完整的「按下 → 移动 → 松手」。 */
  drag: (from: PointerOptions, to: PointerOptions) => void;
  /** 推进场景时钟（双击窗口判定用）。 */
  now: (ms: number) => void;
  /** 模拟 core 广播回来的选择集镜像。 */
  select: (ids: readonly string[]) => void;
  /** 仪式遮罩的「跳过」记录器（没在演仪式 ⇒ null）。 */
  skipCeremony: jest.Mock | null;
  /** 这次输入没有产生任何业务事件（矩阵里的「无操作」）。 */
  expectNoBusinessEvent: () => void;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const scene = new BattlefieldScene();
  const internals = scene as unknown as SceneInternals;

  const bridge: BridgeRecorder = {
    unitClick: jest.fn(),
    unitChatOpen: jest.fn(),
    selectionBox: jest.fn(),
    unitMove: jest.fn(),
    unitBubble: jest.fn(),
    soundCue: jest.fn(),
    flushCamera: jest.fn(),
    cameraMoved: jest.fn(),
    directorMode: jest.fn(),
    unitPosition: jest.fn(),
  };

  const idleUnit: FakeUnit = { id: 'u1', status: 'idle', position: { x: 100, y: 100 } };
  const defaultHit = (x: number, y: number): FakeUnit | null =>
    Math.hypot(x - idleUnit.position.x, y - idleUnit.position.y) <= 12 ? idleUnit : null;

  const unitLayer = {
    hitTest: jest.fn(options.hit ?? defaultHit),
    queryBounds: jest.fn(options.inBounds ?? (() => [])),
    pulseClick: jest.fn(),
    setPreviewHighlights: jest.fn(),
    popSelectionWave: jest.fn(),
    setHovered: jest.fn(),
  };

  const view = {
    current: { center: { x: 1600, y: 1200 }, zoom: 1 },
    visualCenter: { x: 1600, y: 1200 },
    apply: jest.fn((pose: { center: { x: number; y: number }; zoom: number }) => {
      view.current = { center: pose.center, zoom: pose.zoom };
    }),
    setOvershoot: jest.fn(),
    clearOvershoot: jest.fn(),
  };

  let clock = 1000;

  internals.bridge = bridge;
  internals.unitLayer = unitLayer;
  internals.view = view;
  internals.scale = { width: 1280, height: 720 };
  internals.time = {
    get now(): number {
      return clock;
    },
    delayedCall: jest.fn(() => ({ remove: jest.fn() })),
  };
  internals.tweens = { addCounter: jest.fn(() => ({ remove: jest.fn(), getValue: () => 1 })) };
  internals.registry = {
    get: (key: string) => (key === INPUT_FOCUS_KEY ? () => options.inputFocused === true : undefined),
  };
  const skipCeremony = options.ceremony === true ? jest.fn() : null;
  internals.nameplate = skipCeremony === null ? null : { active: true, skip: skipCeremony };
  internals.director = { releaseByManual: jest.fn() };
  internals.selectionBox = { show: jest.fn(), release: jest.fn() };
  internals.taskFxLayer = { commandFlow: jest.fn(), footPulse: jest.fn(), doubleRipple: jest.fn() };
  internals.fxRouter = { play: jest.fn() };
  internals.speechLayer = { speak: jest.fn() };
  internals.speechPicker = createSpeechCopyPicker({ random: () => 0 });
  internals.selectedUnitIds = [];
  internals.units.sync([
    { id: 'u1', name: 'u1', status: 'idle', missionId: null, power: 1 },
    { id: 'u2', name: 'u2', status: 'idle', missionId: null, power: 1 },
  ]);

  const click = (opts: PointerOptions = {}): void => {
    const pointer = makePointer(opts);
    internals.onPointerDown(pointer);
    internals.onPointerUp(pointer);
  };
  const drag = (from: PointerOptions, to: PointerOptions): void => {
    internals.onPointerDown(makePointer(from));
    internals.onPointerMove(makePointer(to));
    internals.onPointerUp(makePointer(to));
  };

  return {
    internals,
    bridge,
    click,
    drag,
    now: (ms: number) => { clock = ms; },
    select: (ids: readonly string[]) => { internals.selectedUnitIds = ids; },
    skipCeremony,
    expectNoBusinessEvent: () => {
      expect(bridge.unitClick).not.toHaveBeenCalled();
      expect(bridge.unitChatOpen).not.toHaveBeenCalled();
      expect(bridge.selectionBox).not.toHaveBeenCalled();
      expect(bridge.unitMove).not.toHaveBeenCalled();
    },
  };
}

// ============================================================================
// P1 · 左键短按
// ============================================================================

describe('矩阵 P1 × O1 · 左键短按命中单位 ⇒ 选中（只发 unit.click）', () => {
  test('P1×O1：单击单位 ⇒ 发 unit.click（选中的锚），不开聊天框', () => {
    const h = makeHarness();

    h.click({ x: 100, y: 100 });

    expect(h.bridge.unitClick).toHaveBeenCalledTimes(1);
    expect(h.bridge.unitClick.mock.calls[0][0]).toBe('u1');
    // 矩阵 P1×O1：单击只选中 —— 双击才开聊天框（design C-03）
    expect(h.bridge.unitChatOpen).not.toHaveBeenCalled();
    // 选中也是一次交互事件 ⇒ 有一句播报气泡（IX-06 事件池的 select 键）
    expect(h.internals.speechLayer.speak).toHaveBeenCalledWith('u1', 'select');
  });

  test('P1×O1：单击不产生选择集变更之外的副作用（不移动、不发指令）', () => {
    const h = makeHarness();

    h.click({ x: 100, y: 100 });

    expect(h.bridge.unitMove).not.toHaveBeenCalled();
    expect(h.bridge.selectionBox).not.toHaveBeenCalled();
  });
});

describe('矩阵 P1 × O2 · 左键短按命中空白 ⇒ 清空选择', () => {
  test('P1×O2：单击空白 ⇒ 走 selection.box 空集（= 清空选择），不发 unit.click', () => {
    const h = makeHarness();

    h.click({ x: 400, y: 400 });

    expect(h.bridge.unitClick).not.toHaveBeenCalled();
    expect(h.bridge.selectionBox).toHaveBeenCalledTimes(1);
    const [, hits, additive] = h.bridge.selectionBox.mock.calls[0];
    expect(hits).toEqual([]);
    expect(additive).toBe(false);
  });
});

describe('矩阵 P1 × O3 · O4 · 建筑 / 名牌 ≡ 空白（不参与拾取）', () => {
  test('P1×O3·O4：建筑层没有拾取出口 ⇒ 点建筑与点空白同义（selection.box 空集）', () => {
    const buildingSource = fs.readFileSync(
      path.join(__dirname, '..', 'objects', 'building-layer.ts'),
      'utf-8'
    );
    // 建筑只画不拾取：没有任何 hitTest / queryBounds 出口
    expect(buildingSource).not.toMatch(/hitTest|queryBounds/);

    const h = makeHarness();
    h.click({ x: 400, y: 400 }); // 建筑所在的屏幕位置（同样点不到单位）

    expect(h.bridge.unitClick).not.toHaveBeenCalled();
    expect(h.bridge.selectionBox.mock.calls[0][1]).toEqual([]);
  });

  test('P1×O4：仪式在演 ⇒ 整次点击被仪式吃掉（既不选中也不清选）', () => {
    const h = makeHarness({ ceremony: true });

    h.click({ x: 100, y: 100 });

    expect(h.skipCeremony).toHaveBeenCalled();
    h.expectNoBusinessEvent();
  });
});

// ============================================================================
// P2 · 左键拖拽（框选）
// ============================================================================

describe('矩阵 P2 × O2 · 空白起手左键拖拽 ⇒ 框选', () => {
  test('P2×O2：拖框 ⇒ 发 selection.box（带命中集 + 命中即弹选择环）', () => {
    const h = makeHarness({ inBounds: () => ['u1'] });

    h.drag({ x: 50, y: 50 }, { x: 300, y: 300 });

    expect(h.bridge.selectionBox).toHaveBeenCalledTimes(1);
    const [bounds, hits, additive] = h.bridge.selectionBox.mock.calls[0];
    expect(hits).toEqual(['u1']);
    expect(additive).toBe(false);
    // 拖框起止点归一化成左上角 + 宽高（反向拖拽也得是正面积）
    expect(bounds).toEqual({ x: 50, y: 50, width: 250, height: 250 });
    expect(h.internals.unitLayer.popSelectionWave).toHaveBeenCalledWith(['u1']);
  });

  test('P2×O2：拖框过程中先出预览（弱色圈），松手才上报终值 id', () => {
    const h = makeHarness({ inBounds: () => ['u1'] });

    h.drag({ x: 50, y: 50 }, { x: 300, y: 300 });

    expect(h.internals.selectionBox.show).toHaveBeenCalled();
    expect(h.internals.selectionBox.release).toHaveBeenCalled();
  });
});

describe('矩阵 P2 × O1 · 单位起手左键拖拽 ⇒ 不产生框选（起点在单位上只能是点击）', () => {
  test('P2×O1：从单位上起手拖拽 ⇒ 既不框选也不选中（design C-05：本期不动）', () => {
    const h = makeHarness();

    h.drag({ x: 100, y: 100 }, { x: 300, y: 300 });

    expect(h.bridge.selectionBox).not.toHaveBeenCalled();
    expect(h.bridge.unitClick).not.toHaveBeenCalled();
  });
});

// ============================================================================
// P3 · 双击
// ============================================================================

describe('矩阵 P3 × O1 · 双击命中单位 ⇒ 打开该 agent 的单独聊天框', () => {
  test('P3×O1：双击单位 ⇒ 发 unit.chat.open（经 core 裁决 → HUD 开框）', () => {
    const h = makeHarness();

    h.click({ x: 100, y: 100 });
    h.now(1000 + 100);
    h.click({ x: 100, y: 100 });

    expect(h.bridge.unitChatOpen).toHaveBeenCalledTimes(1);
    expect(h.bridge.unitChatOpen).toHaveBeenCalledWith('u1');
  });

  test('P3×O1 + 消解规则 2：双击的第一击照常选中，双击不撤销选中集', () => {
    const h = makeHarness();

    h.click({ x: 100, y: 100 });
    h.now(1000 + 100);
    h.click({ x: 100, y: 100 });

    // 两击都发了 unit.click（选中锚）—— 双击**不**改写选择语义
    expect(h.bridge.unitClick).toHaveBeenCalledTimes(2);
  });

  test('消解规则 1：双击窗口取自唯一事实源（320ms）—— 跨窗口两击只算两次单击', () => {
    const h = makeHarness();

    h.click({ x: 100, y: 100 });
    h.now(1000 + CAMERA_METRICS.doubleClickWindowMs + 1);
    h.click({ x: 100, y: 100 });

    expect(h.bridge.unitChatOpen).not.toHaveBeenCalled();
    expect(h.bridge.unitClick).toHaveBeenCalledTimes(2);
  });
});

describe('矩阵 P3 × O3 · O4 · 建筑 / 名牌 ≡ 空白', () => {
  test('P3×O3·O4：双击建筑位置 ≡ 双击空白（不开聊天框）', () => {
    const h = makeHarness();

    h.click({ x: 400, y: 400 });
    h.now(1000 + 100);
    h.click({ x: 400, y: 400 });

    expect(h.bridge.unitChatOpen).not.toHaveBeenCalled();
  });
});

// ============================================================================
// P4 / P5 / P6 · 右键短按 / 右键拖拽 / 中键
// ============================================================================

describe('矩阵 P4 × O2 · 右键短按命中空白 ⇒ 对选中编队下达移动指令', () => {
  test('P4×O2：无选中时右键短按 ⇒ 无操作（不发 unit.move）', () => {
    const h = makeHarness();

    h.click({ x: 400, y: 400, right: true });

    expect(h.bridge.unitMove).not.toHaveBeenCalled();
  });

  test('P4×O2：有选中时右键短按 ⇒ 对选中编队发 unit.move（目标点 = 指针世界坐标）', () => {
    const h = makeHarness();
    h.select(['u1', 'u2']);

    h.click({ x: 400, y: 400, right: true });

    expect(h.bridge.unitMove).toHaveBeenCalledTimes(1);
    expect(h.bridge.unitMove).toHaveBeenCalledWith(['u1', 'u2'], 400, 400);
  });

  test('P4×O2：气泡走「移动指令池」（IX-06：不再是固定一句「收到」）', () => {
    const h = makeHarness();
    h.select(['u1']);

    h.click({ x: 400, y: 400, right: true });

    const text = h.bridge.unitBubble.mock.calls[0][1] as string;
    expect(SPEECH_EVENT_POOLS.move).toContain(text);
    expect(SPEECH_EVENT_POOLS.move).not.toContain('收到');
  });
});

describe('矩阵 P4 × O1 · 右键短按命中「卡住」的单位 ⇒ 集火支援', () => {
  test('P4×O1：命中 error 态单位 ⇒ 气泡改走支援池', () => {
    const stuck: FakeUnit = { id: 'u2', status: 'error', position: { x: 400, y: 400 } };
    const h = makeHarness({ hit: (x, y) => (x === 400 && y === 400 ? stuck : null) });
    h.select(['u1']);

    h.click({ x: 400, y: 400, right: true });

    const text = h.bridge.unitBubble.mock.calls[0][1] as string;
    expect(SPEECH_EVENT_POOLS.support).toContain(text);
    expect(h.internals.taskFxLayer.footPulse).toHaveBeenCalled();
  });

  test('P4×O1：未命中卡住单位 ⇒ 仍是移动指令池', () => {
    const h = makeHarness();
    h.select(['u1']);

    h.click({ x: 400, y: 400, right: true });

    const text = h.bridge.unitBubble.mock.calls[0][1] as string;
    expect(SPEECH_EVENT_POOLS.move).toContain(text);
  });
});

describe('矩阵 P5 · 右键拖拽 ⇒ 平移（不是移动指令）', () => {
  test('P5：右键拖过阈值 ⇒ 走平移，不发 unit.move', () => {
    const h = makeHarness();
    h.select(['u1']);

    h.drag({ x: 500, y: 500, right: true }, { x: 400, y: 500, right: true });

    expect(h.bridge.unitMove).not.toHaveBeenCalled();
    expect(h.internals.view.apply).toHaveBeenCalled();
  });

  test('消解规则 C-08：右键短按与右键拖拽按 4px 阈值分流', () => {
    const h = makeHarness();
    h.select(['u1']);

    // 位移 3px（< 4px）⇒ 仍是短按 ⇒ 发移动指令
    h.drag({ x: 500, y: 500, right: true }, { x: 503, y: 500, right: true });
    expect(h.bridge.unitMove).toHaveBeenCalledTimes(1);
  });
});

describe('矩阵 P6 · 中键拖拽 ⇒ 平移；中键短按 ⇒ 无操作（未定义组合）', () => {
  test('P6：中键拖拽 ⇒ 平移', () => {
    const h = makeHarness();

    h.drag({ x: 500, y: 500, middle: true }, { x: 400, y: 500, middle: true });

    expect(h.internals.view.apply).toHaveBeenCalled();
  });

  test('P6：中键短按 ⇒ 无操作（矩阵未定义 ⇒ 断言「无操作」，design C-06）', () => {
    const h = makeHarness();
    h.select(['u1']);

    h.click({ x: 500, y: 500, middle: true });

    h.expectNoBusinessEvent();
    expect(h.internals.view.apply).not.toHaveBeenCalled();
  });
});

// ============================================================================
// P7 · 滚轮
// ============================================================================

describe('矩阵 P7 · 滚轮 ⇒ 缩放（0.6–1.6，唯一事实源 CAMERA_METRICS）', () => {
  test('P7：滚轮一格 ⇒ 缩放按 zoomStep 变化', () => {
    const h = makeHarness();

    h.internals.onWheel(makePointer(), [], 0, -100); // 上滚放大

    expect(h.internals.view.current.zoom).toBeCloseTo(CAMERA_METRICS.zoomStep, 5);
  });

  test('P7：缩放夹在用户区间内（0.6 – 1.6）', () => {
    const h = makeHarness();

    h.internals.view.current.zoom = CAMERA_METRICS.zoomMax;
    h.internals.onWheel(makePointer(), [], 0, -100); // 已是上限 ⇒ 不再涨
    expect(h.internals.view.current.zoom).toBe(CAMERA_METRICS.zoomMax);

    h.internals.view.current.zoom = CAMERA_METRICS.zoomMin;
    h.internals.onWheel(makePointer(), [], 0, 100); // 已是下限 ⇒ 不再跌
    expect(h.internals.view.current.zoom).toBe(CAMERA_METRICS.zoomMin);
  });

  test('P7：仪式在演 ⇒ 滚轮被仪式吃掉（不缩放）', () => {
    const h = makeHarness({ ceremony: true });

    h.internals.onWheel(makePointer(), [], 0, -100);

    expect(h.internals.view.current.zoom).toBe(1);
    expect(h.skipCeremony).toHaveBeenCalled();
  });
});

// ============================================================================
// P8 / P9 · 键盘面
// ============================================================================

describe('矩阵 P9 · 任意其它键 ⇒ 非仪式期不拦截（无操作）', () => {
  test('P9：非仪式期按任意键 ⇒ 不吞键、不动镜头、不跳仪式', () => {
    const h = makeHarness();

    h.internals.onKeyDown();

    expect(h.skipCeremony).toBeNull();
    expect(h.internals.tweens.addCounter).not.toHaveBeenCalled();
    expect(h.internals.view.apply).not.toHaveBeenCalled();
  });

  test('消解规则 4①：仪式在演 ⇒ 任意键被仪式独占消费（task_187）', () => {
    const h = makeHarness({ ceremony: true });

    h.internals.onKeyDown();

    expect(h.skipCeremony).toHaveBeenCalledTimes(1);
  });
});

describe('消解规则 4②：输入焦点让路（聊天框持焦 ⇒ 画布键盘不响应）', () => {
  test('焦点让路：聊天框持焦时按 ESC ⇒ 镜头不动（矩阵 P8 的让路档）', () => {
    const h = makeHarness({ inputFocused: true });

    h.internals.onEscape();

    expect(h.internals.tweens.addCounter).not.toHaveBeenCalled();
    expect(h.internals.view.apply).not.toHaveBeenCalled();
  });

  test('焦点让路：聊天框持焦时按任意键 ⇒ 仪式也不被顺手跳过', () => {
    const h = makeHarness({ inputFocused: true });

    h.internals.onKeyDown();

    expect(h.skipCeremony).toBeNull();
  });

  test('焦点让路优先于画布：仪式在演时仍归仪式（链首）', () => {
    const h = makeHarness({ ceremony: true, inputFocused: true });

    h.internals.onEscape();

    expect(h.skipCeremony).toHaveBeenCalledTimes(1);
    expect(h.internals.tweens.addCounter).not.toHaveBeenCalled();
  });
});

// ============================================================================
// P10 · 修饰键
// ============================================================================

describe('矩阵 P10 × O1 · 修饰键点击单位 ⇒ 加选 / 减选（toggle）', () => {
  test('P10×O1：修饰键原样带给 core（set / toggle 的裁决在 core 侧）', () => {
    const h = makeHarness();

    h.click({ x: 100, y: 100, shift: true });

    expect(h.bridge.unitClick.mock.calls[0][1]).toEqual({
      shift: true,
      ctrl: false,
      meta: false,
      alt: false,
    });
  });
});

describe('矩阵 P10 × O2 · 修饰键 + 空白', () => {
  test('P10×O2：Shift 拖框 ⇒ additive（加选）', () => {
    const h = makeHarness({ inBounds: () => ['u1'] });

    h.drag({ x: 50, y: 50, shift: true }, { x: 300, y: 300, shift: true });

    const [, hits, additive] = h.bridge.selectionBox.mock.calls[0];
    expect(hits).toEqual(['u1']);
    expect(additive).toBe(true);
  });

  test('P10×O3·O4：Shift 点建筑 / 名牌 ≡ Shift 点空白', () => {
    const h = makeHarness();

    h.click({ x: 400, y: 400, shift: true });

    const [, hits, additive] = h.bridge.selectionBox.mock.calls[0];
    expect(hits).toEqual([]);
    expect(additive).toBe(true);
  });
});

describe('矩阵 P1 + P10 × O1 · 修饰键点击 ⇒ 先 toggle 再走双击判定', () => {
  test('消解规则 3：Shift+双击仍是双击（修饰键不影响双击判定）', () => {
    const h = makeHarness();

    h.click({ x: 100, y: 100, shift: true });
    h.now(1000 + 100);
    h.click({ x: 100, y: 100, shift: true });

    expect(h.bridge.unitChatOpen).toHaveBeenCalledTimes(1);
    expect(h.bridge.unitClick).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// 行为漂移（记账）：矩阵目标 vs 现状 —— 本单是测试单，不改产品代码
// ============================================================================

describe('行为漂移（记账）· 矩阵目标 vs 现状（task_220 不改产品代码）', () => {
  test('漂移① P3×O2：矩阵目标「双击空白 = 回全景」，现状 = 只清空选择、镜头不动', () => {
    const h = makeHarness();

    h.click({ x: 400, y: 400 });
    h.now(1000 + 100);
    h.click({ x: 400, y: 400 });

    // 现状：两次点击都只是「点空地 = 清空选择」
    expect(h.bridge.selectionBox).toHaveBeenCalledTimes(2);
    // 现状：没有任何镜头动作（既不回全景，也不跟随）
    expect(h.internals.tweens.addCounter).not.toHaveBeenCalled();
    expect(h.internals.view.apply).not.toHaveBeenCalled();
    // 矩阵目标（design §2.2 P3×O2 / §3 C-02）：双击空白地面 = 回全景 ⇒ 未落地
  });

  test('漂移② P8：矩阵目标「ESC 不再回全景」，现状 = world 侧仍回全景（C-01 未消解）', () => {
    const h = makeHarness();

    h.internals.onEscape();

    // 现状：镜头补间到全景（= 矩阵目标要撤掉的那条）
    expect(h.internals.tweens.addCounter).toHaveBeenCalledTimes(1);
    // 现状：ESC 同时还会被 HUD 侧消费成「取消选择」⇒ design §3 C-01 描述的双动作仍在
  });

  test('漂移③ P3×O1：矩阵目标「双击单位只开聊天框」，现状 = 顺带进入跟随镜头', () => {
    const h = makeHarness();

    h.click({ x: 100, y: 100 });
    h.now(1000 + 100);
    h.click({ x: 100, y: 100 });

    expect(h.bridge.unitChatOpen).toHaveBeenCalledTimes(1);
    // 现状：双击顺带把镜头拉到该单位（design D3 / C-02 期望「跟随镜头让位」）
    expect(h.internals.tweens.addCounter).toHaveBeenCalledTimes(1);
  });

  test('漂移④ P10×O2：矩阵 §2.2 现状列写「Shift+点空地也清空」，现状 = 不清空（additive + 空集 = 选择集不变）', () => {
    const h = makeHarness();

    h.click({ x: 400, y: 400, shift: true });

    const [, hits, additive] = h.bridge.selectionBox.mock.calls[0];
    expect(hits).toEqual([]);
    expect(additive).toBe(true);
    // core 侧对「additive + 空集」的处理见 src/core/__tests__/interaction-matrix.test.ts
    //   ⇒ 选择集**不变**（矩阵 §2.2 现状列写的「也清空」与实现不符）
  });
});
