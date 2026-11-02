/**
 * 单测：互聊回合超时的**覆盖链**（@since v3.44 / task_090）。
 *
 * 链的三环：
 *   1. 环境变量 STRATIX_PEER_TURN_TIMEOUT_MS —— 渲染层读不到主进程的 process.env，
 *      经 preload 白名单（dev-flags.peerTurnTimeoutRaw）拿到**原始串**；
 *   2. 解析 + 钳位 —— resolvePeerTurnTimeoutMs（纯函数，agent-chat-service）；
 *   3. 注入 —— deps.timeoutMs → spawn 选项的 timeoutMs（缺省 120s）。
 *
 * 覆盖：环境变量读取口（运行时通道 / 未设置）+ 覆盖链贯通 + 缺省回归。
 */

import type { CharacterView, DetectedAgent, WorldState } from '../../core/types';
import { peerTurnTimeoutRaw } from '../main/dev-flags';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import {
  createAgentChatService,
  DEFAULT_PEER_TURN_TIMEOUT_MS,
  resolvePeerTurnTimeoutMs,
  type AgentChatDrawerView,
} from '../services/agent-chat-service';

// ============================================================================
// 夹具
// ============================================================================

const characterA: CharacterView = {
  id: 'ch-a',
  name: '阿尔法',
  persona: '冷静的战术分析师,回答简短。',
  level: 1,
  experience: 0,
  agentKind: 'claude-code',
  skinId: null,
  externalSessionId: null,
};

const characterB: CharacterView = {
  id: 'ch-b',
  name: '贝塔',
  persona: '热情的工程师,喜欢举例。',
  level: 2,
  experience: 10,
  agentKind: 'kimi',
  skinId: null,
  externalSessionId: null,
};

const detected: readonly DetectedAgent[] = [
  {
    kind: 'claude-code',
    tier: 'T1',
    installed: true,
    status: 'installed',
    version: '2.1.0',
    path: '/usr/local/bin/claude',
  },
  {
    kind: 'kimi',
    tier: 'T2',
    installed: true,
    status: 'installed',
    version: '1.0.0',
    path: '/usr/local/bin/kimi',
  },
];

const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
  characters: [characterA, characterB],
  detectedAgents: [...detected],
  units: [],
};

/** 装一个 window.electronAPI.env 桩（渲染层拿环境变量的唯一通道）。 */
function withRuntimeEnv(value: string | null): () => void {
  const scope = globalThis as unknown as { window?: unknown };
  const previous = scope.window;
  scope.window = { electronAPI: { env: { STRATIX_PEER_TURN_TIMEOUT_MS: value } } };
  return () => {
    if (previous === undefined) delete scope.window;
    else scope.window = previous;
  };
}

/** 空视图口（互聊服务只往它上面写，本单只关心 spawn 选项）。 */
const emptyView: AgentChatDrawerView = {
  addMessage: (): void => undefined,
  appendPeerStream: (): void => undefined,
  finalizePeerStream: (): void => undefined,
  setPeerRound: (): void => undefined,
  endPeerChat: (): void => undefined,
};

/** 造一个记 spawn 超时值的服务（不注入 timeoutMs = 走缺省）。 */
function makeService(timeoutMs?: number): {
  readonly service: ReturnType<typeof createAgentChatService>;
  readonly calls: Array<{ readonly timeoutMs: number | undefined }>;
} {
  const calls: Array<{ readonly timeoutMs: number | undefined }> = [];
  const service = createAgentChatService({
    view: emptyView,
    getState: () => state,
    createTransport: () => ({
      spawn: (_prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent> => ({
        async *[Symbol.asyncIterator](): AsyncIterator<TransportEvent> {
          calls.push({ timeoutMs: options?.timeoutMs });
          yield { type: 'done', exitCode: 0, text: '好', sessionId: 's1' };
        },
      }),
    }),
    persistSessionId: (): void => undefined,
    timeoutMs,
  });
  return { service, calls };
}

// ============================================================================
// 1. 环境变量读取口
// ============================================================================

describe('环境变量读取口(peerTurnTimeoutRaw)', () => {
  test('运行时通道(preload 白名单)拿到原始串', () => {
    const restore = withRuntimeEnv('300000');
    try {
      expect(peerTurnTimeoutRaw()).toBe('300000');
    } finally {
      restore();
    }
  });

  test('未设置 → null(调用方用缺省 120s)', () => {
    const restore = withRuntimeEnv(null);
    try {
      expect(peerTurnTimeoutRaw()).toBeNull();
    } finally {
      restore();
    }
  });
});

// ============================================================================
// 2. 覆盖链贯通：环境变量 → 解析 → 注入 → spawn 选项
// ============================================================================

describe('超时覆盖链:环境变量 → 解析 → 注入 → spawn 选项', () => {
  test('环境变量值贯通到回合的 spawn 选项', async () => {
    const restore = withRuntimeEnv('300000');
    try {
      const { service, calls } = makeService(resolvePeerTurnTimeoutMs(peerTurnTimeoutRaw()));
      await service.start('ch-a', 'ch-b', '议题', 1);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0].timeoutMs).toBe(300_000);
    } finally {
      restore();
    }
  });

  test('未注入 → 缺省 120s 进 spawn 选项', async () => {
    const { service, calls } = makeService();
    await service.start('ch-a', 'ch-b', '议题', 1);
    expect(calls[0].timeoutMs).toBe(DEFAULT_PEER_TURN_TIMEOUT_MS);
  });
});
