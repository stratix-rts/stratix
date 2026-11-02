/**
 * 单测：**session.resume 命令的总线往返落点**（@since v3.47，task_101 / v3.2b-B2）——
 *   HUD 命令 → core/bus → core runtime **转发** → 注入的恢复端口（app 层互聊引擎）。
 *
 * why 单开一单而不并进 session-manager.test.ts：manager 的单测是**直调**（不经过总线），
 *   这里验的是**命令通道** —— runtime 是不是真的接住了这条命令、有没有转给恢复端口。
 *   打的是真总线 + 真 store：runtime 的全部职责就是"接在总线上"，mock 掉总线等于把被测行为一起 mock 掉。
 *
 * 核心纪律（与 pipeline.start 同一口径）：core **不跑互聊**，只做转发；
 *   端口缺席时命令按**未落地**处理（onUnhandled）—— 不假装恢复成功。
 */

import { emitCommand, resetBus } from '../bus';
import { createCoreRuntime, type CoreRuntime, type UnhandledChannel } from '../runtime';
import { createSessionManager, type SessionManager } from '../session';
import { createStore, type CoreStore } from '../store';
import type { HudCommand, WorldEvent } from '../types';

interface Harness {
  readonly store: CoreStore;
  readonly session: SessionManager;
  readonly runtime: CoreRuntime;
  /** 恢复端口收到的会话 id（顺序即收到顺序）。 */
  readonly resumed: string[];
  /** 未落地的命令（channel + 类型名）。 */
  readonly unhandled: Array<[UnhandledChannel, string]>;
  readonly stop: () => void;
}

/** 起一个 runtime；withPort=false = 不注入恢复端口（模拟没人接管）。 */
function harness(withPort = true): Harness {
  const store = createStore();
  const session = createSessionManager({ store });
  const resumed: string[] = [];
  const unhandled: Array<[UnhandledChannel, string]> = [];
  const runtime = createCoreRuntime({
    store,
    session,
    ...(withPort
      ? {
          sessionResume: (sessionId: string): void => {
            resumed.push(sessionId);
          },
        }
      : {}),
    onUnhandled: (channel: UnhandledChannel, payload: HudCommand | WorldEvent): void => {
      unhandled.push([channel, payload.type]);
    },
  });
  const stop = runtime.start();
  return { store, session, runtime, resumed, unhandled, stop };
}

let cleanups: Array<() => void> = [];

beforeEach(() => {
  resetBus();
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  resetBus();
});

describe('session.resume：HUD 命令 → runtime 转发 → 恢复端口', () => {
  test('命令经总线转到恢复端口（带 sessionId）', () => {
    const { resumed, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'session.resume', sessionId: 'session_peer_chat_1' });

    expect(resumed).toEqual(['session_peer_chat_1']);
  });

  test('恢复端口缺席 → 命令按未落地处理（不假装恢复成功）', () => {
    const { unhandled, stop } = harness(false);
    cleanups.push(stop);

    emitCommand({ type: 'session.resume', sessionId: 'session_peer_chat_1' });

    expect(unhandled).toEqual([['command', 'session.resume']]);
  });

  test('core 不自己恢复会话（转发而已）：命令不改会话状态', () => {
    // 状态翻转是**恢复端口**那侧的活（core 级恢复翻状态位、引擎级恢复重启轮转）；
    // core runtime 自己只转发 —— 不注入端口时状态纹丝不动。
    const { store, session, stop } = harness(false);
    cleanups.push(stop);

    const created = session.createSession({ kind: 'peer_chat', participants: ['alice', 'bob'] });
    emitCommand({ type: 'session.resume', sessionId: created!.id });

    const after = (store.getState().sessions ?? [])[0];
    expect(after?.status).toBe('active');
    expect(after?.eventCount).toBe(1); // 只有 created —— core 没记任何事件
  });
});
