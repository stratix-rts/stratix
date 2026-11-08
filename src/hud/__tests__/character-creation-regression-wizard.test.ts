/**
 * 回归套件：**新建角色流程 V1-V12 矩阵 · 向导与角色中心段**（@since v3.3，task_228 · CC-03）。
 *
 * 权威定义：docs/DESIGN-character-creation.md §4「验收矩阵 V1-V12」。
 * 本文件覆盖 **V4-V10 / V12**（向导内部 + 角色中心顶栏）；
 * 入口与收口那几条（V1 / V2 / V3 / V11）见 src/app/__tests__/character-creation-regression-entry.test.ts。
 *
 * ============ 断言怎么"指认 V 条目" ============
 *   每条用例的标题都以 **V编号** 开头（`V7 · …`），失败时 jest 报出的用例名
 *   直接就是验收矩阵里的那一条 —— 不用回头翻代码猜是哪条挂了。
 *
 * ============ 点击口径（探针转正）============
 *   所有按钮点击都走 `helpers/shadow-widget.ts`（从 /tmp/cc-flow-probe3.mjs 的
 *   `window.__wizClick` 提炼）：strat-button 的可点区域在它自己的 shadow DOM 里，
 *   不穿透就点不动 —— 会把"测试点不到"误判成"产品坏了"。
 *
 * @jest-environment jsdom
 */

import type { DetectedAgent, HudCommand, WorldState } from '../../core/types';
import { DETECTABLE_AGENT_KINDS, DEFAULT_INSTANCE_ID } from '../../core/types';
import { createSkinRandomizer } from '../../core/theme/skin-registry';

import { clickByAction, clickWidget, dumpWidgets, fillTextInput } from './helpers/shadow-widget';

import { CLI_INSTALL_GUIDE_URL } from '../screens/onboarding-catalog';
import type { CustomAgentsPort } from '../screens/custom-agents-port';
import {
  ONBOARDING_RESCAN_EVENT,
  ONBOARDING_SCREEN_TAG,
  mountOnboardingScreen,
  type OnboardingScreenDeps,
  type StratOnboardingScreenElement,
} from '../screens/onboarding-screen';
import {
  CHARACTER_CREATE_EVENT,
  CHARACTER_SCREEN_TAG,
  mountCharacterScreen,
  type StratCharacterScreenElement,
} from '../screens/character-screen';

// ============================================================================
// 夹具
// ============================================================================

function detected(partial: Partial<DetectedAgent> & { kind: DetectedAgent['kind'] }): DetectedAgent {
  return {
    tier: 'T1',
    installed: false,
    status: 'not-installed',
    version: null,
    path: null,
    ...partial,
  };
}

/** 已装的 claude-code（**无专属预设** → 人设步初始未配置：走问卷或默认模板）。 */
const CLAUDE = detected({
  kind: 'claude-code',
  tier: 'T1',
  installed: true,
  status: 'installed',
  version: '1.2.3',
  path: '/usr/bin/claude',
});

/** 探测超时（探到了但没装）→ 0 可建档。 */
const TIMEOUT = detected({ kind: 'kimi', tier: 'T1', installed: false, status: 'timeout' });

/**
 * 「扫描跑完、但一个可建档的都没有」的状态。
 * why 要铺满静态名单：扫描完成判定是"静态名单全部有结论"（onboarding-catalog 的
 * `isDetectionComplete`）—— 只报一条时状态还是"扫描中"，那测的是 V6 不是 V5。
 */
function scanCompleteButNothingBindable(): DetectedAgent[] {
  return DETECTABLE_AGENT_KINDS.map((kind) =>
    detected({ kind, tier: 'T1', installed: false, status: 'not-installed' })
  );
}

function makeState(detectedAgents?: DetectedAgent[], extra?: Partial<WorldState>): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...(detectedAgents ? { detectedAgents } : {}),
    ...(extra ?? {}),
  };
}

/** 项目实例视图（最小可用字段）。 */
function projectInstance(instanceId: string, title: string) {
  return {
    instanceId,
    projectId: 'proj_1',
    path: `/tmp/${instanceId}`,
    title,
    lastOpenedAt: 0,
    pinned: false,
    archived: false,
    status: 'active' as const,
  };
}

interface WizardHarness {
  readonly screen: StratOnboardingScreenElement;
  readonly host: HTMLElement;
  readonly commands: HudCommand[];
  /** 广播一份状态（走屏的真实订阅链）。 */
  emit(state: WorldState): void;
  unmount(): void;
}

/** 挂真的向导屏（注入适配器，不经真总线 —— 与既有向导测试同口径）。 */
function mountWizard(initial?: WorldState, options?: { readonly customAgents?: CustomAgentsPort }): WizardHarness {
  const commands: HudCommand[] = [];
  const handlers: ((state: WorldState) => void)[] = [];

  const deps: OnboardingScreenDeps = {
    dispatch: (command) => { commands.push(command); },
    subscribe: (next) => {
      handlers.push(next);
      return () => {
        const index = handlers.indexOf(next);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountOnboardingScreen(deps, host, {
    ...(options?.customAgents ? { customAgents: options.customAgents } : {}),
  });
  const screen = host.querySelector(ONBOARDING_SCREEN_TAG) as StratOnboardingScreenElement;
  if (!screen?.shadowRoot) throw new Error('向导屏未 upgrade（shadowRoot 为空）');
  const randomizer = createSkinRandomizer(42);
  screen.skinSource = () => randomizer.next();

  const emit = (state: WorldState): void => {
    for (const handler of handlers.slice()) handler(state);
  };
  if (initial) emit(initial);

  return {
    screen,
    host,
    commands,
    emit,
    unmount: () => { unmountScreen(); host.remove(); },
  };
}

/** 一条假的自定义 agent 注册端口（只关心"端口存在与否"）。 */
function fakeCustomAgentsPort(): CustomAgentsPort {
  return {
    list: async () => ({ ok: true, agents: [] }),
    create: async () => ({ ok: false, error: '未实现' }),
    remove: async () => ({ ok: true }),
    probe: async () => ({ ok: false, error: '未实现' }),
  };
}

/** 走到人设步（扫描 → 起名 → 人设）。 */
function gotoPersona(screen: StratOnboardingScreenElement): void {
  screen.next();
  expect(screen.step).toBe('identity');
  screen.next();
  expect(screen.step).toBe('persona');
}

function root(screen: StratOnboardingScreenElement): ShadowRoot {
  if (!screen.shadowRoot) throw new Error('向导影子树为空');
  return screen.shadowRoot;
}

/** 挂角色中心（子屏）。 */
function mountCharacterCenter(characters: WorldState['characters']): {
  readonly screen: StratCharacterScreenElement;
  readonly host: HTMLElement;
  unmount(): void;
} {
  const commands: HudCommand[] = [];
  const handlers: ((state: WorldState) => void)[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountCharacterScreen(
    {
      dispatch: (command) => { commands.push(command); },
      subscribe: (next) => {
        handlers.push(next);
        return () => {
          const index = handlers.indexOf(next);
          if (index >= 0) handlers.splice(index, 1);
        };
      },
    },
    host
  );
  const screen = host.querySelector(CHARACTER_SCREEN_TAG) as StratCharacterScreenElement;
  if (!screen?.shadowRoot) throw new Error('角色中心未 upgrade（shadowRoot 为空）');
  for (const handler of handlers.slice()) handler(makeState(undefined, { characters }));
  return {
    screen,
    host,
    unmount: () => { unmountScreen(); host.remove(); },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ============================================================================
// V4 —— 角色中心子屏 topbar 常驻「＋ 新建角色」，任何角色数可用
// ============================================================================

describe('V4 · 角色中心子屏顶栏常驻「＋ 新建角色」', () => {
  test('V4-1 · 0 角色 / 有角色，顶栏钮都在（子屏也有一级入口）', () => {
    const empty = mountCharacterCenter([]);
    const emptyBtn = empty.screen.shadowRoot?.querySelector('.topbar-actions [data-role="create-character"]');
    expect(emptyBtn).not.toBeNull();
    empty.unmount();

    const some = mountCharacterCenter([
      { id: 'c-1', name: '甲', persona: '', level: 1, experience: 0 },
    ]);
    const someBtn = some.screen.shadowRoot?.querySelector('.topbar-actions [data-role="create-character"]');
    expect(someBtn).not.toBeNull();
    some.unmount();
  });

  test('V4-2 · 点顶栏钮 → 派 strat-character-create（组合根据此开向导）', () => {
    const center = mountCharacterCenter([]);
    const seen: string[] = [];
    center.host.addEventListener(CHARACTER_CREATE_EVENT, (ev) => { seen.push(ev.type); });

    const btn = center.screen.shadowRoot?.querySelector('.topbar-actions [data-role="create-character"]');
    expect(btn).not.toBeNull();
    expect(clickWidget(btn as HTMLElement)).toBe('clicked');

    expect(seen).toEqual([CHARACTER_CREATE_EVENT]);
    center.unmount();
  });
});

// ============================================================================
// V5 —— 扫描完 0 可建档 agent → 向导不关；空态三动作可用
// ============================================================================

describe('V5 · 扫描完 0 可建档 → 向导不关 + 空态三动作', () => {
  test('V5-1 · 扫描完成且 0 可建档 → 向导仍在 + 三动作（重扫 / 自定义 / 指引）齐活', () => {
    const h = mountWizard(makeState(scanCompleteButNothingBindable()), {
      customAgents: fakeCustomAgentsPort(),
    });

    // 扫描确实跑完了（否则这条测的是 V6）。
    const status = h.screen.shadowRoot?.querySelector('[data-role="scan-status"]');
    expect(status?.textContent).toContain('扫描完成');

    // 向导没关（屏仍挂在宿主里）。
    expect(h.screen.isConnected).toBe(true);

    const actions = h.screen.shadowRoot?.querySelector('[data-role="scan-empty-actions"]');
    expect(actions).not.toBeNull();
    // ① 重新扫描
    expect(h.screen.shadowRoot?.querySelector('[data-action="rescan"]')).not.toBeNull();
    // ② ＋ 添加自定义 agent（端口存在才显示）
    expect(h.screen.shadowRoot?.querySelector('[data-action="custom-open-form"]')).not.toBeNull();
    // ③ 查看 CLI 安装指引
    const guide = h.screen.shadowRoot?.querySelector('[data-role="cli-install-guide"]') as HTMLAnchorElement | null;
    expect(guide?.getAttribute('href')).toBe(CLI_INSTALL_GUIDE_URL);
    expect(guide?.getAttribute('target')).toBe('_blank');
    expect(guide?.getAttribute('rel')).toContain('noopener');
    h.unmount();
  });

  test('V5-2 · 点「重新扫描」→ 派意图事件（组合根重派既有 detection 命令）', () => {
    const h = mountWizard(makeState(scanCompleteButNothingBindable()));

    let fired = 0;
    h.host.addEventListener(ONBOARDING_RESCAN_EVENT, () => { fired += 1; });
    expect(clickByAction(root(h.screen), 'rescan')).toBe('clicked');

    expect(fired).toBe(1);
    h.unmount();
  });
});

// ============================================================================
// V6 —— 扫描进行中：「正在等扫描结果…」+ 结果逐条刷新
// ============================================================================

describe('V6 · 扫描进行中 → 等待文案 + 结果逐条刷新', () => {
  test('V6-1 · 还没收到任何广播 → 「正在等扫描结果…」', () => {
    const h = mountWizard();
    const body = h.screen.shadowRoot?.querySelector('[data-role="body"]');
    expect(body?.textContent).toContain('正在等扫描结果');
    expect(h.screen.shadowRoot?.querySelector('[data-role="scan-status"]')?.textContent).toContain('扫描中');
    h.unmount();
  });

  test('V6-2 · 结果逐条到达 → 行数逐条涨（不是一次性全画）', () => {
    const h = mountWizard();

    h.emit(makeState([CLAUDE]));
    let rows = h.screen.shadowRoot?.querySelectorAll('[data-role="scan-row"]');
    expect(rows).toHaveLength(1);

    h.emit(makeState([CLAUDE, detected({ kind: 'codex', tier: 'T1', installed: true, status: 'installed' })]));
    rows = h.screen.shadowRoot?.querySelectorAll('[data-role="scan-row"]');
    expect(rows).toHaveLength(2);
    h.unmount();
  });
});

// ============================================================================
// V7 —— 人设步未配置 → 主按钮 disabled + footer 原因含"还差几题"
// ============================================================================

describe('V7 · 人设步未配置 → 禁用带原因', () => {
  test('V7-1 · 主按钮 disabled + 页脚说清还差几题（禁用必须带原因）', () => {
    const h = mountWizard(makeState([CLAUDE]));
    gotoPersona(h.screen);

    const primary = h.screen.shadowRoot?.querySelector('[data-action="next"]');
    expect(primary?.hasAttribute('disabled')).toBe(true);

    const reason = h.screen.shadowRoot?.querySelector('[data-role="footer-reason"]');
    expect(reason?.hasAttribute('hidden')).toBe(false);
    expect(reason?.textContent).toContain('人设还没配好');
    // 「还差几题」：题数必须是个正数（0 题 = 没差 = 不该拦）。
    const missing = /还差 (\d+) 题/.exec(reason?.textContent ?? '');
    expect(missing).not.toBeNull();
    expect(Number(missing?.[1])).toBeGreaterThan(0);
    // 禁用按钮点不动（不静默吞点击，也不假装能点）。
    expect(clickByAction(root(h.screen), 'next')).toBe('disabled');
    h.unmount();
  });
});

// ============================================================================
// V8 —— 人设步点「用默认模板」→ 主按钮解锁，可进确认步
// ============================================================================

describe('V8 · 人设步「用默认模板」→ 解锁并进确认步', () => {
  test('V8-1 · 点「用默认模板」→ 主按钮解锁 + 原因撤掉 + 能到确认步', () => {
    const h = mountWizard(makeState([CLAUDE]));
    gotoPersona(h.screen);

    expect(clickByAction(root(h.screen), 'use-default-template')).toBe('clicked');

    expect(h.screen.shadowRoot?.querySelector('[data-action="next"]')?.hasAttribute('disabled')).toBe(false);
    expect(h.screen.shadowRoot?.querySelector('[data-role="footer-reason"]')?.hasAttribute('hidden')).toBe(true);
    // 按钮换成状态说明（不给"再点一次没反应"的死按钮）。
    expect(h.screen.shadowRoot?.querySelector('[data-role="default-template-state"]')?.textContent).toContain('已用默认模板');

    h.screen.next();
    expect(h.screen.step).toBe('confirm');
    h.unmount();
  });
});

// ============================================================================
// V9 —— 人设步答完问卷 → 主按钮解锁（既有路径回归）
// ============================================================================

describe('V9 · 人设步答完问卷 → 解锁', () => {
  test('V9-1 · 问卷答全 → 主按钮解锁（预设 / 问卷 / 默认模板 三选一都成立）', () => {
    const h = mountWizard(makeState([CLAUDE]));
    gotoPersona(h.screen);
    expect(h.screen.shadowRoot?.querySelector('[data-action="next"]')?.hasAttribute('disabled')).toBe(true);

    const radios = Array.from(
      h.screen.shadowRoot?.querySelectorAll('[data-role="option"]') ?? []
    ) as HTMLInputElement[];
    expect(radios.length).toBeGreaterThan(0);
    for (const radio of radios) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(h.screen.shadowRoot?.querySelector('[data-action="next"]')?.hasAttribute('disabled')).toBe(false);
    h.unmount();
  });
});

// ============================================================================
// V10 —— 项目实例内开向导 → 归属条可见
// ============================================================================

describe('V10 · 项目实例内开向导 → 归属条可见', () => {
  test('V10-1 · 项目实例 → 「将建到：默认沙盒」+ 名册契约说明 + 项目名', () => {
    const h = mountWizard(
      makeState([CLAUDE], {
        activeInstanceId: 'inst_alpha',
        projectInstances: [projectInstance('inst_alpha', '我的项目')],
      })
    );

    const bar = h.screen.shadowRoot?.querySelector('[data-role="ownership-bar"]');
    expect(bar?.getAttribute('data-mode')).toBe('project');
    expect(bar?.textContent).toContain('将建到：默认沙盒');
    expect(bar?.textContent).toContain('名册契约');
    expect(bar?.textContent).toContain('我的项目');
    h.unmount();
  });

  test('V10-2 · 默认沙盒 → 归属条只说「将建到：默认沙盒」（不多说项目那套）', () => {
    const h = mountWizard(makeState([CLAUDE], { activeInstanceId: DEFAULT_INSTANCE_ID }));

    const bar = h.screen.shadowRoot?.querySelector('[data-role="ownership-bar"]');
    expect(bar?.getAttribute('data-mode')).toBe('sandbox');
    expect(bar?.textContent).toContain('将建到：默认沙盒');
    expect(bar?.textContent).not.toContain('名册契约');
    h.unmount();
  });
});

// ============================================================================
// V12 —— 0 可建档 + 无 customAgents 端口 → 空态仍两动作（重扫 / 指引），无死文案
// ============================================================================

describe('V12 · 纯 vite 环境（无 customAgents 端口）→ 空态仍两动作', () => {
  test('V12-1 · 只有重扫 + 指引两个动作，没有注册入口（端口不存在就不给死按钮）', () => {
    const h = mountWizard(makeState(scanCompleteButNothingBindable()));

    expect(h.screen.shadowRoot?.querySelector('[data-action="rescan"]')).not.toBeNull();
    expect(h.screen.shadowRoot?.querySelector('[data-role="cli-install-guide"]')).not.toBeNull();
    expect(h.screen.shadowRoot?.querySelector('[data-action="custom-open-form"]')).toBeNull();
    h.unmount();
  });

  test('V12-2 · 「重进向导」那句无效指引没了（对已经站在向导里的人无效）', () => {
    const h = mountWizard(makeState(scanCompleteButNothingBindable()));

    const body = h.screen.shadowRoot?.querySelector('[data-role="body"]')?.textContent ?? '';
    expect(body).not.toContain('重进向导');
    expect(body).not.toContain('确认 PATH');
    h.unmount();
  });
});

// ============================================================================
// 工具自检（探针转正的产物本身也要能用）
// ============================================================================

describe('shadow 穿透工具（探针转正）', () => {
  test('工具 · dumpWidgets 能列出向导里的动作与提示（探针 __wizDump 的 jest 版）', () => {
    const h = mountWizard(makeState([CLAUDE]));
    gotoPersona(h.screen);

    const dump = dumpWidgets(root(h.screen));
    expect(dump.actions.some((item) => item.action === 'use-default-template')).toBe(true);
    expect(dump.inputs.length).toBeGreaterThan(0);
    h.unmount();
  });

  test('工具 · fillTextInput 填的名字真的进了屏（事件链通）', () => {
    const h = mountWizard(makeState([CLAUDE]));
    h.screen.next();
    expect(h.screen.step).toBe('identity');

    expect(fillTextInput(root(h.screen), '穿透工具')).toBe(true);

    expect(h.screen.identities[0]?.name).toBe('穿透工具');
    h.unmount();
  });
});
