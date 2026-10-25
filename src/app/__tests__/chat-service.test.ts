/**
 * 集成测试：角色对话回路服务（app/services/chat-service.ts，task_035）。
 * transport 全打桩（脚本化事件序列 / 可挂起的受控脚本），覆盖任务规格的五个面：
 *   1. 会话映射：首发拼 persona、续发透传 sessionId（不重拼）、session id 回写恰好一次；
 *   2. 流式转发顺序与 finalize 时机（含 setSending 的起止）；
 *   3. 错误路径：超时/拉起失败 → 错误气泡（带 error 标记）+ retry 重发原文；
 *   4. 中断：stop → AbortSignal → aborted 事件 → 部分文本保留 + 标注气泡；
 *   5. 守门拦截：agent 未检出 / 未绑 kind / 角色不在档（这些一律不打 transport）。
 * 另有全局单飞锁（抽屉只有一条活跃流缓冲，两路并发会串台）与超时参数透传。
 */

import type { AgentKind, CharacterView, DetectedAgent, ExpSource, WorldEvent, WorldState } from '../../core/types';
import { onWorldEvent, resetBus } from '../../core/bus';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import { DEFAULT_EXP_WEIGHTS } from '../services/exp-config';
import {
  buildFirstPrompt,
  CHAT_MSG_EMPTY_REPLY,
  CHAT_MSG_INTERRUPTED,
  CHAT_MSG_NOT_INSTALLED,
  CHAT_MSG_NO_PROFILE,
  CHAT_MSG_UNBOUND,
  chatErrorText,
  chatOfflineText,
  createChatService,
  DEFAULT_CHAT_ROUND_TIMEOUT_MS,
  isAgentKindInstalled,
  type ChatDrawerView,
  type ChatPersistedMessage,
  type ChatTransportFactory,
} from '../services/chat-service';

// ============================================================================
// 夹具
// ============================================================================

const character: CharacterView = {
  id: 'ch-1',
  name: '阿尔法',
  persona: '冷静的战术分析师，回答简短。',
  level: 1,
  experience: 0,
  agentKind: 'claude-code',
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

/** 记录调用序列的视图口：log 用字符串快照方便全序断言。 */
interface ViewHarness {
  readonly view: ChatDrawerView;
  readonly log: string[];
  readonly messages: Array<{ characterId?: string; role: string; text: string; error?: boolean }>;
}

function makeView(): ViewHarness {
  const log: string[] = [];
  const messages: ViewHarness['messages'] = [];
  return {
    view: {
      addMessage(message): void {
        messages.push(message);
        log.push(`add:${message.role}:${message.text}`);
      },
      appendStream(chunk): void {
        log.push(`stream:${chunk}`);
      },
      finalizeStream(): void {
        log.push('finalize');
      },
      setSending(sending): void {
        log.push(`sending:${sending}`);
      },
    },
    log,
    messages,
  };
}

/** 一次 spawn 的记账。 */
interface SpawnRecord {
  readonly prompt: string;
  readonly options: SpawnOptions | undefined;
}

/** 受控脚本：拿到调用记录后产出事件流（可以 await 外部信号、可以挂起）。 */
type Script = (record: SpawnRecord) => AsyncGenerator<TransportEvent>;

/** 固定事件序列脚本。 */
function scripted(...events: TransportEvent[]): Script {
  return async function* script(): AsyncGenerator<TransportEvent> {
    for (const event of events) yield event;
  };
}

/**
 * 挂起脚本：先吐 events，然后等外部 release（resolve 时补吐尾部事件）。
 * 忙碌锁 / 中断测试用它把回合「卡在半路」。
 */
function gated(events: TransportEvent[], tail: TransportEvent[] = []): {
  script: Script;
  release(): void;
} {
  let resolveRelease: () => void = () => { /* 占位，start 后替换 */ };
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

/** 等信号取消后收尾的脚本（模拟 runtime：abort → killTree → error{aborted}）。 */
function abortableScript(prefix: string): Script {
  return async function* script(record: SpawnRecord): AsyncGenerator<TransportEvent> {
    if (prefix.length > 0) yield { type: 'message', text: prefix };
    const signal = record.options?.signal;
    if (!signal) throw new Error('abortableScript 需要 options.signal');
    if (!signal.aborted) {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    }
    yield { type: 'error', message: '调用被取消，已终止进程', code: 'aborted' };
  };
}

/** 打桩 transport 工厂：按调用次序消耗脚本（脚本用尽后复用最后一个）。 */
function makeFactory(scripts: Script[]): { factory: ChatTransportFactory; calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = [];
  let index = 0;
  const factory: ChatTransportFactory = (kind: AgentKind) => ({
    spawn: (prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent> => {
      const record: SpawnRecord = { prompt, options };
      calls.push(record);
      const script = scripts[Math.min(index, scripts.length - 1)];
      index += 1;
      const run = script(record);
      return {
        [Symbol.asyncIterator]: () => run,
      };
    },
  });
  return { factory, calls };
}

interface HarnessOptions {
  readonly characters?: readonly CharacterView[];
  readonly detected?: readonly DetectedAgent[] | undefined;
  readonly scripts?: Script[];
  readonly timeoutMs?: number;
  /** 在线位夹具（@since v3.30，task_054）：离线拦截用；缺省空 = 全员在线。 */
  readonly units?: readonly import('../../core/types').UnitView[];
  /** 经验权重注入（task_039）；缺省走 exp-config 的临时常量。 */
  readonly expWeight?: (source: ExpSource) => number;
  /** context-source 注入件（task_053）；缺省不注入。 */
  readonly provideContext?: (characterId: string) => import('../services/stratix-context').StratixContextInput | null;
}

interface ServiceHarness {
  readonly service: ReturnType<typeof createChatService>;
  readonly view: ViewHarness;
  readonly calls: SpawnRecord[];
  readonly persisted: Array<[string, string]>;
  /** persistMessage 收到的落库消息序列（task_036）。 */
  readonly messages: ChatPersistedMessage[];
  setState(patch: Partial<Pick<WorldState, 'characters' | 'detectedAgents' | 'units'>>): void;
}

function makeHarness(options: HarnessOptions = {}): ServiceHarness {
  const view = makeView();
  // 拷贝成可变数组：setState 直改字段（真实 store 里 state 是不可变快照，这里用小改模拟字段演进）。
  const detected: readonly DetectedAgent[] | undefined =
    'detected' in options ? options.detected : [detectedClaude];
  // task_054：state 面增 units（在线位守门第四条）；夹具给空数组 = 全员在档在线。
  const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
    characters: [...(options.characters ?? [character])],
    detectedAgents: detected ? [...detected] : undefined,
    units: [...(options.units ?? [])],
  };
  const { factory, calls } = makeFactory(options.scripts ?? [scripted()]);
  const persisted: Array<[string, string]> = [];
  const messages: ChatPersistedMessage[] = [];
  const service = createChatService({
    view: view.view,
    getState: () => state,
    createTransport: factory,
    persistSessionId: (characterId, sessionId) => {
      persisted.push([characterId, sessionId]);
    },
    persistMessage: (message) => {
      messages.push(message);
    },
    expWeight: options.expWeight,
    provideContext: options.provideContext,
    timeoutMs: options.timeoutMs,
  });
  return {
    service,
    view,
    calls,
    persisted,
    messages,
    setState: (patch) => Object.assign(state, patch),
  };
}

/** 让微任务跑几拍（send 是 async，for-await 的第一跳要排两三个微任务才到脚本）。 */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

// ============================================================================
// 纯函数
// ============================================================================

describe('isAgentKindInstalled：检测快照裁决', () => {
  test('installed=true 才放行（status=timeout 但 which 确认过也算装了）', () => {
    expect(isAgentKindInstalled([detectedClaude], 'claude-code')).toBe(true);
    expect(
      isAgentKindInstalled(
        [{ ...detectedClaude, status: 'timeout', version: null }],
        'claude-code'
      )
    ).toBe(true);
  });

  test('未检出 / installed=false / 快照缺失（非 Electron）一律拦截', () => {
    expect(isAgentKindInstalled([detectedClaude], 'kimi')).toBe(false);
    expect(
      isAgentKindInstalled(
        [{ ...detectedClaude, installed: false, status: 'not-installed', path: null }],
        'claude-code'
      )
    ).toBe(false);
    expect(isAgentKindInstalled(undefined, 'claude-code')).toBe(false);
  });
});

describe('buildFirstPrompt：persona 内嵌拼装', () => {
  test('首发 = 引导语 + 角色设定 + 用户消息；persona 空则只发原文', () => {
    const prompt = buildFirstPrompt(character, '在吗');
    expect(prompt).toContain('阿尔法');
    expect(prompt).toContain('冷静的战术分析师');
    expect(prompt).toContain('在吗');
    expect(prompt.indexOf('角色设定')).toBeLessThan(prompt.indexOf('在吗')); // 设定在前

    const bare: CharacterView = { ...character, persona: '   ' };
    expect(buildFirstPrompt(bare, '在吗')).toBe('在吗');
  });
});

// ============================================================================
// 回合编排
// ============================================================================

describe('会话映射：首发 persona / 续发 sessionId / 回写恰好一次', () => {
  test('首发拼 persona 且不带 sessionId；session 事件回写后续发只发原文', async () => {
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'session', sessionId: 'sess-abc' },
          { type: 'message', text: '你好' },
          { type: 'done', exitCode: 0, text: '你好', sessionId: 'sess-abc' }
        ),
        scripted({ type: 'message', text: '在的' }, { type: 'done', exitCode: 0, text: '在的', sessionId: 'sess-abc' }),
      ],
    });

    await h.service.send('ch-1', '在吗');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].prompt).toBe(buildFirstPrompt(character, '在吗')); // 拼装口径与导出函数同源
    expect(h.calls[0].options?.sessionId ?? null).toBeNull(); // 首发没有会话可续
    expect(h.calls[0].options?.timeoutMs).toBe(DEFAULT_CHAT_ROUND_TIMEOUT_MS); // 缺省超时透传
    // session 事件与 done.sessionId 同 id —— 只回写一次。
    expect(h.persisted).toEqual([['ch-1', 'sess-abc']]);
    expect(h.service.sessionSnapshot('ch-1')).toMatchObject({ sessionId: 'sess-abc', busy: false });

    await h.service.send('ch-1', '好的');
    expect(h.calls[1].prompt).toBe('好的'); // 续发不重拼 persona（上下文里已有）
    expect(h.calls[1].options?.sessionId).toBe('sess-abc');
    expect(h.persisted).toEqual([['ch-1', 'sess-abc']]); // 没有新 id 不再回写
  });

  test('重启恢复（task_055）：档案 externalSessionId 有效 → 种入内存会话，首发即透传 resume（不重拼 persona）', async () => {
    const h = makeHarness({
      characters: [{ ...character, externalSessionId: 'sess-old' }],
      scripts: [scripted({ type: 'message', text: 'hi' }, { type: 'done', exitCode: 0, text: 'hi', sessionId: null })],
    });
    await h.service.send('ch-1', '接着说');
    // 回执非空 = 统一策略的「有效」分支：sessionId 透传、原文直发（persona 在会话上下文里）。
    expect(h.calls[0].options?.sessionId ?? null).toBe('sess-old');
    expect(h.calls[0].prompt).toBe('接着说');
    expect(h.calls[0].prompt).not.toContain('角色设定');
    expect(h.persisted).toEqual([]); // 同 id 未变，不回写
  });

  test('重启恢复（task_055）：档案 externalSessionId 空/缺 → 首发重建（persona 重注入，不透传）', async () => {
    const h = makeHarness({
      characters: [{ ...character, externalSessionId: '' }],
      scripts: [scripted({ type: 'message', text: 'hi' }, { type: 'done', exitCode: 0, text: 'hi', sessionId: null })],
    });
    await h.service.send('ch-1', '第一条');
    // 「无效/空」分支：首发拼 persona + 不带 sessionId（buildFirstPrompt 语义不变）。
    expect(h.calls[0].prompt).toBe(buildFirstPrompt(character, '第一条'));
    expect(h.calls[0].options?.sessionId ?? null).toBeNull();
  });

  test('重启恢复：种子只种一次 —— 内存会话建立后档案回执不再是真相源（CLI 回新 id 覆盖种子）', async () => {
    const h = makeHarness({
      characters: [{ ...character, externalSessionId: 'sess-old' }],
      scripts: [
        scripted(
          { type: 'session', sessionId: 'sess-new' }, // CLI 侧旧会话失效，回了新 id
          { type: 'message', text: '好的' },
          { type: 'done', exitCode: 0, text: '好的', sessionId: 'sess-new' }
        ),
        scripted({ type: 'done', exitCode: 0, text: '嗯', sessionId: 'sess-new' }),
      ],
    });
    await h.service.send('ch-1', '接着说');
    expect(h.calls[0].options?.sessionId).toBe('sess-old'); // 种子生效
    expect(h.persisted).toEqual([['ch-1', 'sess-new']]); // 新 id 回写，自动自愈
    await h.service.send('ch-1', '再确认');
    expect(h.calls[1].options?.sessionId).toBe('sess-new'); // 运行中状态接管，不再用旧种子
  });
});

describe('流式转发顺序与 finalize 时机', () => {
  test('message 逐条 appendStream → done 收束；无 addMessage；setSending 起止对称', async () => {
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'message', text: '你' },
          { type: 'message', text: '好' },
          { type: 'done', exitCode: 0, text: '你好', sessionId: null }
        ),
      ],
    });
    await h.service.send('ch-1', '打招呼');
    expect(h.view.log).toEqual(['sending:true', 'stream:你', 'stream:好', 'finalize', 'sending:false']);
    expect(h.view.messages).toEqual([]);
  });

  test('tool_use / tool_result 不进气泡；空回复（零文本）落一条占位气泡', async () => {
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'tool_use', tool: 'Bash', input: { command: 'ls' }, id: 't1' },
          { type: 'tool_result', id: 't1', text: 'a.txt' },
          { type: 'done', exitCode: 0, text: '', sessionId: null }
        ),
      ],
    });
    await h.service.send('ch-1', '列一下文件');
    expect(h.view.log).toEqual(['sending:true', 'finalize', `add:assistant:${CHAT_MSG_EMPTY_REPLY}`, 'sending:false']);
  });
});

describe('错误路径：错误气泡 + retry 重发', () => {
  test('超时 → 保留部分文本 + error 标记气泡；retry 重发原文且成功', async () => {
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'message', text: '半截' },
          { type: 'error', message: '等了 180 秒', code: 'timeout' }
        ),
        scripted({ type: 'message', text: '重试成功' }, { type: 'done', exitCode: 0, text: '重试成功', sessionId: null }),
      ],
    });

    await h.service.send('ch-1', '在吗');
    expect(h.view.log).toEqual([
      'sending:true',
      'stream:半截',
      'finalize',
      `add:assistant:${chatErrorText('timeout', '等了 180 秒')}`,
      'sending:false',
    ]);
    expect(h.view.messages[0]).toMatchObject({ characterId: 'ch-1', role: 'assistant', error: true });

    await h.service.retry('ch-1');
    expect(h.calls).toHaveLength(2);
    // 失败那轮没有建立会话 → 重发仍是首发（persona 重新内嵌），原文原样。
    expect(h.calls[1].prompt).toBe(buildFirstPrompt(character, '在吗'));
    expect(h.view.log.slice(-3)).toEqual(['stream:重试成功', 'finalize', 'sending:false']);
  });

  test('spawn 失败（拉不起 CLI）同样走错误气泡；无重试记录时 retry 是 no-op', async () => {
    const h = makeHarness({
      scripts: [scripted({ type: 'error', message: 'ENOENT', code: 'spawn_failed' })],
    });
    await h.service.send('ch-1', '在吗');
    expect(h.view.messages[0]?.text).toBe(chatErrorText('spawn_failed', 'ENOENT'));

    await h.service.retry('ch-9'); // 无档案角色：清掉可重试记录的路（这里本来就没有）
    expect(h.calls).toHaveLength(1); // 没有第二次 spawn
  });

  test('transport 直接抛异常（防御路径）：错误气泡 + 状态复位', async () => {
    const h = makeHarness({
      scripts: [
        async function* boom(): AsyncGenerator<TransportEvent> {
          throw new Error('runtime 炸了');
        },
      ],
    });
    await h.service.send('ch-1', '在吗');
    expect(h.view.log).toEqual(['sending:true', 'finalize', `add:assistant:${chatErrorText('cli_error', 'runtime 炸了')}`, 'sending:false']);
    expect(h.service.inFlight).toBe(false);
  });
});

describe('中断：stop → AbortSignal → aborted 收尾', () => {
  test('stop 触发 spawn 收到的 signal；aborted 事件 → 保留部分文本 + 标注气泡（无 error 标记）', async () => {
    const h = makeHarness({ scripts: [abortableScript('思考中…')] });
    const round = h.service.send('ch-1', '慢慢想');
    await flush();
    expect(h.service.inFlight).toBe(true);

    h.service.stop('ch-1');
    await round;

    expect(h.calls[0].options?.signal?.aborted).toBe(true); // stop 真打到了信号上
    expect(h.view.log).toEqual([
      'sending:true',
      'stream:思考中…',
      'finalize',
      `add:assistant:${CHAT_MSG_INTERRUPTED}`,
      'sending:false',
    ]);
    expect(h.view.messages[0]?.error).toBeUndefined(); // 用户主动中断不算错误，不给重试钮
    expect(h.service.sessionSnapshot('ch-1')?.busy).toBe(false);
  });

  test('不在跑 / 不是该角色时 stop 是 no-op（不炸不误伤）', async () => {
    const gate = gated([{ type: 'message', text: '…' }], [{ type: 'done', exitCode: 0, text: '…', sessionId: null }]);
    const h = makeHarness({ scripts: [gate.script] });
    const round = h.service.send('ch-1', '在吗');
    await flush();

    h.service.stop('ch-other'); // 别人的停止钮不该打断我的对话
    await flush();
    expect(h.service.inFlight).toBe(true); // 回合还在跑（gated 脚本没被 signal 影响）

    h.service.stop('ch-1'); // 正主来了 —— 但 gated 脚本不监听 signal，仍需放行门栓才能收尾
    gate.release();
    await round;
    expect(h.service.inFlight).toBe(false);
  });
});

describe('守门拦截：不碰 transport 的三条路', () => {
  test('agent 未检出 → 「该 CLI 未安装，对话不可用」；transport 一次都不 spawn', async () => {
    const h = makeHarness({ detected: [] });
    await h.service.send('ch-1', '在吗');
    expect(h.view.messages).toEqual([
      { characterId: 'ch-1', role: 'assistant', text: CHAT_MSG_NOT_INSTALLED },
    ]);
    expect(h.calls).toHaveLength(0);
    expect(h.view.log).toEqual(['add:assistant:该 CLI 未安装，对话不可用']); // 没有 setSending 抖动
  });

  test('installed=false（确定没装）同样拦截', async () => {
    const h = makeHarness({
      detected: [{ ...detectedClaude, installed: false, status: 'not-installed', path: null }],
    });
    await h.service.send('ch-1', '在吗');
    expect(h.view.messages[0]?.text).toBe(CHAT_MSG_NOT_INSTALLED);
  });

  test('未绑 agent / 角色不在档 → 各自的引导文案', async () => {
    const h = makeHarness({ characters: [{ ...character, agentKind: null }] });
    await h.service.send('ch-1', '在吗');
    expect(h.view.messages[0]?.text).toBe(CHAT_MSG_UNBOUND);

    await h.service.send('ghost', '在吗');
    expect(h.view.messages[1]?.text).toBe(CHAT_MSG_NO_PROFILE);
    expect(h.calls).toHaveLength(0);
  });
});

describe('全局单飞锁（抽屉只有一条活跃流缓冲）', () => {
  test('一回合没结束，第二个 send 直接忽略（同一角色与跨角色同理）', async () => {
    const gate = gated([{ type: 'message', text: '…' }], [{ type: 'done', exitCode: 0, text: '…', sessionId: null }]);
    const h = makeHarness({ scripts: [gate.script] });

    const round1 = h.service.send('ch-1', '第一条');
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.service.inFlight).toBe(true);

    await h.service.send('ch-1', '第二条'); // 同角色：忽略
    await h.service.send('ch-1', '插队'); // 仍然忽略
    expect(h.calls).toHaveLength(1);

    gate.release();
    await round1;
    expect(h.view.log.filter((entry) => entry === 'sending:true')).toHaveLength(1); // 只有第一轮起过发送态
  });
});

// gated（挂起脚本）的 release 句柄已在各用例闭包里持有，无需全局辅助。

// ============================================================================
// 消息落库（task_036）：时机 / 角色 / sessionRef / retry 不重复写
// ============================================================================

describe('消息落库：user 即时 / assistant 收束整段 / error 走 role=error', () => {
  test('完整回合：user 先落（sessionRef 空）→ assistant 整段落（sessionRef 回执）', async () => {
    const h = makeHarness({
      scripts: [
        scripted(
          { type: 'session', sessionId: 'sess-9' },
          { type: 'message', text: '你' },
          { type: 'message', text: '好' },
          { type: 'done', exitCode: 0, text: '你好', sessionId: 'sess-9' }
        ),
      ],
    });
    await h.service.send('ch-1', '在吗');

    expect(h.messages).toEqual([
      { characterId: 'ch-1', role: 'user', text: '在吗', sessionRef: null }, // 即时写，还没会话
      { characterId: 'ch-1', role: 'assistant', text: '你好', sessionRef: 'sess-9' }, // 整段写，带回执
    ]);
  });

  test('续发：user 消息带上已建立的 sessionRef', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'session', sessionId: 'sess-1' }, { type: 'message', text: '一' }, { type: 'done', exitCode: 0, text: '一', sessionId: 'sess-1' }),
        scripted({ type: 'message', text: '二' }, { type: 'done', exitCode: 0, text: '二', sessionId: 'sess-1' }),
      ],
    });
    await h.service.send('ch-1', '第一轮');
    await h.service.send('ch-1', '第二轮');

    expect(h.messages.map((m) => [m.role, m.text, m.sessionRef])).toEqual([
      ['user', '第一轮', null],
      ['assistant', '一', 'sess-1'],
      ['user', '第二轮', 'sess-1'], // 会话已建立：续发的 user 也带回执
      ['assistant', '二', 'sess-1'],
    ]);
  });

  test('错误路径：role=error 落库（回填历史时渲染成错误样式）；中断标注落 assistant', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'message', text: '半截' }, { type: 'error', message: '等太久', code: 'timeout' }),
      ],
    });
    await h.service.send('ch-1', '在吗');
    expect(h.messages.at(-1)).toEqual({
      characterId: 'ch-1',
      role: 'error',
      text: chatErrorText('timeout', '等太久'),
      sessionRef: null,
    });

    const h2 = makeHarness({ scripts: [abortableScript('思考中')] });
    const round = h2.service.send('ch-1', '慢慢想');
    await flush();
    h2.service.stop('ch-1');
    await round;
    expect(h2.messages.at(-1)).toEqual({
      characterId: 'ch-1',
      role: 'assistant', // 用户主动中断不是错误：与气泡同口径（无重试钮）
      text: CHAT_MSG_INTERRUPTED,
      sessionRef: null,
    });
  });

  test('空回复：占位文案随气泡落 assistant；零文本不落空串', async () => {
    const h = makeHarness({
      scripts: [scripted({ type: 'tool_use', tool: 'Bash', id: 't1' }, { type: 'done', exitCode: 0, text: '', sessionId: null })],
    });
    await h.service.send('ch-1', '列一下文件');
    expect(h.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', '列一下文件'],
      ['assistant', CHAT_MSG_EMPTY_REPLY],
    ]);
  });

  test('守门拦截文案不落库（瞬时引导，不是对话内容）；被单飞锁忽略的 send 也不落', async () => {
    const gate = gated([{ type: 'message', text: '…' }], [{ type: 'done', exitCode: 0, text: '…', sessionId: null }]);
    const h = makeHarness({ detected: [], scripts: [gate.script] });
    await h.service.send('ch-1', '未检出也想发'); // 守门拦截：不落
    expect(h.messages).toEqual([]);

    const h2 = makeHarness({ characters: [{ ...character, agentKind: null }] });
    await h2.service.send('ch-1', '未绑定'); // 同样不落
    expect(h2.messages).toEqual([]);

    // 单飞锁：第一轮进行中，第二次 send 被忽略 —— 不落重复的 user
    const h3 = makeHarness({ scripts: [gate.script] });
    const round = h3.service.send('ch-1', '第一条');
    await flush();
    await h3.service.send('ch-1', '插队');
    gate.release();
    await round;
    expect(h3.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(h3.messages.find((m) => m.text === '插队')).toBeUndefined();
  });

  test('retry 不重复落 user（原文已在库/会话里，重试是服务侧动作）；重试成功照常落 assistant', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'error', message: '失败了', code: 'cli_error' }),
        scripted({ type: 'message', text: '补上了' }, { type: 'done', exitCode: 0, text: '补上了', sessionId: null }),
      ],
    });
    await h.service.send('ch-1', '重试这条');
    await h.service.retry('ch-1');

    const users = h.messages.filter((m) => m.role === 'user');
    expect(users).toEqual([{ characterId: 'ch-1', role: 'user', text: '重试这条', sessionRef: null }]);
    expect(h.messages.map((m) => m.role)).toEqual(['user', 'error', 'assistant']);
  });

  test('persistMessage 抛错不炸对话（可用性优先于历史完整性）', async () => {
    const view = makeView();
    const state = { characters: [character], detectedAgents: [detectedClaude], units: [] } as Pick<WorldState, 'characters' | 'detectedAgents' | 'units'>;
    const { factory, calls } = makeFactory([
      scripted({ type: 'message', text: '照常回' }, { type: 'done', exitCode: 0, text: '照常回', sessionId: null }),
    ]);
    const service = createChatService({
      view: view.view,
      getState: () => state,
      createTransport: factory,
      persistSessionId: () => {},
      persistMessage: () => { throw new Error('落库口炸了'); },
    });
    await expect(service.send('ch-1', '在吗')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1); // transport 照常跑完
    expect(view.log.at(-1)).toBe('sending:false'); // 状态复位
  });
});

// ============================================================================
// 每轮经验事件：exp.gained（task_039）
// ============================================================================

describe('exp.gained：每轮成功收束发射 chat_round（task_039）', () => {
  /** 收集总线上的 exp 事件；resetBus 隔离（本文件其他用例不碰总线，这里进出都清干净）。 */
  function collectExp(): { events: WorldEvent[]; stop: () => void } {
    const events: WorldEvent[] = [];
    const off = onWorldEvent((event) => {
      if (event.type === 'exp.gained') events.push(event);
    });
    return { events, stop: off };
  }

  let collected: ReturnType<typeof collectExp>;

  beforeEach(() => {
    resetBus();
    collected = collectExp();
  });

  afterEach(() => {
    collected.stop();
    resetBus();
  });

  test('done 收束 → 恰好一条 exp.gained(chat_round, 默认 5)', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'message', text: '在的' }, { type: 'done', exitCode: 0, text: '在的', sessionId: null }),
      ],
    });
    await h.service.send('ch-1', '在吗');

    expect(collected.events).toEqual([
      { type: 'exp.gained', characterId: 'ch-1', source: 'chat_round', amount: DEFAULT_EXP_WEIGHTS.chat_round },
    ]);
  });

  test('多轮 → 每轮一条（时机：每轮 finalize 之后）', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'message', text: '一' }, { type: 'done', exitCode: 0, text: '一', sessionId: null }),
        scripted({ type: 'message', text: '二' }, { type: 'done', exitCode: 0, text: '二', sessionId: null }),
      ],
    });
    await h.service.send('ch-1', '第一轮');
    await h.service.send('ch-1', '第二轮');

    expect(collected.events).toHaveLength(2);
    expect(collected.events.every((e) => e.type === 'exp.gained' && e.source === 'chat_round')).toBe(true);
  });

  test('注入 expWeight 换算 amount（task_040 接管口）；权重 0 → 整轮不发', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'message', text: '好' }, { type: 'done', exitCode: 0, text: '好', sessionId: null }),
      ],
      expWeight: (source) => (source === 'chat_round' ? 9 : 0),
    });
    await h.service.send('ch-1', '加权轮');
    expect(collected.events).toEqual([
      { type: 'exp.gained', characterId: 'ch-1', source: 'chat_round', amount: 9 },
    ]);

    const h0 = makeHarness({
      scripts: [
        scripted({ type: 'message', text: '静默' }, { type: 'done', exitCode: 0, text: '静默', sessionId: null }),
      ],
      expWeight: () => 0,
    });
    await h0.service.send('ch-1', '零权重轮');
    expect(collected.events).toHaveLength(1); // 还是只有上面那一条
  });

  test('error 轮（transport 失败）→ 不发（error 轮不计经验）', async () => {
    const h = makeHarness({
      scripts: [scripted({ type: 'error', message: '失败了', code: 'cli_error' })],
    });
    await h.service.send('ch-1', '会失败的一轮');
    expect(collected.events).toHaveLength(0);
  });

  test('守门拒绝轮（agent 未检出）→ 不发（根本没进 runRound）', async () => {
    const h = makeHarness({ detected: [] });
    await h.service.send('ch-1', '没装 CLI 也要聊');
    expect(collected.events).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  test('用户中断轮（aborted）→ 不发（中断不是完成）', async () => {
    const h = makeHarness({ scripts: [abortableScript('说到一半')] });
    const sending = h.service.send('ch-1', '会被打断的话');
    await flush();
    h.service.stop('ch-1');
    await sending;
    expect(collected.events).toHaveLength(0);
  });

  test('空回复占位轮 → 照发（done 到了就是完整回合，agent 只调了工具不算失败）', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'tool_use', tool: 'Bash', input: {}, id: 't1' }, { type: 'done', exitCode: 0, text: '', sessionId: null }),
      ],
    });
    await h.service.send('ch-1', '只调工具别说话');
    expect(collected.events).toEqual([
      { type: 'exp.gained', characterId: 'ch-1', source: 'chat_round', amount: DEFAULT_EXP_WEIGHTS.chat_round },
    ]);
  });
});

// ============================================================================
// 上下文注入（task_053）
// ============================================================================

describe('上下文注入（task_053）：首发附带 <stratix-context>，续发不注入', () => {
  const snapshot = (): import('../services/stratix-context').StratixContextInput => ({
    characterId: 'ch-1',
    characterName: '阿尔法',
    profileSummary: 'Lv.1 · EXP 0 · claude-code',
    peers: [{ id: 'ch-2', name: '贝塔', kind: 'codex', level: 2 }],
    recentTasks: [{ summary: '修复登录页', status: 'completed', at: 1_700_000_000_000 }],
    lastTopic: null,
  });

  test('首发：persona 之后、用户消息之前插入 <stratix-context> 块', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'message', text: '收到' }, { type: 'done', exitCode: 0, text: '', sessionId: 's-1' }),
        scripted({ type: 'message', text: '第二句' }, { type: 'done', exitCode: 0, text: '', sessionId: 's-1' }),
      ],
      provideContext: () => snapshot(),
    });
    await h.service.send('ch-1', '第一句');
    const first = h.calls[0]?.prompt ?? '';
    expect(first).toContain('<stratix-context>');
    expect(first).toContain('# 同场角色');
    expect(first).toContain('# 近期任务');
    // 位置契约：引导语 < 角色设定 < stratix-context < 用户消息
    expect(first.indexOf('角色设定')).toBeLessThan(first.indexOf('<stratix-context>'));
    expect(first.indexOf('<stratix-context>')).toBeLessThan(first.indexOf('【用户消息】'));

    // 续发：会话里已含 → 不再注入（一次性）
    await h.service.send('ch-1', '第二句');
    expect(h.calls[1]?.prompt).toBe('第二句');
  });

  test('注入件返回 null / 缺省 → 首发不带块（走原路径）', async () => {
    const off = makeHarness({
      scripts: [scripted({ type: 'done', exitCode: 0, text: '', sessionId: null })],
      provideContext: () => null,
    });
    await off.service.send('ch-1', '你好');
    expect(off.calls[0]?.prompt).not.toContain('<stratix-context>');

    const absent = makeHarness({
      scripts: [scripted({ type: 'done', exitCode: 0, text: '', sessionId: null })],
    });
    await absent.service.send('ch-1', '你好');
    expect(absent.calls[0]?.prompt).not.toContain('<stratix-context>');
  });

  test('注入件抛错 → 吞掉不绑架对话（首发照常拼 persona，只是没块）', async () => {
    const h = makeHarness({
      scripts: [scripted({ type: 'done', exitCode: 0, text: '', sessionId: null })],
      provideContext: () => {
        throw new Error('snapshot boom');
      },
    });
    await h.service.send('ch-1', '你好');
    const prompt = h.calls[0]?.prompt ?? '';
    expect(prompt).not.toContain('<stratix-context>');
    expect(prompt).toContain('冷静的战术分析师');
    expect(prompt).toContain('【用户消息】');
  });

  test('buildFirstPrompt 三参：persona 空但块存在 → 保留引导语与【用户消息】结构', () => {
    const bare: CharacterView = { ...character, persona: '   ' };
    const prompt = buildFirstPrompt(bare, '在吗', '<stratix-context>块</stratix-context>');
    expect(prompt).toContain('你将扮演');
    expect(prompt).toContain('<stratix-context>块</stratix-context>');
    expect(prompt).toContain('【用户消息】\n在吗');
    // 传空串（快照全空）→ 与 undefined 等价：persona 空回原路径
    expect(buildFirstPrompt(bare, '在吗', '')).toBe('在吗');
  });
});

// ============================================================================
// agent 健康监测对接面（@since v3.30，task_054）：离线守门第四条（035 三条之上加在线位）
// + transport exit 异常旁路上报。规格⑤「灰显与拦截」的对话侧断言。
// ============================================================================

describe('离线守门：units.online === false → 错误气泡 + 轻提示（task_054）', () => {
  const offlineUnit = {
    id: 'unit-1',
    name: '阿尔法',
    status: 'idle' as const,
    missionId: null,
    power: 3,
    characterId: 'ch-1',
    online: false,
  };

  /** 手拼带注入口的服务（HarnessOptions 没有 notify / onTransportError 位，这里补齐）。 */
  function makeService(overrides: {
    readonly units?: import('../../core/types').UnitView[];
    readonly scripts?: Script[];
    readonly notify?: (text: string) => void;
    readonly onTransportError?: (kind: AgentKind, code: import('../services/cli-transport/transport').TransportErrorCode) => void;
  }): { view: ViewHarness; calls: SpawnRecord[]; setUnits: (units: import('../../core/types').UnitView[]) => void; service: ReturnType<typeof createChatService> } {
    const view = makeView();
    const units: import('../../core/types').UnitView[] = [...(overrides.units ?? [])];
    const { factory, calls } = makeFactory(overrides.scripts ?? [scripted()]);
    const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
      characters: [character],
      detectedAgents: [detectedClaude],
      units,
    };
    const service = createChatService({
      view: view.view,
      getState: () => state,
      createTransport: factory,
      persistSessionId: () => {},
      notify: overrides.notify,
      onTransportError: overrides.onTransportError,
    });
    return { view, calls, setUnits: (next) => { units.length = 0; units.push(...next); }, service };
  }

  test('离线角色 → 错误气泡「当前离线」；transport 一次都不 spawn', async () => {
    const h = makeHarness({ units: [offlineUnit] });
    await h.service.send('ch-1', '在吗');
    expect(h.view.messages).toEqual([
      { characterId: 'ch-1', role: 'assistant', text: chatOfflineText('阿尔法'), error: true },
    ]);
    expect(h.calls).toHaveLength(0);
  });

  test('轻提示去重：掉线期间多次发送只提示一次；恢复后照常进 transport', async () => {
    const toasts: string[] = [];
    const s = makeService({
      units: [offlineUnit],
      scripts: [scripted({ type: 'message', text: '回来了' }, { type: 'done', exitCode: 0, text: '回来了', sessionId: null })],
      notify: (text) => toasts.push(text),
    });
    await s.service.send('ch-1', '第一次');
    await s.service.send('ch-1', '第二次');
    expect(toasts).toEqual(['「阿尔法」当前离线']); // 两次拦截只提示一次
    expect(s.view.messages).toHaveLength(2); // 错误气泡每次都落（诚实反馈）
    expect(s.calls).toHaveLength(0);

    // 恢复在线 → 守门通过 → 照常进 transport，不再提示。
    s.setUnits([{ ...offlineUnit, online: true }]);
    await s.service.send('ch-1', '第三次');
    expect(s.calls).toHaveLength(1);
    expect(toasts).toHaveLength(1);
  });
});

describe('transport 异常上报：error 事件旁路上报健康监测（task_054）', () => {
  test('error 事件回调 (kind, code)；aborted 同样透传（裁决在健康监测）', async () => {
    const reported: Array<[AgentKind, string]> = [];
    const view = makeView();
    const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
      characters: [character],
      detectedAgents: [detectedClaude],
      units: [],
    };
    const { factory } = makeFactory([scripted({ type: 'error', code: 'cli_error', message: '炸了' })]);
    const service = createChatService({
      view: view.view,
      getState: () => state,
      createTransport: factory,
      persistSessionId: () => {},
      onTransportError: (kind, code) => reported.push([kind, code]),
    });
    await service.send('ch-1', '在吗');
    await flush();
    expect(reported).toEqual([['claude-code', 'cli_error']]);
    expect(view.messages.at(-1)?.text).toContain('炸了'); // 主路照旧：错误气泡落地
  });
});

// ============================================================================
// unit.speaking：说话气泡事件（@since v3.37，task_062）—— runRound 起手发 true、
// 收束（finally，成功/失败/中断统一）发 false；角色没上战场不发。战场头顶「···」
// 气泡经 bus-adapter 转发驱动（hud 不直接驱动 world，app 层在这里翻译成世界事件）。
// ============================================================================

describe('unit.speaking：说话气泡起止（task_062）', () => {
  const speakingUnit: import('../../core/types').UnitView = {
    id: 'unit_ch_1',
    name: '阿尔法',
    status: 'idle',
    missionId: null,
    power: 1,
    characterId: 'ch-1',
  };

  function collectSpeaking(): { events: WorldEvent[]; stop: () => void } {
    const events: WorldEvent[] = [];
    const off = onWorldEvent((event) => {
      if (event.type === 'unit.speaking') events.push(event);
    });
    return { events, stop: off };
  }

  let collected: ReturnType<typeof collectSpeaking>;

  beforeEach(() => {
    resetBus();
    collected = collectSpeaking();
  });

  afterEach(() => {
    collected.stop();
    resetBus();
  });

  test('一轮对话：起手 true → 收束 false（恰好一对，顺序先起后止）', async () => {
    const h = makeHarness({
      units: [speakingUnit],
      scripts: [
        scripted({ type: 'message', text: '在的' }, { type: 'done', exitCode: 0, text: '在的', sessionId: null }),
      ],
    });
    await h.service.send('ch-1', '在吗');

    expect(collected.events).toEqual([
      { type: 'unit.speaking', unitId: 'unit_ch_1', speaking: true },
      { type: 'unit.speaking', unitId: 'unit_ch_1', speaking: false },
    ]);
  });

  test('错误轮也要收气泡：error 事件路径的 finally 发 false（气泡不留残迹）', async () => {
    const h = makeHarness({
      units: [speakingUnit],
      scripts: [scripted({ type: 'error', message: 'cli 挂了', code: 'cli_error' })],
    });
    await h.service.send('ch-1', '在吗');

    expect(collected.events).toEqual([
      { type: 'unit.speaking', unitId: 'unit_ch_1', speaking: true },
      { type: 'unit.speaking', unitId: 'unit_ch_1', speaking: false },
    ]);
  });

  test('多轮：每轮一对起止（第二轮重发同样成对）', async () => {
    const h = makeHarness({
      units: [speakingUnit],
      scripts: [
        scripted({ type: 'message', text: '一' }, { type: 'done', exitCode: 0, text: '一', sessionId: null }),
        scripted({ type: 'message', text: '二' }, { type: 'done', exitCode: 0, text: '二', sessionId: null }),
      ],
    });
    await h.service.send('ch-1', '第一轮');
    await h.service.send('ch-1', '第二轮');

    expect(collected.events).toEqual([
      { type: 'unit.speaking', unitId: 'unit_ch_1', speaking: true },
      { type: 'unit.speaking', unitId: 'unit_ch_1', speaking: false },
      { type: 'unit.speaking', unitId: 'unit_ch_1', speaking: true },
      { type: 'unit.speaking', unitId: 'unit_ch_1', speaking: false },
    ]);
  });

  test('角色没上战场（units 空 / 无匹配 characterId）→ 不发事件', async () => {
    const h = makeHarness({
      scripts: [
        scripted({ type: 'message', text: '在的' }, { type: 'done', exitCode: 0, text: '在的', sessionId: null }),
      ],
    });
    await h.service.send('ch-1', '在吗');

    expect(collected.events).toHaveLength(0);
  });

  test('守门拦截（agent 未检出）→ 不发事件（没起过回合就没有起止）', async () => {
    const h = makeHarness({
      detected: [],
      units: [speakingUnit],
      scripts: [],
    });
    await h.service.send('ch-1', '在吗');

    expect(collected.events).toHaveLength(0);
    expect(h.calls).toHaveLength(0); // 连 transport 都没打（守门在 runRound 之前）
  });
});
