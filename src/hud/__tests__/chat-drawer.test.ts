/**
 * 集成测试：聊天抽屉（hud/panels/chat-drawer.ts + chat-catalog.ts）。
 * 覆盖：WorldState 驱动渲染（会话列表 / 消息流 / 连接状态）、会话切换、
 *   输入与发送 → HudCommand 派发、消息截尾、卸载退订、纯派生函数，
 *   以及**整条闭环**：输入发送 → HudCommand → core(agent-link) → WorldState.messages 广播 → 面板重渲染。
 * @jest-environment jsdom
 *
 * 闭环那一段不打桩总线也不打桩会话：emitCommand / createCoreRuntime / HudBusAdapter /
 *   core/agent-link 的 Manager 全是真件，只有远端 agent 用 gateway-double（协议层替身，
 *   它按真实帧格式校验收发并自动应答 'ack:<text>'，见 core/agent-link/__tests__/helpers）。
 *   断掉的是"面板自己往消息流里塞气泡"这条捷径 —— 面板一行都不许本地加消息，
 *   气泡出现与否完全由 core 回广播决定。
 */

import { emitCommand, resetBus } from '../../core/bus';
import { createGatewayDouble } from '../../core/agent-link/__tests__/helpers/gateway-double';
import { createAgentLinkManager, type AgentLinkManager } from '../../core/agent-link/manager';
import { createCoreRuntime } from '../../core/runtime';
import { createStore } from '../../core/store';
import type {
  AgentLinkKind,
  AgentLinkPhase,
  AgentLinkView,
  AgentMessageView,
  HudCommand,
  WorldState,
} from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import type { ThemeController } from '../theme/theme-controller';

import {
  buildChatSendCommand,
  chatDrawerSignature,
  MAX_VISIBLE_MESSAGES,
  PHASE_LABELS,
  resolveActiveLinkId,
  resolveChatDrawer,
} from '../panels/chat-catalog';
import {
  CHAT_DRAWER_TAG,
  mountChatDrawer,
  type ChatDrawerDeps,
  type StratChatDrawerElement,
} from '../panels/chat-drawer';

const ENDPOINT = 'http://127.0.0.1:18080';
const ENDPOINT_B = 'http://127.0.0.1:18081';
/** 会话建链/应答都压到毫秒级：闭环测试等的是 settle(0)，不等真实网络超时。 */
const TIMING = { requestTimeoutMs: 200, connectTimeoutMs: 200, baseReconnectDelayMs: 1 };

// ============================================================================
// 夹具
// ============================================================================

function link(patch: Partial<AgentLinkView> & { id: string }): AgentLinkView {
  return {
    kind: 'openclaw',
    displayName: patch.id,
    phase: 'connected',
    phaseReason: null,
    agentId: null,
    sessionId: null,
    endpoint: 'ws://127.0.0.1:18080/ws?token=***',
    connectedAt: 1000,
    lastError: null,
    ...patch,
  };
}

function message(patch: Partial<AgentMessageView> & { id: string }): AgentMessageView {
  return {
    linkId: 'link-1',
    direction: 'outbound',
    author: 'you',
    text: `消息 ${patch.id}`,
    at: 1_700_000_000_000,
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

interface Harness {
  readonly panel: StratChatDrawerElement;
  readonly host: HTMLElement;
  readonly commands: HudCommand[];
  /** core 广播一份新状态（走 adapter.subscribe 的真实订阅链）。 */
  emit(state: WorldState): void;
  subscriberCount(): number;
  unmount(): void;
}

function mountPanel(): Harness {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const deps: ChatDrawerDeps = {
    dispatch: (command) => { commands.push(command); },
    subscribe: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountPanel = mountChatDrawer(deps, host);
  const panel = host.querySelector(CHAT_DRAWER_TAG) as StratChatDrawerElement;
  if (!panel?.shadowRoot) throw new Error('聊天抽屉未 upgrade（shadowRoot 为空）');

  return {
    panel,
    host,
    commands,
    emit: (state) => { subs.forEach((handler) => handler(state)); },
    subscriberCount: () => subs.size,
    unmount: () => { unmountPanel(); host.remove(); },
  };
}

/** 进 shadow DOM 打字：走组件自己的事件链，不直接设属性绕过 input 监听。 */
function typeDraft(panel: StratChatDrawerElement, text: string): void {
  const box = panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
  if (!box) throw new Error('输入框未渲染');
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 点真实发送按钮。 */
function clickSend(panel: StratChatDrawerElement): void {
  const button = panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]');
  if (!button) throw new Error('发送按钮未渲染');
  button.click();
}

/** 在输入框里按 Enter（语义提取自旧 AgentChatModal：Enter 发送、Shift+Enter 换行）。 */
function pressEnter(panel: StratChatDrawerElement, shiftKey = false): void {
  const box = panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
  if (!box) throw new Error('输入框未渲染');
  const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true });
  box.dispatchEvent(event);
}

function clickSession(panel: StratChatDrawerElement, linkId: string): void {
  const button = panel.shadowRoot?.querySelector<HTMLButtonElement>(`button[data-link="${linkId}"]`);
  if (!button) throw new Error(`会话按钮未渲染: ${linkId}`);
  button.click();
}

function statusOf(panel: StratChatDrawerElement): { text: string; tone: string | null } {
  const el = panel.shadowRoot?.querySelector('[data-role="status"]');
  return { text: el?.textContent ?? '', tone: el?.getAttribute('data-tone') ?? null };
}

function messagesOf(panel: StratChatDrawerElement): HTMLElement[] {
  return Array.from(panel.shadowRoot?.querySelectorAll<HTMLElement>('[data-message]') ?? []);
}

// ============================================================================
// 纯函数：WorldState → 视图模型
// ============================================================================

describe('WorldState → 抽屉视图模型（纯函数）', () => {
  test('会话列表按 core 顺序展开，连接相位翻成标签与色调', () => {
    const model = resolveChatDrawer(makeState({
      links: [
        link({ id: 'link-1', displayName: 'Writer', phase: 'connected' }),
        link({ id: 'link-2', displayName: 'Reviewer', phase: 'connecting' }),
        link({ id: 'link-3', displayName: 'Broken', phase: 'error', lastError: 'gateway refused' }),
      ],
    }), null);

    expect(model.sessions.map((row) => row.displayName)).toEqual(['Writer', 'Reviewer', 'Broken']);
    expect(model.sessions.map((row) => row.phaseLabel)).toEqual(['在线', '连接中', '连接异常']);
    expect(model.sessions.map((row) => row.tone)).toEqual(['online', 'pending', 'error']);
    // 未显式选择时回落到第一个会话，不让面板停在"什么都没选"
    expect(model.active?.id).toBe('link-1');
  });

  test('相位词表与 AgentLinkPhase 一一对应（core 判相位，HUD 只负责念出来）', () => {
    const phases: AgentLinkPhase[] = ['idle', 'connecting', 'connected', 'reconnecting', 'closing', 'closed', 'error'];
    expect(Object.keys(PHASE_LABELS).sort()).toEqual([...phases].sort());
    expect(PHASE_LABELS.connected).toBe('在线');
    expect(PHASE_LABELS.connecting).toBe('连接中');
    expect(PHASE_LABELS.closed).toBe('已断开');
  });

  test('只有 connected 会话可发送，其余给出人话禁用理由', () => {
    const connected = resolveChatDrawer(makeState({ links: [link({ id: 'l1', phase: 'connected' })] }), null);
    expect(connected.canSend).toBe(true);
    expect(connected.sendDisabledReason).toBeNull();

    const connecting = resolveChatDrawer(makeState({ links: [link({ id: 'l1', phase: 'connecting' })] }), null);
    expect(connecting.canSend).toBe(false);
    expect(connecting.sendDisabledReason).toContain('连接中');

    const failed = resolveChatDrawer(
      makeState({ links: [link({ id: 'l1', phase: 'error', lastError: 'gateway refused' })] }),
      null
    );
    expect(failed.sendDisabledReason).toContain('gateway refused');
  });

  test('无会话：空模型 + 明确理由（不编造会话）', () => {
    const model = resolveChatDrawer(makeState(), null);
    expect(model.sessions).toEqual([]);
    expect(model.active).toBeNull();
    expect(model.canSend).toBe(false);
    expect(model.sendDisabledReason).toBe('还没有外部 agent 会话');
  });

  test('消息只取当前会话的那一段（别的 agent 在聊天不该冒到眼前）', () => {
    const model = resolveChatDrawer(makeState({
      links: [link({ id: 'link-1' }), link({ id: 'link-2' })],
      messages: [
        message({ id: 'm1', linkId: 'link-1' }),
        message({ id: 'm2', linkId: 'link-2', text: '别人的对话' }),
        message({ id: 'm3', linkId: 'link-1', direction: 'inbound', author: 'agent-1', text: '收到' }),
      ],
    }), 'link-1');

    expect(model.messages.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(model.messages.map((m) => m.direction)).toEqual(['outbound', 'inbound']);
  });

  test('切到另一个会话 → 消息流跟着换', () => {
    const state = makeState({
      links: [link({ id: 'link-1' }), link({ id: 'link-2' })],
      messages: [
        message({ id: 'm1', linkId: 'link-1' }),
        message({ id: 'm2', linkId: 'link-2', direction: 'inbound', author: 'agent-2' }),
      ],
    });
    expect(resolveChatDrawer(state, 'link-2').messages.map((m) => m.id)).toEqual(['m2']);
    expect(resolveChatDrawer(state, 'link-2').sessions.find((row) => row.id === 'link-2')?.active).toBe(true);
  });

  test('选中的会话已消失 → 回落到第一个，不停在幽灵会话上', () => {
    const links = [link({ id: 'link-1' }), link({ id: 'link-2' })];
    expect(resolveActiveLinkId(links, 'link-gone')).toBe('link-1');
    expect(resolveActiveLinkId(links, 'link-2')).toBe('link-2');
    expect(resolveActiveLinkId([], 'link-2')).toBeNull();
    expect(resolveChatDrawer(makeState({ links: [link({ id: 'link-1' })] }), 'gone').active?.id).toBe('link-1');
  });

  test('长会话截尾：只渲染最近 MAX_VISIBLE_MESSAGES 条，其余只报条数', () => {
    const many = Array.from({ length: MAX_VISIBLE_MESSAGES + 7 }, (_, i) =>
      message({ id: `m${i}`, text: `t${i}` })
    );
    const model = resolveChatDrawer(makeState({ links: [link({ id: 'link-1' })], messages: many }), 'link-1');

    expect(model.messages).toHaveLength(MAX_VISIBLE_MESSAGES);
    expect(model.hiddenMessages).toBe(7);
    // 保留最新的一条、丢掉最早的一条（core 已按契约裁过，这里再截一段控 DOM 体积）
    expect(model.messages[model.messages.length - 1].id).toBe(`m${MAX_VISIBLE_MESSAGES + 6}`);
  });
});

describe('渲染签名：无关变动不重绘', () => {
  test('当前会话的消息 / 会话相位 / 查看对象任一变化才改签名', () => {
    const base = makeState({
      links: [link({ id: 'link-1' }), link({ id: 'link-2' })],
      messages: [message({ id: 'm1' })],
    });
    const same = chatDrawerSignature(base, 'link-1');
    expect(chatDrawerSignature(makeState({
      links: [link({ id: 'link-1' }), link({ id: 'link-2' })],
      messages: [message({ id: 'm1' })],
    }), 'link-1')).toBe(same);

    expect(chatDrawerSignature(makeState({
      links: [link({ id: 'link-1' }), link({ id: 'link-2' })],
      messages: [message({ id: 'm1' }), message({ id: 'm2' })],
    }), 'link-1')).not.toBe(same);

    expect(chatDrawerSignature(makeState({
      links: [link({ id: 'link-1', phase: 'reconnecting' }), link({ id: 'link-2' })],
      messages: [message({ id: 'm1' })],
    }), 'link-1')).not.toBe(same);

    // 查看对象变了：消息是按会话过滤的，换个会话看的就是另一段
    expect(chatDrawerSignature(base, 'link-2')).not.toBe(same);
  });

  test('别的会话来消息不影响本面板签名（别人聊天不必重渲染我）', () => {
    const base = makeState({ links: [link({ id: 'link-1' }), link({ id: 'link-2' })] });
    const otherTalks = makeState({
      links: [link({ id: 'link-1' }), link({ id: 'link-2' })],
      messages: [message({ id: 'm2', linkId: 'link-2' })],
    });
    expect(chatDrawerSignature(otherTalks, 'link-1')).toBe(chatDrawerSignature(base, 'link-1'));
  });
});

describe('命令构造：空消息 / 无目标会话都不发', () => {
  test('正常构造：trim 后带 linkId（多会话时 core 才不会拒投）', () => {
    expect(buildChatSendCommand('  hi  ', 'link-1')).toEqual({ type: 'chat.send', text: 'hi', linkId: 'link-1' });
  });

  test('空白消息构造不出命令', () => {
    expect(buildChatSendCommand('', 'link-1')).toBeNull();
    expect(buildChatSendCommand('   \n ', 'link-1')).toBeNull();
  });

  test('没有目标会话构造不出命令（不投给未知 agent）', () => {
    expect(buildChatSendCommand('hi', null)).toBeNull();
    expect(buildChatSendCommand('hi', '')).toBeNull();
  });
});

// ============================================================================
// 面板：渲染与派发
// ============================================================================

describe('面板：渲染 / 会话切换 / 发送', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('会话列表 + 消息流 + 连接状态由 WorldState 驱动', () => {
    h = mountPanel();
    h.emit(makeState({
      links: [
        link({ id: 'link-1', displayName: 'Writer', kind: 'claude-code' }),
        link({ id: 'link-2', displayName: 'Reviewer', phase: 'connecting' }),
      ],
      messages: [
        message({ id: 'm1', text: '开工了' }),
        message({ id: 'm2', direction: 'inbound', author: 'agent-1', text: '收到，马上开始' }),
      ],
    }));

    expect(h.panel.visibleSessionIds).toEqual(['link-1', 'link-2']);
    expect(h.panel.visibleMessageIds).toEqual(['m1', 'm2']);
    expect(statusOf(h.panel).text).toBe('在线');
    expect(statusOf(h.panel).tone).toBe('online');

    const bubbles = messagesOf(h.panel);
    expect(bubbles[0].getAttribute('data-direction')).toBe('outbound');
    expect(bubbles[1].getAttribute('data-direction')).toBe('inbound');
    expect(bubbles[1].textContent).toContain('收到，马上开始');
  });

  test('连接中 / 已断开会话：状态标签与色调跟着 core 相位走', () => {
    h = mountPanel();
    h.emit(makeState({ links: [link({ id: 'link-1', phase: 'connecting' })] }));
    expect(statusOf(h.panel)).toEqual({ text: '连接中', tone: 'pending' });

    h.emit(makeState({ links: [link({ id: 'link-1', phase: 'closed' })] }));
    expect(statusOf(h.panel)).toEqual({ text: '已断开', tone: 'offline' });

    h.emit(makeState({ links: [link({ id: 'link-1', phase: 'error', lastError: 'gateway refused' })] }));
    expect(statusOf(h.panel)).toEqual({ text: '连接异常', tone: 'error' });
  });

  test('无会话：给引导文案，发送按钮禁用并说明原因', () => {
    h = mountPanel();
    h.emit(makeState());

    expect(h.panel.shadowRoot?.querySelector('[data-role="empty"]')?.textContent).toContain('还没有外部 agent 会话');
    const send = h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]');
    expect(send?.disabled).toBe(true);
    expect(h.panel.shadowRoot?.querySelector('[data-role="send-hint"]')?.textContent).toBe('还没有外部 agent 会话');
  });

  test('会话切换：点另一段对话 → 消息流换段、状态换相位（不发命令，纯展示态）', () => {
    h = mountPanel();
    h.emit(makeState({
      links: [link({ id: 'link-1' }), link({ id: 'link-2', displayName: 'Reviewer', phase: 'connecting' })],
      messages: [
        message({ id: 'm1', linkId: 'link-1', text: '给 Writer 的' }),
        message({ id: 'm2', linkId: 'link-2', direction: 'inbound', author: 'agent-2', text: '给 Reviewer 的' }),
      ],
    }));
    expect(h.panel.visibleMessageIds).toEqual(['m1']);

    clickSession(h.panel, 'link-2');

    expect(h.panel.visibleMessageIds).toEqual(['m2']);
    expect(statusOf(h.panel).text).toBe('连接中');
    expect(h.commands).toHaveLength(0); // 换会话是展示态，不是业务变更
  });

  test('输入 + 点发送 → chat.send(带 linkId)；发完清空输入框', () => {
    h = mountPanel();
    h.emit(makeState({ links: [link({ id: 'link-1' }), link({ id: 'link-2' })] }));

    typeDraft(h.panel, '  检查城墙  ');
    expect(h.panel.draft).toBe('  检查城墙  ');
    clickSend(h.panel);

    expect(h.commands).toEqual([{ type: 'chat.send', text: '检查城墙', linkId: 'link-1' }]);
    expect(h.panel.draft).toBe('');
    expect(h.panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]')?.value).toBe('');
  });

  test('发送总是带当前会话 id（多会话时 core 不会因为"目标不明"拒投）', () => {
    h = mountPanel();
    h.emit(makeState({ links: [link({ id: 'link-1' }), link({ id: 'link-2' })] }));

    clickSession(h.panel, 'link-2');
    typeDraft(h.panel, 'ping');
    clickSend(h.panel);

    expect(h.commands).toEqual([{ type: 'chat.send', text: 'ping', linkId: 'link-2' }]);
  });

  test('Enter 发送；Shift+Enter 只换行不发送', () => {
    h = mountPanel();
    h.emit(makeState({ links: [link({ id: 'link-1' })] }));

    typeDraft(h.panel, '回车即发');
    pressEnter(h.panel);
    expect(h.commands).toEqual([{ type: 'chat.send', text: '回车即发', linkId: 'link-1' }]);

    typeDraft(h.panel, '换行继续写');
    pressEnter(h.panel, true);
    expect(h.commands).toHaveLength(1);
    expect(h.panel.draft).toBe('换行继续写');
  });

  test('空消息不构造命令（不发半截命令给 core）', () => {
    h = mountPanel();
    h.emit(makeState({ links: [link({ id: 'link-1' })] }));

    typeDraft(h.panel, '   ');
    clickSend(h.panel);
    pressEnter(h.panel);

    expect(h.commands).toEqual([]);
  });

  test('会话未连接时发送按钮禁用（能力判定与 core 一致：只有 connected 发得出去）', () => {
    h = mountPanel();
    h.emit(makeState({ links: [link({ id: 'link-1', phase: 'connecting' })] }));

    typeDraft(h.panel, '还没连上');
    const send = h.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]');
    expect(send?.disabled).toBe(true);

    clickSend(h.panel);
    pressEnter(h.panel);
    expect(h.commands).toEqual([]);
  });

  test('面板不做本地乐观回显：发出后气泡要等 core 广播才出现', () => {
    h = mountPanel();
    h.emit(makeState({ links: [link({ id: 'link-1' })] }));

    typeDraft(h.panel, '本端这条');
    clickSend(h.panel);

    expect(h.commands).toHaveLength(1);
    expect(h.panel.visibleMessageIds).toEqual([]); // 本地没塞气泡

    // core 把消息投影回 WorldState 后才渲染
    h.emit(makeState({
      links: [link({ id: 'link-1' })],
      messages: [message({ id: 'm1', text: '本端这条' })],
    }));
    expect(h.panel.visibleMessageIds).toEqual(['m1']);
  });

  test('agent 应答是增量渲染：新气泡追加进来，旧消息不清空', () => {
    h = mountPanel();
    h.emit(makeState({
      links: [link({ id: 'link-1' })],
      messages: [message({ id: 'm1', text: '第一句' })],
    }));
    expect(messagesOf(h.panel)).toHaveLength(1);

    h.emit(makeState({
      links: [link({ id: 'link-1' })],
      messages: [
        message({ id: 'm1', text: '第一句' }),
        message({ id: 'm2', direction: 'inbound', author: 'agent-1', text: '第二句' }),
      ],
    }));

    // 前一条原样保留（不是整段清空重画），后一条按 inbound 方向追加
    expect(h.panel.visibleMessageIds).toEqual(['m1', 'm2']);
    expect(messagesOf(h.panel)[0].textContent).toContain('第一句');
    expect(messagesOf(h.panel)[1].textContent).toContain('第二句');
    expect(messagesOf(h.panel)[1].getAttribute('data-direction')).toBe('inbound');
  });

  test('消息正文按纯文本渲染（外部内容不当作 HTML 执行）', () => {
    h = mountPanel();
    h.emit(makeState({
      links: [link({ id: 'link-1' })],
      messages: [message({ id: 'm1', text: '<img src=x onerror="alert(1)">' })],
    }));

    expect(h.panel.shadowRoot?.querySelector('img')).toBeNull();
    expect(messagesOf(h.panel)[0].textContent).toContain('<img src=x onerror="alert(1)">');
  });

  test('长会话在面板侧截尾并提示未显示条数', () => {
    h = mountPanel();
    const many = Array.from({ length: MAX_VISIBLE_MESSAGES + 3 }, (_, i) => message({ id: `m${i}`, text: `t${i}` }));
    h.emit(makeState({ links: [link({ id: 'link-1' })], messages: many }));

    expect(h.panel.visibleMessageIds).toHaveLength(MAX_VISIBLE_MESSAGES);
    expect(h.panel.shadowRoot?.querySelector('[data-role="hidden"]')?.textContent).toContain('3 条未显示');
  });

  test('打字不重绘消息流（签名判重：输入不进签名）', () => {
    h = mountPanel();
    h.emit(makeState({ links: [link({ id: 'link-1' })] }));
    const before = messagesOf(h.panel)[0];

    typeDraft(h.panel, '正在输入');

    expect(messagesOf(h.panel)[0]).toBe(before); // 同一个节点，没被重建
    expect(h.panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]')?.value).toBe('正在输入');
  });

  test('卸载后退订（反复挂卸不累积监听器）', () => {
    h = mountPanel();
    expect(h.subscriberCount()).toBe(1);
    h.unmount();
    expect(h.subscriberCount()).toBe(0);
    h = undefined as unknown as Harness;
  });
});

// ============================================================================
// 闭环：HudCommand → core(agent-link) → WorldState 广播 → 面板
// ============================================================================

interface LoopHarness {
  readonly panel: StratChatDrawerElement;
  readonly manager: AgentLinkManager;
  readonly gateway: ReturnType<typeof createGatewayDouble>;
  stop(): Promise<void>;
}

const themeController: ThemeController = {
  apply: () => {},
  get current(): null { return null; },
};

function settle(ms = 10): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function mountLoop(gatewayOptions: Parameters<typeof createGatewayDouble>[0] = {}): LoopHarness {
  const gateway = createGatewayDouble({ deviceId: 'dev-1', ...gatewayOptions });
  const store = createStore();
  const manager = createAgentLinkManager({ transport: gateway.transport, store, timing: TIMING });
  const runtime = createCoreRuntime({ store, agentLink: manager });
  const adapter = createHudBusAdapter({ themeController });
  const unmountAdapter = adapter.mount();
  const stopRuntime = runtime.start();

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountPanel = mountChatDrawer(adapter, host);
  const panel = host.querySelector(CHAT_DRAWER_TAG) as StratChatDrawerElement;

  return {
    panel,
    manager,
    gateway,
    stop: async () => {
      unmountPanel();
      host.remove();
      stopRuntime();
      unmountAdapter();
      await manager.dispose();
    },
  };
}

let loops: LoopHarness[] = [];

beforeEach(() => {
  resetBus();
  loops = [];
});

afterEach(async () => {
  await Promise.all(loops.map((loop) => loop.stop()));
  loops = [];
  resetBus();
});

describe('闭环：发送 → core 会话 → 消息流广播 → 面板增量渲染', () => {
  test('建链 → 输入 → 发送 → 本端回显 → agent 应答进消息流（真总线 + 真 runtime + 真 agent-link）', async () => {
    const loop = mountLoop();
    loops.push(loop);

    // 1. 建链：core/agent-link 把会话投影进 WorldState，抽屉显示"在线"
    emitCommand({ type: 'link.open', kind: 'openclaw', endpoint: ENDPOINT, displayName: 'Writer' });
    await settle();
    expect(loop.panel.visibleSessionIds).toHaveLength(1);
    expect(statusOf(loop.panel).text).toBe('在线');

    // 2. 输入并发送：抽屉只发 HudCommand，消息流归 core 管
    typeDraft(loop.panel, 'ping');
    expect(loop.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]')?.disabled).toBe(false);
    clickSend(loop.panel);

    // 3. 命令总线是同步的：click 返回时 core 已把本端气泡投影进 WorldState 并广播回来，
    //    面板增量渲染出这一条 —— 整条链路 一个 HudCommand → core 状态 → WorldState → 面板
    expect(loop.panel.visibleMessageIds).toHaveLength(1);
    const outbound = messagesOf(loop.panel)[0];
    expect(outbound.getAttribute('data-direction')).toBe('outbound');
    expect(outbound.textContent).toContain('ping');

    // 4. 远端 agent 应答（gateway-double 按协议回 'ack:ping'）→ 同一条链路增量多出一条气泡
    await settle();
    expect(loop.panel.visibleMessageIds).toHaveLength(2);
    const inbound = messagesOf(loop.panel)[1];
    expect(inbound.getAttribute('data-direction')).toBe('inbound');
    expect(inbound.textContent).toContain('ack:ping');

    // 协议侧确实按 chat.send 的形状发出去了（帧走的是真编解码）
    const sent = loop.gateway.sentFrames().filter((frame) => frame.type === 'text');
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toBe('ping');
  });

  test('断开（closed）后发送按钮禁用，状态显示"已断开"', async () => {
    const loop = mountLoop();
    loops.push(loop);

    emitCommand({ type: 'link.open', kind: 'openclaw', endpoint: ENDPOINT, displayName: 'Writer' });
    await settle();
    expect(statusOf(loop.panel).text).toBe('在线');

    emitCommand({ type: 'link.close', linkId: loop.manager.list()[0].id });
    await settle();

    expect(statusOf(loop.panel)).toEqual({ text: '已断开', tone: 'offline' });
    typeDraft(loop.panel, '还有人吗');
    expect(loop.panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]')?.disabled).toBe(true);
    expect(loop.panel.shadowRoot?.querySelector('[data-role="send-hint"]')?.textContent).toContain('已断开');
  });

  test('两个会话：消息各归各家，切换看各自那段（不串台）', async () => {
    const loop = mountLoop();
    loops.push(loop);

    emitCommand({ type: 'link.open', kind: 'openclaw', endpoint: ENDPOINT, displayName: 'Writer' });
    await settle();
    emitCommand({ type: 'link.open', kind: 'claude-code', endpoint: ENDPOINT_B, displayName: 'Reviewer' });
    await settle();
    expect(loop.panel.visibleSessionIds).toHaveLength(2);

    const [writer, reviewer] = loop.manager.list();

    // 两个会话各发一条（抽屉显式带 linkId，多会话下 core 不会拒投）
    emitCommand({ type: 'chat.send', text: '给 Writer', linkId: writer.id });
    emitCommand({ type: 'chat.send', text: '给 Reviewer', linkId: reviewer.id });
    // gateway-double 对两条都自动应答，于是每个会话各成一对（本端 + agent）
    await settle();

    expect(loop.panel.visibleMessageIds).toHaveLength(2);
    expect(messagesOf(loop.panel)[0].textContent).toContain('给 Writer');
    expect(messagesOf(loop.panel)[0].textContent).not.toContain('给 Reviewer');
    expect(messagesOf(loop.panel)[1].textContent).toContain('ack:给 Writer');

    clickSession(loop.panel, reviewer.id);
    expect(loop.panel.visibleMessageIds).toHaveLength(2);
    expect(messagesOf(loop.panel)[0].textContent).toContain('给 Reviewer');
    expect(messagesOf(loop.panel)[0].textContent).not.toContain('给 Writer');
    expect(statusOf(loop.panel).text).toBe('在线');
  });

  test('远端主动下发的消息（REMOTE_EVENT.message）也进消息流', async () => {
    const loop = mountLoop();
    loops.push(loop);

    emitCommand({ type: 'link.open', kind: 'openclaw', endpoint: ENDPOINT, displayName: 'Writer' });
    await settle();
    const linkId = loop.manager.list()[0].id;

    // 事件名用协议词表里的 REMOTE_EVENT.message（'agent.message'），不是自造名字
    loop.gateway.currentChannel()?.emitEvent('agent.message', { author: 'remote', message: '我在后台' });
    await settle();

    expect(loop.panel.visibleMessageIds).toHaveLength(1);
    expect(messagesOf(loop.panel)[0].textContent).toContain('我在后台');
    expect(loop.manager.messages(linkId)).toHaveLength(1);
  });

  test('AgentLinkKind 原样透传到会话视图（hud 不做 kind 归一）', async () => {
    const loop = mountLoop();
    loops.push(loop);

    const kinds: AgentLinkKind[] = ['openclaw', 'claude-code'];
    for (const kind of kinds) {
      emitCommand({ type: 'link.open', kind, endpoint: ENDPOINT, displayName: `${kind} agent` });
      await settle();
    }

    expect(loop.panel.model.sessions.map((row) => row.kind)).toEqual(kinds);
  });
});