/**
 * 单测：**world 侧订阅信息层级**的最小用例（@since v3.4，task_096）。
 *
 * why 这个用例在 world 目录下：层级状态（L1 常驻 / L2 事件 / L3 沉浸）要能被 world 侧订阅 ——
 *   将来战场上的 L3 元素（导演取景框等）据此让位。而 HUD ↔ world 零直接调用（总线铁律），
 *   唯一合法通道就是 core 的 state 广播 —— 所以 world 侧订阅的就是 WorldState.infoLayer。
 *   本用例把这条链路钉死：命令 → core 写状态 → 广播 → world 侧订阅者收到层级。
 *
 * 替身说明：打的是真实 core/bus 单例 + 真实 store + 真实 runtime（不 mock 总线）。
 */

import { emitCommand, emitWorldEvent, onState, resetBus, type Unsubscribe } from '../../core/bus';
import { createCoreRuntime, type CoreRuntime } from '../../core/runtime';
import { createStore, type CoreStore } from '../../core/store';
import type { InfoLayer, WorldState } from '../../core/types';

interface Harness {
  runtime: CoreRuntime;
  store: CoreStore;
  stop: () => void;
}

function harness(): Harness {
  const store = createStore();
  const runtime = createCoreRuntime({ store });
  const stop = runtime.start();
  return { runtime, store, stop };
}

/**
 * world 侧订阅者的最小实现形状（将来的导演取景框 / 演出层就长这样）：
 * 订阅 state 广播 → 读 infoLayer → 按层级决定让不让位。
 */
function subscribeLayer(
  onLayer: (layer: InfoLayer) => void,
): { seen: InfoLayer[]; off: Unsubscribe } {
  const seen: InfoLayer[] = [];
  const off = onState((state: WorldState) => {
    // 缺省按 L1（常驻档）处理 —— 与 core/info-layer.ts 的回落口径一致。
    onLayer(state.infoLayer ?? 'L1');
    seen.push(state.infoLayer ?? 'L1');
  });
  return { seen, off };
}

let cleanups: (() => void)[] = [];

beforeEach(() => {
  resetBus();
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  resetBus();
});

describe('world 侧：订阅 HUD 信息层级（经 core 契约）', () => {
  test('HUD 发命令 → core 写状态 → world 侧订阅者收到层级', () => {
    const { runtime, stop } = harness();
    cleanups.push(stop);

    const { seen, off } = subscribeLayer(() => undefined);
    cleanups.push(off);

    emitCommand({ type: 'hud.layer.set', layer: 'L3' });

    expect(seen).toEqual(['L3']);
  });

  test('层级在多次广播中保持最新（订阅者拿到的是当前档，不是首档）', () => {
    const { runtime, stop } = harness();
    cleanups.push(stop);

    const { seen, off } = subscribeLayer(() => undefined);
    cleanups.push(off);

    emitCommand({ type: 'hud.layer.set', layer: 'L3' });
    emitCommand({ type: 'hud.layer.set', layer: 'L1' });

    expect(seen).toEqual(['L3', 'L1']);
  });

  test('退订后不再收到广播（订阅必须可撤 —— perf 铁律）', () => {
    const { runtime, stop } = harness();
    cleanups.push(stop);

    const { seen, off } = subscribeLayer(() => undefined);
    emitCommand({ type: 'hud.layer.set', layer: 'L3' });
    off();
    emitCommand({ type: 'hud.layer.set', layer: 'L1' });

    expect(seen).toEqual(['L3']);
  });
});

/**
 * Z6 沉浸层的 world 侧用例（@since v3.4，task_094）—— 导演取景框挂进 L3 状态。
 *
 * why 在 world 目录下：取景框是**战场画面区**的 L3 元素（world/objects/director-frame.ts），
 *   「导演期间中屏保留取景框角标」这条验收标准落在 world 侧 ——
 *   导演模式开着 = 有演出在演 = 有效档 L3（L1 让位、L2 收起，取景框是画面里最清楚的东西）；
 *   导演关掉（手动介入或点开关）→ 层级回 L1，取景框随之退场。
 */
describe('world 侧：导演取景框挂进 L3 状态（task_094）', () => {
  test('导演模式开启 → world 侧收到 L3；关闭 → 回到 L1', () => {
    const { runtime, stop } = harness();
    cleanups.push(stop);

    const { seen, off } = subscribeLayer(() => undefined);
    cleanups.push(off);

    emitCommand({ type: 'camera.director', enabled: true });
    expect(seen).toEqual(['L3']);

    emitCommand({ type: 'camera.director', enabled: false });
    expect(seen).toEqual(['L3', 'L1']);
  });

  test('world 侧手动介入（回写 false）同样让层级退出 L3', () => {
    const { runtime, stop } = harness();
    cleanups.push(stop);

    const { seen, off } = subscribeLayer(() => undefined);
    cleanups.push(off);

    emitCommand({ type: 'camera.director', enabled: true });
    // 主播碰了镜头 → world 发同名事件 → core 写回 false（手动优先是硬规则）。
    emitWorldEvent({ type: 'camera.director', enabled: false });

    expect(seen).toEqual(['L3', 'L1']);
  });
});
