/**
 * 集成测试:agent 互聊编排服务(app/services/agent-chat-service.ts,task_052)。
 * transport 全打桩(脚本化事件序列 / 可挂起 / 可中止),覆盖任务规格六面:
 *   1. 回合编排:A 首发(persona 内嵌的议题指令)→ B 转述应答 → 循环到轮数上限;
 *      A、B 会话隔离(sessionId 各归各,绝不互串 -- spawn 记录钉死);
 *   2. 中断与超时:回合 error(timeout 等)→ 中断标注气泡 + 双份落库 + 整场收束;
 *   3. 停止:stop() → AbortSignal → error{aborted} → 「(已中断)」标注 + 收束;
 *   4. 插话:interject 落 user 气泡 + 双方历史,注入双方下一轮 prompt(「用户补充:」前缀,各一次);
 *   5. 落库约定:开题 user 双份 / 每轮 assistant 原文(发言者)+ [peer:id] 前缀副本(对方);
 *   6. 守门与单飞:任一方未检出 / 未绑定 → 提示气泡不进 transport;同 id / 空议题 / 重复 start 不跑。
 * 另有轮次进度(setPeerRound 序列)与经验口径(chat_round 每回合一发、只给发言者,不双计)。
 */

import type { AgentKind, CharacterView, DetectedAgent, ExpSource, WorldEvent, WorldState } from '../../core/types';
import { onWorldEvent, resetBus } from '../../core/bus';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import {
  applyInterjections,
  buildOpeningPrompt,
  buildRelayPrompt,
  createAgentChatService,
  DEFAULT_PEER_ROUNDS,
  DEFAULT_PEER_TURN_TIMEOUT_MS,
  PEER_MSG_EMPTY_REPLY,
  PEER_MSG_INTERRUPTED,
  PEER_NETWORK_FALLBACK_HINT,
  peerMarkedContent,
  resolvePeerTurnTimeoutMs,
  type AgentChatDrawerView,
} from '../services/agent-chat-service';
import { buildFirstPrompt, type ChatPersistedMessage, type ChatTransportFactory } from '../services/chat-service';

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

const detectedClaude: DetectedAgent = {
  kind: 'claude-code',
  tier: 'T1',
  installed: true,
  status: 'installed',
  version: '2.1.0',
  path: '/usr/local/bin/claude',
};

const detectedKimi: DetectedAgent = {
  kind: 'kimi',
  tier: 'T2',
  installed: true,
  status: 'installed',
  version: '1.0.0',
  path: '/usr/local/bin/kimi',
};

/** 记录调用序列的视图口（联合会话写入面）：log 用字符串快照方便全序断言。 */
interface ViewHarness {
  readonly view: AgentChatDrawerView;
  readonly log: string[];
  readonly messages: Array<{ role: string; text: string }>;
  readonly rounds: Array<[number, number]>;
  readonly ended: number[];
}

function makeView(): ViewHarness {
  const log: string[] = [];
  const messages: ViewHarness['messages'] = [];
  const rounds: Array<[number, number]> = [];
  const ended: number[] = [];
  // 模拟 catalog 的流缓冲：appendPeerStream 累积，finalize 收束成联合会话消息
  // （与真组件同语义：有文本才成气泡，零文本不产生消息）。task_052。
  let streamRole: 'assistant' | 'peer' | null = null;
  let streamText = '';
  return {
    view: {
      addMessage(message): void {
        messages.push({ role: message.role, text: message.text });
        log.push(`add:${message.role}:${message.text}`);
      },
      appendPeerStream(role, chunk): void {
        streamRole = role;
        streamText += chunk;
        log.push(`stream:${role}:${chunk}`);
      },
      finalizePeerStream(): void {
        if (streamRole !== null && streamText.length > 0) {
          messages.push({ role: streamRole, text: streamText });
          log.push(`add:${streamRole}:${streamText}`);
        }
        streamRole = null;
        streamText = '';
        log.push('finalize');
      },
      setPeerRound(current, total): void {
        rounds.push([current, total]);
        log.push(`round:${current}/${total}`);
      },
      endPeerChat(): void {
        ended.push(1);
        log.push('end');
      },
    },
    log,
    messages,
    rounds,
    ended,
  };
}

/** 一次 spawn 的记账。 */
interface SpawnRecord {
  readonly prompt: string;
  readonly sessionId: string | null;
  readonly signal: AbortSignal | undefined;
  /** 回合超时（task_090：缺省 120s，可注入覆盖）。 */
  readonly timeoutMs: number | undefined;
}

/** 受控脚本:拿到调用记录后产出事件流。 */
type Script = (record: SpawnRecord) => AsyncGenerator<TransportEvent>;

/** 固定事件序列脚本。 */
function scripted(...events: TransportEvent[]): Script {
  return async function* script(): AsyncGenerator<TransportEvent> {
    for (const event of events) yield event;
  };
}

/** 一次成功回合的脚本:吐 sessionId + 文本,done 收束。 */
function turn(sessionId: string, text: string): Script {
  return scripted(
    { type: 'session', sessionId },
    { type: 'message', text },
    { type: 'done', exitCode: 0, text: null, sessionId }
  );
}

/** 挂起脚本:先吐 events,等外部 release 后补吐尾部(把回合「卡在半路」供插话/停止)。 */
function gated(events: TransportEvent[], tail: TransportEvent[] = []): {
  script: Script;
  release(): void;
} {
  let resolveRelease: () => void = () => { /* 占位,start 后替换 */ };
  const released = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const script: Script = async function* script(): AsyncGenerator<TransportEvent> {
    for (const event of events) yield event;
    await released;
    for (const event of tail) yield event;
  };
  return { script, release: () => resolveRelease() };
}

/** 等信号取消后收尾的脚本(模拟 runtime:abort → killTree → error{aborted})。 */
function abortableScript(prefix: string): Script {
  return async function* script(record: SpawnRecord): AsyncGenerator<TransportEvent> {
    if (prefix.length > 0) yield { type: 'message', text: prefix };
    const signal = record.signal;
    if (!signal) throw new Error('abortableScript 需要 options.signal');
    if (!signal.aborted) {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    }
    yield { type: 'error', message: '调用被取消,已终止进程', code: 'aborted' };
  };
}

/** 打桩 transport 工厂:按调用次序消耗脚本(脚本用尽 → spawn_failed 防御步)。 */
function makeFactory(scripts: Script[]): { factory: ChatTransportFactory; calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = [];
  let index = 0;
  const factory: ChatTransportFactory = (kind: AgentKind) => ({
    spawn: (prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent> => {
      const record: SpawnRecord = {
        prompt,
        sessionId: options?.sessionId ?? null,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      };
      calls.push(record);
      const script = scripts[index];
      index += 1;
      const run = script
        ? script(record)
        : (async function* guard(): AsyncGenerator<TransportEvent> {
            yield { type: 'error', code: 'spawn_failed', message: `脚本未覆盖第 ${index} 次 spawn(${kind})` };
          })();
      return { [Symbol.asyncIterator]: () => run };
    },
  });
  return { factory, calls };
}

interface HarnessOptions {
  readonly characters?: readonly CharacterView[];
  readonly detected?: readonly DetectedAgent[] | undefined;
  readonly scripts?: Script[];
  readonly expWeight?: (source: ExpSource) => number;
  readonly timeoutMs?: number;
  /** context-source 注入件（task_053）；缺省不注入。 */
  readonly provideContext?: (characterId: string) => import('../services/stratix-context').StratixContextInput | null;
}

interface ServiceHarness {
  readonly service: ReturnType<typeof createAgentChatService>;
  readonly view: ViewHarness;
  readonly calls: SpawnRecord[];
  readonly sessionIds: Array<[string, string]>;
  readonly messages: ChatPersistedMessage[];
  readonly events: WorldEvent[];
}

function makeHarness(options: HarnessOptions = {}): ServiceHarness {
  const view = makeView();
  const detected: readonly DetectedAgent[] | undefined =
    'detected' in options ? options.detected : [detectedClaude, detectedKimi];
  // task_054：state 面增 units（守门第四条）；夹具缺省空 = 全员在档在线。
  const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
    characters: [...(options.characters ?? [characterA, characterB])],
    detectedAgents: detected ? [...detected] : undefined,
    units: [],
  };
  const { factory, calls } = makeFactory(options.scripts ?? []);
  const sessionIds: Array<[string, string]> = [];
  const messages: ChatPersistedMessage[] = [];
  const events: WorldEvent[] = [];
  const service = createAgentChatService({
    view: view.view,
    getState: () => state,
    createTransport: factory,
    persistSessionId: (characterId, sessionId) => {
      sessionIds.push([characterId, sessionId]);
    },
    persistMessage: (message) => {
      messages.push(message);
    },
    expWeight: options.expWeight,
    provideContext: options.provideContext,
    timeoutMs: options.timeoutMs,
  });
  const off = onWorldEvent((event) => {
    events.push(event);
  });
  void off; // 总线监听随 afterEach 的 resetBus 一并清掉(与 chat-service 测试同口径)
  return { service, view, calls, sessionIds, messages, events };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 24; i += 1) await Promise.resolve();
};

beforeEach(() => {
  resetBus();
});

afterEach(() => {
  resetBus();
});

// ============================================================================
// 纯函数:prompt 拼装
// ============================================================================

describe('prompt 拼装(纯函数)', () => {
  test('开题指令:与对方讨论议题,直接给观点 + 网络兜底指引', () => {
    expect(buildOpeningPrompt('贝塔', '先侦察还是先扩张')).toBe(
      `与 贝塔 讨论：先侦察还是先扩张。请直接给出你的观点。\n${PEER_NETWORK_FALLBACK_HINT}`
    );
  });

  test('网络兜底指引:开题与转述都带「不可用就凭已知作答 + 注明知识截止」', () => {
    // task_090：CLI 子进程没有代理 env 时，agent 会空转重试网络直到回合超时。
    for (const prompt of [
      buildOpeningPrompt('贝塔', '议题'),
      buildRelayPrompt('阿尔法', '我认为应该先侦察。', '议题'),
    ]) {
      expect(prompt).toContain('若网络检索不可用或超时');
      expect(prompt).toContain('凭你已有的知识作答');
      expect(prompt).toContain('注明知识截止时间');
      expect(prompt).toContain('不要反复重试网络');
    }
  });

  test('转述指令:对方观点 + 请回应同一议题', () => {
    const prompt = buildRelayPrompt('阿尔法', '我认为应该先侦察。', '先侦察还是先扩张');
    expect(prompt).toContain('阿尔法 说：');
    expect(prompt).toContain('我认为应该先侦察。');
    expect(prompt).toContain('请回应，与 阿尔法 讨论议题：先侦察还是先扩张');
  });

  test('插话前缀:每条一行、拼在回合指令前;空队列原样返回', () => {
    const base = buildOpeningPrompt('贝塔', '议题');
    expect(applyInterjections(base, [])).toBe(base);
    expect(applyInterjections(base, ['看资源', '快决定'])).toBe(
      ['用户补充：看资源', '用户补充：快决定', base].join('\n')
    );
  });

  test('peer 落库前缀约定:[peer:{发言者id}] 原文', () => {
    expect(peerMarkedContent('ch-b', '我同意。')).toBe('[peer:ch-b] 我同意。');
  });
});

// ============================================================================
// 回合编排(正常 3 轮 = 6 回合)
// ============================================================================

describe('回合编排:正常 3 轮', () => {
  test('A 首发(persona 内嵌)→ B 转述应答 → 循环;双方会话隔离;轮次进度;收束', async () => {
    const harness = makeHarness({
      scripts: [
        turn('sess-a', 'A1:先侦察。'),
        turn('sess-b', 'B1:我同意侦察。'),
        turn('sess-a', 'A2:那就分两路。'),
        turn('sess-b', 'B2:分两路可行。'),
        turn('sess-a', 'A3:定了。'),
        turn('sess-b', 'B3:执行。'),
      ],
    });
    await harness.service.start('ch-a', 'ch-b', '先侦察还是先扩张', 3);
    await flush();

    // 六个回合,交替 A/B。
    expect(harness.calls).toHaveLength(6);
    const topics = '先侦察还是先扩张';

    // A 首发内嵌 persona(035 语义),指令是开题文案。
    expect(harness.calls[0].prompt).toBe(buildFirstPrompt(characterA, buildOpeningPrompt('贝塔', topics)));
    expect(harness.calls[0].sessionId).toBeNull();
    // B 首次也应内嵌 persona(B 的会话从零开始),指令转述 A 的观点。
    expect(harness.calls[1].prompt).toBe(
      buildFirstPrompt(characterB, buildRelayPrompt('阿尔法', 'A1:先侦察。', topics))
    );
    expect(harness.calls[1].sessionId).toBeNull();
    // A 第二回合:无 persona(会话已有上下文),转述 B 的观点;sessionId 复用 A 自己的。
    expect(harness.calls[2].prompt).toBe(buildRelayPrompt('贝塔', 'B1:我同意侦察。', topics));
    expect(harness.calls[2].sessionId).toBe('sess-a');
    expect(harness.calls[3].prompt).toBe(buildRelayPrompt('阿尔法', 'A2:那就分两路。', topics));
    expect(harness.calls[3].sessionId).toBe('sess-b');
    expect(harness.calls[4].prompt).toBe(buildRelayPrompt('贝塔', 'B2:分两路可行。', topics));
    expect(harness.calls[4].sessionId).toBe('sess-a');
    expect(harness.calls[5].prompt).toBe(buildRelayPrompt('阿尔法', 'A3:定了。', topics));
    expect(harness.calls[5].sessionId).toBe('sess-b');

    // 会话隔离:A 的 sessionId 只出现在 A 的回合(ch-b 永远拿不到 sess-a)。
    const aIds = [0, 2, 4].map((i) => harness.calls[i].sessionId);
    const bIds = [1, 3, 5].map((i) => harness.calls[i].sessionId);
    expect(aIds).toEqual([null, 'sess-a', 'sess-a']);
    expect(bIds).toEqual([null, 'sess-b', 'sess-b']);

    // 联合会话消息序:开题 user → A/B 交替(A=assistant、B=peer)。
    expect(harness.view.messages.map((m) => `${m.role}:${m.text}`)).toEqual([
      `user:${buildOpeningPrompt('贝塔', topics)}`,
      'assistant:A1:先侦察。',
      'peer:B1:我同意侦察。',
      'assistant:A2:那就分两路。',
      'peer:B2:分两路可行。',
      'assistant:A3:定了。',
      'peer:B3:执行。',
    ]);

    // 轮次进度 + 收束。
    expect(harness.view.rounds).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(harness.view.ended).toHaveLength(1);
    expect(harness.service.running).toBe(false);
  });

  test('落库约定:开题 user 双份;每轮发言者原文 + 对方 [peer:id] 前缀副本', async () => {
    const harness = makeHarness({
      scripts: [turn('sa', 'A1'), turn('sb', 'B1')],
      // 1 轮 = A、B 各一回(轮数上限 3 是缺省值,这里显式压到 1 更聚焦)。
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 1);
    await flush();

    const persisted = harness.messages.map(
      (m) => `${m.characterId}|${m.role}|${m.text}|${m.sessionRef ?? '-'}`
    );
    expect(persisted).toEqual([
      `ch-a|user|${buildOpeningPrompt('贝塔', '议题')}|-`,
      `ch-b|user|${buildOpeningPrompt('阿尔法', '议题')}|-`,
      'ch-a|assistant|A1|sa',
      'ch-b|assistant|[peer:ch-a] A1|-',
      'ch-b|assistant|B1|sb',
      'ch-a|assistant|[peer:ch-b] B1|-',
    ]);

    // 会话 id 回执:双方各一次(各自第一次 done)。
    expect(harness.sessionIds).toEqual([['ch-a', 'sa'], ['ch-b', 'sb']]);
  });

  test('经验口径:每回合一发 chat_round、只给发言者(A/B 各计各的,不双计)', async () => {
    const harness = makeHarness({
      scripts: [turn('sa', 'A1'), turn('sb', 'B1')],
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 1);
    await flush();

    const expEvents = harness.events.filter((event) => event.type === 'exp.gained');
    expect(expEvents).toEqual([
      { type: 'exp.gained', characterId: 'ch-a', source: 'chat_round', amount: 5 },
      { type: 'exp.gained', characterId: 'ch-b', source: 'chat_round', amount: 5 },
    ]);
  });

  test('空回合(done 无文本)→ 占位气泡 + 占位文案落库,链条继续', async () => {
    const harness = makeHarness({
      scripts: [
        scripted({ type: 'done', exitCode: 0, text: null, sessionId: 'sa' }),
        turn('sb', 'B1'),
      ],
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 1);
    await flush();

    expect(harness.view.messages.some((m) => m.text === PEER_MSG_EMPTY_REPLY)).toBe(true);
    // B 的转述 prompt 里拿到的是占位文案(诚实于时序)。
    expect(harness.calls[1].prompt).toBe(buildFirstPrompt(characterB, buildRelayPrompt('阿尔法', PEER_MSG_EMPTY_REPLY, '议题')));
  });

  test('轮数钳位:0 → 1 轮(至少双方各说一次);缺省 DEFAULT_PEER_ROUNDS=3', async () => {
    expect(DEFAULT_PEER_ROUNDS).toBe(3);
    const harness = makeHarness({
      scripts: [turn('sa', 'A1'), turn('sb', 'B1')],
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 0);
    await flush();
    expect(harness.calls).toHaveLength(2); // 1 轮 = A、B 各一回
    expect(harness.view.rounds).toEqual([[1, 1]]);
  });
});

// ============================================================================
// 中断与超时
// ============================================================================

describe('中断与超时', () => {
  test('回合超时缺省 120s:进 spawn 选项(可注入覆盖)', async () => {
    // task_090：缺省值回归 —— 覆盖链的最后一环是 spawn 选项里的 timeoutMs。
    expect(DEFAULT_PEER_TURN_TIMEOUT_MS).toBe(120_000);

    const defaultHarness = makeHarness({ scripts: [turn('sa', 'A1'), turn('sb', 'B1')] });
    await defaultHarness.service.start('ch-a', 'ch-b', '议题', 1);
    await flush();
    expect(defaultHarness.calls[0].timeoutMs).toBe(DEFAULT_PEER_TURN_TIMEOUT_MS);

    const overrideHarness = makeHarness({
      scripts: [turn('sa', 'A1'), turn('sb', 'B1')],
      timeoutMs: 300_000,
    });
    await overrideHarness.service.start('ch-a', 'ch-b', '议题', 1);
    await flush();
    expect(overrideHarness.calls[0].timeoutMs).toBe(300_000);
  });

  test('超时覆盖链的解析口径:缺省 120s / 非法回缺省 / 超界钳到 [10s,10min]', () => {
    expect(resolvePeerTurnTimeoutMs(null)).toBe(DEFAULT_PEER_TURN_TIMEOUT_MS);
    expect(resolvePeerTurnTimeoutMs(undefined)).toBe(DEFAULT_PEER_TURN_TIMEOUT_MS);
    expect(resolvePeerTurnTimeoutMs('')).toBe(DEFAULT_PEER_TURN_TIMEOUT_MS);
    expect(resolvePeerTurnTimeoutMs('  ')).toBe(DEFAULT_PEER_TURN_TIMEOUT_MS);
    expect(resolvePeerTurnTimeoutMs('不是数字')).toBe(DEFAULT_PEER_TURN_TIMEOUT_MS);
    expect(resolvePeerTurnTimeoutMs('0')).toBe(DEFAULT_PEER_TURN_TIMEOUT_MS);
    expect(resolvePeerTurnTimeoutMs('-5')).toBe(DEFAULT_PEER_TURN_TIMEOUT_MS);
    // 正常值：环境变量是字符串 → 解析成毫秒数。
    expect(resolvePeerTurnTimeoutMs('300000')).toBe(300_000);
    expect(resolvePeerTurnTimeoutMs(300_000)).toBe(300_000);
    // 超界钳位（与主进程 chat:run 的钳位一致）。
    expect(resolvePeerTurnTimeoutMs('1000')).toBe(10_000);
    expect(resolvePeerTurnTimeoutMs('1800000')).toBe(600_000);
  });

  test('回合超时 → 「(互聊中断:...)」标注 + 双份落库 + 整场收束(链条断掉不硬撑)', async () => {
    const harness = makeHarness({
      scripts: [
        turn('sa', 'A1'),
        scripted({ type: 'error', code: 'timeout', message: '调用超时:120000ms 无输出' }),
        turn('sa', '不该被调用的第 3 回合'),
      ],
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 3);
    await flush();

    expect(harness.calls).toHaveLength(2); // 第 3 回合没有上一位的输出可转述,不跑
    const marker = harness.view.messages.find((m) => m.text.startsWith('（互聊中断：'));
    expect(marker).toBeDefined();
    expect(marker?.role).toBe('peer'); // 断在 B 的回合 → peer 侧标注
    expect(marker?.text).toContain('timeout');
    // 中断标注也双份落库(对方份带前缀)。
    const texts = harness.messages.map((m) => `${m.characterId}|${m.text}`);
    expect(texts).toContain(`ch-b|${marker?.text}`);
    expect(texts).toContain(`ch-a|[peer:ch-b] ${marker?.text}`);
    expect(harness.view.ended).toHaveLength(1);
  });

  test('停止:stop() → AbortSignal → aborted → 「(已中断)」+ 部分文本保留 + 收束', async () => {
    const harness = makeHarness({
      scripts: [abortableScript('A1 前半')],
    });
    const running = harness.service.start('ch-a', 'ch-b', '议题', 3);
    await flush();
    expect(harness.service.running).toBe(true);

    harness.service.stop();
    await running;
    await flush();

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0].signal?.aborted).toBe(true);
    const texts = harness.view.messages.map((m) => m.text);
    expect(texts).toContain(PEER_MSG_INTERRUPTED);
    expect(harness.view.ended).toHaveLength(1);
    // 部分文本诚实保留(先收束半截话,再落标注)。
    expect(harness.view.log.join('\n')).toContain('stream:assistant:A1 前半');
    expect(harness.view.log.indexOf('finalize')).toBeGreaterThan(-1);
  });

  test('回合之间 stop:stopRequested 落在下一回合前生效(不再发新回合)', async () => {
    const first = gated(
      [{ type: 'session', sessionId: 'sa' }, { type: 'message', text: 'A1' }],
      [{ type: 'done', exitCode: 0, text: null, sessionId: 'sa' }]
    );
    const harness = makeHarness({
      scripts: [first.script, turn('sb', 'B1'), turn('sa', 'A2')],
    });
    const running = harness.service.start('ch-a', 'ch-b', '议题', 2);
    await flush();
    // A 回合 done 之后、B 回合开始前:stop 在两回合之间落进状态。
    harness.service.stop();
    first.release();
    await running;
    await flush();

    expect(harness.calls).toHaveLength(1); // B 的回合不再发起
    expect(harness.view.messages.some((m) => m.text === PEER_MSG_INTERRUPTED)).toBe(false); // 没有在飞回合可断
    expect(harness.view.ended).toHaveLength(1); // 但整场照常收束
  });
});

// ============================================================================
// 插话
// ============================================================================

describe('插话:注入双方下一轮 prompt', () => {
  test('user 气泡 + 双方历史 user 落库;「用户补充:」前缀进双方下一回各一次', async () => {
    const first = gated(
      [{ type: 'session', sessionId: 'sa' }, { type: 'message', text: 'A1' }],
      [{ type: 'done', exitCode: 0, text: null, sessionId: 'sa' }]
    );
    const harness = makeHarness({
      scripts: [first.script, turn('sb', 'B1'), turn('sa', 'A2'), turn('sb', 'B2')],
    });
    const running = harness.service.start('ch-a', 'ch-b', '议题', 2);
    await flush();

    harness.service.interject('记得看资源');
    first.release();
    await running;
    await flush();

    // 联合会话立即出现插话气泡。
    expect(harness.view.messages.some((m) => m.role === 'user' && m.text === '记得看资源')).toBe(true);
    // 双方历史各一条 user。
    const interjections = harness.messages.filter((m) => m.role === 'user' && m.text === '记得看资源');
    expect(interjections.map((m) => m.characterId).sort()).toEqual(['ch-a', 'ch-b']);

    // B 的第一回合(下一回)带前缀;A 的第二回合(A 的下一回)也带一次;之后不再重复。
    expect(harness.calls[1].prompt).toContain('用户补充：记得看资源');
    expect(harness.calls[2].prompt).toContain('用户补充：记得看资源');
    expect(harness.calls[3].prompt).not.toContain('用户补充');
    // 前缀在回合指令之前（A 的第 2 回合是裸指令；B 的首发因 persona 内嵌包在里面 -- contains 已验）。
    expect(harness.calls[2].prompt.startsWith('用户补充：记得看资源')).toBe(true);
  });

  test('不在跑时 interject 是 no-op;空白插话忽略', async () => {
    const harness = makeHarness({ scripts: [turn('sa', 'A1'), turn('sb', 'B1')] });
    harness.service.interject('没人听'); // 未 start
    expect(harness.view.messages).toHaveLength(0);
    expect(harness.messages).toHaveLength(0);

    await harness.service.start('ch-a', 'ch-b', '议题', 1);
    await flush();
    harness.service.interject('   ');
    expect(harness.view.messages.some((m) => m.text === '   ')).toBe(false);
    expect(harness.messages.filter((m) => m.text === '   ')).toHaveLength(0);
  });
});

// ============================================================================
// 守门与单飞
// ============================================================================

describe('守门与单飞', () => {
  test('任一方未检出 → 提示气泡 + 立即收束,不进 transport', async () => {
    const harness = makeHarness({
      detected: [detectedClaude], // kimi 未检出
      scripts: [turn('sa', 'A1')],
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 3);
    await flush();

    expect(harness.calls).toHaveLength(0);
    expect(harness.view.messages).toHaveLength(1);
    expect(harness.view.messages[0].text).toContain('贝塔');
    expect(harness.view.messages[0].text).toContain('CLI 未安装');
    expect(harness.view.ended).toHaveLength(1);
  });

  test('未绑定 kind / 角色不在档 → 同样拦截(文案带名字 / 档案缺失)', async () => {
    const unbound = makeHarness({
      characters: [characterA, { ...characterB, agentKind: null }],
    });
    await unbound.service.start('ch-a', 'ch-b', '议题', 1);
    expect(unbound.calls).toHaveLength(0);
    expect(unbound.view.messages[0].text).toContain('未绑定 CLI agent');

    const missing = makeHarness({ characters: [characterA] });
    await missing.service.start('ch-a', 'ch-404', '议题', 1);
    expect(missing.calls).toHaveLength(0);
    expect(missing.view.messages[0].text).toContain('未找到角色');
  });

  test('同 id / 空议题 → 静默忽略(视图零调用)', async () => {
    const harness = makeHarness({ scripts: [turn('sa', 'A1')] });
    await harness.service.start('ch-a', 'ch-a', '议题', 1);
    await harness.service.start('ch-a', 'ch-b', '   ', 1);
    await flush();
    expect(harness.calls).toHaveLength(0);
    expect(harness.view.messages).toHaveLength(0);
    expect(harness.view.ended).toHaveLength(0);
  });

  test('单飞:一场没结束,第二场 start 静默忽略', async () => {
    const first = gated([{ type: 'session', sessionId: 'sa' }], [{ type: 'done', exitCode: 0, text: null, sessionId: 'sa' }]);
    const harness = makeHarness({ scripts: [first.script] });
    const running = harness.service.start('ch-a', 'ch-b', '议题', 1);
    await flush();

    await harness.service.start('ch-a', 'ch-b', '另一场', 1); // 在跑 → 忽略
    first.release();
    await running;
    await flush();

    // 第二场 start 被忽略：「另一场」议题从未出现在任何回合里；
    // 第一场照常走完自己的回合链（A 首发无文本 → B 拿到占位转述，之后脚本尽 → 防御中断）。
    for (const call of harness.calls) {
      expect(call.prompt).not.toContain('另一场');
    }
    expect(harness.view.messages.some((m) => m.text.includes('另一场'))).toBe(false);
  });
});

// ============================================================================
// 上下文注入(task_053):互聊开题同样附 <stratix-context>(各自角色自己的快照)
// ============================================================================

describe('重启恢复口径(task_055):互聊不种档案回执,重启后首发重建', () => {
  test('档案 externalSessionId 非空 → 互聊首发仍不带 sessionId、仍拼 persona(回执与聊天共用字段,不共享续接)', async () => {
    // 场景:重启后 externalSessionId 是聊天会话的回执(或上一场互聊的,无法区分)。
    const harness = makeHarness({
      characters: [
        { ...characterA, externalSessionId: 'chat-receipt-1' },
        { ...characterB, externalSessionId: 'chat-receipt-2' },
      ],
      scripts: [turn('peer-a-1', 'A1'), turn('peer-b-1', 'B1')],
    });
    await harness.service.start('ch-a', 'ch-b', '新议题', 1);
    await flush();

    // 双方首发都不透传回执(sessionId=null),prompt 拼装 persona(首发重建,上下文一次性讲齐)。
    expect(harness.calls).toHaveLength(2);
    for (const call of harness.calls) {
      expect(call.sessionId).toBeNull();
      expect(call.prompt).toContain('角色设定');
    }
  });
});

describe('上下文注入(task_053):双方各自首发注入、续回合不注入', () => {
  test('A 开题回合带 A 的块;B 首回合带 B 的块;后续回合(会话已建)不再注入', async () => {
    const provideContext = (characterId: string): import('../services/stratix-context').StratixContextInput | null => ({
      characterId,
      characterName: characterId === 'ch-a' ? '阿尔法' : '贝塔',
      profileSummary: `Lv.1 · ${characterId}`,
      peers: [],
      recentTasks: [],
      lastTopic: null,
    });
    const harness = makeHarness({
      scripts: [
        turn('sess-a', 'A1'),
        turn('sess-b', 'B1'),
        turn('sess-a', 'A2'),
        turn('sess-b', 'B2'),
      ],
      provideContext,
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 2);
    await flush();

    const prompts = harness.calls.map((call) => call.prompt);
    // 回合序:A 开题 → B → A → B(会话事件维持 session 后续回合纯文本)
    expect(prompts.length).toBe(4);
    // A 的首发(开题):persona 后插块
    expect(prompts[0]).toContain('<stratix-context>');
    expect(prompts[0]).toContain('Lv.1 · ch-a');
    expect(prompts[0].indexOf('角色设定')).toBeLessThan(prompts[0].indexOf('<stratix-context>'));
    // B 的首发(自己 session 的首回合):B 自己的快照
    expect(prompts[1]).toContain('<stratix-context>');
    expect(prompts[1]).toContain('Lv.1 · ch-b');
    // 双方各自第二回合:会话已含 → 不再注入(一次性)
    expect(prompts[2]).not.toContain('<stratix-context>');
    expect(prompts[3]).not.toContain('<stratix-context>');
  });

  test('注入件缺省 → 全程无块(互聊照常)', async () => {
    const harness = makeHarness({
      scripts: [turn('sess-a', 'A1'), turn('sess-b', 'B1')],
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 1);
    await flush();
    for (const call of harness.calls) {
      expect(call.prompt).not.toContain('<stratix-context>');
    }
  });

  test('注入件抛错 → 吞掉不绑架讨论', async () => {
    const harness = makeHarness({
      scripts: [turn('sess-a', 'A1'), turn('sess-b', 'B1')],
      provideContext: () => {
        throw new Error('boom');
      },
    });
    await harness.service.start('ch-a', 'ch-b', '议题', 1);
    await flush();
    expect(harness.calls.length).toBe(2);
    for (const call of harness.calls) {
      expect(call.prompt).not.toContain('<stratix-context>');
    }
  });
});
