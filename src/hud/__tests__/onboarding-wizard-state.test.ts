/**
 * 集成测试：向导状态机补全（task_227 · CC-02，设计文档 docs/DESIGN-character-creation.md §3.C）。
 *
 * 覆盖验收四条：
 *   C1 人设步：未配置 → 主按钮 disabled + footer 原因（含剩余题数）；「用默认模板」→ 解锁 → 能到确认 → submit 成功；
 *   C2 扫描步 0 可建档：空态三动作在位（无端口两动作）+ 旧的「重进向导」指引没了；
 *   C3 归属条：沙盒 / 项目两态文案正确，完成事件带归属（沙盒维持现状文案）；
 *   外加「重新扫描」派意图事件（组合根据此重派既有 detection 命令）。
 *
 * @jest-environment jsdom
 *
 * 边界说明：与 screens/onboarding-screen.test.ts 同款夹具 —— 注入适配器，不经真总线；
 * 本屏只与 WorldState（读）+ character.create / ui.navigate（写）打交道。
 */

import type { DetectedAgent, HudCommand, WorldState } from '../../core/types';
import { DEFAULT_INSTANCE_ID } from '../../core/types';
import { createSkinRandomizer } from '../../core/theme/skin-registry';

import { CLI_INSTALL_GUIDE_URL } from '../screens/onboarding-catalog';
import type { CustomAgentsPort } from '../screens/custom-agents-port';
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_RESCAN_EVENT,
  ONBOARDING_SCREEN_TAG,
  mountOnboardingScreen,
  type OnboardingCompleteDetail,
  type OnboardingScreenDeps,
  type StratOnboardingScreenElement,
} from '../screens/onboarding-screen';

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

interface Harness {
  readonly screen: StratOnboardingScreenElement;
  readonly commands: HudCommand[];
  readonly host: HTMLElement;
  emit(state: WorldState): void;
  unmount(): void;
}

function mountScreen(initial?: WorldState, options?: { readonly customAgents?: CustomAgentsPort }): Harness {
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
    commands,
    host,
    emit,
    unmount: () => { unmountScreen(); host.remove(); },
  };
}

function all(screen: StratOnboardingScreenElement, selector: string): HTMLElement[] {
  return Array.from(screen.shadowRoot?.querySelectorAll(selector) ?? []);
}

function one(screen: StratOnboardingScreenElement, selector: string): HTMLElement {
  const node = screen.shadowRoot?.querySelector(selector);
  if (!node) throw new Error(`节点未渲染: ${selector}`);
  return node as HTMLElement;
}

function maybe(screen: StratOnboardingScreenElement, selector: string): HTMLElement | null {
  return (screen.shadowRoot?.querySelector(selector) as HTMLElement | null) ?? null;
}

function click(screen: StratOnboardingScreenElement, selector: string): void {
  one(screen, selector).click();
}

/** 走到人设步（扫描 → 起名 → 人设）。 */
function gotoPersona(screen: StratOnboardingScreenElement): void {
  screen.next();
  expect(screen.step).toBe('identity');
  screen.next();
  expect(screen.step).toBe('persona');
}

/** 一条假的自定义 agent 注册端口（本测试只关心"端口存在与否"）。 */
function fakeCustomAgentsPort(): CustomAgentsPort {
  return {
    list: async () => ({ ok: true, agents: [] }),
    create: async () => ({ ok: false, error: '未实现' }),
    remove: async () => ({ ok: true }),
    probe: async () => ({ ok: false, error: '未实现' }),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ============================================================================
// C1 人设步：禁用带原因 + 「用默认模板」
// ============================================================================

describe('C1 人设步 · 禁用带原因 + 用默认模板', () => {
  test('人设没配好 → 主按钮 disabled + 页脚说清还差几题', () => {
    const h = mountScreen(makeState([CLAUDE]));
    gotoPersona(h.screen);

    const primary = one(h.screen, '[data-action="next"]');
    // 主按钮禁用（点不动 = 不给"点了没反应"的假机会）。
    expect(primary.hasAttribute('disabled')).toBe(true);
    // 禁用必须带原因（设计原则③）：页脚明说 + title 里也有一份。
    const reason = one(h.screen, '[data-role="footer-reason"]');
    expect(reason.hasAttribute('hidden')).toBe(false);
    expect(reason.textContent).toContain('人设还没配好');
    expect(reason.textContent).toContain('还差 4 题');
    expect(primary.getAttribute('title')).toContain('还差 4 题');
    h.unmount();
  });

  test('「用默认模板」→ 主按钮解锁，能走到确认步并 submit 成功', () => {
    const h = mountScreen(makeState([CLAUDE]));
    gotoPersona(h.screen);

    click(h.screen, '[data-action="use-default-template"]');

    // 解锁：主按钮可点了，页脚原因撤掉。
    expect(one(h.screen, '[data-action="next"]').hasAttribute('disabled')).toBe(false);
    expect(one(h.screen, '[data-role="footer-reason"]').hasAttribute('hidden')).toBe(true);
    // 按钮换成状态说明（不给"再点一次没反应"的死按钮）。
    expect(one(h.screen, '[data-role="default-template-state"]').textContent).toContain('已用默认模板');

    h.screen.next();
    expect(h.screen.step).toBe('confirm');

    let completed: OnboardingCompleteDetail | null = null;
    h.host.addEventListener(ONBOARDING_COMPLETE_EVENT, (ev) => {
      completed = (ev as CustomEvent<OnboardingCompleteDetail>).detail;
    });
    h.screen.submit();

    const creates = h.commands.filter((c) => c.type === 'character.create');
    expect(creates).toHaveLength(1);
    // 落库口径不变：人设留空 → core 套默认模板（不改 persona 校验）。
    expect((creates[0] as { persona?: string }).persona).toBeUndefined();
    expect(completed).not.toBeNull();
    expect((completed as unknown as OnboardingCompleteDetail).created).toHaveLength(1);
    h.unmount();
  });

  test('「用默认模板」只作用于当前 agent：另一个 agent 没配好时主按钮仍禁用', () => {
    const h = mountScreen(makeState([CLAUDE, detected({ kind: 'codex', tier: 'T1', installed: true, status: 'installed' })]));
    h.screen.next(); // → identity
    h.screen.next(); // → persona
    expect(h.screen.step).toBe('persona');

    click(h.screen, '[data-action="use-default-template"]');
    // 当前 agent 配好了，但 codex 还没配 → 仍禁用，并报到 codex 头上。
    const primary = one(h.screen, '[data-action="next"]');
    expect(primary.hasAttribute('disabled')).toBe(true);
    expect(one(h.screen, '[data-role="footer-reason"]').textContent).toContain('还差 4 题');
    h.unmount();
  });

  test('问卷答全 → 主按钮同样解锁（预设/问卷/默认模板三选一）', () => {
    const h = mountScreen(makeState([CLAUDE]));
    gotoPersona(h.screen);
    expect(one(h.screen, '[data-action="next"]').hasAttribute('disabled')).toBe(true);

    const radios = (): HTMLInputElement[] =>
      all(h.screen, '[data-role="option"]') as HTMLInputElement[];
    for (const radio of radios()) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(one(h.screen, '[data-action="next"]').hasAttribute('disabled')).toBe(false);
    h.unmount();
  });
});

// ============================================================================
// C2 扫描步 0 可建档空态：三动作
// ============================================================================

describe('C2 扫描步 · 0 可建档空态三动作', () => {
  test('0 可建档 → 重新扫描 / 添加自定义 agent / CLI 安装指引三动作在位，旧指引没了', () => {
    const h = mountScreen(makeState([TIMEOUT]), { customAgents: fakeCustomAgentsPort() });

    const actions = one(h.screen, '[data-role="scan-empty-actions"]');
    expect(actions).toBeTruthy();
    // ① 重新扫描
    expect(one(h.screen, '[data-action="rescan"]')).toBeTruthy();
    // ② ＋添加自定义 agent（端口存在才显示）
    expect(one(h.screen, '[data-action="custom-open-form"]')).toBeTruthy();
    // ③ 查看 CLI 安装指引（外链，走浏览器既有能力）
    const guide = one(h.screen, '[data-role="cli-install-guide"]') as HTMLAnchorElement;
    expect(guide.getAttribute('href')).toBe(CLI_INSTALL_GUIDE_URL);
    expect(guide.getAttribute('target')).toBe('_blank');
    expect(guide.getAttribute('rel')).toContain('noopener');
    expect(guide.textContent).toContain('CLI 安装指引');

    // 旧的无效指引（「确认 PATH 里装了 CLI 后重进向导」）必须删掉。
    const bodyText = one(h.screen, '[data-role="body"]').textContent ?? '';
    expect(bodyText).not.toContain('重进向导');
    expect(bodyText).not.toContain('确认 PATH');
    h.unmount();
  });

  test('没有 customAgents 端口 → 只给两个动作（不显示注册入口）', () => {
    const h = mountScreen(makeState([TIMEOUT]));

    expect(one(h.screen, '[data-action="rescan"]')).toBeTruthy();
    expect(one(h.screen, '[data-role="cli-install-guide"]')).toBeTruthy();
    expect(maybe(h.screen, '[data-action="custom-open-form"]')).toBeNull();
    h.unmount();
  });

  test('点「重新扫描」→ 派意图事件（组合根据此重派既有 detection 命令）', () => {
    const h = mountScreen(makeState([TIMEOUT]));

    let fired = 0;
    h.host.addEventListener(ONBOARDING_RESCAN_EVENT, () => { fired += 1; });
    click(h.screen, '[data-action="rescan"]');

    expect(fired).toBe(1);
    h.unmount();
  });

  test('探到了 agent 时不显示空态动作区（不是空态就别添乱）', () => {
    const h = mountScreen(makeState([CLAUDE]));
    expect(maybe(h.screen, '[data-role="scan-empty-actions"]')).toBeNull();
    h.unmount();
  });
});

// ============================================================================
// C3 归属条
// ============================================================================

describe('C3 归属条', () => {
  test('默认沙盒 → 顶部常驻「将建到：默认沙盒」', () => {
    const h = mountScreen(makeState([CLAUDE], { activeInstanceId: DEFAULT_INSTANCE_ID }));

    const bar = one(h.screen, '[data-role="ownership-bar"]');
    expect(bar.getAttribute('data-mode')).toBe('sandbox');
    expect(bar.textContent).toContain('将建到：默认沙盒');
    expect(bar.textContent).not.toContain('名册契约');
    h.unmount();
  });

  test('没进副本（activeInstanceId 缺省）→ 也按沙盒说', () => {
    const h = mountScreen(makeState([CLAUDE]));

    const bar = one(h.screen, '[data-role="ownership-bar"]');
    expect(bar.getAttribute('data-mode')).toBe('sandbox');
    expect(bar.textContent).toContain('将建到：默认沙盒');
    h.unmount();
  });

  test('项目实例 → 追加名册契约说明（角色归沙盒这件事得说清）', () => {
    const h = mountScreen(
      makeState([CLAUDE], {
        activeInstanceId: 'inst_alpha',
        projectInstances: [projectInstance('inst_alpha', '我的项目')],
      })
    );

    const bar = one(h.screen, '[data-role="ownership-bar"]');
    expect(bar.getAttribute('data-mode')).toBe('project');
    expect(bar.textContent).toContain('将建到：默认沙盒');
    expect(bar.textContent).toContain('名册契约');
    expect(bar.textContent).toContain('我的项目');
    h.unmount();
  });

  test('完成事件带归属：项目实例带说明，沙盒实例维持现状（toastNote = null）', () => {
    const h = mountScreen(
      makeState([CLAUDE], {
        activeInstanceId: 'inst_alpha',
        projectInstances: [projectInstance('inst_alpha', '我的项目')],
      })
    );

    let completed: OnboardingCompleteDetail | null = null;
    h.host.addEventListener(ONBOARDING_COMPLETE_EVENT, (ev) => {
      completed = (ev as CustomEvent<OnboardingCompleteDetail>).detail;
    });

    gotoPersona(h.screen);
    click(h.screen, '[data-action="use-default-template"]');
    h.screen.next();
    h.screen.submit();

    const detail = completed as unknown as OnboardingCompleteDetail;
    expect(detail.ownership.projectMode).toBe(true);
    expect(detail.ownership.toastNote).toContain('名册契约');
    h.unmount();
  });

  test('完成事件带归属：沙盒实例不带归属补充（现状文案不变）', () => {
    const h = mountScreen(makeState([CLAUDE], { activeInstanceId: DEFAULT_INSTANCE_ID }));

    let completed: OnboardingCompleteDetail | null = null;
    h.host.addEventListener(ONBOARDING_COMPLETE_EVENT, (ev) => {
      completed = (ev as CustomEvent<OnboardingCompleteDetail>).detail;
    });

    gotoPersona(h.screen);
    click(h.screen, '[data-action="use-default-template"]');
    h.screen.next();
    h.screen.submit();

    const detail = completed as unknown as OnboardingCompleteDetail;
    expect(detail.ownership.projectMode).toBe(false);
    expect(detail.ownership.toastNote).toBeNull();
    h.unmount();
  });
});
