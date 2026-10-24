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

import type { AgentKind, CharacterView, DetectedAgent, WorldState } from '../../core/types';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import {
  buildFirstPrompt,
  CHAT_MSG_EMPTY_REPLY,
  CHAT_MSG_INTERRUPTED,
  CHAT_MSG_NOT_INSTALLED,
  CHAT_MSG_NO_PROFILE,
  CHAT_MSG_UNBOUND,
  chatErrorText,
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
}

interface ServiceHarness {
  readonly service: ReturnType<typeof createChatService>;
  readonly view: ViewHarness;
  readonly calls: SpawnRecord[];
  readonly persisted: Array<[string, string]>;
  /** persistMessage 收到的落库消息序列（task_036）。 */
  readonly messages: ChatPersistedMessage[];
  setState(patch: Partial<Pick<WorldState, 'characters' | 'detectedAgents'>>): void;
}

function makeHarness(options: HarnessOptions = {}): ServiceHarness {
  const view = makeView();
  // 拷贝成可变数组：setState 直改字段（真实 store 里 state 是不可变快照，这里用小改模拟字段演进）。
  const detected: readonly DetectedAgent[] | undefined =
    'detected' in options ? options.detected : [detectedClaude];
  const state: Pick<WorldState, 'characters' | 'detectedAgents'> = {
    characters: [...(options.characters ?? [character])],
    detectedAgents: detected ? [...detected] : undefined,
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

  test('档案里已有 externalSessionId？会话状态从零开始按首发处理（档案是落库回执，不是内存真相）', async () => {
    const h = makeHarness({
      characters: [{ ...character, externalSessionId: 'sess-old' }],
      scripts: [scripted({ type: 'message', text: 'hi' }, { type: 'done', exitCode: 0, text: 'hi', sessionId: null })],
    });
    await h.service.send('ch-1', '第一条');
    // 内存会话状态未建立 → 首发拼 persona；externalSessionId 不透传（重启后由首答重建）。
    expect(h.calls[0].prompt).toContain('角色设定');
    expect(h.calls[0].options?.sessionId ?? null).toBeNull();
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
    const state = { characters: [character], detectedAgents: [detectedClaude] } as Pick<WorldState, 'characters' | 'detectedAgents'>;
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
