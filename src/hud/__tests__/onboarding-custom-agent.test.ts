/**
 * 文件职责：**向导扫描步的自定义 agent 注册表单**测试（task_056 规格③⑥）—— 入口渲染
 *   （端口注入才有）、表单开合与输入回填、「测试」按钮（假端口回结论）、「注册」
 *   （校验拒绝 / 成功后随检测广播出新行）、扫描行的自定义段 bindable / label、
 *   「移除注册」动作、注册行进入起名清单（044 链路复用的行为证据）。
 * 手法：与 onboarding-screen.test.ts 同源（真实 web-component + 注入假端口），不 mock
 *   屏内部方法 —— 表单行为是 DOM 级证据。
 * @jest-environment jsdom
 */

import {
  ONBOARDING_SCREEN_TAG,
  mountOnboardingScreen,
  type OnboardingScreenDeps,
  type StratOnboardingScreenElement,
} from '../screens/onboarding-screen';
import {
  isDetectionComplete,
  resolveBindableKinds,
  resolveScanRows,
  resolveScanStatus,
} from '../screens/onboarding-catalog';
import type { CustomAgentProbeResult, CustomAgentsPort } from '../screens/custom-agents-port';
import type { CustomAgentValidationCode } from '../../core/custom-agent';
import type { HudCommand, WorldState, DetectedAgent } from '../../core/types';

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

const CLAUDE = detected({ kind: 'claude-code', installed: true, status: 'installed', version: '1.2.3' });
const TIMEOUT = detected({ kind: 'kimi', status: 'timeout' });

function makeState(detectedAgents?: DetectedAgent[]): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...(detectedAgents ? { detectedAgents } : {}),
  };
}

/** 假注册端口：记录调用，按剧本回话。 */
interface PortScript {
  readonly probeResult?: CustomAgentProbeResult;
  readonly createResult?: { ok: false; code?: CustomAgentValidationCode; error?: string };
  readonly removeResult?: { ok: boolean; error?: string };
}
function fakePort(script: PortScript = {}): CustomAgentsPort & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async list() {
      calls.push('list');
      return { ok: true, agents: [] };
    },
    async probe(probeCmd) {
      calls.push(`probe:${probeCmd}`);
      return script.probeResult ?? { ok: true, installed: true, exitCode: 0, stdout: 'v1.0' };
    },
    async create(draft) {
      calls.push(`create:${draft.name}`);
      if (script.createResult) return script.createResult;
      return {
        ok: true,
        agent: {
          id: 'myagent',
          name: draft.name,
          probeCmd: draft.probeCmd,
          runCmdTemplate: draft.runCmdTemplate,
          outputParser: draft.outputParser,
          createdAt: 0,
        },
      };
    },
    async remove(id) {
      calls.push(`remove:${id}`);
      return script.removeResult ?? { ok: true };
    },
  };
}

interface Harness {
  readonly screen: StratOnboardingScreenElement;
  readonly commands: HudCommand[];
  emit(state: WorldState): void;
  unmount(): void;
}

function mountScreen(port: CustomAgentsPort | null, initial?: WorldState): Harness {
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
  const emit = (state: WorldState): void => {
    for (const handler of handlers.slice()) handler(state);
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountOnboardingScreen(deps, host, port ? { customAgents: port } : {});
  const screen = host.querySelector(ONBOARDING_SCREEN_TAG) as StratOnboardingScreenElement;
  if (!screen?.shadowRoot) throw new Error('向导屏未 upgrade（shadowRoot 为空）');
  if (initial) emit(initial);
  return {
    screen,
    commands,
    emit,
    unmount: () => {
      unmountScreen();
      host.remove();
    },
  };
}

/** 找到屏里带 data-action 的按钮元素并派发点击（strat-button 的对外事件形态）。 */
function clickAction(screen: StratOnboardingScreenElement, action: string): void {
  const node = screen.shadowRoot?.querySelector(`[data-action="${action}"]`);
  if (!node) throw new Error(`找不到 data-action=${action}`);
  node.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true, composed: true }));
}

function setInput(screen: StratOnboardingScreenElement, role: string, value: string): void {
  const input = screen.shadowRoot?.querySelector(`[data-role="${role}"]`) as HTMLInputElement | null;
  if (!input) throw new Error(`找不到输入 ${role}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

// ============================================================================
// 1. 派生目录：自定义注册行的 bindable / label / 完成度
// ============================================================================

describe('task_056 onboarding-catalog：自定义注册行的派生口径', () => {
  const MYAGENT = detected({
    kind: 'custom:myagent',
    installed: true,
    status: 'installed',
    label: 'MyAgent',
  });

  it('自定义行 bindable（能勾选导入）且显示名取注册名（label），不是裸 kind 串', () => {
    const rows = resolveScanRows(makeState([CLAUDE, MYAGENT]));
    const customRow = rows.find((row) => row.kind === 'custom:myagent');
    expect(customRow).toBeDefined();
    expect(customRow?.bindable).toBe(true);
    expect(customRow?.label).toBe('MyAgent');
  });

  it('label 缺失（脏检测行）回落 slug（剥前缀，不崩不糊）', () => {
    const rows = resolveScanRows(makeState([detected({ kind: 'custom:mytool', installed: true, status: 'installed' })]));
    expect(rows[0]?.label).toBe('mytool');
  });

  it('自定义行进起名清单（044 逐个配置链路复用的判据）', () => {
    expect(resolveBindableKinds(makeState([CLAUDE, MYAGENT, TIMEOUT]))).toEqual([
      'claude-code',
      'custom:myagent',
    ]);
  });

  it('完成度文案：注册行加入后分母随行数走，不出现 12/11 倒挂', () => {
    const eleven = makeState(Array.from({ length: 11 }, (_, index) =>
      detected({ kind: `agent${index}` as DetectedAgent['kind'], status: 'failed', tier: 'T2' })
    ));
    expect(isDetectionComplete(eleven)).toBe(true);
    const twelve = makeState([
      ...Array.from({ length: 11 }, (_, index) =>
        detected({ kind: `agent${index}` as DetectedAgent['kind'], status: 'failed', tier: 'T2' })
      ),
      MYAGENT,
    ]);
    expect(isDetectionComplete(twelve)).toBe(true);
    expect(resolveScanStatus(twelve).text).toContain('12/12');
  });
});

// ============================================================================
// 2. 表单流：入口 / 开合 / 校验 / 测试 / 注册 / 移除
// ============================================================================

describe('task_056 向导扫描步：注册表单流', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('端口未注入：不渲染注册入口（非 Electron 降级，向导照常可走）', () => {
    const harness = mountScreen(null, makeState([CLAUDE]));
    expect(harness.screen.shadowRoot?.querySelector('[data-group="custom-agent"]')).toBeNull();
    harness.unmount();
  });

  it('端口注入：入口渲染；点开表单；填值经输入进草稿（广播重画后回填不丢）', () => {
    const harness = mountScreen(fakePort(), makeState([CLAUDE]));
    expect(harness.screen.shadowRoot?.querySelector('[data-group="custom-agent"]')).not.toBeNull();
    clickAction(harness.screen, 'custom-toggle-form');
    let form = harness.screen.shadowRoot?.querySelector('[data-role="custom-form"]');
    expect(form).not.toBeNull();

    setInput(harness.screen, 'custom-name', 'MyAgent');
    setInput(harness.screen, 'custom-probe-cmd', 'myagent --version');
    setInput(harness.screen, 'custom-template', 'myagent ask {prompt}');

    // 广播重画（检测行变化触发签名变化）：草稿回填，输入不丢。
    harness.emit(makeState([CLAUDE, TIMEOUT]));
    form = harness.screen.shadowRoot?.querySelector('[data-role="custom-form"]');
    const name = form?.querySelector('[data-role="custom-name"]') as HTMLInputElement | null;
    expect(name?.value).toBe('MyAgent');
    harness.unmount();
  });

  it('「测试」按钮：跑探测命令并回显结论（exit 0 = 通过）', async () => {
    const port = fakePort({ probeResult: { ok: true, installed: true, exitCode: 0, stdout: 'myagent 1.0' } });
    const harness = mountScreen(port, makeState([CLAUDE]));
    clickAction(harness.screen, 'custom-toggle-form');
    setInput(harness.screen, 'custom-probe-cmd', 'myagent --version');
    clickAction(harness.screen, 'custom-test-probe');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(port.calls).toContain('probe:myagent --version');
    const node = harness.screen.shadowRoot?.querySelector('[data-role="custom-probe-result"]');
    expect(node?.getAttribute('hidden')).toBeNull();
    expect(node?.textContent).toContain('探测通过');
    expect(node?.textContent).toContain('myagent 1.0');
    harness.unmount();
  });

  it('「测试」按钮：白名单外命令被本地拦下（不打 IPC，内联提示）', async () => {
    const port = fakePort();
    const harness = mountScreen(port, makeState([CLAUDE]));
    clickAction(harness.screen, 'custom-toggle-form');
    setInput(harness.screen, 'custom-probe-cmd', 'myagent; rm -rf /');
    clickAction(harness.screen, 'custom-test-probe');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(port.calls.some((call) => call.startsWith('probe:'))).toBe(false); // 没打 IPC
    const error = harness.screen.shadowRoot?.querySelector('[data-role="custom-form-error"]');
    expect(error?.getAttribute('hidden')).toBeNull();
    expect(error?.textContent).toContain('探测命令非法');
    harness.unmount();
  });

  it('「注册」：字段没填齐 → 本地校验拒（内联提示，不打 IPC）', async () => {
    const port = fakePort();
    const harness = mountScreen(port, makeState([CLAUDE]));
    clickAction(harness.screen, 'custom-toggle-form');
    setInput(harness.screen, 'custom-name', 'MyAgent');
    setInput(harness.screen, 'custom-probe-cmd', 'myagent --version');
    // 模板没填 → template-empty。
    clickAction(harness.screen, 'custom-register');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(port.calls.some((call) => call.startsWith('create:'))).toBe(false);
    const error = harness.screen.shadowRoot?.querySelector('[data-role="custom-form-error"]');
    expect(error?.textContent).toContain('执行模板');
    harness.unmount();
  });

  it('「注册」成功：表单收起；检测广播推入新行 → 扫描列表出现且默认勾上（044 链路复用）', async () => {
    const port = fakePort();
    const harness = mountScreen(port, makeState([CLAUDE]));
    clickAction(harness.screen, 'custom-toggle-form');
    setInput(harness.screen, 'custom-name', 'MyAgent');
    setInput(harness.screen, 'custom-probe-cmd', 'myagent --version');
    setInput(harness.screen, 'custom-template', 'myagent ask {prompt}');
    clickAction(harness.screen, 'custom-register');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(port.calls).toContain('create:MyAgent');
    // 主进程注册后探测并入快照广播（真实链路）：新行已装可绑 → 默认勾选。
    harness.emit(
      makeState([
        CLAUDE,
        detected({ kind: 'custom:myagent', installed: true, status: 'installed', label: 'MyAgent' }),
      ])
    );
    const row = harness.screen.shadowRoot?.querySelector('[data-role="scan-row"][data-kind="custom:myagent"]');
    expect(row).not.toBeNull();
    const checkbox = row?.querySelector<HTMLInputElement>('[data-role="scan-select"]');
    expect(checkbox?.checked).toBe(true);
    // 表单已收起。
    expect(harness.screen.shadowRoot?.querySelector('[data-role="custom-form"]')).toBeNull();
    harness.unmount();
  });

  it('「移除注册」：对注册行触发端口调用（删除语义 = 断检测；角色不在向导阶段，主进程层裁决）', async () => {
    const port = fakePort();
    const harness = mountScreen(
      port,
      makeState([CLAUDE, detected({ kind: 'custom:myagent', installed: true, status: 'installed', label: 'MyAgent' })])
    );
    const removeButton = harness.screen.shadowRoot?.querySelector('[data-action="custom-remove"]');
    expect(removeButton).not.toBeNull(); // 自定义行带移除按钮（内置行没有）
    expect(harness.screen.shadowRoot?.querySelector('[data-role="scan-row"][data-kind="claude-code"] [data-action="custom-remove"]')).toBeNull();
    removeButton?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true, composed: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(port.calls).toContain('remove:myagent');
    // 广播掉行后：扫描列表不再有该行（角色档案保留语义在主进程 / 恢复层，别处测）。
    harness.emit(makeState([CLAUDE]));
    expect(harness.screen.shadowRoot?.querySelector('[data-role="scan-row"][data-kind="custom:myagent"]')).toBeNull();
    harness.unmount();
  });
});
