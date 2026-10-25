/**
 * 集成测试：角色聊天抽屉（hud/components/chat-drawer/，task_034 —— transport 打桩的纯 UI 任务）。
 * 覆盖三层：
 *   1. 纯逻辑（chat-catalog.ts）：多角色会话隔离 / appendStream 增量与归属 / finalize 收束 /
 *      截尾 / 头部派生 / 发送闸门 —— node 可算，无 DOM；
 *   2. 组件（chat-drawer.ts）：开合滑入滑出态 / 点单位（selection 广播）切上下文 /
 *      消息气泡方向 / 发送回调（Enter 与按钮两条路）/ setSending 禁用态 / 流式增量渲染不重建
 *      列表 / XSS 转义 / 卸载退订；
 *   3. DEMO 假流（demo-fake-stream.ts）：jest fake timers 驱动"发送 → 逐 chunk → 收束"的
 *      演示路径 —— 它同时验证了 035 组合根将要使用的同一组公开方法的调用面。
 * @jest-environment jsdom
 */

import type { CharacterView, UnitView, WorldState } from '../../core/types';

import {
  CHAT_SESSION_MESSAGE_CAP,
  createCharacterChatSessions,
  resolveCharacterHeader,
  sendableDraft,
} from '../components/chat-drawer/chat-catalog';
import {
  CHARACTER_CHAT_DRAWER_TAG,
  mountCharacterChatDrawer,
  type CharacterChatDrawerDeps,
  type StratCharacterChatDrawerElement,
} from '../components/chat-drawer/chat-drawer';
import {
  DEMO_REPLY_PREFIX,
  createDemoOnSend,
  splitDemoReply,
} from '../components/chat-drawer/demo-fake-stream';

// ============================================================================
// 夹具
// ============================================================================

function unit(id: string, characterId: string | null): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 10, characterId };
}

function character(id: string, patch: Partial<CharacterView> = {}): CharacterView {
  return {
    id,
    name: `角色-${id}`,
    persona: '',
    level: 1,
    experience: 0,
    agentKind: 'kimi',
    ...patch,
  };
}

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

/** task_035 追加：停止 / 重试回调的记录器（与 sent 同一模式）。 */
interface ExtraDeps {
  onStop?: (characterId: string) => void;
  onRetry?: (characterId: string) => void;
  /** task_036 追加：历史加载回调（记录调用；受控兑现见「历史回填」组）。 */
  loadHistory?: (characterId: string) => Promise<readonly {
    characterId?: string;
    role: 'user' | 'assistant';
    text: string;
    error?: boolean;
    at?: number;
  }[]>;
}

interface Harness {
  readonly panel: StratCharacterChatDrawerElement;
  readonly host: HTMLElement;
  /** onSend 回调收到的 (characterId, text) 依次记录。 */
  readonly sent: Array<{ characterId: string; text: string }>;
  /** onStop / onRetry 收到的 characterId 依次记录（task_035）。 */
  readonly stopped: string[];
  readonly retried: string[];
  /** loadHistory 被请求的角色 id 依次记录（task_036）。 */
  readonly historyRequested: string[];
  /** 模拟 core 广播一份新状态（走组件订阅的真实链路）。 */
  emit(state: WorldState): void;
  subscriberCount(): number;
  unmount(): void;
}

function mountPanel(onSend?: (characterId: string, text: string) => void, extra: ExtraDeps = {}): Harness {
  const sent: Array<{ characterId: string; text: string }> = [];
  const stopped: string[] = [];
  const retried: string[] = [];
  const historyRequested: string[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const deps: CharacterChatDrawerDeps = {
    subscribe: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
    onSend: onSend ?? ((characterId, text) => { sent.push({ characterId, text }); }),
    onStop: (characterId) => {
      stopped.push(characterId);
      extra.onStop?.(characterId);
    },
    onRetry: (characterId) => {
      retried.push(characterId);
      extra.onRetry?.(characterId);
    },
    loadHistory: extra.loadHistory
      ? (characterId) => {
          historyRequested.push(characterId);
          return extra.loadHistory!(characterId);
        }
      : undefined,
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountPanel = mountCharacterChatDrawer(deps, host);
  const panel = host.querySelector(CHARACTER_CHAT_DRAWER_TAG) as StratCharacterChatDrawerElement;
  if (!panel?.shadowRoot) throw new Error('角色聊天抽屉未 upgrade（shadowRoot 为空）');

  return {
    panel,
    host,
    sent,
    stopped,
    retried,
    historyRequested,
    emit: (state) => { subs.forEach((handler) => handler(state)); },
    subscriberCount: () => subs.size,
    unmount: () => { unmountPanel(); host.remove(); },
  };
}

/** 进 shadow DOM 打字：走组件自己的事件链，不直接设属性绕过 input 监听。 */
function typeDraft(panel: StratCharacterChatDrawerElement, text: string): void {
  const box = panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
  if (!box) throw new Error('输入框未渲染');
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickSend(panel: StratCharacterChatDrawerElement): void {
  const button = panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]');
  if (!button) throw new Error('发送按钮未渲染');
  button.click();
}

function clickClose(panel: StratCharacterChatDrawerElement): void {
  const button = panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="close"]');
  if (!button) throw new Error('关闭按钮未渲染');
  button.click();
}

function pressEnter(panel: StratCharacterChatDrawerElement, shiftKey = false): void {
  const box = panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
  if (!box) throw new Error('输入框未渲染');
  const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true });
  box.dispatchEvent(event);
}

function railOf(panel: StratCharacterChatDrawerElement): HTMLElement {
  const rail = panel.shadowRoot?.querySelector<HTMLElement>('[data-role="rail"]');
  if (!rail) throw new Error('抽屉轨道未渲染');
  return rail;
}

function messagesBoxOf(panel: StratCharacterChatDrawerElement): HTMLElement {
  const box = panel.shadowRoot?.querySelector<HTMLElement>('[data-role="messages"]');
  if (!box) throw new Error('消息列表未渲染');
  return box;
}

function bubblesOf(panel: StratCharacterChatDrawerElement): HTMLElement[] {
  return Array.from(messagesBoxOf(panel).querySelectorAll<HTMLElement>('[data-role="bubble"], [data-role="stream-bubble"]'));
}

function headerOf(panel: StratCharacterChatDrawerElement): { name: string; badge: string } {
  const name = panel.shadowRoot?.querySelector('[data-role="char-name"]')?.textContent ?? '';
  const badge = panel.shadowRoot?.querySelector('[data-role="kind-badge"]')?.textContent ?? '';
  return { name, badge };
}

// ============================================================================
// 纯逻辑：会话存储（chat-catalog）
// ============================================================================

describe('会话存储：多角色隔离与流式缓冲（纯逻辑）', () => {
  function deterministicStore(): ReturnType<typeof createCharacterChatSessions> {
    let n = 0;
    return createCharacterChatSessions({
      nextId: () => `id-${(n += 1)}`,
      now: () => 1_700_000_000_000,
    });
  }

  test('每角色独立消息数组：A 的消息不会冒进 B', () => {
    const store = deterministicStore();
    store.setViewing('a');
    store.addMessage({ role: 'user', text: '给 A' });
    store.setViewing('b');
    store.addMessage({ role: 'user', text: '给 B' });

    expect(store.messages('a').map((m) => m.text)).toEqual(['给 A']);
    expect(store.messages('b').map((m) => m.text)).toEqual(['给 B']);
    expect(store.characterIds).toEqual(['a', 'b']);
  });

  test('addMessage 的归属：缺省取当前查看角色；无归属或空正文不落库', () => {
    const store = deterministicStore();
    expect(store.addMessage({ role: 'user', text: '无处安放' })).toBeNull(); // 没有角色上下文

    store.setViewing('a');
    const committed = store.addMessage({ role: 'user', text: '你好' });
    expect(committed?.characterId).toBe('a');
    expect(store.addMessage({ role: 'user', text: '' })).toBeNull(); // 空正文没有信息量
  });

  test('appendStream 增量追加；切走视图后流仍归原角色（不串台）', () => {
    const store = deterministicStore();
    store.setViewing('a');
    const stream = store.appendStream('你');
    expect(stream).toMatchObject({ characterId: 'a', text: '你' });

    store.setViewing('b');
    expect(store.appendStream('好')).toMatchObject({ characterId: 'a', text: '你好' }); // 归属不变

    const message = store.finalizeStream();
    expect(message).toMatchObject({ characterId: 'a', text: '你好', role: 'assistant' });
    expect(store.messages('b')).toEqual([]); // B 的会话干干净净
  });

  test('appendStream 无处安放（没有活跃流也没有查看对象）→ 忽略', () => {
    const store = deterministicStore();
    expect(store.appendStream('迷路的 chunk')).toBeNull();
  });

  test('finalize：id 沿用流的 id（气泡 DOM 稳定）；正文为空则丢弃；重复收束是 no-op', () => {
    const store = deterministicStore();
    store.setViewing('a');
    const streamId = store.appendStream('实')?.id;
    store.appendStream('话');
    const message = store.finalizeStream();
    expect(message?.id).toBe(streamId);
    expect(message?.text).toBe('实话');
    expect(store.finalizeStream()).toBeNull();

    store.appendStream(''); // 空 chunk 不建流
    expect(store.stream).toBeNull();
  });

  test('会话截尾：超过上限丢最旧的（perf 硬约束，历史归 036 的库）', () => {
    const store = createCharacterChatSessions({ cap: 3 });
    store.setViewing('a');
    for (let i = 1; i <= 5; i += 1) store.addMessage({ role: 'user', text: `m${i}` });
    expect(store.messages('a').map((m) => m.text)).toEqual(['m3', 'm4', 'm5']);
  });

  test('CHAT_SESSION_MESSAGE_CAP 默认值与外部会话同量级（100）', () => {
    expect(CHAT_SESSION_MESSAGE_CAP).toBe(100);
  });
});

describe('头部派生与发送闸门（纯逻辑）', () => {
  test('档案命中：名字 + kind 徽标文案（词表来自 AGENT_KIND_LABELS 单一真相源）', () => {
    const header = resolveCharacterHeader([character('c1', { name: '铁牛', agentKind: 'kimi' })], 'c1');
    expect(header).toEqual({ characterId: 'c1', name: '铁牛', kindLabel: 'Kimi' });
  });

  test('未绑定 agent → kindLabel 为 null（不编造）；档案缺失 → 名字回落 id', () => {
    expect(resolveCharacterHeader([character('c1', { agentKind: null })], 'c1')?.kindLabel).toBeNull();
    const ghost = resolveCharacterHeader([], 'ghost-id');
    expect(ghost).toEqual({ characterId: 'ghost-id', name: 'ghost-id', kindLabel: null });
    expect(resolveCharacterHeader([character('c1')], null)).toBeNull();
  });

  test('sendableDraft：trim 后非空才可发，返回的就是要发的正文', () => {
    expect(sendableDraft('  你好  ')).toBe('你好');
    expect(sendableDraft('')).toBeNull();
    expect(sendableDraft('  \n ')).toBeNull();
  });
});

// ============================================================================
// 组件：开合 / 点单位切上下文 / 消息 / 发送
// ============================================================================

describe('组件：抽屉开合', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('挂载即注册且默认收起（data-open=false）', () => {
    h = mountPanel();
    expect(customElements.get(CHARACTER_CHAT_DRAWER_TAG)).toBeTruthy();
    expect(railOf(h.panel).getAttribute('data-open')).toBe('false');
    expect(h.panel.isOpen).toBe(false);
  });

  test('open/close 切换 data-open；open(id) 同时切上下文；关闭按钮走 DOM 点击', () => {
    h = mountPanel();
    h.panel.open('c1');
    expect(railOf(h.panel).getAttribute('data-open')).toBe('true');
    expect(h.panel.characterId).toBe('c1');

    clickClose(h.panel);
    expect(railOf(h.panel).getAttribute('data-open')).toBe('false');
    expect(h.panel.characterId).toBe('c1'); // 关闭保留上下文，再打开还在原会话

    h.panel.open();
    expect(h.panel.isOpen).toBe(true);
    expect(h.panel.characterId).toBe('c1');
  });
});

describe('组件：点战场单位 → 打开抽屉并切上下文（selection 广播驱动）', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('单选关联角色的单位 → 打开 + 头部显示角色名与 kind 徽标', () => {
    h = mountPanel();
    h.emit(makeState({
      units: [unit('u1', 'c1'), unit('u2', null)],
      characters: [character('c1', { name: '铁牛', agentKind: 'codex' })],
      selection: { unitIds: ['u1'], previewUnitIds: [], revision: 1 },
    }));

    expect(h.panel.isOpen).toBe(true);
    expect(h.panel.characterId).toBe('c1');
    expect(headerOf(h.panel)).toEqual({ name: '铁牛', badge: 'Codex' });
  });

  test('同 revision 的后续广播不会把刚关掉的抽屉再顶开', () => {
    h = mountPanel();
    const state = makeState({
      units: [unit('u1', 'c1')],
      selection: { unitIds: ['u1'], previewUnitIds: [], revision: 7 },
    });
    h.emit(state);
    expect(h.panel.isOpen).toBe(true);

    h.panel.close();
    h.emit(state); // 无关广播（notices 变了但 selection 没变）
    expect(h.panel.isOpen).toBe(false);
  });

  test('多点 / 点未关联角色的单位 / 点空地：都不动抽屉', () => {
    h = mountPanel();
    h.emit(makeState({
      units: [unit('u1', 'c1'), unit('u2', 'c2'), unit('u3', null)],
      selection: { unitIds: ['u1', 'u2'], previewUnitIds: [], revision: 2 },
    }));
    expect(h.panel.isOpen).toBe(false);

    h.emit(makeState({
      units: [unit('u3', null)],
      selection: { unitIds: ['u3'], previewUnitIds: [], revision: 3 },
    }));
    expect(h.panel.isOpen).toBe(false);

    h.emit(makeState({
      units: [unit('u3', null)],
      selection: { unitIds: [], previewUnitIds: [], revision: 4 },
    }));
    expect(h.panel.isOpen).toBe(false);
  });

  test('点另一个角色的单位 → 切上下文，消息流跟着换段（每角色独立会话）', () => {
    h = mountPanel();
    h.panel.open('c1');
    h.panel.addMessage({ characterId: 'c1', role: 'user', text: '给 c1 的' });
    h.panel.addMessage({ characterId: 'c2', role: 'assistant', text: '给 c2 的' });
    expect(h.panel.visibleMessageIds).toHaveLength(1);

    h.emit(makeState({
      units: [unit('u2', 'c2')],
      selection: { unitIds: ['u2'], previewUnitIds: [], revision: 9 },
    }));

    expect(h.panel.characterId).toBe('c2');
    expect(h.panel.visibleMessageIds).toHaveLength(1);
    expect(messagesBoxOf(h.panel).textContent).toContain('给 c2 的');
    expect(messagesBoxOf(h.panel).textContent).not.toContain('给 c1 的');
  });

  test('档案缺失的角色：头部名字回落 id，徽标显示未绑定（不编造档案）', () => {
    h = mountPanel();
    h.emit(makeState({
      units: [unit('u1', 'ghost')],
      selection: { unitIds: ['u1'], previewUnitIds: [], revision: 1 },
    }));
    expect(headerOf(h.panel)).toEqual({ name: 'ghost', badge: '未绑定' });
  });
});

describe('组件：消息渲染与发送', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('user 气泡靠右 / assistant 气泡靠左（data-side 驱动 CSS 对齐）', () => {
    h = mountPanel();
    h.panel.open('c1');
    h.panel.addMessage({ role: 'user', text: '出发' });
    h.panel.addMessage({ role: 'assistant', text: '收到' });

    const sides = bubblesOf(h.panel).map((b) => b.getAttribute('data-side'));
    expect(sides).toEqual(['user', 'assistant']);
  });

  test('新消息自动滚动到底部', () => {
    h = mountPanel();
    h.panel.open('c1');
    const box = messagesBoxOf(h.panel);
    Object.defineProperty(box, 'scrollHeight', { value: 512, configurable: true });

    h.panel.addMessage({ role: 'user', text: '到底去' });
    expect(box.scrollTop).toBe(512);
  });

  test('输入 + 点发送：onSend(characterId, trim 后正文)，user 气泡立即出现，草稿清空', () => {
    h = mountPanel();
    h.panel.open('c1');

    typeDraft(h.panel, '  检查城墙  ');
    clickSend(h.panel);

    expect(h.sent).toEqual([{ characterId: 'c1', text: '检查城墙' }]);
    expect(bubblesOf(h.panel)[0].getAttribute('data-side')).toBe('user');
    expect(bubblesOf(h.panel)[0].textContent).toContain('检查城墙');
    expect(h.panel.draft).toBe('');
    expect(h.panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]')?.value).toBe('');
  });

  test('Enter 发送；Shift+Enter 只换行不发送', () => {
    h = mountPanel();
    h.panel.open('c1');

    typeDraft(h.panel, '回车即发');
    pressEnter(h.panel);
    expect(h.sent).toEqual([{ characterId: 'c1', text: '回车即发' }]);

    typeDraft(h.panel, '换行继续写');
    pressEnter(h.panel, true);
    expect(h.sent).toHaveLength(1);
    expect(h.panel.draft).toBe('换行继续写');
  });

  test('空草稿不发送；没选角色时输入区整体禁用，选了角色即解锁', () => {
    h = mountPanel();
    const box = h.panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
    const send = h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]');
    expect(box?.disabled).toBe(true);
    expect(send?.disabled).toBe(true);

    typeDraft(h.panel, '还没有角色');
    clickSend(h.panel);
    pressEnter(h.panel);
    expect(h.sent).toEqual([]);

    h.panel.setCharacter('c1');
    expect(h.panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]')?.disabled).toBe(false);

    typeDraft(h.panel, '   '); // 只有空白：按钮仍禁用，Enter 也发不出去
    expect(h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]')?.disabled).toBe(true);
    pressEnter(h.panel);
    expect(h.sent).toEqual([]);
  });

  test('setSending(true)：输入框与发送钮禁用、提示发送中；false 后恢复', () => {
    h = mountPanel();
    h.panel.open('c1');
    typeDraft(h.panel, '正文');
    expect(h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]')?.disabled).toBe(false);

    h.panel.setSending(true);
    expect(h.panel.sending).toBe(true);
    expect(h.panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]')?.disabled).toBe(true);
    expect(h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]')?.disabled).toBe(true);
    expect(h.panel.shadowRoot?.querySelector('[data-role="send-hint"]')?.textContent).toContain('发送中');

    clickSend(h.panel); // 发送中的旁路（直接点按钮）也发不出去
    expect(h.sent).toEqual([]);

    h.panel.setSending(false);
    expect(h.panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]')?.disabled).toBe(false);
    expect(h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]')?.disabled).toBe(false);
  });

  test('消息正文按纯文本渲染（外部内容不当作 HTML 执行）', () => {
    h = mountPanel();
    h.panel.open('c1');
    h.panel.addMessage({ role: 'assistant', text: '<img src=x onerror="alert(1)">' });

    expect(h.panel.shadowRoot?.querySelector('img')).toBeNull();
    expect(bubblesOf(h.panel)[0].textContent).toContain('<img src=x onerror="alert(1)">');
  });
});

// ============================================================================
// 组件：流式渲染（appendStream / finalizeStream —— 035 组合根的调用面）
// ============================================================================

describe('组件：流式增量渲染', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('appendStream 逐 chunk 增量：只动流式气泡，已提交气泡的 DOM 节点不重建', () => {
    h = mountPanel();
    h.panel.open('c1');
    h.panel.addMessage({ role: 'user', text: '问一句' });
    const committedBefore = bubblesOf(h.panel)[0];

    h.panel.appendStream('第一');
    h.panel.appendStream('段');

    const bubbles = bubblesOf(h.panel);
    expect(bubbles[0]).toBe(committedBefore); // 同一个节点，没被重建
    const streamBubble = bubbles[1];
    expect(streamBubble.getAttribute('data-role')).toBe('stream-bubble');
    expect(streamBubble.getAttribute('data-streaming')).toBe('true');
    expect(streamBubble.querySelector('.bubble-text')?.textContent).toBe('第一段');
    expect(h.panel.visibleMessageIds).toHaveLength(1); // 流缓冲不算已提交消息
  });

  test('finalizeStream 收束：转为普通气泡（id 不变、光标消失），可再次开新流', () => {
    h = mountPanel();
    h.panel.open('c1');
    h.panel.appendStream('答');
    h.panel.appendStream('案');
    const streamId = h.panel.streaming?.id;

    h.panel.finalizeStream();

    expect(h.panel.streaming).toBeNull();
    expect(h.panel.visibleMessageIds).toEqual([streamId]);
    const box = messagesBoxOf(h.panel);
    expect(box.querySelector('[data-role="stream-bubble"]')).toBeNull();
    expect(box.querySelector('[data-message]')?.getAttribute('data-side')).toBe('assistant');
    expect(box.querySelector('[data-message]')?.textContent).toContain('答案');

    h.panel.appendStream('下一段'); // 收束后可复用
    expect(h.panel.streaming?.text).toBe('下一段');
  });

  test('没有角色上下文时 appendStream 被忽略（不抛错、不建流）', () => {
    h = mountPanel();
    h.panel.appendStream('迷路');
    expect(h.panel.streaming).toBeNull();
  });

  test('流属于发言角色：切到别的角色看不到它，收束也归档到原角色', () => {
    h = mountPanel();
    h.panel.open('c1');
    h.panel.appendStream('给 c1 的流');
    h.panel.setCharacter('c2');

    expect(messagesBoxOf(h.panel).querySelector('[data-role="stream-bubble"]')).toBeNull();
    expect(h.panel.streaming?.characterId).toBe('c1'); // 缓冲还在，归属没变

    h.panel.appendStream('（续）');
    h.panel.finalizeStream();

    h.panel.setCharacter('c1');
    expect(h.panel.visibleMessageIds).toHaveLength(1);
    expect(messagesBoxOf(h.panel).textContent).toContain('给 c1 的流（续）');
    h.panel.setCharacter('c2');
    expect(h.panel.visibleMessageIds).toHaveLength(0); // c2 会话没被串台
  });
});

// ============================================================================
// 生命周期
// ============================================================================

describe('组件：卸载退订', () => {
  test('反复挂卸不累积监听器', () => {
    const h = mountPanel();
    // task_046 起抽屉嵌挂任务输出面板，它吃同一份 subscribe（各自订阅各自退订）→ 2 条。
    expect(h.subscriberCount()).toBe(2);
    h.unmount();
    expect(h.subscriberCount()).toBe(0);
  });
});

// ============================================================================
// 嵌挂的任务输出面板（task_046）
// ============================================================================

describe('组件：嵌挂任务输出面板（task_046）', () => {
  test('抽屉携带嵌挂面板，open 切上下文时同步 showFor', () => {
    const h = mountPanel();
    const taskOutput = h.panel.taskOutput;
    expect(taskOutput).not.toBeNull();
    expect(taskOutput?.characterId).toBeNull();
    h.panel.open('c1');
    expect(taskOutput?.characterId).toBe('c1');
    h.panel.setCharacter('c2');
    expect(taskOutput?.characterId).toBe('c2');
    // 流式端口随嵌挂可用（组合根经 taskOutput 接 onTaskChunk）
    h.emit(makeState({ tasks: [{
      id: 'task-1', characterId: 'c2', prompt: 'p', status: 'running',
      createdAt: 1, startedAt: 1, endedAt: null, output: '',
    }] }));
    taskOutput?.appendTaskOutput('c2', '流');
    expect(taskOutput?.outputText).toBe('流');
    h.unmount();
  });
});

// ============================================================================
// DEMO 假流（演示路径 —— 正式数据 035 接）
// ============================================================================

describe('DEMO 假流：定时器驱动的发送 → 流式 → 收束', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('splitDemoReply 按码点切 chunk（不切半个汉字）', () => {
    expect(splitDemoReply('abcdef', 3)).toEqual(['abc', 'def']);
    expect(splitDemoReply('你好世界', 3)).toEqual(['你好世', '界']);
    expect(splitDemoReply('', 3)).toEqual([]);
  });

  test('发送后：延迟首发 → 逐 chunk appendStream → finalize + 解锁输入', () => {
    const h = mountPanel();
    h.panel.open('c1');
    // DEMO 装配：把假流回调当 onSend 注入（正式装配由 035 换成 chat-service）。
    // 重设 deps 不会重复订阅（组件有 _unsubscribe 守卫），只换掉发送回调。
    const demoOnSend = createDemoOnSend(() => h.panel, { startDelayMs: 100, chunkIntervalMs: 50 });
    h.panel.deps = {
      subscribe: () => () => {},
      onSend: demoOnSend,
    };

    typeDraft(h.panel, '演示一下');
    clickSend(h.panel);

    // user 气泡立即出现；假流回调锁住输入区
    expect(h.panel.sending).toBe(true);
    expect(bubblesOf(h.panel)[0].getAttribute('data-side')).toBe('user');

    jest.advanceTimersByTime(99);
    expect(h.panel.streaming).toBeNull(); // 还没到首发延迟

    jest.advanceTimersByTime(1); // 首发
    expect(h.panel.streaming?.text.length).toBeGreaterThan(0);

    jest.advanceTimersByTime(50); // 第二个 chunk
    const grown = h.panel.streaming?.text.length ?? 0;
    expect(grown).toBeGreaterThan(3);

    jest.runAllTimers(); // 剩余 chunk + finalize
    expect(h.panel.streaming).toBeNull();
    expect(h.panel.sending).toBe(false);
    const committed = messagesBoxOf(h.panel).querySelectorAll('[data-message]');
    expect(committed).toHaveLength(2); // user + 收束后的 assistant
    expect(committed[1].textContent).toContain(DEMO_REPLY_PREFIX); // 假流内容带 DEMO 标记
    expect(h.panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]')?.disabled).toBe(false);

    h.unmount();
  });
});

// ============================================================================
// task_035 追加：错误气泡（重试）与发送中「停止」钮 —— 对话回路的 UI 面
// ============================================================================

describe('组件：错误气泡与停止钮（task_035）', () => {
  test('error 标记的 assistant 消息 → 警示配色气泡 + 内嵌重试钮；点击回调 onRetry(characterId)', () => {
    const h = mountPanel();
    h.emit(makeState({ characters: [character('c1')], units: [unit('u1', 'c1')] }));
    h.panel.open('c1');

    h.panel.addMessage({ characterId: 'c1', role: 'user', text: '在吗' });
    h.panel.addMessage({ characterId: 'c1', role: 'assistant', text: '⚠ 调用超时：等太久', error: true });

    const bubbles = bubblesOf(h.panel);
    expect(bubbles).toHaveLength(2);
    const errorBubble = bubbles[1];
    expect(errorBubble.getAttribute('data-error')).toBe('true');

    const retry = errorBubble.querySelector<HTMLButtonElement>('[data-role="retry"]');
    expect(retry?.textContent).toBe('重试');
    retry?.click();
    expect(h.retried).toEqual(['c1']); // 回调带气泡所属角色（不一定是当前查看对象）

    // 重试钮的 data-character 转义过：恶意 id 不逃逸属性域（换个带标记的角色复现）。
    const evilId = 'ev"><script>alert(1)</script>';
    h.emit(makeState({ characters: [character(evilId), character('c1')], units: [unit('u1', 'c1')] }));
    h.panel.open(evilId);
    h.panel.addMessage({ role: 'assistant', text: '坏 id 的错误', error: true });
    const evilBubble = bubblesOf(h.panel).at(-1);
    const evilButton = evilBubble?.querySelector<HTMLElement>('[data-role="retry"]');
    // 转义的目标是**结构安全**：属性域没被括号炸弹擑开 —— 没有真的 script 元素被建出来；
    // 而 dataset 读回来是原 id（回调路由需要原文，不能转义两次）。
    expect(evilBubble?.querySelector('script')).toBeNull();
    expect(evilButton?.dataset.character).toBe(evilId);
    evilButton?.click();
    expect(h.retried.at(-1)).toBe(evilId); // 重试回调路由到原 id
    h.unmount();
  });

  test('停止钮只在发送中出现；点击回调 onStop(当前查看角色)；缺省 deps 不炸', () => {
    const h = mountPanel();
    h.emit(makeState({ characters: [character('c1')], units: [unit('u1', 'c1')] }));
    h.panel.open('c1');

    const stop = h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="stop"]');
    expect(stop).toBeTruthy();
    expect(stop?.hidden).toBe(true); // 平时隐藏

    h.panel.setSending(true);
    const visibleStop = h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="stop"]');
    expect(visibleStop?.hidden).toBe(false);
    visibleStop?.click();
    expect(h.stopped).toEqual(['c1']);

    h.panel.setSending(false);
    expect(h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="stop"]')?.hidden).toBe(true);

    // 未发送时点不到；没接 onStop 的组件（纯 UI 演示路径）也不炸。
    visibleStop?.click();
    expect(h.stopped).toEqual(['c1']);
    h.unmount();
  });

  test('会话存储：error 标记随消息落库（重渲染不丢）', () => {
    const store = createCharacterChatSessions({ nextId: () => 'm1', now: () => 1 });
    store.setViewing('a');
    const committed = store.addMessage({ role: 'assistant', text: '⚠ 调用超时', error: true });
    expect(committed?.error).toBe(true);
    expect(store.messages('a')[0]?.error).toBe(true);
    // 普通消息不带标记。
    expect(store.addMessage({ role: 'user', text: '好的' })?.error).toBeUndefined();
  });
});

// ============================================================================
// task_036 追加：历史回填（打开 / 切角色 → loadHistory → 会话存储）
// ============================================================================

describe('组件：历史回填（task_036）', () => {
  /** 排空微任务：loadHistory 的 then 要落定后才好断言。 */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  const history = [
    { characterId: 'c1', role: 'user' as const, text: '上次问的', at: 1 },
    { characterId: 'c1', role: 'assistant' as const, text: '上次答的', at: 2 },
    { characterId: 'c1', role: 'assistant' as const, text: '上次炸的', error: true, at: 3 },
  ];

  test('open(角色) 拉取并按序回填；error 条目渲染成错误气泡（data-error + 重试钮）', async () => {
    const h = mountPanel(undefined, { loadHistory: async () => history });
    h.panel.open('c1');
    await flush();

    expect(h.historyRequested).toEqual(['c1']);
    expect(h.panel.visibleMessageIds).toHaveLength(3);
    const bubbles = bubblesOf(h.panel);
    expect(bubbles.map((b) => b.getAttribute('data-side'))).toEqual(['user', 'assistant', 'assistant']);
    expect(bubbles[2].getAttribute('data-error')).toBe('true'); // role=error → 错误样式路径
    expect(bubbles[2].querySelector('[data-role="retry"]')).toBeTruthy();
    expect(messagesBoxOf(h.panel).textContent).toContain('上次答的');
    h.unmount();
  });

  test('切角色逐角色拉取；重复 open / 切回不重复拉、不重复回填', async () => {
    const h = mountPanel(undefined, {
      loadHistory: async (id) => (id === 'c1' ? history : [{ role: 'user', text: 'B 的历史' }]),
    });
    h.panel.open('c1');
    await flush();
    h.panel.setCharacter('c2');
    await flush();
    expect(h.historyRequested).toEqual(['c1', 'c2']);
    expect(messagesBoxOf(h.panel).textContent).toContain('B 的历史');

    // 切回 c1：历史已在内存，不再发请求，也不重复回填
    h.panel.setCharacter('c1');
    await flush();
    h.panel.close();
    h.panel.open('c1');
    await flush();
    expect(h.historyRequested).toEqual(['c1', 'c2']);
    expect(h.panel.visibleMessageIds).toHaveLength(3);
    h.unmount();
  });

  test('内存会话非空（本轮已有消息）→ 不请求：内存是超集，回填只会重复', async () => {
    const h = mountPanel(undefined, { loadHistory: async () => history });
    h.panel.open('c1');
    await flush(); // 第一次已回填
    h.panel.addMessage({ characterId: 'c9', role: 'user', text: '本轮说的' });

    h.panel.setCharacter('c9');
    await flush();
    expect(h.historyRequested).toEqual(['c1']); // c9 内存非空，不拉
    expect(messagesBoxOf(h.panel).textContent).toContain('本轮说的');
    h.unmount();
  });

  test('流式缓冲态不回填：流结束后（内存非空）后续打开也不叠加 —— 历史被本轮消息吸收', async () => {
    let resolveHistory!: (entries: readonly {
      characterId?: string; role: 'user' | 'assistant'; text: string; error?: boolean; at?: number;
    }[]) => void;
    const h = mountPanel(undefined, {
      loadHistory: () => new Promise((resolve) => { resolveHistory = resolve; }),
    });
    h.panel.open('c1');
    h.panel.appendStream('流还在跑'); // 加载期间目标角色起了流
    await flush();
    resolveHistory(history);
    await flush();

    expect(h.panel.visibleMessageIds).toHaveLength(0); // 没回填
    h.panel.finalizeStream(); // 流收束 → 内存非空
    h.panel.close();
    h.panel.open('c1');
    await flush();
    expect(h.panel.visibleMessageIds).toHaveLength(1); // 只有收束的那条，历史不再叠加
    h.unmount();
  });

  test('加载竞态：期间用户已发言 → 丢弃本次（不把历史叠在新消息后面）', async () => {
    let resolveHistory!: (entries: readonly {
      characterId?: string; role: 'user' | 'assistant'; text: string; error?: boolean; at?: number;
    }[]) => void;
    const h = mountPanel(undefined, {
      loadHistory: () => new Promise((resolve) => { resolveHistory = resolve; }),
    });
    h.panel.open('c1');
    h.panel.addMessage({ characterId: 'c1', role: 'user', text: '插进来的新消息' });
    resolveHistory(history);
    await flush();

    expect(h.panel.visibleMessageIds).toHaveLength(1); // 只有新消息
    expect(messagesBoxOf(h.panel).textContent).not.toContain('上次问的');
    h.unmount();
  });

  test('加载失败静默放弃：空会话照常可用，下次打开重试', async () => {
    let fails = true;
    const h = mountPanel(undefined, {
      loadHistory: async () => {
        if (fails) throw new Error('IPC 不通');
        return history;
      },
    });
    h.panel.open('c1');
    await flush();
    expect(h.panel.visibleMessageIds).toHaveLength(0); // 静默降级，不炸

    fails = false;
    h.panel.close();
    h.panel.open('c1'); // 未标记：下次打开重试
    await flush();
    expect(h.panel.visibleMessageIds).toHaveLength(3);
    h.unmount();
  });

  test('回填归属钉死到请求的角色：loader 返回的 characterId 不被信任', async () => {
    const h = mountPanel(undefined, {
      loadHistory: async () => [{ characterId: '别的角色', role: 'user', text: '串台的' }],
    });
    h.panel.setCharacter('c1');
    await flush();
    expect(h.panel.sessionCharacterIds).toEqual(['c1']); // 只落在 c1 名下
    expect(h.panel.visibleMessageIds).toHaveLength(1);
    h.unmount();
  });
});
