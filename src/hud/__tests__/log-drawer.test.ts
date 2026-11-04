/**
 * 集成测试：统一日志抽屉 Web Component（hud/panels/log-drawer.ts）。
 * 覆盖：订阅 state 增量渲染（新条目自动出现 / notice 过期后行仍在）、按任务与级别过滤、
 *   清空当前视图、折叠抽屉、正文转义、渲染判重、卸载释放订阅、装配进 main-screen。
 * @jest-environment jsdom
 *
 * 抽屉是真组件（真 Shadow DOM、真事件链），替身只有 adapter 的 subscribe —— 也就是 HUD 与
 * 总线之间的全部边界。断言打在"画出了什么行 / 点了会怎样"上，不断言像素。
 */

import type { MissionView, Notice, WorldState } from '../../core/types';
import { LOG_DRAWER_TAG, mountLogDrawer, type LogDrawerDeps, type StratLogDrawerElement } from '../panels/log-drawer';
import { createMainScreen } from '../screens/main-screen';

function notice(partial: Partial<Notice> & { id: string }): Notice {
  return { level: 'info', text: partial.id, createdAt: 1_700_000_000_000, expiresAt: 1_700_009_000_000, ...partial };
}

function mission(partial: Partial<MissionView> & { id: string }): MissionView {
  return { title: `任务 ${partial.id}`, phase: 'running', unitIds: [], createdAt: 1_700_000_000_000, ...partial };
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
  /** core 广播一份新状态（走 adapter.subscribe 的真实订阅链）。 */
  emit(state: WorldState): void;
  /** 当前挂着的订阅数（验证卸载后没有泄漏）。 */
  subscriberCount(): number;
  unmount(): void;
}

function mountDrawer(): { drawer: StratLogDrawerElement; host: HTMLElement; harness: Harness } {
  const subs = new Set<(state: WorldState) => void>();
  const deps: LogDrawerDeps = {
    subscribe: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountDrawer = mountLogDrawer(deps, host);
  const drawer = host.querySelector(LOG_DRAWER_TAG) as StratLogDrawerElement;
  if (!drawer?.shadowRoot) throw new Error('日志抽屉未 upgrade（shadowRoot 为空）');

  return {
    drawer,
    host,
    harness: {
      emit: (state) => { subs.forEach((handler) => handler(state)); },
      subscriberCount: () => subs.size,
      unmount: () => { unmountDrawer(); host.remove(); },
    },
  };
}

/** 进 shadow DOM 点真实按钮：走组件自己的事件链，不直接调方法。 */
function clickAction(drawer: StratLogDrawerElement, action: string, level?: string): void {
  const sel = level ? `button[data-action="${action}"][data-level="${level}"]` : `button[data-action="${action}"]`;
  const btn = drawer.shadowRoot?.querySelector<HTMLButtonElement>(sel);
  if (!btn) throw new Error(`抽屉按钮未渲染: ${action}${level ? `/${level}` : ''}`);
  btn.click();
}

const rows = (drawer: StratLogDrawerElement): Element[] =>
  Array.from(drawer.shadowRoot?.querySelectorAll('[data-role="row"]') ?? []);

const text = (drawer: StratLogDrawerElement, role: string): string | null | undefined =>
  drawer.shadowRoot?.querySelector(`[data-role="${role}"]`)?.textContent;

let mounted: Array<() => void> = [];

afterEach(() => {
  mounted.forEach((dispose) => dispose());
  mounted = [];
  document.body.innerHTML = '';
});

describe('订阅：state 一变，新条目自动出现', () => {
  test('刚挂载（还没收到 state）显示等待态，不报错', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    expect(drawer.entries).toEqual([]);
    expect(text(drawer, 'summary')).toBe('等待世界状态…');
    expect(rows(drawer)).toHaveLength(0);
  });

  test('收到带通知与任务的 state → 立刻画出「时间/来源/级别/正文」四列', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    harness.emit(
      makeState({
        notices: [notice({ id: 'n-1', level: 'error', text: 'agent 掉线', source: 'core/agent-link' })],
        missions: [mission({ id: 'm-1', title: '联调 hello loop', phase: 'running' })],
      }),
    );

    expect(rows(drawer)).toHaveLength(2);
    expect(text(drawer, 'summary')).toBe('2 条');

    const errRow = drawer.shadowRoot?.querySelector('[data-entry="notice:n-1"]');
    expect(errRow?.getAttribute('data-level')).toBe('error');
    expect(errRow?.textContent).toContain('core/agent-link'); // 来源
    expect(errRow?.textContent).toContain('错误'); // 级别
    expect(errRow?.textContent).toContain('agent 掉线'); // 正文
    // 时间列：固定 HH:MM:SS 形状（具体钟点取决于本机时区，不在这里断言）
    expect(errRow?.querySelector('[data-role="time"]')?.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    const missionRow = drawer.shadowRoot?.querySelector('[data-entry="mission:m-1:running"]');
    expect(missionRow?.getAttribute('data-mission')).toBe('m-1');
    expect(missionRow?.textContent).toContain('「联调 hello loop」进行中');
  });

  test('后续广播带来新通知 → 新行自动追加，不刷新页面', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    harness.emit(makeState({ notices: [notice({ id: 'n-1', text: '第一条' })] }));
    expect(rows(drawer)).toHaveLength(1);

    harness.emit(makeState({ notices: [notice({ id: 'n-2', text: '第二条' }), notice({ id: 'n-1', text: '第一条' })] }));
    expect(rows(drawer)).toHaveLength(2);
    expect(text(drawer, 'summary')).toBe('2 条');
    // 最新在前
    expect(rows(drawer).map((r) => r.getAttribute('data-entry'))).toEqual(['notice:n-2', 'notice:n-1']);
  });

  test('任务相位迁移 → 自动补一行新相位（旧行保留，是累积视图不是当前态）', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    harness.emit(makeState({ missions: [mission({ id: 'm-1', phase: 'pending' })] }));
    expect(rows(drawer)).toHaveLength(1);

    harness.emit(makeState({ missions: [mission({ id: 'm-1', phase: 'running' })] }));
    expect(rows(drawer).map((r) => r.getAttribute('data-entry'))).toEqual([
      'mission:m-1:running',
      'mission:m-1:pending',
    ]);
  });

  test('core 把过期通知剔掉 → 已渲染的行仍在（不是 notices 的镜像）', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    harness.emit(makeState({ notices: [notice({ id: 'n-1', text: '过期也会留下' })] }));
    harness.emit(makeState({ notices: [] }));

    expect(rows(drawer)).toHaveLength(1);
    expect(rows(drawer)[0].textContent).toContain('过期也会留下');
  });

  test('与日志无关的广播（只有选择集变化）→ 不重绘 DOM', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    harness.emit(makeState({ notices: [notice({ id: 'n-1' })] }));
    const before = rows(drawer)[0];

    harness.emit(makeState({ notices: [notice({ id: 'n-1' })], selection: { unitIds: ['u-1'], previewUnitIds: [], revision: 7 } }));
    expect(rows(drawer)[0]).toBe(before); // 同一个节点 = 没重建
  });

  test('正文里的 HTML 字符被转义，不会变成真标签', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    harness.emit(makeState({ notices: [notice({ id: 'n-1', text: '<img src=x onerror=alert(1)>' })] }));
    const row = rows(drawer)[0];
    expect(row.textContent).toContain('<img src=x onerror=alert(1)>'); // 作为文本显示
    expect(row.querySelector('img')).toBeNull(); // 没有真的建出标签
  });
});

describe('过滤：按任务、按级别', () => {
  function setup(): { drawer: StratLogDrawerElement; harness: Harness } {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);
    harness.emit(
      makeState({
        notices: [
          notice({ id: 'n-1', level: 'info', text: '全局通知', missionId: null }),
          notice({ id: 'n-2', level: 'error', text: '任务一报错', missionId: 'm-1' }),
          notice({ id: 'n-3', level: 'error', text: '任务二报错', missionId: 'm-2' }),
        ],
        missions: [mission({ id: 'm-1', title: '联调 hello loop' }), mission({ id: 'm-2', title: '跑压测' })],
      }),
    );
    return { drawer, harness };
  }

  test('任务下拉列出「全部任务」+ 当前所有任务', () => {
    const { drawer } = setup();
    const options = Array.from(drawer.shadowRoot?.querySelectorAll('select[data-role="mission-filter"] option') ?? []);
    // 首项恒为「全部任务」（value 为空串），其余是 state.missions 的候选
    expect(options[0]?.textContent).toBe('全部任务');
    expect(options[0]?.getAttribute('value')).toBe('');
    expect(options.slice(1).map((o) => o.getAttribute('value')).sort()).toEqual(['m-1', 'm-2']);
    expect(options.map((o) => o.textContent)).toContain('联调 hello loop');
  });

  test('选某个任务 → 只剩该任务的行（通知与任务事件都算），摘要变成过滤口径', () => {
    const { drawer } = setup();

    drawer.setMissionFilter('m-1');
    expect(rows(drawer).map((r) => r.getAttribute('data-entry'))).toEqual([
      'mission:m-1:running',
      'notice:n-2',
    ]);
    expect(text(drawer, 'summary')).toBe('2 / 5 条');
    expect(text(drawer, 'mission-tag')).toBe('联调 hello loop');

    drawer.setMissionFilter(null);
    expect(rows(drawer)).toHaveLength(5);
    expect(text(drawer, 'summary')).toBe('5 条');
  });

  test('下拉上真实选中 → 走 change 事件改筛选（不是只有 API 能改）', () => {
    const { drawer } = setup();
    const select = drawer.shadowRoot?.querySelector<HTMLSelectElement>('select[data-role="mission-filter"]');
    if (!select) throw new Error('任务下拉未渲染');

    select.value = 'm-2';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(drawer.filter.missionId).toBe('m-2');
    expect(rows(drawer).map((r) => r.getAttribute('data-entry'))).toEqual([
      'mission:m-2:running',
      'notice:n-3',
    ]);
  });

  test('点级别筹码 = 勾选/取消该级别（默认全选，点一下是"摘掉它"）；「全部级别」恢复', () => {
    const { drawer } = setup();

    // 默认不过滤 = 三级全勾；点 error = 取消勾选 error
    clickAction(drawer, 'level', 'error');
    expect(drawer.filter.levels).toEqual(new Set(['info', 'warn']));
    expect(rows(drawer).every((r) => r.getAttribute('data-level') === 'info')).toBe(true);
    expect(rows(drawer).length).toBeGreaterThan(0);

    clickAction(drawer, 'levels-all');
    expect(drawer.filter.levels).toBeNull();
    expect(rows(drawer)).toHaveLength(5);
  });

  test('筹码的按下态反映真实筛选（aria-pressed 与 filter 一致）', () => {
    const { drawer } = setup();
    const pressed = (level: string): string | null | undefined =>
      drawer.shadowRoot?.querySelector(`button[data-action="level"][data-level="${level}"]`)?.getAttribute('aria-pressed');
    const allPressed = (): string | null | undefined =>
      drawer.shadowRoot?.querySelector('button[data-action="levels-all"]')?.getAttribute('aria-pressed');

    expect(allPressed()).toBe('true'); // 默认不过滤
    expect(pressed('error')).toBe('true');

    clickAction(drawer, 'level', 'error');
    expect(pressed('error')).toBe('false');
    expect(pressed('info')).toBe('true');
    expect(allPressed()).toBe('false');
  });

  test('任务 + 级别是两个「与」条件；选满三级自动归一回「全部级别」', () => {
    const { drawer } = setup();

    // m-1 下有「任务 m-1 进行中」(info) 与「任务一报错」(error)；取消 error 后只剩前者
    drawer.setMissionFilter('m-1');
    clickAction(drawer, 'level', 'error');
    expect(drawer.filter.levels).toEqual(new Set(['info', 'warn']));
    expect(rows(drawer).map((r) => r.getAttribute('data-entry'))).toEqual(['mission:m-1:running']);

    // 现在是 {info, warn}；补上第三个级别 → 满三级 → 归一为 null（「全部级别」筹码与三个级别筹码不再两套真相）
    clickAction(drawer, 'level', 'error');
    expect(drawer.filter.levels).toBeNull();
  });

  test('过滤到空 → 明说是筛选结果，不是"暂无日志"', () => {
    const { drawer } = setup();
    drawer.setMissionFilter('m-ghost');
    expect(rows(drawer)).toHaveLength(0);
    expect(text(drawer, 'empty')).toBe('当前筛选下没有日志');
  });
});

describe('清空当前视图', () => {
  test('点「清空」→ 行全没了，且 state 里还活着的通知不会回放', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    const state = makeState({ notices: [notice({ id: 'n-1', text: '会被清掉' })] });
    harness.emit(state);
    expect(rows(drawer)).toHaveLength(1);

    clickAction(drawer, 'clear');
    expect(rows(drawer)).toHaveLength(0);
    expect(drawer.entries).toEqual([]);

    // 同一份 state 再广播一次：已消费记忆没清 → 不复活
    harness.emit(state);
    expect(rows(drawer)).toHaveLength(0);
  });

  test('清空后新通知仍然进得来', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    harness.emit(makeState({ notices: [notice({ id: 'n-1' })] }));
    clickAction(drawer, 'clear');
    harness.emit(makeState({ notices: [notice({ id: 'n-2' })] }));

    expect(rows(drawer).map((r) => r.getAttribute('data-entry'))).toEqual(['notice:n-2']);
  });

  test('清空不影响筛选条件（清的是行，不是筛选态）', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    harness.emit(makeState({ notices: [notice({ id: 'n-1', level: 'error' })] }));
    clickAction(drawer, 'level', 'error');
    const levelsBefore = drawer.filter.levels;
    clickAction(drawer, 'clear');

    expect(drawer.filter.levels).toEqual(levelsBefore);
    expect(drawer.filter.levels).toEqual(new Set(['info', 'warn']));
  });
});

describe('抽屉形态：可折叠', () => {
  test('点「收起」→ body 清空、按钮文案变「展开」；再点恢复', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);
    harness.emit(makeState({ notices: [notice({ id: 'n-1' })] }));
    expect(rows(drawer)).toHaveLength(1);

    clickAction(drawer, 'toggle');
    expect(drawer.collapsed).toBe(true);
    expect(rows(drawer)).toHaveLength(0);
    expect(drawer.shadowRoot?.querySelector('[data-role="body"]')?.textContent).toBe('');
    expect(drawer.shadowRoot?.querySelector('button[data-action="toggle"]')?.textContent).toBe('展开');

    clickAction(drawer, 'toggle');
    expect(drawer.collapsed).toBe(false);
    expect(rows(drawer)).toHaveLength(1);
  });

  test('折叠期间来的通知不会被漏掉（进缓冲，恢复即渲染）', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    harness.emit(makeState({ notices: [notice({ id: 'n-1' })] }));
    clickAction(drawer, 'toggle');
    harness.emit(makeState({ notices: [notice({ id: 'n-2' }), notice({ id: 'n-1' })] }));

    expect(drawer.entries).toHaveLength(2); // 缓冲里有
    expect(rows(drawer)).toHaveLength(0); // 折叠着不画

    clickAction(drawer, 'toggle');
    expect(rows(drawer)).toHaveLength(2);
  });

  test('折叠态用 host 的 collapsed attribute 表达（组件外也能选到）', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);

    expect(drawer.hasAttribute('collapsed')).toBe(false);
    clickAction(drawer, 'toggle');
    expect(drawer.hasAttribute('collapsed')).toBe(true);
  });
});

describe('纯展示：不产生 HudCommand', () => {
  test('抽屉的依赖面里没有 dispatch（类型层面就发不出命令）', () => {
    const { drawer, harness } = mountDrawer();
    mounted.push(harness.unmount);
    harness.emit(makeState({ notices: [notice({ id: 'n-1' })], missions: [mission({ id: 'm-1' })] }));

    // 折叠 / 过滤 / 清空全走一遍，没有任何命令出口
    clickAction(drawer, 'toggle');
    clickAction(drawer, 'toggle');
    clickAction(drawer, 'level', 'error');
    clickAction(drawer, 'levels-all');
    clickAction(drawer, 'clear');

    expect(Object.keys(drawer.adapter ?? {})).toEqual(['subscribe']);
    expect(drawer.collapsed).toBe(false);
    expect(drawer.filter.levels).toBeNull();
  });
});

describe('资源清理', () => {
  test('卸载后订阅被释放，不再响应后续广播（不泄漏监听器）', () => {
    const { drawer, harness } = mountDrawer();

    expect(harness.subscriberCount()).toBe(1);
    harness.unmount();
    expect(harness.subscriberCount()).toBe(0);

    const before = drawer.entries.length;
    harness.emit(makeState({ notices: [notice({ id: 'n-1' })] }));
    expect(drawer.entries.length).toBe(before);
  });

  test('反复挂载卸载不会把订阅堆起来', () => {
    for (let i = 0; i < 5; i++) {
      const { harness } = mountDrawer();
      expect(harness.subscriberCount()).toBe(1);
      harness.unmount();
      expect(harness.subscriberCount()).toBe(0);
    }
  });
});

describe('装配进 main-screen（dev 页走的就是这条路径）', () => {
  test('主屏把日志抽屉挂上，走真实订阅链渲染，并在卸载时随之退订', () => {
    const subs = new Set<(state: WorldState) => void>();
    const adapter = {
      dispatch: () => { /* 抽屉是纯展示，不该有命令流过；这里故意留空以示不依赖 */ },
      subscribe: (handler: (state: WorldState) => void) => {
        subs.add(handler);
        return () => { subs.delete(handler); };
      },
      mount: () => () => { /* 本用例不关心 core 订阅 */ },
      latest: null,
      // 皮肤真相（@since task_115）：主屏要读当前皮肤，装配用的假 adapter 也要给一份。
      themeId: 'default' as const,
      subscribeTheme: () => () => undefined,
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = createMainScreen(adapter).mount(host);

    const drawer = host.querySelector(LOG_DRAWER_TAG) as StratLogDrawerElement;
    if (!drawer?.shadowRoot) throw new Error('主屏未挂上日志抽屉');

    subs.forEach((handler) =>
      handler(makeState({ notices: [notice({ id: 'n-1', level: 'warn', text: '主屏链路' })] })),
    );
    expect(rows(drawer)).toHaveLength(1);
    expect(rows(drawer)[0].getAttribute('data-level')).toBe('warn');

    unmount();
    host.remove();
    expect(subs.size).toBe(0); // 主屏卸载 → 抽屉随之退订
  });
});