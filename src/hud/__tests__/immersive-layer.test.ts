/**
 * 集成测试：**Z6 沉浸层的触发接线**（@since v3.4，task_094）。
 *
 * 覆盖验收标准的四条：
 *   1. 三类演出（里程碑大字 / ▶60 秒重演 / 导演取景框）各自正确触发 L3 ——
 *      断言不是「层级字段是 L3」，而是**看得见的口径**：L1 降到 18% 对比、L2 收起。
 *   2. 演出结束层级自动恢复（L1 对比回 1、L2 回来）。
 *   3. 演出中断（异常路径）层级不卡死 —— 大字被摘掉 / 回放被释放时占用必须归还。
 *   4. 导演模式持续期间中屏保留取景框角标 —— 导演开着时层级进 L3（world 侧的取景框
 *      本身由 camera.director 事件驱动，见 world/objects/director-frame.ts）。
 *
 * 链路是真的：里程碑组件 / 回放控制器 → HudCommand → core/bus → core runtime → store →
 *   state 广播 → HUD 侧层级控制器 → 根元素上的 CSS 变量。不 mock 总线（mock 掉总线等于
 *   把被测行为一起 mock 掉了 —— 同 core/__tests__/info-layer.test.ts 的口径）。
 *
 * @jest-environment jsdom
 */

import { emitCommand, onState, resetBus } from '../../core/bus';
import { createCoreRuntime, type CoreRuntime } from '../../core/runtime';
import { createStore, type CoreStore } from '../../core/store';
import { HUD_LAYER_METRICS, MARQUEE_METRICS, REPLAY_METRICS } from '../../core/theme/visual-spec';
import { mountMilestone, type StratMilestoneElement } from '../components/marquee/milestone';
import type { DayReplayEntry } from '../components/replay/replay-catalog';
import { createReplayController, type ReplayController } from '../components/replay/replay-controller';
import {
  INFO_LAYER_CSS_VARS,
  createInfoLayerController,
  type InfoLayerController,
} from '../layers/info-layer';

interface Harness {
  readonly runtime: CoreRuntime;
  readonly store: CoreStore;
  readonly controller: InfoLayerController;
  stop(): void;
}

/** 起一套真的 core（runtime + store + 总线）+ 真的 HUD 层级控制器。 */
function harness(): Harness {
  resetBus();
  const store = createStore();
  const runtime = createCoreRuntime({ store });
  const stopRuntime = runtime.start();
  const controller = createInfoLayerController();
  const offState = onState((state) => controller.apply(state.infoLayer ?? 'L1'));
  return {
    runtime,
    store,
    controller,
    stop: () => {
      offState();
      stopRuntime();
      controller.destroy();
      resetBus();
    },
  };
}

/** L1 分区当前的不透明度（0.18 = 让位；1 = 正常对比）。 */
function l1Opacity(): number {
  return Number(document.documentElement.style.getPropertyValue(INFO_LAYER_CSS_VARS.l1Opacity));
}

/** L2 分区当前的可见性（hidden = 收起；visible = 在屏）。 */
function l2Visibility(): string {
  return document.documentElement.style.getPropertyValue(INFO_LAYER_CSS_VARS.l2Visibility);
}

/** 断言当前处在 L3 沉浸档（L1 让位 + L2 收起）。 */
function expectImmersive(): void {
  expect(l1Opacity()).toBe(HUD_LAYER_METRICS.l1DimOpacity);
  expect(l2Visibility()).toBe('hidden');
}

/** 断言已退出沉浸档（L1 恢复满对比 + L2 回到在屏）。 */
function expectRestored(): void {
  expect(l1Opacity()).toBe(HUD_LAYER_METRICS.l1Opacity);
  expect(l2Visibility()).toBe('visible');
}

/** 挂一个里程碑大字（命令走真的总线）。 */
function mountMilestoneElement(): { element: StratMilestoneElement; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const mounted = mountMilestone(host, { dispatch: (command) => emitCommand(command) });
  return { element: mounted.element, unmount: mounted.unmount };
}

/** 打满一轮里程碑（每 10 个完成一次）。 */
function triggerMilestone(element: StratMilestoneElement): void {
  for (let i = 0; i < MARQUEE_METRICS.milestoneEvery; i += 1) element.noteCompleted();
}

/** 一条回放条目（造数据只在本测试里 —— 生产代码不许造假，这里是夹具）。 */
function entry(at: number): DayReplayEntry {
  return { at, kind: 'done', characterId: 'c1', taskId: 't1', label: '做完了', sessionId: 's1' };
}

/** 起一个回放控制器（占用出口走真的总线）。 */
function makeReplay(entries: readonly DayReplayEntry[]): ReplayController {
  return createReplayController({
    port: { loadDay: async () => entries },
    emitBeat: () => undefined,
    setClock: () => undefined,
    setImmersive: (active) => emitCommand({ type: 'hud.layer.hold', trigger: 'replay', active }),
    timers: {
      setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs) as unknown as number,
      clearTimeout: (handle) => globalThis.clearTimeout(handle),
    },
  });
}

let harnessRef: Harness | null = null;
let milestoneRef: { element: StratMilestoneElement; unmount: () => void } | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('style');
  harnessRef = harness();
});

afterEach(() => {
  milestoneRef?.unmount();
  milestoneRef = null;
  harnessRef?.stop();
  harnessRef = null;
  document.body.innerHTML = '';
  jest.useRealTimers();
});

describe('Z6 沉浸层：里程碑大字（@since v3.4，task_094）', () => {
  test('大字在屏 → L1 降到 18% 对比、L2 收起；大字收起 → 全恢复', () => {
    const mounted = mountMilestoneElement();
    milestoneRef = mounted;

    expectRestored();

    triggerMilestone(mounted.element);

    expectImmersive();

    jest.advanceTimersByTime(MARQUEE_METRICS.milestoneDurationMs);

    expectRestored();
  });

  test('大字中途被摘掉 → 占用归还，层级不卡死在 L3（异常路径）', () => {
    const mounted = mountMilestoneElement();
    milestoneRef = mounted;
    triggerMilestone(mounted.element);
    expectImmersive();

    mounted.unmount();

    expectRestored();
  });
});

describe('Z6 沉浸层：▶60 秒重演（@since v3.4，task_094）', () => {
  test('播放中 → L1 让位、L2 收起；播完 → 全恢复', async () => {
    const replay = makeReplay([entry(1_000)]);
    await replay.load();

    expectRestored();

    replay.play();
    expectImmersive();

    // 播完（间隔上限 2s，跑两拍足够走完最后一条）。
    jest.advanceTimersByTime(REPLAY_METRICS.maxEventGapMs * 2 + 10);

    expectRestored();
  });

  test('播到一半被释放（dispose）→ 占用归还，层级不卡死（异常路径）', async () => {
    const replay = makeReplay([entry(1_000), entry(2_000)]);
    await replay.load();
    replay.play();
    expectImmersive();

    replay.dispose();

    expectRestored();
  });
});

describe('Z6 沉浸层：导演取景框（@since v3.4，task_094）', () => {
  test('导演模式开着 → 进 L3（L1 让位、L2 收起）；关掉 → 恢复', () => {
    emitCommand({ type: 'camera.director', enabled: true });

    expectImmersive();
    expect(harnessRef?.store.getState().directorEnabled).toBe(true);

    emitCommand({ type: 'camera.director', enabled: false });

    expectRestored();
    expect(harnessRef?.store.getState().directorEnabled).toBe(false);
  });

  test('导演手动让位（world 侧回写 false）同样释放占用', () => {
    emitCommand({ type: 'camera.director', enabled: true });
    expectImmersive();

    // world 检测到手动介入 → 发同名事件 → core 写回 false（占用同步释放）。
    emitCommand({ type: 'hud.layer.hold', trigger: 'director', active: false });

    expectRestored();
  });
});

describe('Z6 沉浸层：多演出叠加（@since v3.4，task_094）', () => {
  test('里程碑撞上重演：先结束的那个放手，另一个还在演 → 仍是 L3', async () => {
    const mounted = mountMilestoneElement();
    milestoneRef = mounted;
    const replay = makeReplay([entry(1_000), entry(2_000)]);
    await replay.load();

    replay.play();
    triggerMilestone(mounted.element);
    expectImmersive();

    // 里程碑大字先收起 —— 重演还在演，沉浸不能撤。
    jest.advanceTimersByTime(MARQUEE_METRICS.milestoneDurationMs);
    expectImmersive();

    // 重演也结束 —— 两个占用都空了，层级回手动档。
    replay.stop();
    expectRestored();
  });

  test('演出期间手动切档不打架：结束后回到手动档', () => {
    const mounted = mountMilestoneElement();
    milestoneRef = mounted;

    emitCommand({ type: 'hud.layer.set', layer: 'L2' });
    triggerMilestone(mounted.element);
    expectImmersive();

    jest.advanceTimersByTime(MARQUEE_METRICS.milestoneDurationMs);

    // 手动档是 L2 —— 演出结束回 L2，不是回 L1。
    expect(l1Opacity()).toBe(HUD_LAYER_METRICS.l1Opacity);
    expect(l2Visibility()).toBe('visible');
    expect(harnessRef?.store.getState().infoLayer).toBe('L2');
  });
});
