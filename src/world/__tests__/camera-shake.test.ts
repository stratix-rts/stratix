/**
 * 单测：world 桥接层的镜头震动转发（world/bridge/bus-adapter.ts，task_080）。
 * 覆盖：world 通道上的 camera.shake → 场景端口的 syncCameraShake（时长 + 强度原样送达）。
 *
 * 测试打的是**真实的 core/bus 单例**（与 bus-adapter.test.ts 同口径）：桥接层唯一的职责就是
 * 接在总线上，mock 掉总线等于把被测行为一起 mock 掉。隔离靠 resetBus()。
 */

import { emitWorldEvent, resetBus, type Unsubscribe } from '../../core/bus';
import type { WorldEvent } from '../../core/types';
import { createWorldBridge, type WorldScenePort } from '../bridge/bus-adapter';

interface ShakeCall {
  readonly durationMs: number;
  readonly intensity: number;
}

function createPort(): { port: WorldScenePort; shakes: ShakeCall[] } {
  const shakes: ShakeCall[] = [];
  const port: WorldScenePort = {
    syncUnits: () => {},
    syncSelection: () => {},
    syncCameraShake: (durationMs, intensity) => {
      shakes.push({ durationMs, intensity });
    },
  };
  return { port, shakes };
}

let stops: Unsubscribe[] = [];

beforeEach(() => {
  resetBus();
  stops = [];
});

afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  resetBus();
});

describe('camera.shake → 场景端口（task_080）', () => {
  test('world 通道上的震动事件转发到 syncCameraShake（参数原样送达）', () => {
    const { port, shakes } = createPort();
    const bridge = createWorldBridge(port);
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'camera.shake', durationMs: 100, intensity: 0.005 });

    expect(shakes).toEqual([{ durationMs: 100, intensity: 0.005 }]);
  });

  test('场景没实现 syncCameraShake 也不破编译、不抛错（可选端口惯例）', () => {
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
    };
    const bridge = createWorldBridge(port);
    stops.push(() => bridge.destroy());

    const event: WorldEvent = { type: 'camera.shake', durationMs: 100, intensity: 0.005 };
    expect(() => emitWorldEvent(event)).not.toThrow();
  });

  test('桥接层销毁后不再转发（退订干净）', () => {
    const { port, shakes } = createPort();
    const bridge = createWorldBridge(port);
    bridge.destroy();

    emitWorldEvent({ type: 'camera.shake', durationMs: 100, intensity: 0.005 });

    expect(shakes).toHaveLength(0);
  });
});
