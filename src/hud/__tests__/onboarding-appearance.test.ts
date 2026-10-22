/**
 * 集成测试：首启向导第②步的**形象预览**（hud/screens/onboarding-screen.ts + appearance-preview-port.ts）。
 * 覆盖：随机形象、部件选择器、体型切换、canvas 宿主与预览服务的接线、
 *   提交时 character.create 带 appearance、卸载时销毁预览实例（Phaser 生命周期）。
 * @jest-environment jsdom
 *
 * 边界说明：屏**不认识**合成器（hud 不 import world —— 铁律），只经注入的端口发意图。
 *   所以这里注入的是**端口桩**：不碰真 canvas，也不碰素材；
 *   真 canvas 的手测归 task_029。
 */

import * as fs from 'fs';
import * as path from 'path';

import type { DetectedAgent, HudCommand, WorldState } from '../../core/types';
import type {
  AppearanceCategoryInfo,
  AppearancePreviewPort,
} from '../screens/appearance-preview-port';
import {
  ONBOARDING_SCREEN_TAG,
  mountOnboardingScreen,
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

const CLAUDE = detected({ kind: 'claude-code', tier: 'T1', installed: true, status: 'installed', version: '1.2.3' });
const CODEX = detected({ kind: 'codex', tier: 'T1', installed: true, status: 'installed', version: '0.9.0' });

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

/** 端口桩的记录（测试据此断言"屏发了什么意图"）。 */
interface PortLog {
  destroyed: number;
  attached: HTMLElement[];
  previews: unknown[];
  randomized: number;
  /** 让 randomize 返回 null（模拟"素材没加载出来"）。 */
  randomizeReturnsNull: boolean;
}

interface StubPort {
  readonly port: AppearancePreviewPort;
  readonly log: PortLog;
}

function createStubPort(): StubPort {
  const log: PortLog = {
    destroyed: 0,
    attached: [],
    previews: [],
    randomized: 0,
    randomizeReturnsNull: false,
  };

  const categories = (bodyType: string): readonly AppearanceCategoryInfo[] => [
    { category: 'body', name: '身体（肤色）', variants: bodyType === 'male' ? ['dark', 'light'] : ['light'] },
    { category: 'hair', name: '头发', variants: ['black', 'blonde'] },
    { category: 'eyes', name: '眼睛', variants: ['blue'] },
    { category: 'ears', name: '耳朵', variants: [] },
    { category: 'facial', name: '面部毛发', variants: ['beard'] },
  ];

  const port: AppearancePreviewPort = {
    bodyTypes: ['male', 'female'],
    listCategories: (bodyType) => categories(bodyType),
    whenReady: () => Promise.resolve(),
    randomize: () => {
      log.randomized += 1;
      if (log.randomizeReturnsNull) return null;
      return { bodyType: 'male', parts: { body: 'light', hair: 'blonde' } };
    },
    attach: (host) => { log.attached.push(host); },
    preview: (appearance) => { log.previews.push(appearance); },
    destroy: () => { log.destroyed += 1; },
  };

  return { port, log };
}

interface Harness {
  readonly screen: StratOnboardingScreenElement;
  readonly commands: HudCommand[];
  readonly log: PortLog;
  emit(state: WorldState): void;
  unmount(): void;
}

function mountScreen(stub: StubPort | null): Harness {
  const commands: HudCommand[] = [];
  const handlers: ((state: WorldState) => void)[] = [];
  const deps = {
    dispatch: (command: HudCommand) => { commands.push(command); },
    subscribe: (next: (state: WorldState) => void) => {
      handlers.push(next);
      return () => {
        const index = handlers.indexOf(next);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountOnboardingScreen(deps, host, stub ? { appearance: stub.port } : {});
  const screen = host.querySelector(ONBOARDING_SCREEN_TAG) as StratOnboardingScreenElement;
  if (!screen?.shadowRoot) throw new Error('向导屏未 upgrade（shadowRoot 为空）');

  const emptyLog: PortLog = {
    destroyed: 0,
    attached: [],
    previews: [],
    randomized: 0,
    randomizeReturnsNull: false,
  };

  return {
    screen,
    commands,
    log: stub?.log ?? emptyLog,
    emit: (state) => { for (const handler of handlers.slice()) handler(state); },
    unmount: () => { unmountScreen(); host.remove(); },
  };
}

function one(screen: StratOnboardingScreenElement, selector: string): HTMLElement {
  const node = screen.shadowRoot?.querySelector(selector);
  if (!node) throw new Error(`节点未渲染: ${selector}`);
  return node as HTMLElement;
}

/** 模拟下拉选择：改值 + 派发 change 事件（走真实的委托链）。 */
function select(screen: StratOnboardingScreenElement, selector: string, value: string): void {
  const field = one(screen, selector) as HTMLSelectElement;
  field.value = value;
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('向导第②步 · 形象预览', () => {
  test('进入第②步：新条目自带一套随机形象，画布宿主挂上预览服务', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    expect(h.screen.step).toBe('identity');
    // 随机形象被请求过（新条目要自带一套长相）
    expect(stub.log.randomized).toBeGreaterThan(0);
    expect(h.screen.appearanceOf('claude-code')).toEqual({
      bodyType: 'male',
      parts: { body: 'light', hair: 'blonde' },
    });

    // 画布宿主：屏渲染出容器，且把它交给了预览服务
    const canvasHost = one(h.screen, '[data-role="appearance-canvas"]');
    expect(canvasHost).toBeTruthy();
    expect(stub.log.attached.length).toBeGreaterThan(0);
    expect(stub.log.attached[stub.log.attached.length - 1]).toBe(canvasHost);
    h.unmount();
  });

  test('「随机形象」按钮 → 重新抽一套并推给预览服务', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    const before = stub.log.randomized;
    one(h.screen, '[data-action="randomize-appearance"]').click();

    expect(stub.log.randomized).toBe(before + 1);
    // 预览被刷新（把新的形象推给服务）
    expect(stub.log.previews.length).toBeGreaterThan(0);
    const last = stub.log.previews[stub.log.previews.length - 1] as { bodyType: string };
    expect(last.bodyType).toBe('male');
    h.unmount();
  });

  test('素材没就绪（randomize 返 null）→ 给出提示，不编造长相', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    const before = h.screen.appearanceOf('claude-code');
    stub.log.randomizeReturnsNull = true;
    one(h.screen, '[data-action="randomize-appearance"]').click();

    expect(one(h.screen, '[data-role="appearance-error"]').textContent).toContain('素材还没加载出来');
    // 抽不到就不改：原来的长相保持不变（不编造）
    expect(h.screen.appearanceOf('claude-code')).toEqual(before);
    h.unmount();
  });

  test('部件选择器：改变体 → 更新形象并刷新预览（不重画选择器）', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    select(h.screen, '[data-role="appearance-part"][data-category="hair"]', 'black');

    expect(h.screen.appearanceOf('claude-code')?.parts.hair).toBe('black');
    const last = stub.log.previews[stub.log.previews.length - 1] as { parts: Record<string, string> };
    expect(last.parts.hair).toBe('black');
    // 摘要跟着更新
    expect(one(h.screen, '[data-role="appearance-summary"]').textContent).toContain('hair:black');
    h.unmount();
  });

  test('体型选择器：换体型 → 形象体型跟着换', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    select(h.screen, '[data-role="body-type"]', 'female');

    expect(h.screen.appearanceOf('claude-code')?.bodyType).toBe('female');
    h.unmount();
  });

  test('多个 agent：点「预览形象」切到另一个，画布跟着换', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE, CODEX]));
    one(h.screen, '[data-action="next"]').click();

    expect(h.screen.previewKind).toBe('claude-code');
    one(h.screen, '[data-action="preview-appearance"][data-kind="codex"]').click();

    expect(h.screen.previewKind).toBe('codex');
    h.unmount();
  });

  test('提交：character.create 带 appearance（没选的条目不带该字段）', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    const nameInput = one(h.screen, '[data-field="name"]') as HTMLInputElement;
    nameInput.value = 'Neo';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    select(h.screen, '[data-role="appearance-part"][data-category="hair"]', 'black');

    h.screen.submit();

    const create = h.commands.find((command) => command.type === 'character.create');
    expect(create).toBeDefined();
    if (create?.type !== 'character.create') throw new Error('命令类型不对');
    expect(create.appearance).toEqual({
      bodyType: 'male',
      parts: { body: 'light', hair: 'black' },
    });
    h.unmount();
  });

  test('提交：没选形象的条目不带 appearance 字段（老档案照旧合法）', () => {
    const stub = createStubPort();
    // 素材一直没就绪 → 从头就没有形象可选
    stub.log.randomizeReturnsNull = true;
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    expect(h.screen.appearanceOf('claude-code')).toBeNull();

    h.screen.submit();
    const create = h.commands.find((command) => command.type === 'character.create');
    if (create?.type !== 'character.create') throw new Error('命令类型不对');
    expect(create.appearance).toBeUndefined();
    h.unmount();
  });

  test('生命周期：卸载向导 → 预览实例被销毁（Phaser 不泄漏）', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    expect(stub.log.destroyed).toBe(0);
    h.unmount();
    expect(stub.log.destroyed).toBe(1);
  });

  test('没注入端口：向导照常能走完（只是没有形象功能）', () => {
    const h = mountScreen(null);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    expect(h.screen.step).toBe('identity');
    expect(one(h.screen, '[data-role="appearance-unavailable"]').textContent).toContain('形象预览没接上');
    expect(h.screen.appearanceOf('claude-code')).toBeNull();
    h.unmount();
  });

  test('画布宿主跨重渲染存活（换肤 / 切预览不丢画布）', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    const canvasHost = one(h.screen, '[data-role="appearance-canvas"]');
    one(h.screen, '[data-action="reroll"]').click();

    // 还是同一个宿主元素（Phaser 的 canvas 挂在它里面）
    expect(one(h.screen, '[data-role="appearance-canvas"]')).toBe(canvasHost);
    h.unmount();
  });
});

// ============================================================================
// 架构护栏：hud ↔ world 的隔离（task_028 的硬约束）
// ============================================================================

describe('架构护栏 · 向导屏不认识 world', () => {
  const read = (relative: string): string =>
    fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf-8');

  const screenSource = read('hud/screens/onboarding-screen.ts');
  const portSource = read('hud/screens/appearance-preview-port.ts');
  const serviceSource = read('app/services/appearance-preview-service.ts');

  test('屏与端口都不 import world / phaser（总线隔离铁律）', () => {
    expect(screenSource).not.toMatch(/from '[^']*world\//);
    expect(screenSource).not.toMatch(/from 'phaser'/);
    expect(portSource).not.toMatch(/from '[^']*world\//);
    expect(portSource).not.toMatch(/from 'phaser'/);
  });

  test('预览服务不把 Phaser 拖进依赖图（Phaser 只在游戏工厂那一层 import）', () => {
    expect(serviceSource).not.toMatch(/from 'phaser'/);
    // 但它得认识 world（合成器与注册表在那边）—— 组合根允许，hud 不允许。
    expect(serviceSource).toMatch(/from '[^']*world\/appearance/);
  });
});
