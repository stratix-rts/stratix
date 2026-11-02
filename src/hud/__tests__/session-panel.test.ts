/**
 * 集成测试：会话面板 Web Component（hud/panels/session-panel.ts）。
 * 覆盖：列表渲染 / kind 筛选 / 状态徽标 / 中断命令（session.interrupt）/ 空态三档 /
 *   **历史抽屉的 kind 路由**（四路：角色对话历史 / 会话事件流 / 任务单引用 / 命令行消息投影）/
 *   未附着语义 / 长标题截断 / 卸载释放订阅 / 装配进 main-screen。
 * @jest-environment jsdom
 *
 * 面板是真组件（真 Shadow DOM、真事件链），替身只有两条边界：总线的 subscribe/dispatch
 * 与历史读取口。断言打在"画出了什么 / 点了会怎样"上，不断言像素。
 */

import type { HudCommand, SessionRecord, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import type {
  SessionHistoryEntry,
  SessionHistoryPort,
} from '../panels/session-catalog';
import {
  mountSessionPanel,
  SESSION_PANEL_TAG,
  type SessionPanelDeps,
  type StratSessionPanelElement,
} from '../panels/session-panel';
import { createMainScreen } from '../screens/main-screen';

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

function session(partial: Partial<SessionRecord> & { id: string }): SessionRecord {
  return {
    kind: 'peer_chat',
    title: '互聊：甲 × 乙',
    participants: ['a', 'b'],
    status: 'active',
    createdAt: 1_700_000_000_000,
    lastEventAt: 1_700_000_000_000,
    closedAt: null,
    eventCount: 3,
    ...partial,
  };
}

function entry(partial: Partial<SessionHistoryEntry> & { id: string }): SessionHistoryEntry {
  return {
    cursor: partial.id,
    at: 1_700_000_000_000,
    author: '甲',
    text: '正文',
    tone: 'normal',
    ...partial,
  };
}

interface Harness {
  panel: StratSessionPanelElement;
  /** 广播一份世界状态（走 adapter.subscribe 的真实订阅链）。 */
  emit(state: WorldState): void;
  /** 已发出的命令（面板唯一的写出口）。 */
  commands: HudCommand[];
  subscriberCount(): number;
  unmount(): void;
}

function mountPanel(history?: SessionHistoryPort): Harness {
  const subs = new Set<(state: WorldState) => void>();
  const commands: HudCommand[] = [];
  const deps: SessionPanelDeps = {
    adapter: {
      dispatch: (command) => { commands.push(command); },
      subscribe: (handler) => {
        subs.add(handler);
        return () => { subs.delete(handler); };
      },
    },
    ...(history ? { history } : {}),
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountPanel = mountSessionPanel(deps, host);
  const panel = host.querySelector(SESSION_PANEL_TAG) as StratSessionPanelElement;
  if (!panel?.shadowRoot) throw new Error('会话面板未 upgrade（shadowRoot 为空）');

  return {
    panel,
    commands,
    emit: (state) => { subs.forEach((handler) => handler(state)); },
    subscriberCount: () => subs.size,
    unmount: () => { unmountPanel(); host.remove(); },
  };
}

/** 面板默认折叠；测试要先展开才看得到列表。 */
function expand(panel: StratSessionPanelElement): void {
  if (panel.collapsed) panel.toggleCollapsed();
}

const rows = (panel: StratSessionPanelElement): Element[] =>
  Array.from(panel.shadowRoot?.querySelectorAll('[data-role="row"]') ?? []);

const entries = (panel: StratSessionPanelElement): Element[] =>
  Array.from(panel.shadowRoot?.querySelectorAll('[data-role="entry"]') ?? []);

const textOf = (panel: StratSessionPanelElement, role: string): string | null | undefined =>
  panel.shadowRoot?.querySelector(`[data-role="${role}"]`)?.textContent;

/** 让微任务队列跑完（历史读取是异步的）。 */
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function click(panel: StratSessionPanelElement, selector: string): void {
  const node = panel.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`面板里找不到节点：${selector}`);
  node.click();
}

let mounted: Array<() => void> = [];

afterEach(() => {
  mounted.forEach((dispose) => dispose());
  mounted = [];
  document.body.innerHTML = '';
});

describe('会话列表：渲染', () => {
  test('刚挂载（还没收到 state）显示等待态，不报错', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);

    expect(rows(harness.panel)).toHaveLength(0);
    expect(textOf(harness.panel, 'summary')).toBe('等待世界状态…');
  });

  test('收到会话 → 画出标题 / kind 徽标 / 状态徽标 / 活动时间', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState({
      sessions: [
        session({ id: 's-1', kind: 'peer_chat', title: '互聊：甲 × 乙', status: 'active', eventCount: 5 }),
        session({ id: 's-2', kind: 'character_chat', title: '角色对话：丙', status: 'idle', eventCount: 2 }),
      ],
    }));

    const list = rows(harness.panel);
    expect(list).toHaveLength(2);
    // 最近活动的在前（两条 lastEventAt 相同 → 按 createdAt 兜底，顺序稳定即可断言内容）。
    const titles = list.map((r) => r.querySelector('[data-role="row"]')?.textContent ?? r.textContent);
    expect(titles.join('|')).toContain('互聊：甲 × 乙');
    expect(titles.join('|')).toContain('角色对话：丙');

    const first = list[0];
    expect(first.getAttribute('data-kind')).toBe('peer_chat');
    expect(first.querySelector('.badge[data-kind]')?.textContent).toBe('互聊');
    expect(first.querySelector('[data-role="status-badge"]')?.textContent).toBe('进行中');
    expect(first.querySelector('[data-role="row-meta"]')?.textContent).toContain('5 事件');
  });

  test('长标题截断展示，完整标题仍在 title 属性里', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    const longTitle = '这是一条非常非常长的会话标题用来验证截断行为是否生效';
    harness.emit(makeState({ sessions: [session({ id: 's-1', title: longTitle })] }));

    const titleNode = harness.panel.shadowRoot?.querySelector('[data-role="row"] .row-title');
    expect(titleNode?.textContent?.length).toBeLessThan(longTitle.length);
    expect(titleNode?.textContent?.endsWith('…')).toBe(true);
    expect(titleNode?.getAttribute('title')).toBe(longTitle);
  });

  test('标题里的 HTML 字符被转义，不会变成真标签', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    // 标题长度 ≤ 展示上限（不触发截断），断言的是"转义后仍是纯文本"。
    const hostile = '<img src=x onerror=1>';
    harness.emit(makeState({ sessions: [session({ id: 's-1', title: hostile })] }));

    const row = rows(harness.panel)[0];
    expect(row.textContent).toContain(hostile);
    expect(row.querySelector('img')).toBeNull();
  });
});

describe('筛选：kind 筹码', () => {
  function setup(): Harness {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({
      sessions: [
        session({ id: 's-1', kind: 'peer_chat', title: '互聊一场' }),
        session({ id: 's-2', kind: 'character_chat', title: '角色对话' }),
        session({ id: 's-3', kind: 'shell_link', title: '命令行' }),
      ],
    }));
    return harness;
  }

  test('筹码列出全部 + 五种 kind', () => {
    const harness = setup();
    const chips = Array.from(
      harness.panel.shadowRoot?.querySelectorAll('[data-action="filter"]') ?? []
    );
    expect(chips.map((c) => c.getAttribute('data-kind'))).toEqual([
      'all',
      'character_chat',
      'peer_chat',
      'task_run',
      'mission_run',
      'shell_link',
    ]);
    expect(chips.map((c) => c.textContent)).toEqual(['全部', '聊天', '互聊', '任务', '编队', '连接']);
  });

  test('点某个 kind 筹码 → 只剩该 kind 的行', () => {
    const harness = setup();

    click(harness.panel, '[data-action="filter"][data-kind="peer_chat"]');

    expect(harness.panel.kindFilter).toBe('peer_chat');
    expect(rows(harness.panel)).toHaveLength(1);
    expect(rows(harness.panel)[0].getAttribute('data-kind')).toBe('peer_chat');
  });

  test('筹码的按下态反映真实筛选', () => {
    const harness = setup();
    click(harness.panel, '[data-action="filter"][data-kind="task_run"]');

    const pressed = (kind: string): string | null | undefined =>
      harness.panel.shadowRoot
        ?.querySelector(`[data-action="filter"][data-kind="${kind}"]`)
        ?.getAttribute('aria-pressed');
    expect(pressed('task_run')).toBe('true');
    expect(pressed('all')).toBe('false');
  });

  test('切回「全部」→ 全部行回来', () => {
    const harness = setup();
    click(harness.panel, '[data-action="filter"][data-kind="peer_chat"]');
    click(harness.panel, '[data-action="filter"][data-kind="all"]');

    expect(rows(harness.panel)).toHaveLength(3);
  });
});

describe('状态徽标与中断按钮', () => {
  test('四种状态各有各的徽标文案', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState({
      sessions: [
        session({ id: 's-active', status: 'active' }),
        session({ id: 's-idle', status: 'idle' }),
        session({ id: 's-interrupted', status: 'interrupted' }),
        session({ id: 's-closed', status: 'closed' }),
      ],
    }));

    const badgeOf = (id: string): string | null | undefined =>
      harness.panel.shadowRoot
        ?.querySelector(`[data-session="${id}"] [data-role="status-badge"]`)
        ?.textContent;
    expect(badgeOf('s-active')).toBe('进行中');
    expect(badgeOf('s-idle')).toBe('空闲');
    expect(badgeOf('s-interrupted')).toBe('已中断');
    expect(badgeOf('s-closed')).toBe('已结束');
  });

  test('interrupted 的会话给出「可恢复」提示，但不再给中断钮（重复中断必被状态机拒绝）', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState({
      sessions: [
        session({ id: 's-interrupted', status: 'interrupted' }),
        session({ id: 's-active', status: 'active' }),
      ],
    }));

    const interruptedRow = harness.panel.shadowRoot?.querySelector('[data-session="s-interrupted"]');
    expect(interruptedRow?.querySelector('[data-role="resumable-hint"]')?.textContent).toContain('恢复');
    expect(interruptedRow?.querySelector('[data-action="interrupt"]')).toBeNull();

    const activeRow = harness.panel.shadowRoot?.querySelector('[data-session="s-active"]');
    expect(activeRow?.querySelector('[data-action="interrupt"]')).not.toBeNull();
  });

  test('点「中断」→ 发出 session.interrupt 命令（带 sessionId）', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState({ sessions: [session({ id: 's-1', status: 'active' })] }));
    expect(harness.commands).toHaveLength(0);

    click(harness.panel, '[data-session="s-1"] [data-action="interrupt"]');

    expect(harness.commands).toEqual([{ type: 'session.interrupt', sessionId: 's-1' }]);
  });

  test('点「中断」不会顺手展开历史（两个动作互不串台）', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState({ sessions: [session({ id: 's-1', status: 'active' })] }));
    click(harness.panel, '[data-session="s-1"] [data-action="interrupt"]');

    expect(harness.panel.expandedSessionId).toBeNull();
  });
});

/**
 * 恢复按钮（@since v3.47，task_101）：被中断的**互聊**会话行给「恢复」钮 →
 * 发 `session.resume` 命令（裁决在 core/session 的状态机与互聊引擎，面板自己不判）。
 */
describe('恢复按钮（session.resume）', () => {
  test('被中断的互聊会话 → 行内有「恢复」钮', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState({
      sessions: [
        session({ id: 's-peer', kind: 'peer_chat', status: 'interrupted' }),
        session({ id: 's-chat', kind: 'character_chat', status: 'interrupted' }),
        session({ id: 's-active', kind: 'peer_chat', status: 'active' }),
      ],
    }));

    const peerRow = harness.panel.shadowRoot?.querySelector('[data-session="s-peer"]');
    expect(peerRow?.querySelector('[data-action="resume"]')).not.toBeNull();
    // 第一期只做互聊：别的 kind 不给恢复钮（不给"点了必被拒"的按钮）。
    const chatRow = harness.panel.shadowRoot?.querySelector('[data-session="s-chat"]');
    expect(chatRow?.querySelector('[data-action="resume"]')).toBeNull();
    // 进行中的会话不需要恢复（本来就在跑）。
    const activeRow = harness.panel.shadowRoot?.querySelector('[data-session="s-active"]');
    expect(activeRow?.querySelector('[data-action="resume"]')).toBeNull();
  });

  test('点「恢复」→ 发出 session.resume 命令（带 sessionId）', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState({
      sessions: [session({ id: 's-peer', kind: 'peer_chat', status: 'interrupted' })],
    }));
    expect(harness.commands).toHaveLength(0);

    click(harness.panel, '[data-session="s-peer"] [data-action="resume"]');

    expect(harness.commands).toEqual([{ type: 'session.resume', sessionId: 's-peer' }]);
  });

  test('点「恢复」不会顺手展开历史（两个动作互不串台）', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState({
      sessions: [session({ id: 's-peer', kind: 'peer_chat', status: 'interrupted' })],
    }));
    click(harness.panel, '[data-session="s-peer"] [data-action="resume"]');

    expect(harness.panel.expandedSessionId).toBeNull();
  });
});

/**
 * 分叉入口（@since v3.48，task_102）：历史抽屉里每条**会话事件**旁的「从这里分叉」钮 →
 * 发 `session.fork` 命令（atSeq = 该事件的 seq；裁决在 core/session 的 manager.fork）。
 */
describe('分叉入口（session.fork）', () => {
  test('互聊会话的事件条目旁有「从这里分叉」钮（值 = 该事件的 seq）', async () => {
    const history: SessionHistoryPort = {
      loadSessionEvents: async () => [
        entry({ id: 'e-1', seq: 2, author: '甲', text: '先侦察' }),
        entry({ id: 'e-2', seq: 5, author: '乙', text: '我守北门' }),
      ],
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-peer', kind: 'peer_chat' })] }));

    harness.panel.expandSession('s-peer');
    await flush();

    const buttons = Array.from(
      harness.panel.shadowRoot?.querySelectorAll('[data-action="fork"]') ?? []
    );
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.getAttribute('data-at-seq'))).toEqual(['2', '5']);
    expect(buttons.map((b) => b.getAttribute('data-session'))).toEqual(['s-peer', 's-peer']);
  });

  test('点「从这里分叉」→ 发出 session.fork 命令（带 sessionId 与 atSeq）', async () => {
    const history: SessionHistoryPort = {
      loadSessionEvents: async () => [
        entry({ id: 'e-1', seq: 2, author: '甲', text: '先侦察' }),
        entry({ id: 'e-2', seq: 5, author: '乙', text: '我守北门' }),
      ],
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-peer', kind: 'peer_chat' })] }));
    harness.panel.expandSession('s-peer');
    await flush();
    expect(harness.commands).toHaveLength(0);

    click(harness.panel, '[data-action="fork"][data-at-seq="5"]');

    expect(harness.commands).toEqual([
      { type: 'session.fork', sessionId: 's-peer', atSeq: 5 },
    ]);
  });

  test('条目没有 seq（角色对话历史）→ 不给分叉钮（点了复制不到东西）', async () => {
    const history: SessionHistoryPort = {
      loadCharacterChat: async () => [entry({ id: 'm-1', author: '我', text: '在的' })],
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({
      sessions: [session({ id: 's-chat', kind: 'character_chat', participants: ['char-9'] })],
    }));

    harness.panel.expandSession('s-chat');
    await flush();

    expect(harness.panel.shadowRoot?.querySelector('[data-action="fork"]')).toBeNull();
  });

  test('非互聊会话（task_run）→ 不给分叉钮（第一期只认 peer_chat）', async () => {
    const history: SessionHistoryPort = {
      loadSessionEvents: async () => [entry({ id: 'e-1', seq: 1, author: '开工', text: '任务开始' })],
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-task', kind: 'task_run' })] }));

    harness.panel.expandSession('s-task');
    await flush();

    expect(harness.panel.shadowRoot?.querySelector('[data-action="fork"]')).toBeNull();
  });
});

describe('空态三档', () => {
  test('一条会话都没有 → 引导文案', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState({ sessions: [] }));

    expect(rows(harness.panel)).toHaveLength(0);
    expect(textOf(harness.panel, 'empty')).toContain('还没有会话');
  });

  test('WorldState 里没有 sessions 键（未附着）→ 同样走空态，不报错', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);

    harness.emit(makeState());

    expect(rows(harness.panel)).toHaveLength(0);
    expect(textOf(harness.panel, 'empty')).toContain('还没有会话');
  });

  test('筛选档下没有 → 明说是筛选结果', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-1', kind: 'peer_chat' })] }));

    click(harness.panel, '[data-action="filter"][data-kind="shell_link"]');

    expect(rows(harness.panel)).toHaveLength(0);
    expect(textOf(harness.panel, 'empty')).toBe('该筛选下没有会话');
  });
});

describe('历史抽屉：kind 路由（四路）', () => {
  test('character_chat → 走角色对话历史读取器（带角色 id）', async () => {
    const calls: Array<{ characterId: string; limit: number; before?: string }> = [];
    const history: SessionHistoryPort = {
      loadCharacterChat: async (characterId, limit, before) => {
        calls.push({ characterId, limit, before });
        return [entry({ id: 'm-1', author: '我', text: '在的' })];
      },
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({
      sessions: [session({ id: 's-1', kind: 'character_chat', participants: ['char-9'] })],
    }));

    harness.panel.expandSession('s-1');
    await flush();

    expect(calls).toEqual([{ characterId: 'char-9', limit: 50, before: undefined }]);
    expect(entries(harness.panel)).toHaveLength(1);
    expect(textOf(harness.panel, 'entry-text')).toBe('在的');
  });

  test('peer_chat → 走会话事件读取器（带会话 id）', async () => {
    const calls: Array<{ sessionId: string; limit: number; before?: string }> = [];
    const history: SessionHistoryPort = {
      loadSessionEvents: async (sessionId, limit, before) => {
        calls.push({ sessionId, limit, before });
        return [entry({ id: 'e-1', author: '中断', text: '互聊超时', tone: 'warn' })];
      },
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-peer', kind: 'peer_chat' })] }));

    harness.panel.expandSession('s-peer');
    await flush();

    expect(calls).toEqual([{ sessionId: 's-peer', limit: 50, before: undefined }]);
    expect(textOf(harness.panel, 'entry-text')).toBe('互聊超时');
    expect(harness.panel.shadowRoot?.querySelector('[data-role="entry"]')?.getAttribute('data-tone')).toBe('warn');
  });

  test('task_run → 也走会话事件读取器', async () => {
    const calls: string[] = [];
    const history: SessionHistoryPort = {
      loadSessionEvents: async (sessionId) => {
        calls.push(sessionId);
        return [entry({ id: 'e-1', author: '收尾', text: '任务完成' })];
      },
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-task', kind: 'task_run' })] }));

    harness.panel.expandSession('s-task');
    await flush();

    expect(calls).toEqual(['s-task']);
    expect(textOf(harness.panel, 'entry-text')).toBe('任务完成');
  });

  test('mission_run → 走任务单详情引用（WorldState.missions 投影，不发 IO）', async () => {
    const calls: string[] = [];
    const history: SessionHistoryPort = {
      loadSessionEvents: async (sessionId) => {
        calls.push(sessionId);
        return [];
      },
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({
      missions: [{ id: 'm-1', title: '夜袭准备', phase: 'running', unitIds: ['u-1'], createdAt: 1_700_000_000_000 }],
      sessions: [session({ id: 's-mission', kind: 'mission_run', refId: 'm-1' })],
    }));

    harness.panel.expandSession('s-mission');
    await flush();

    expect(calls).toEqual([]); // 不该走事件读取器
    expect(textOf(harness.panel, 'entry-text')).toContain('夜袭准备');
    expect(textOf(harness.panel, 'entry-text')).toContain('进行中');
  });

  test('mission_run 的任务单不在世界状态里 → 如实说明，不编详情', async () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({
      sessions: [session({ id: 's-mission', kind: 'mission_run', refId: 'm-ghost' })],
    }));

    harness.panel.expandSession('s-mission');
    await flush();

    expect(textOf(harness.panel, 'entry-text')).toContain('不在当前世界状态里');
  });

  test('shell_link → 走 WorldState.messages 投影（不发 IO）', async () => {
    const calls: string[] = [];
    const history: SessionHistoryPort = {
      loadSessionEvents: async (sessionId) => {
        calls.push(sessionId);
        return [];
      },
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({
      messages: [
        { id: 'msg-1', linkId: 'link-7', direction: 'outbound', author: '我', text: 'ping', at: 1_700_000_000_000 },
        { id: 'msg-2', linkId: 'link-other', direction: 'inbound', author: '它', text: 'pong', at: 1_700_000_000_000 },
      ],
      sessions: [session({ id: 's-link', kind: 'shell_link', refId: 'link-7', participants: ['link-7'] })],
    }));

    harness.panel.expandSession('s-link');
    await flush();

    expect(calls).toEqual([]);
    expect(entries(harness.panel)).toHaveLength(1);
    expect(textOf(harness.panel, 'entry-text')).toBe('ping');
  });

  test('读取口缺席（未附着）→ 抽屉如实说明，不显示假数据', async () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-peer', kind: 'peer_chat' })] }));

    harness.panel.expandSession('s-peer');
    await flush();

    expect(entries(harness.panel)).toHaveLength(0);
    expect(textOf(harness.panel, 'drawer-note')).toContain('未附着');
  });

  test('读取失败 → 抽屉说失败并给重试，不显示空历史冒充正常', async () => {
    const history: SessionHistoryPort = {
      loadSessionEvents: async () => { throw new Error('service 没起'); },
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-peer', kind: 'peer_chat' })] }));

    harness.panel.expandSession('s-peer');
    await flush();

    expect(entries(harness.panel)).toHaveLength(0);
    expect(textOf(harness.panel, 'drawer-note')).toContain('读取失败');
    expect(harness.panel.shadowRoot?.querySelector('[data-action="retry"]')).not.toBeNull();
  });

  test('读到空 → 说"没有可读的历史记录"（真实空，不是未附着）', async () => {
    const history: SessionHistoryPort = { loadSessionEvents: async () => [] };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-peer', kind: 'peer_chat' })] }));

    harness.panel.expandSession('s-peer');
    await flush();

    expect(textOf(harness.panel, 'drawer-note')).toBe('没有可读的历史记录');
  });

  test('翻页：满页时给「加载更早」，再点一次带游标回读', async () => {
    const calls: Array<{ sessionId: string; before?: string }> = [];
    const page = (n: number): SessionHistoryEntry[] =>
      Array.from({ length: 50 }, (_, i) => entry({ id: `e-${n}-${i}`, cursor: String(n * 100 + i) }));
    const history: SessionHistoryPort = {
      loadSessionEvents: async (sessionId, _limit, before) => {
        calls.push({ sessionId, before });
        return calls.length === 1 ? page(1) : page(0);
      },
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({ sessions: [session({ id: 's-peer', kind: 'peer_chat' })] }));

    harness.panel.expandSession('s-peer');
    await flush();
    expect(entries(harness.panel)).toHaveLength(50);
    expect(harness.panel.shadowRoot?.querySelector('[data-action="load-earlier"]')).not.toBeNull();

    click(harness.panel, '[data-action="load-earlier"]');
    await flush();

    expect(calls.length).toBe(2);
    expect(calls[1].before).toBe('100'); // 最早一条的游标
    expect(entries(harness.panel)).toHaveLength(100);
  });

  test('换一条会话 → 抽屉内容跟着换（旧的异步结果不串台）', async () => {
    const history: SessionHistoryPort = {
      loadSessionEvents: async (sessionId) => {
        if (sessionId === 'slow') {
          await new Promise((resolve) => { setTimeout(resolve, 20); });
          return [entry({ id: 'e-slow', text: '慢的那条' })];
        }
        return [entry({ id: 'e-fast', text: '快的那条' })];
      },
    };
    const harness = mountPanel(history);
    mounted.push(harness.unmount);
    expand(harness.panel);
    harness.emit(makeState({
      sessions: [
        session({ id: 'slow', kind: 'peer_chat' }),
        session({ id: 'fast', kind: 'peer_chat' }),
      ],
    }));

    harness.panel.expandSession('slow');
    harness.panel.expandSession('fast');
    await flush();
    await new Promise((resolve) => { setTimeout(resolve, 40); });

    expect(harness.panel.expandedSessionId).toBe('fast');
    expect(textOf(harness.panel, 'entry-text')).toBe('快的那条');
  });
});

describe('资源清理', () => {
  test('卸载后订阅被释放（不泄漏监听器）', () => {
    const harness = mountPanel();
    expect(harness.subscriberCount()).toBe(1);

    harness.unmount();
    expect(harness.subscriberCount()).toBe(0);
  });

  test('反复挂载卸载不会把订阅堆起来', () => {
    for (let i = 0; i < 5; i++) {
      const harness = mountPanel();
      expect(harness.subscriberCount()).toBe(1);
      harness.unmount();
      expect(harness.subscriberCount()).toBe(0);
    }
  });
});

describe('装配进 main-screen（dev 页走的就是这条路径）', () => {
  test('主屏挂上会话面板，顶栏「会话面板」钮能展开它', () => {
    const subs = new Set<(state: WorldState) => void>();
    const adapter: HudBusAdapter = {
      dispatch: () => { /* 本用例只关心面板挂载与展开 */ },
      subscribe: (handler) => {
        subs.add(handler);
        return () => { subs.delete(handler); };
      },
      mount: () => () => { subs.clear(); },
      latest: null,
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = createMainScreen(adapter).mount(host);

    const panel = host.querySelector(SESSION_PANEL_TAG) as StratSessionPanelElement;
    if (!panel?.shadowRoot) throw new Error('主屏未挂上会话面板');
    expect(panel.collapsed).toBe(true);

    const button = host.querySelector('[data-role="sessions"]');
    if (!button) throw new Error('顶栏没有「会话面板」入口');
    // 走真按钮：strat-button 内部 button 点击 → strat-button-click 冒泡到主屏。
    const inner = button.shadowRoot?.querySelector('button');
    if (!inner) throw new Error('会话面板按钮没渲染出来');
    inner.click();

    expect(panel.collapsed).toBe(false);

    unmount();
    host.remove();
    expect(subs.size).toBe(0);
  });
});
