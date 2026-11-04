/**
 * 集成测试：⌘K 命令面板 + 共享命令注册表（@since v3.9，task_150）。
 *
 * 覆盖验收口径：
 *   1. ⌘K 唤起 → 输两字模糊命中 → Enter 执行，**全程无鼠标**；
 *   2. ≥15 条命令注册；底栏 composer 的五命令 + 中文别名零回归（词表同源）；
 *   3. 不可用命令灰态 + 原因（0 角色时「派发任务」）；
 *   4. ESC 栈语义：面板在栈顶 → 先关面板，下面的对话框后关；
 *   5. 最近使用置顶生效。
 *
 * 替身只有两个边界：adapter（派发 + 订阅状态）与遮挡控制器（ESC 路由）。
 *
 * @jest-environment jsdom
 */

import type { HudCommand, WorldState } from '../../core/types';
import {
  COMMAND_PALETTE_TAG,
  mountCommandPalette,
  type StratCommandPaletteElement,
} from '../components/command-palette/command-palette';
import { createOcclusionController, type OcclusionController } from '../layers/occlusion';
import {
  APP_COMMANDS,
  CLI_BINDINGS,
  filterAppCommands,
  groupAppCommands,
  resolveAppCommands,
  sortByRecentUsage,
} from '../lib/command-registry';
import { resetAppActions } from '../lib/app-actions';
import { MAX_RECENT_COMMANDS, RECENT_COMMANDS_STORAGE_KEY } from '../lib/recent-commands';

const UNITS = [{ id: 'u-neo', name: 'Neo', status: 'idle' as const, missionId: null, power: 3 }];

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: UNITS,
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  } as WorldState;
}

interface Harness {
  readonly commands: HudCommand[];
  readonly element: StratCommandPaletteElement;
  readonly occlusion: OcclusionController;
  /** 广播一份状态（模拟 core 推送）。 */
  push(state: WorldState): void;
  /** 敲 ⌘K（全局唤起）。 */
  pressPaletteKey(): void;
  /** 在搜索框里打字（真的 input 事件链）。 */
  type(text: string): void;
  /** 在搜索框里敲一个键。 */
  press(key: string, init?: KeyboardEventInit): void;
  search(): HTMLInputElement;
  unmount(): void;
}

function mount(): Harness {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const occlusion = createOcclusionController({ document });

  const unmountPalette = mountCommandPalette(
    {
      dispatch: (command) => { commands.push(command); },
      subscribe: (handler) => {
        subs.add(handler);
        return () => { subs.delete(handler); };
      },
    },
    host,
    { occlusion }
  );
  const element = host.querySelector(COMMAND_PALETTE_TAG) as StratCommandPaletteElement;
  if (!element?.shadowRoot) throw new Error('命令面板未 upgrade（shadowRoot 为空）');

  const search = (): HTMLInputElement => {
    const input = element.shadowRoot?.querySelector<HTMLInputElement>('[data-role="search"]');
    if (!input) throw new Error('搜索框未渲染');
    return input;
  };

  return {
    commands,
    element,
    occlusion,
    push: (state) => { subs.forEach((handler) => { handler(state); }); },
    pressPaletteKey: () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    },
    type: (text) => {
      const input = search();
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    press: (key, init) => {
      search().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    },
    search,
    unmount: () => { unmountPalette(); host.remove(); },
  };
}

let mounted: Array<() => void> = [];

beforeEach(() => {
  window.localStorage.clear();
  resetAppActions();
});

afterEach(() => {
  mounted.forEach((dispose) => dispose());
  mounted = [];
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[data-srf-theme]').forEach((node) => node.remove());
});

describe('共享注册表：一份事实源', () => {
  test('全应用命令 ≥15 条（⌘K 面板的覆盖面）', () => {
    expect(APP_COMMANDS.length).toBeGreaterThanOrEqual(15);
  });

  test('底栏 composer 的五命令 + 中文别名收编在注册表里（词表同源）', () => {
    expect(CLI_BINDINGS.map((b) => b.name)).toEqual(['mission', 'theme', 'settings', 'replay', 'help']);
    const aliasOf = (name: string): readonly string[] =>
      CLI_BINDINGS.find((b) => b.name === name)?.aliases ?? [];
    expect(aliasOf('mission')).toEqual(['任务', '新建任务']);
    expect(aliasOf('theme')).toEqual(['主题', '皮肤']);
    expect(aliasOf('settings')).toEqual(['设置']);
    expect(aliasOf('replay')).toEqual(['回放']);
    expect(aliasOf('help')).toEqual(['帮助', '?']);
  });

  test('每条命令都有标题、别名、分组与动作（没有半成品条目）', () => {
    for (const spec of APP_COMMANDS) {
      expect(spec.title.length).toBeGreaterThan(0);
      expect(spec.aliases.length).toBeGreaterThan(0);
      expect(spec.group.length).toBeGreaterThan(0);
      expect(spec.action.kind.length).toBeGreaterThan(0);
    }
  });

  test('模糊匹配：两个字命中标题/别名（不用拼音库）', () => {
    const hits = filterAppCommands(APP_COMMANDS, '像素').map((c) => c.id);
    expect(hits).toContain('theme.pixel');
    expect(filterAppCommands(APP_COMMANDS, '日志').map((c) => c.id)).toContain('log.open');
    expect(filterAppCommands(APP_COMMANDS, '设置').map((c) => c.id)).toContain('settings.open');
  });

  test('分组渲染：按组归并且组内保序', () => {
    const groups = groupAppCommands(resolveAppCommands(APP_COMMANDS, { state: null, draftTitle: '' }));
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.map((g) => g.id)).toEqual(['task', 'character', 'view', 'appearance', 'help']);
  });

  test('最近使用置顶：排在前面的命令提到最前', () => {
    const sorted = sortByRecentUsage(APP_COMMANDS, ['settings.open']);
    expect(sorted[0]?.id).toBe('settings.open');
  });
});

describe('⌘K 面板：全程无鼠标', () => {
  test('⌘K 唤起 → 焦点进搜索框 → 输两字模糊命中 → Enter 执行', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    harness.pressPaletteKey();
    expect(harness.element.isOpen).toBe(true);
    // 唤起即可打字（不用再按一下 Tab）。
    // 焦点在影子树里 —— document.activeElement 指向宿主，真实焦点看 shadowRoot.activeElement。
    expect(harness.element.shadowRoot?.activeElement).toBe(harness.search());

    harness.type('像素');
    expect(harness.element.visibleCommandIds).toContain('theme.pixel');

    harness.press('Enter');
    expect(harness.commands).toEqual([{ type: 'theme.set', themeId: 'pixel' }]);
    // 执行完面板关闭。
    expect(harness.element.isOpen).toBe(false);
  });

  test('Ctrl+K 也能唤起（Windows / Linux 口径）', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    expect(harness.element.isOpen).toBe(true);
  });

  test('↑↓ 选择 + Enter 执行（选择真的在动）', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    harness.pressPaletteKey();
    harness.type('设置');
    expect(harness.element.visibleCommandIds).toEqual(['settings.open']);

    harness.press('ArrowDown');
    expect(harness.element.selectedIndex).toBe(0); // 只有一条 → 停在原地
    harness.press('Enter');
    expect(harness.commands).toEqual([{ type: 'ui.navigate', screen: 'settings' }]);
  });

  test('Esc 关闭面板', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    harness.pressPaletteKey();
    expect(harness.element.isOpen).toBe(true);

    harness.press('Escape');
    expect(harness.element.isOpen).toBe(false);
  });

  test('Tab 不逃逸（focus trap）', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    harness.pressPaletteKey();
    const input = harness.search();
    expect(harness.element.shadowRoot?.activeElement).toBe(input);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    // 焦点仍在面板内（不是逃到 body 外的元素上）。
    const active = harness.element.shadowRoot?.activeElement ?? null;
    expect(active).not.toBeNull();
    expect(harness.element.shadowRoot?.contains(active)).toBe(true);
  });

  test('执行后焦点回原位（原位可聚焦才回）', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    const origin = document.createElement('button');
    document.body.appendChild(origin);
    origin.focus();
    expect(document.activeElement).toBe(origin);

    harness.pressPaletteKey();
    expect(document.activeElement).not.toBe(origin);

    harness.type('设置');
    harness.press('Enter');
    expect(document.activeElement).toBe(origin);
  });
});

describe('不可用命令：灰态 + 原因', () => {
  test('0 角色时「派发任务」灰态并给出原因', () => {
    const harness = mount();
    mounted.push(harness.unmount);
    harness.push(makeState());

    harness.pressPaletteKey();
    harness.type('派发');

    const item = harness.element.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[data-command="task.dispatch"]'
    );
    expect(item).not.toBeNull();
    expect(item?.disabled).toBe(true);
    expect(item?.textContent).toContain('没有可派发的角色');
  });

  test('有角色但没写指令 → 灰态给另一条原因（说清缺什么）', () => {
    const harness = mount();
    mounted.push(harness.unmount);
    harness.push(makeState({
      characters: [
        { id: 'c-1', name: 'Neo', agentKind: 'coder', level: 1 },
      ] as never,
    }));

    harness.pressPaletteKey();
    harness.type('派发');

    const item = harness.element.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[data-command="task.dispatch"]'
    );
    expect(item?.disabled).toBe(true);
    expect(item?.textContent).toContain('任务指令');
  });
});

describe('关着的时候不能挡页面（@since v3.9，task_152）', () => {
  test('挂载即关闭态：遮罩与面板都带 hidden（不铺在全屏上）', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    // 遮罩是全屏 + pointer-events:auto —— 一旦它是可见态，整个页面就被它罩住
    // （全屏发暗 + 所有点击被吃掉 = 用户实测的「模态框遮挡页面」）。
    const backdrop = harness.element.shadowRoot?.querySelector('[data-role="backdrop"]');
    const panel = harness.element.shadowRoot?.querySelector('[data-role="panel"]');
    expect((backdrop as HTMLElement | null)?.hidden).toBe(true);
    expect((panel as HTMLElement | null)?.hidden).toBe(true);
  });

  test('样式表里显式压掉 hidden 的 display（作者样式压过 UA 的 [hidden]）', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    // .panel 自带 display:grid —— 作者样式压过 UA 的 [hidden]{display:none}，
    //   光打 hidden 属性不够，组件自己的样式表必须再压一条 display:none。
    const css = harness.element.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/\.panel\[hidden\][^{]*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.backdrop\[hidden\][^{]*\{[^}]*display:\s*none/);
  });

  test('打开 → 遮罩与面板现身；关闭 → 又藏回去', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    harness.pressPaletteKey();
    const backdrop = harness.element.shadowRoot?.querySelector('[data-role="backdrop"]') as HTMLElement;
    const panel = harness.element.shadowRoot?.querySelector('[data-role="panel"]') as HTMLElement;
    expect(backdrop.hidden).toBe(false);
    expect(panel.hidden).toBe(false);

    harness.press('Escape');
    expect(backdrop.hidden).toBe(true);
    expect(panel.hidden).toBe(true);
  });
});

describe('ESC 栈语义（@since v3.9，task_146）：顺序按栈', () => {
  test('面板在栈顶 → 第一次 ESC 只关面板，下面的对话框还在', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    // 底下先开一个对话框（模拟新建任务对话框）。
    harness.occlusion.openModal('new-task-dialog');
    harness.pressPaletteKey();
    expect(harness.occlusion.state.modals).toEqual(['new-task-dialog', 'command-palette']);

    harness.press('Escape');
    expect(harness.element.isOpen).toBe(false);
    // 栈顶被摘掉，底下的对话框**没被动**。
    expect(harness.occlusion.state.modals).toEqual(['new-task-dialog']);
  });

  test('面板不在栈顶时，ESC 由遮挡控制器路由到栈顶', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    harness.pressPaletteKey();
    harness.occlusion.openModal('new-task-dialog');
    expect(harness.occlusion.state.activeModal).toBe('new-task-dialog');

    // 栈顶是对话框 → ESC 关它（不是关面板）。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(harness.occlusion.state.modals).toEqual(['command-palette']);
  });
});

describe('最近使用置顶', () => {
  test('执行过的命令下次排到最前', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    harness.pressPaletteKey();
    harness.type('设置');
    harness.press('Enter');
    expect(harness.commands).toHaveLength(1);

    const stored = JSON.parse(
      window.localStorage.getItem(RECENT_COMMANDS_STORAGE_KEY) ?? '[]'
    ) as string[];
    expect(stored[0]).toBe('settings.open');

    // 再开一次 → 置顶。
    harness.pressPaletteKey();
    expect(harness.element.visibleCommandIds[0]).toBe('settings.open');
  });

  test('记忆条数封顶（最多 5 条 —— 数据不许无限增长）', () => {
    const harness = mount();
    mounted.push(harness.unmount);

    for (const id of ['settings.open', 'log.open', 'status.open', 'chat.open', 'character.open', 'help.shortcuts']) {
      const spec = APP_COMMANDS.find((c) => c.id === id);
      if (!spec) continue;
      harness.pressPaletteKey();
      harness.type(spec.title);
      harness.press('Enter');
    }

    const stored = JSON.parse(
      window.localStorage.getItem(RECENT_COMMANDS_STORAGE_KEY) ?? '[]'
    ) as string[];
    expect(stored.length).toBeLessThanOrEqual(MAX_RECENT_COMMANDS);
  });
});
