/**
 * 集成测试：命令行命令注册表（@since v3.6，task_113）。
 *
 * 覆盖两条线：
 *   1. 注册表（纯逻辑）：命令名 / 别名 / 参数 / 白名单 / 未命中的近似候选；
 *   2. 命令面板：搜索框回车 → 真的执行（mission 开对话框、theme 切皮肤、
 *      settings 开设置页、replay 放回放、help 列命令），未匹配 → 回可用命令清单。
 *
 * 面板是真组件（真 Shadow DOM、真事件链），替身只有 adapter 两个方法与回放读取口 ——
 *   也就是 HUD 与总线之间的全部边界。断言打在"派发出了什么命令 / 面板说了什么"上。
 *
 * @jest-environment jsdom
 */

import type { HudCommand, WorldState } from '../../core/types';
import { COMMAND_PANEL_TAG, mountCommandPanel, type StratCommandPanelElement } from '../panels/command-panel';
import {
  CLI_COMMANDS,
  cliHelpText,
  cliUnknownText,
  parseCliInput,
} from '../panels/command-registry';
import { NEW_TASK_OPEN_EVENT } from '../components/new-task-dialog/new-task-dialog';
import { createReplayController, type ReplayController } from '../components/replay/replay-controller';
import type { DayReplayEntry } from '../components/replay/replay-catalog';

const UNITS = [
  { id: 'u-neo', name: 'Neo', status: 'idle' as const, missionId: null, power: 3 },
];

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
  };
}

interface Harness {
  readonly commands: HudCommand[];
  readonly panel: StratCommandPanelElement;
  /** 敲一行命令行并回车（走真实的 keydown 事件链）。 */
  run(raw: string): Promise<void>;
  /** 面板回执区文案。 */
  output(): string;
  unmount(): void;
}

function mountPanel(replay: ReplayController | null = null): Harness {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const host = document.createElement('div');
  document.body.appendChild(host);

  const unmountPanel = mountCommandPanel(
    {
      dispatch: (command) => { commands.push(command); },
      subscribe: (handler) => {
        subs.add(handler);
        return () => { subs.delete(handler); };
      },
    },
    host,
    { replay }
  );
  const panel = host.querySelector(COMMAND_PANEL_TAG) as StratCommandPanelElement;
  if (!panel?.shadowRoot) throw new Error('命令面板未 upgrade（shadowRoot 为空）');

  const query = panel.shadowRoot.querySelector<HTMLInputElement>('[data-role="query"]');
  if (!query) throw new Error('命令输入框未渲染');

  return {
    commands,
    panel,
    run: async (raw: string) => {
      query.value = raw;
      query.dispatchEvent(new Event('input', { bubbles: true }));
      query.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      // 回车处理是异步的（replay 要等读取口）：让出两轮微任务 + 一个宏任务。
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    output: () => panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '',
    unmount: () => { unmountPanel(); host.remove(); },
  };
}

/** 当天的两条回放条目（真形状，不是假数据 —— 只在单测里当读取口的返回）。 */
function entries(): DayReplayEntry[] {
  return [
    { at: 1000, kind: 'spawn', characterId: 'c-1', taskId: 't-1', label: '开工', sessionId: 's-1' },
    { at: 2000, kind: 'done', characterId: 'c-1', taskId: 't-1', label: '完成', sessionId: 's-1' },
  ];
}

/** 真控制器 + 假读取口（读取口是唯一的 IO 边界）。 */
function controller(port: { loadDay: () => Promise<readonly DayReplayEntry[]> }): ReplayController {
  return createReplayController({
    port,
    emitBeat: () => undefined,
    setClock: () => undefined,
    // 假定时器：play() 之后不再推进（单测只关心"开始放了"），也不留真定时器挂住 jest。
    timers: { setTimeout: () => 0, clearTimeout: () => undefined },
  });
}

let mounted: Array<() => void> = [];

afterEach(() => {
  mounted.forEach((dispose) => dispose());
  mounted = [];
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[data-srf-theme]').forEach((node) => node.remove());
});

describe('注册表：命令名 / 别名 / 参数', () => {
  test('mission 带标题 → 命中，参数原样保留（标题里的空格不能丢）', () => {
    const parsed = parseCliInput('mission 重构 总线');
    expect(parsed.kind).toBe('matched');
    expect(parsed.spec?.id).toBe('mission');
    expect(parsed.arg).toBe('重构 总线');
  });

  test('中文别名也认（底栏提示词承诺过「主题 / 设置」）', () => {
    expect(parseCliInput('主题').spec?.id).toBe('theme');
    expect(parseCliInput('设置').spec?.id).toBe('settings');
    expect(parseCliInput('回放').spec?.id).toBe('replay');
    expect(parseCliInput('帮助').spec?.id).toBe('help');
  });

  test('命令名大小写不敏感', () => {
    expect(parseCliInput('HELP').spec?.id).toBe('help');
    expect(parseCliInput('Settings').spec?.id).toBe('settings');
  });

  test('mission 不带标题 → 参数缺失（给用法提示，不执行）', () => {
    const parsed = parseCliInput('mission');
    expect(parsed.kind).toBe('missing-arg');
    expect(parsed.spec?.id).toBe('mission');
  });

  test('theme 的参数只认 default / pixel（契约口径），其它值判非法', () => {
    expect(parseCliInput('theme pixel').kind).toBe('matched');
    expect(parseCliInput('theme default').kind).toBe('matched');
    const bad = parseCliInput('theme ocean');
    expect(bad.kind).toBe('invalid-arg');
    expect(bad.spec?.id).toBe('theme');
  });

  test('未命中 → unknown，并给一个近似候选', () => {
    const parsed = parseCliInput('sett');
    expect(parsed.kind).toBe('unknown');
    expect(parsed.suggestion).toBe('settings');
  });

  test('空输入 → empty（不是未命中）', () => {
    expect(parseCliInput('   ').kind).toBe('empty');
  });

  test('help 文案列出全部命令（列出来的必须就是能敲的）', () => {
    const text = cliHelpText();
    for (const spec of CLI_COMMANDS) {
      expect(text).toContain(spec.usage);
    }
    expect(text).toContain('mission <标题>');
    expect(text).toContain('replay');
  });

  test('未匹配文案给清单，不是干巴巴一句拒绝', () => {
    const text = cliUnknownText('瞎敲的');
    expect(text).toContain('没有匹配的命令');
    expect(text).toContain('mission <标题>');
    expect(text).toContain('replay');
  });
});

describe('命令面板：回车即执行', () => {
  test('mission <标题> → 打开新建任务对话框（预填标题），且不自己派单', async () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);

    const opened: string[] = [];
    const onOpen = (event: Event): void => {
      opened.push((event as CustomEvent<{ title?: string }>).detail?.title ?? '');
    };
    document.addEventListener(NEW_TASK_OPEN_EVENT, onOpen);
    try {
      await harness.run('mission 走查验收任务');

      expect(opened).toEqual(['走查验收任务']);
      // 派单逻辑不重复实现：命令行只负责把标题带过去。
      expect(harness.commands).toEqual([]);
      expect(harness.output()).toContain('走查验收任务');
      // 标题草稿同步成同一句（面板内不留两份真相）。
      const draft = harness.panel.shadowRoot?.querySelector<HTMLInputElement>('[data-role="draft"]');
      expect(draft?.value).toBe('走查验收任务');
    } finally {
      document.removeEventListener(NEW_TASK_OPEN_EVENT, onOpen);
    }
  });

  test('settings → 派 ui.navigate(settings)', async () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);

    await harness.run('settings');

    expect(harness.commands).toEqual([{ type: 'ui.navigate', screen: 'settings' }]);
    expect(harness.output()).toContain('设置');
  });

  test('theme → 派 theme.set（不带参数时切到像素风）', async () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);

    await harness.run('theme');

    expect(harness.commands).toEqual([{ type: 'theme.set', themeId: 'pixel' }]);
    expect(harness.output()).toContain('像素风');
  });

  test('theme default → 派 theme.set(default)', async () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);

    await harness.run('theme default');

    expect(harness.commands).toEqual([{ type: 'theme.set', themeId: 'default' }]);
  });

  test('皮肤没真的换掉 → 明确降级提示（不假装切成功）', async () => {
    // 造一张"当前皮肤"样式表：命令派出去后它没变 → 说明 handler 没接上。
    const style = document.createElement('style');
    style.setAttribute('data-srf-theme', 'default');
    document.head.appendChild(style);

    const harness = mountPanel();
    mounted.push(harness.unmount);

    await harness.run('theme');

    expect(harness.commands).toEqual([{ type: 'theme.set', themeId: 'pixel' }]);
    expect(harness.output()).toContain('皮肤系统接入中');
  });

  test('replay → 读到今天的记录就放（同一份回放控制器）', async () => {
    const replay = controller({ loadDay: async () => entries() });
    const harness = mountPanel(replay);
    mounted.push(harness.unmount);

    await harness.run('replay');

    expect(replay.state.playing).toBe(true);
    expect(harness.output()).toContain('正在回放今天');
  });

  test('replay → 网关不可用给人话提示 + 重试指引', async () => {
    const replay = controller({
      loadDay: async () => { throw new Error('gateway down'); },
    });
    const harness = mountPanel(replay);
    mounted.push(harness.unmount);

    await harness.run('replay');

    expect(harness.output()).toContain('回放失败');
    expect(harness.output()).toContain('重试');
    expect(replay.state.playing).toBe(false);
  });

  test('replay → 今天没活儿也说实话（不编数据）', async () => {
    const replay = controller({ loadDay: async () => [] });
    const harness = mountPanel(replay);
    mounted.push(harness.unmount);

    await harness.run('replay');

    expect(harness.output()).toContain('今天还没有任务记录');
    expect(replay.state.playing).toBe(false);
  });

  test('replay → 没有回放控制器时如实说没接线', async () => {
    const harness = mountPanel(null);
    mounted.push(harness.unmount);

    await harness.run('replay');

    expect(harness.output()).toContain('没接线');
    expect(harness.commands).toEqual([]);
  });

  test('help → 列出全部可用命令', async () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);

    await harness.run('help');

    const text = harness.output();
    for (const spec of CLI_COMMANDS) {
      expect(text).toContain(spec.usage);
    }
  });

  test('未匹配输入 → 回执给可用命令清单（不是干巴巴拒绝）', async () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);

    await harness.run('瞎敲的');

    expect(harness.output()).toContain('没有匹配的命令');
    expect(harness.output()).toContain('mission <标题>');
    expect(harness.output()).toContain('settings');
    expect(harness.commands).toEqual([]);
  });

  test('mission 不带标题 → 给用法提示，不派任何命令', async () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);

    await harness.run('mission');

    expect(harness.output()).toContain('用法：mission <标题>');
    expect(harness.commands).toEqual([]);
  });

  test('过滤空时给出引导（命令输入框不再是死路）', () => {
    const harness = mountPanel();
    mounted.push(harness.unmount);

    const input = harness.panel.shadowRoot?.querySelector<HTMLInputElement>('[data-role="query"]');
    if (!input) throw new Error('命令输入框未渲染');
    input.value = 'mission 走查';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const empty = harness.panel.shadowRoot?.querySelector('[data-role="empty"]');
    expect(empty?.textContent).toContain('回车执行');
    const hint = harness.panel.shadowRoot?.querySelector('[data-role="empty-hint"]');
    expect(hint?.textContent).toContain('replay');
  });
});
