/**
 * 集成测试：事件轨（hud/components/marquee/marquee.ts + marquee-catalog.ts，task_080 建；
 * @since v3.4 task_091 升级为 Z2 事件轨）。
 * 覆盖：文案模板 / 相对时间 / 分级配色（纯函数直打）+ 条目栈行为（最多 5 条、最旧一条淡出、
 * 新消息在最上、时间刷新、演示模式强制开启）+ Z2 规格（折叠 2 条 / 展开 N 条、hover 详情不跳动、
 * 点击发 focus.unit 总线事件、与控制岛零重叠）。
 * @jest-environment jsdom
 */

import {
  formatRelativeTime,
  isMilestoneCount,
  MARQUEE_ICONS,
  marqueeDetailFor,
  marqueeEntryForEvent,
  marqueeTextFor,
  marqueeToneColor,
  milestoneEntryText,
  milestoneText,
  resolveTaskTitle,
  resolveTaskTitleFull,
  resolveUnitIdForTask,
  shortenText,
} from '../components/marquee/marquee-catalog';
import {
  MARQUEE_ENABLED_KEY,
  mountMarquee,
  type MarqueeDeps,
  type StratMarqueeElement,
} from '../components/marquee/marquee';
import { MARQUEE_METRICS, VISUAL_PALETTE } from '../../core/theme/visual-spec';
import { emitCommand, onCommand, resetBus } from '../../core/bus';
import type { CharacterTask, HudCommand, MissionView, UnitView, WorldEvent } from '../../core/types';

// ============================================================================
// 纯函数层
// ============================================================================

describe('相对时间（run 级）', () => {
  const now = 1_000_000_000;

  test('一分钟内是「刚刚」', () => {
    expect(formatRelativeTime(now, now)).toBe('刚刚');
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚');
    expect(formatRelativeTime(now - 59_000, now)).toBe('刚刚');
  });

  test('分钟级 / 小时级 / 天级分档', () => {
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe('3 分钟前');
    expect(formatRelativeTime(now - 59 * 60_000, now)).toBe('59 分钟前');
    expect(formatRelativeTime(now - 60 * 60_000, now)).toBe('1 小时前');
    expect(formatRelativeTime(now - 5 * 3_600_000, now)).toBe('5 小时前');
    expect(formatRelativeTime(now - 24 * 3_600_000, now)).toBe('1 天前');
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe('3 天前');
  });

  test('未来时间戳按「刚刚」处理（不出现负数）', () => {
    expect(formatRelativeTime(now + 10_000, now)).toBe('刚刚');
  });
});

describe('短标题截断', () => {
  test('短标题原样返回', () => {
    expect(shortenText('登录页改版')).toBe('登录页改版');
  });

  test('超长标题截断加省略号；空白先折叠成单空格', () => {
    expect(shortenText('登录页改版\n需要兼容移动端')).toBe('登录页改版 需要兼容移…');
    expect(shortenText('a'.repeat(40)).length).toBe(12);
  });
});

describe('事件 → 条目映射', () => {
  const task: CharacterTask = {
    id: 't1',
    characterId: 'c1',
    prompt: '把登录页改成两栏布局',
    status: 'running',
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    output: '',
  };

  const queued: WorldEvent = { type: 'task.queued', task };
  const completed: WorldEvent = { type: 'task.completed', task };
  const failed: WorldEvent = { type: 'task.failed', task };

  test('派活 / 完成 / 报错 各自映射到对应分级与图标', () => {
    const ctx = { characterName: '小王', taskTitle: '登录页改版' };
    expect(marqueeEntryForEvent(queued, ctx, 1000)).toMatchObject({
      kind: 'dispatch',
      icon: MARQUEE_ICONS.dispatch,
      text: '小王 接了「登录页改版」',
      at: 1000,
    });
    expect(marqueeEntryForEvent(completed, ctx, 1000)).toMatchObject({
      kind: 'complete',
      icon: MARQUEE_ICONS.complete,
      text: '小王 完成了「登录页改版」',
    });
    expect(marqueeEntryForEvent(failed, ctx, 1000)).toMatchObject({
      kind: 'error',
      icon: MARQUEE_ICONS.error,
      text: '小王 在「登录页改版」上卡住了',
    });
  });

  test('无关事件不产生条目（返回 null）', () => {
    expect(marqueeEntryForEvent({ type: 'camera.moved', center: { x: 0, y: 0 }, zoom: 1 }, {}, 0)).toBeNull();
    expect(marqueeEntryForEvent({ type: 'task.started', task }, {}, 0)).toBeNull();
  });

  test('缺角色名 / 缺标题时走兜底句式（不出现空槽）', () => {
    expect(marqueeTextFor('complete', '', '登录页改版')).toBe('「登录页改版」完成了');
    expect(marqueeTextFor('complete', '小王', '')).toBe('小王 完成了任务');
    expect(marqueeTextFor('dispatch', '', '')).toBe('派了新任务');
    expect(marqueeTextFor('error', '', '')).toBe('有任务卡住了');
  });
});

describe('分级配色（唯一事实源的七色语义色）', () => {
  test('四个分级各取一个语义色，且色值来自 VISUAL_PALETTE', () => {
    expect(marqueeToneColor('dispatch')).toContain(VISUAL_PALETTE.unit);
    expect(marqueeToneColor('complete')).toContain(VISUAL_PALETTE.success);
    expect(marqueeToneColor('error')).toContain(VISUAL_PALETTE.danger);
    expect(marqueeToneColor('milestone')).toContain(VISUAL_PALETTE.progress);
  });
});

describe('任务短标题解析', () => {
  const task: CharacterTask = {
    id: 't1',
    characterId: 'c1',
    prompt: '把登录页改成两栏布局并兼容移动端',
    status: 'running',
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    output: '',
    missionId: 'm1',
  };

  test('有 mission 时用 mission 标题（那是人起的、够短）', () => {
    const missions: MissionView[] = [
      {
        id: 'm1',
        title: '登录页改版',
        phase: 'running',
        unitIds: ['u1'],
        createdAt: 0,
      },
    ];
    expect(resolveTaskTitle(task, missions)).toBe('登录页改版');
  });

  test('没有 mission 时退回任务原文并截断', () => {
    expect(resolveTaskTitle(task, [])).toBe('把登录页改成两栏布局并…');
  });
});

describe('里程碑判定与文案', () => {
  test('每 10 个触发一次（10 / 20 / 30）', () => {
    expect(isMilestoneCount(9)).toBe(false);
    expect(isMilestoneCount(10)).toBe(true);
    expect(isMilestoneCount(20)).toBe(true);
    expect(isMilestoneCount(21)).toBe(false);
  });

  test('大字带感叹号、跑马灯条目不带（同一件事两种语气）', () => {
    expect(milestoneText(10)).toBe('第 10 个任务完成！');
    expect(milestoneEntryText(10)).toBe('第 10 个任务完成');
  });
});

// ============================================================================
// 组件层
// ============================================================================

/** 内存版 localStorage（避免真存储串味）。 */
function memoryStorage(initial: Record<string, string> = {}): {
  readonly storage: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
  readonly data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    storage: {
      getItem: (key) => (key in data ? data[key] : null),
      setItem: (key, value) => { data[key] = value; },
      removeItem: (key) => { delete data[key]; },
    },
  };
}

let clockNow = 1_000_000_000;
let host: HTMLElement;
let element: StratMarqueeElement;
let unmount: () => void;

function mount(remembered: Record<string, string> = {}, deps: Partial<MarqueeDeps> = {}): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  const mounted = mountMarquee(host, {
    now: () => clockNow,
    storage: () => memoryStorage(remembered).storage,
    ...deps,
  });
  element = mounted.element;
  unmount = mounted.unmount;
}

/** 影子 DOM 里的条目节点（自上而下 = 自新到旧）。 */
function entryNodes(): HTMLElement[] {
  const stack = element.shadowRoot?.querySelector('[data-role="stack"]');
  return stack ? Array.from(stack.querySelectorAll('.entry')) : [];
}

/** 当前**出场**的条目（Z2 折叠态：只露 collapsedVisible 条，其余留在 DOM 里但 display:none）。 */
function visibleEntryNodes(): HTMLElement[] {
  return entryNodes().filter((node) => !node.classList.contains('is-hidden'));
}

/** 折叠 / 展开按钮（Z2）。 */
function toggleButton(): HTMLButtonElement | null {
  return (element.shadowRoot?.querySelector('[data-role="toggle"]') as HTMLButtonElement | null) ?? null;
}

function pushEntry(kind: 'dispatch' | 'complete' | 'error' | 'milestone', text: string, at = clockNow): void {
  element.push({ kind, icon: MARQUEE_ICONS[kind], text, at });
}

beforeEach(() => {
  jest.useFakeTimers();
  clockNow = 1_000_000_000;
});

afterEach(() => {
  unmount?.();
  host?.remove();
  jest.useRealTimers();
});

describe('跑马灯组件：条目栈行为', () => {
  test('新消息插到最上，DOM 顺序 = 自新到旧', () => {
    mount();
    pushEntry('dispatch', '第一条');
    pushEntry('complete', '第二条');

    const nodes = entryNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes[0].querySelector('.text')?.textContent).toBe('第二条');
    expect(nodes[1].querySelector('.text')?.textContent).toBe('第一条');
  });

  test('条目带分级标记与图标；颜色走语义色 token', () => {
    mount();
    pushEntry('complete', '小王 完成了「登录页改版」');

    const node = entryNodes()[0];
    expect(node.getAttribute('data-kind')).toBe('complete');
    expect(node.querySelector('.icon')?.textContent).toBe(MARQUEE_ICONS.complete);
    expect(node.style.getPropertyValue('--entry-color')).toContain(VISUAL_PALETTE.success);
  });

  test('最多 5 条：第 6 条进来时最旧一条进入淡出，淡出结束后被移除', () => {
    mount();
    for (let i = 1; i <= 5; i += 1) pushEntry('dispatch', `第 ${i} 条`);
    expect(entryNodes()).toHaveLength(5);

    pushEntry('dispatch', '第 6 条');

    // 淡出中的最旧一条还在 DOM 里（带 leaving 标记），但已不占条目位
    expect(element.entries).toHaveLength(MARQUEE_METRICS.maxEntries);
    const nodes = entryNodes();
    expect(nodes).toHaveLength(6);
    const leaving = nodes[nodes.length - 1];
    expect(leaving.classList.contains('leaving')).toBe(true);
    expect(leaving.querySelector('.text')?.textContent).toBe('第 1 条');

    // 退场时长（300ms）结束后移除
    jest.advanceTimersByTime(MARQUEE_METRICS.exitDurationMs);
    expect(entryNodes()).toHaveLength(5);
    expect(entryNodes()[0].querySelector('.text')?.textContent).toBe('第 6 条');
  });

  test('相对时间随时间刷新（时间戳刷新，不重建节点）', () => {
    mount();
    pushEntry('complete', '小王 完成了「登录页改版」');
    expect(entryNodes()[0].querySelector('.time')?.textContent).toBe('刚刚');

    clockNow += 3 * 60_000;
    jest.advanceTimersByTime(5000);

    expect(entryNodes()[0].querySelector('.time')?.textContent).toBe('3 分钟前');
  });

  test('卸载时清掉计时器（元素离场后不再回调）', () => {
    mount();
    pushEntry('complete', '一条');
    const removed = jest.spyOn(HTMLElement.prototype, 'remove');
    unmount();
    jest.advanceTimersByTime(60_000);
    // 卸载后不应再有 DOM 操作报错，且元素确实已离场
    expect(element.isConnected).toBe(false);
    removed.mockRestore();
  });
});

describe('跑马灯组件：演示模式强制开启', () => {
  test('本地记忆为 off 时默认不可见；setForced(true) 后强制可见', () => {
    mount({ [MARQUEE_ENABLED_KEY]: 'off' });
    expect(element.visible).toBe(false);
    expect(element.forced).toBe(false);

    element.setForced(true);
    expect(element.visible).toBe(true);
    expect(element.forced).toBe(true);
  });

  test('记忆为 off 时不渲染条目；强制开启后条目照常进栈', () => {
    mount({ [MARQUEE_ENABLED_KEY]: 'off' });
    pushEntry('complete', '看不见的一条');
    expect(entryNodes()).toHaveLength(0);

    element.setForced(true);
    pushEntry('complete', '看得见的一条');
    expect(entryNodes()).toHaveLength(1);
  });

  test('默认（无记忆）可见', () => {
    mount();
    expect(element.visible).toBe(true);
  });
});

// ============================================================================
// Z2 事件轨（@since v3.4，task_091）—— 依据 docs/hud-redesign-proposal.html §2.5 Z2 行
// ============================================================================

describe('事件轨（Z2）：折叠 / 展开', () => {
  test('默认折叠：只露 collapsedVisible 条，其余条目留在 DOM 里但不出场', () => {
    mount();
    for (let i = 1; i <= MARQUEE_METRICS.maxEntries; i += 1) pushEntry('dispatch', `第 ${i} 条`);

    expect(entryNodes()).toHaveLength(MARQUEE_METRICS.maxEntries);
    expect(visibleEntryNodes()).toHaveLength(MARQUEE_METRICS.collapsedVisible);
    expect(element.expanded).toBe(false);
    expect(element.hiddenCount).toBe(MARQUEE_METRICS.maxEntries - MARQUEE_METRICS.collapsedVisible);
  });

  test('「展开 N 条」按钮：N = 被藏条数；点开露全部，再点收起', () => {
    mount();
    for (let i = 1; i <= MARQUEE_METRICS.maxEntries; i += 1) pushEntry('dispatch', `第 ${i} 条`);

    const toggle = toggleButton();
    expect(toggle).not.toBeNull();
    expect(toggle?.hidden).toBe(false);
    expect(toggle?.textContent).toBe('展开 3 条');

    toggle?.click();
    expect(element.expanded).toBe(true);
    expect(visibleEntryNodes()).toHaveLength(MARQUEE_METRICS.maxEntries);
    expect(toggle?.textContent).toBe('收起');
    expect(element.hiddenCount).toBe(0);

    toggle?.click();
    expect(element.expanded).toBe(false);
    expect(visibleEntryNodes()).toHaveLength(MARQUEE_METRICS.collapsedVisible);
    expect(toggle?.textContent).toBe('展开 3 条');
  });

  test('条目不超过折叠可见数时不显示展开按钮（底边静默）', () => {
    mount();
    pushEntry('complete', '一条');
    expect(toggleButton()?.hidden).toBe(true);

    pushEntry('complete', '两条');
    expect(toggleButton()?.hidden).toBe(true);

    pushEntry('complete', '三条');
    expect(toggleButton()?.hidden).toBe(false);
    expect(toggleButton()?.textContent).toBe('展开 1 条');
  });

  test('新条目进来后折叠态仍只露 2 条（被挤下去的藏起来，不撑高轨道）', () => {
    mount();
    pushEntry('complete', '第一条');
    pushEntry('complete', '第二条');
    pushEntry('complete', '第三条');

    expect(visibleEntryNodes()).toHaveLength(MARQUEE_METRICS.collapsedVisible);
    expect(visibleEntryNodes()[0].querySelector('.text')?.textContent).toBe('第三条');
    expect(element.hiddenCount).toBe(1);
  });
});

describe('事件轨（Z2）：hover 详情行', () => {
  const detailEntry = () => ({
    kind: 'complete' as const,
    icon: MARQUEE_ICONS.complete,
    text: '小王 完成了「登录页改版」',
    detail: '小王 完成了「把登录页改成两栏布局并兼容移动端」',
    unitId: 'u-1',
    at: clockNow,
  });

  test('悬停出现详情行（完整文案 + 相对时间）；移出收起', () => {
    mount();
    element.push(detailEntry());
    const node = entryNodes()[0];
    const detail = node.querySelector('[data-role="detail"]');
    expect(detail).not.toBeNull();
    expect(detail?.querySelector('.detail-text')?.textContent).toBe(
      '小王 完成了「把登录页改成两栏布局并兼容移动端」',
    );
    expect(detail?.querySelector('.detail-time')?.textContent).toBe('刚刚');

    expect(node.hasAttribute('data-hover')).toBe(false);
    node.dispatchEvent(new MouseEvent('mouseenter'));
    expect(node.getAttribute('data-hover')).toBe('true');
    node.dispatchEvent(new MouseEvent('mouseleave'));
    expect(node.hasAttribute('data-hover')).toBe(false);
  });

  test('详情行随时间刷新相对时间', () => {
    mount();
    element.push(detailEntry());
    const node = entryNodes()[0];

    clockNow += 3 * 60_000;
    jest.advanceTimersByTime(5000);

    expect(node.querySelector('.detail-time')?.textContent).toBe('3 分钟前');
  });

  test('hover 不挪动任何条目（详情板脱流：绝对定位 + 不增删节点）', () => {
    mount();
    pushEntry('complete', '第一条');
    pushEntry('complete', '第二条');
    const stack = element.shadowRoot?.querySelector('[data-role="stack"]');
    const before = entryNodes().map((node) => node.style.cssText);
    const childCountBefore = stack?.childNodes.length;

    entryNodes()[0].dispatchEvent(new MouseEvent('mouseenter'));

    expect(entryNodes().map((node) => node.style.cssText)).toEqual(before);
    expect(stack?.childNodes.length).toBe(childCountBefore);
    // 详情板绝对定位（脱流）—— 组件样式表里的出处
    const css = element.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/\.detail\s*\{[^}]*position:\s*absolute/);
  });
});

describe('事件轨（Z2）：点击发 focus.unit', () => {
  const clickable = () => ({
    kind: 'complete' as const,
    icon: MARQUEE_ICONS.complete,
    text: '小王 完成了「登录页改版」',
    unitId: 'u-1',
    at: clockNow,
  });

  test('点击条目 → 命令出口收到 focus.unit（带单位 id）', () => {
    const dispatch = jest.fn();
    mount({}, { dispatch });
    element.push(clickable());

    entryNodes()[0].click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'focus.unit', unitId: 'u-1' });
  });

  test('总线级：focus.unit 命令真的发到了 core/bus 的 command 通道', () => {
    resetBus();
    const seen: HudCommand[] = [];
    const off = onCommand((command) => seen.push(command));
    mount({}, { dispatch: (command) => emitCommand(command) });
    element.push(clickable());

    entryNodes()[0].click();

    expect(seen).toEqual([{ type: 'focus.unit', unitId: 'u-1' }]);
    off();
    resetBus();
  });

  test('没有关联单位的条目点了不动作（里程碑那条不指向任何单位）', () => {
    const dispatch = jest.fn();
    mount({}, { dispatch });
    element.push({ kind: 'milestone', icon: MARQUEE_ICONS.milestone, text: '第 10 个任务完成', at: clockNow });

    entryNodes()[0].click();

    expect(dispatch).not.toHaveBeenCalled();
  });

  test('键盘可达：条目可聚焦，回车同样发 focus.unit', () => {
    const dispatch = jest.fn();
    mount({}, { dispatch });
    element.push(clickable());
    const node = entryNodes()[0];
    expect(node.getAttribute('role')).toBe('button');
    expect(node.getAttribute('tabindex')).toBe('0');

    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'focus.unit', unitId: 'u-1' });
  });
});

describe('事件轨（Z2）：几何（与控制岛零重叠）', () => {
  test('轨道宽度 ≤260px；1280 / 1920 宽下与控制岛（56% 屏宽贴底居中）不相撞', () => {
    mount();
    // 宽度上限来自唯一事实源（proposal §2.5 Z2：宽 ≤260px）
    expect(MARQUEE_METRICS.maxWidthPx).toBeLessThanOrEqual(260);
    expect(element.style.getPropertyValue('--marquee-width')).toBe(`${MARQUEE_METRICS.maxWidthPx}px`);

    // 轨道右缘 = 左边距 16 + 轨道宽；控制岛左缘 = (1 - 56% 屏宽) / 2（贴底居中）
    const trackRight = 16 + MARQUEE_METRICS.maxWidthPx;
    for (const viewport of [1280, 1920]) {
      const islandLeft = ((1 - 0.56) / 2) * viewport;
      expect(trackRight).toBeLessThanOrEqual(islandLeft);
    }
  });
});

describe('事件轨（Z2）：纯逻辑层新增', () => {
  const task: CharacterTask = {
    id: 't1',
    characterId: 'ch-1',
    prompt: '把登录页改成两栏布局并兼容移动端',
    status: 'running',
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    output: '',
    missionId: 'm1',
  };

  test('完整标题不截断（详情行用）；短标题照旧截断', () => {
    const missions: MissionView[] = [
      { id: 'm1', title: '登录页改版', phase: 'running', unitIds: ['u1'], createdAt: 0 },
    ];
    expect(resolveTaskTitleFull(task, missions)).toBe('登录页改版');
    expect(resolveTaskTitle(task, missions)).toBe('登录页改版');

    const noMission = { ...task, missionId: null };
    expect(resolveTaskTitleFull(noMission, [])).toBe('把登录页改成两栏布局并兼容移动端');
    expect(resolveTaskTitle(noMission, [])).toBe('把登录页改成两栏布局并…');
  });

  test('任务 → 单位 id：优先同 mission 上的那个单位，其次同角色的任意单位', () => {
    const units: UnitView[] = [
      { id: 'u-other', name: 'A', status: 'idle', missionId: null, power: 1, characterId: 'ch-1' },
      { id: 'u-on', name: 'B', status: 'busy', missionId: 'm1', power: 1, characterId: 'ch-1' },
      { id: 'u-other-char', name: 'C', status: 'idle', missionId: 'm1', power: 1, characterId: 'ch-9' },
    ];
    expect(resolveUnitIdForTask(units, task)).toBe('u-on');
    expect(resolveUnitIdForTask(units, { ...task, missionId: 'm-zz' })).toBe('u-other');
    expect(resolveUnitIdForTask(units, { ...task, characterId: 'ch-none' })).toBeNull();
  });

  test('详情句式与短句同款，只是标题不截断', () => {
    expect(marqueeDetailFor('complete', '小王', '把登录页改成两栏布局并兼容移动端')).toBe(
      '小王 完成了「把登录页改成两栏布局并兼容移动端」',
    );
    expect(marqueeDetailFor('milestone', '小王', '标题')).toBe('');
  });

  test('事件 → 条目：带上详情全文与关联单位 id', () => {
    const entry = marqueeEntryForEvent(
      { type: 'task.completed', task },
      {
        characterName: '小王',
        taskTitle: '登录页改版',
        taskTitleFull: '把登录页改成两栏布局并兼容移动端',
        unitId: 'u-1',
      },
      1000,
    );
    expect(entry?.text).toBe('小王 完成了「登录页改版」');
    expect(entry?.detail).toBe('小王 完成了「把登录页改成两栏布局并兼容移动端」');
    expect(entry?.unitId).toBe('u-1');
  });
});
