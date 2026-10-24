/**
 * 集成测试：首启向导第②步的**每 agent 独立形象**（hud/screens/onboarding-screen.ts
 *   + appearance-preview-port.ts + onboarding-catalog.ts 的草稿逻辑）。
 * 覆盖：草稿初始化（品牌预设命中 / 素材未就绪的兜底回填）、深拷贝独立性、
 *   每 agent 卡片上的「重随机 / 重置为品牌默认」、切换预览对象、部件选择器改的是
 *   **当前预览对象**的草稿、提交时逐 agent 各带各的 appearance、卸载时销毁预览实例。
 *   任务：.long-run-agent/tasks/task_032.md。
 * @jest-environment jsdom
 *
 * 边界说明：屏**不认识**合成器（hud 不 import world —— 铁律），只经注入的端口发意图。
 *   所以这里注入的是**端口桩**：不碰真 canvas，也不碰素材；
 *   真 canvas 的手测归 task_029。
 */

import * as fs from 'fs';
import * as path from 'path';

import type { CharacterAppearance, DetectedAgent, HudCommand, WorldState } from '../../core/types';
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

// ============================================================================
// 端口桩：品牌预设（itemId 精确格式）+ 规则随机
// ============================================================================

/** claude-code 的"品牌预设"（桩里的形状与真实 brand-presets 一致：{ variant, itemId }）。 */
const PRESET_CLAUDE: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    body: { variant: 'light', itemId: 'heads_human_male' },
    hair: { variant: 'chestnut', itemId: 'hair_parted' },
  },
};

/** codex 的"品牌预设"（与 claude 不同，测"每 agent 各自的"）。 */
const PRESET_CODEX: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    body: { variant: 'light', itemId: 'heads_human_male' },
    hair: { variant: 'ash', itemId: 'hair_buzzcut' },
  },
};

/** 词表外 kind 的兜底预设。 */
const PRESET_FALLBACK: CharacterAppearance = {
  bodyType: 'male',
  parts: { body: { variant: 'light', itemId: 'heads_human_male' } },
};

/** 「重随机」（normal 档）的结果：与预设明显不同（体型都换了）。 */
const NORMAL_RANDOM: CharacterAppearance = {
  bodyType: 'female',
  parts: { hair: { variant: 'black', itemId: 'hair_long_straight' } },
};

/** 端口桩的记录（测试据此断言"屏发了什么意图"）。 */
interface PortLog {
  destroyed: number;
  attached: HTMLElement[];
  previews: CharacterAppearance[];
  /** randomizeNormal 被调了几次。 */
  randomizedNormal: number;
  /** preset 被问过哪些 kind（顺序）。 */
  presetCalls: string[];
  /** 模拟"素材没就绪"：false 时 preset / randomizeNormal 都返回 null。 */
  ready: boolean;
  /** 让 randomizeNormal 返回 null（模拟"素材没加载出来"）。 */
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
    randomizedNormal: 0,
    presetCalls: [],
    ready: true,
    randomizeReturnsNull: false,
  };

  const categories = (bodyType: string): readonly AppearanceCategoryInfo[] => [
    { category: 'body', name: '身体（肤色）', variants: bodyType === 'male' ? ['dark', 'light'] : ['light'] },
    { category: 'hair', name: '头发', variants: ['black', 'blonde', 'chestnut'] },
    { category: 'eyes', name: '眼睛', variants: ['blue'] },
    { category: 'ears', name: '耳朵', variants: [] },
    { category: 'facial', name: '面部毛发', variants: ['beard'] },
  ];

  const port: AppearancePreviewPort = {
    bodyTypes: ['male', 'female'],
    listCategories: (bodyType) => categories(bodyType),
    whenReady: () => Promise.resolve(),
    preset: (kind) => {
      log.presetCalls.push(kind);
      if (!log.ready) return null;
      if (kind === 'claude-code') return PRESET_CLAUDE;
      if (kind === 'codex') return PRESET_CODEX;
      return PRESET_FALLBACK;
    },
    randomizeNormal: () => {
      log.randomizedNormal += 1;
      if (!log.ready || log.randomizeReturnsNull) return null;
      return NORMAL_RANDOM;
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
    randomizedNormal: 0,
    presetCalls: [],
    ready: true,
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

/** 等端口桩的 whenReady 微任务链落地（屏的回填在 .then 里）。 */
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('向导第②步 · 每 agent 独立形象（草稿初始化）', () => {
  test('进入第②步：每个 agent 的草稿 = 各自的品牌预设（itemId 格式），且是独立深拷贝', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE, CODEX]));
    one(h.screen, '[data-action="next"]').click();

    expect(h.screen.step).toBe('identity');
    // 各自的预设（不是共享的一份，也不是随机的）
    expect(h.log.presetCalls).toContain('claude-code');
    expect(h.log.presetCalls).toContain('codex');
    expect(h.screen.appearanceOf('claude-code')).toEqual(PRESET_CLAUDE);
    expect(h.screen.appearanceOf('codex')).toEqual(PRESET_CODEX);

    // 深拷贝：草稿不是预设对象本身，部件值也不是同一份引用
    const claude = h.screen.appearanceOf('claude-code');
    expect(claude).not.toBe(PRESET_CLAUDE);
    expect(claude?.parts.body).not.toBe(PRESET_CLAUDE.parts.body);
    // itemId 精确格式保留
    expect(claude?.parts.hair).toMatchObject({ variant: 'chestnut', itemId: 'hair_parted' });

    // 画布宿主：屏渲染出容器，且把它交给了预览服务（默认预览第一个 agent）
    const canvasHost = one(h.screen, '[data-role="appearance-canvas"]');
    expect(stub.log.attached.length).toBeGreaterThan(0);
    expect(stub.log.attached[stub.log.attached.length - 1]).toBe(canvasHost);
    // 预览推的是第一个 agent 的预设
    expect(stub.log.previews[stub.log.previews.length - 1]).toEqual(PRESET_CLAUDE);
    h.unmount();
  });

  test('深拷贝的独立性：改 A 的部件不会写穿预设、不影响 B', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE, CODEX]));
    one(h.screen, '[data-action="next"]').click();

    select(h.screen, '[data-role="appearance-part"][data-category="hair"]', 'black');

    // A 的头发换了，B 的草稿没动，桩里的预设常量也没被写穿
    expect(h.screen.appearanceOf('claude-code')?.parts.hair).toBe('black');
    expect(h.screen.appearanceOf('codex')?.parts.hair).toMatchObject({ variant: 'ash', itemId: 'hair_buzzcut' });
    expect(PRESET_CLAUDE.parts.hair).toMatchObject({ variant: 'chestnut', itemId: 'hair_parted' });
    h.unmount();
  });

  test('兜底：素材未就绪（preset 返 null）→ 草稿为空，等 whenReady 后回填预设', async () => {
    const stub = createStubPort();
    stub.log.ready = false;
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    // 素材没就绪：不编造长相，草稿是 null
    expect(h.screen.appearanceOf('claude-code')).toBeNull();

    stub.log.ready = true;
    await flush();

    // whenReady 落地 → 补上默认形象
    expect(h.screen.appearanceOf('claude-code')).toEqual(PRESET_CLAUDE);
    h.unmount();
  });
});

describe('向导第②步 · 重随机与重置品牌默认', () => {
  test('「重随机」按钮（卡片级，带 data-kind）：规则随机 normal 档，只改那一个 agent', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE, CODEX]));
    one(h.screen, '[data-action="next"]').click();

    const previewsBefore = stub.log.previews.length;
    // 当前预览的是 claude —— 点 codex 卡片上的重随机
    one(h.screen, '[data-action="randomize-appearance"][data-kind="codex"]').click();

    expect(stub.log.randomizedNormal).toBe(1);
    expect(h.screen.appearanceOf('codex')).toEqual(NORMAL_RANDOM);
    // 另一个 agent 的草稿不受影响
    expect(h.screen.appearanceOf('claude-code')).toEqual(PRESET_CLAUDE);
    // codex 不是当前预览对象 → 画布不该被 codex 的新形象刷掉
    expect(stub.log.previews.length).toBe(previewsBefore);

    // 再点当前预览对象（claude）的重随机 → 草稿换新 + 画布刷新
    one(h.screen, '[data-action="randomize-appearance"][data-kind="claude-code"]').click();
    expect(h.screen.appearanceOf('claude-code')).toEqual(NORMAL_RANDOM);
    expect(stub.log.previews[stub.log.previews.length - 1]).toEqual(NORMAL_RANDOM);
    h.unmount();
  });

  test('素材没就绪（randomizeNormal 返 null）→ 给出提示，不编造长相', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    const before = h.screen.appearanceOf('claude-code');
    stub.log.randomizeReturnsNull = true;
    one(h.screen, '[data-action="randomize-appearance"][data-kind="claude-code"]').click();

    expect(one(h.screen, '[data-role="appearance-error"]').textContent).toContain('素材还没加载出来');
    // 抽不到就不改：原来的长相保持不变（不编造）
    expect(h.screen.appearanceOf('claude-code')).toEqual(before);
    h.unmount();
  });

  test('「重置为品牌默认」按钮：草稿回到预设（新的深拷贝）', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    // 先重随机打乱，再重置
    one(h.screen, '[data-action="randomize-appearance"][data-kind="claude-code"]').click();
    expect(h.screen.appearanceOf('claude-code')).toEqual(NORMAL_RANDOM);

    one(h.screen, '[data-action="reset-appearance"][data-kind="claude-code"]').click();

    const restored = h.screen.appearanceOf('claude-code');
    expect(restored).toEqual(PRESET_CLAUDE);
    // 是新的深拷贝，不是把预设常量直接塞回来
    expect(restored).not.toBe(PRESET_CLAUDE);
    // 画布跟着刷新回默认形象
    expect(stub.log.previews[stub.log.previews.length - 1]).toEqual(PRESET_CLAUDE);
    h.unmount();
  });

  test('重随机与部件选择作用于草稿副本：改部件后重随机，部件被整套替换', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    select(h.screen, '[data-role="appearance-part"][data-category="hair"]', 'black');
    expect(h.screen.appearanceOf('claude-code')?.parts.hair).toBe('black');

    one(h.screen, '[data-action="randomize-appearance"][data-kind="claude-code"]').click();
    // 重随机是整套替换（normal 档随机结果），不是在旧草稿上打补丁
    expect(h.screen.appearanceOf('claude-code')).toEqual(NORMAL_RANDOM);
    h.unmount();
  });
});

describe('向导第②步 · 预览与部件选择器', () => {
  test('多个 agent：点「预览形象」切到另一个，画布跟着换', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE, CODEX]));
    one(h.screen, '[data-action="next"]').click();

    expect(h.screen.previewKind).toBe('claude-code');
    one(h.screen, '[data-action="preview-appearance"][data-kind="codex"]').click();

    expect(h.screen.previewKind).toBe('codex');
    // 切过去就把 codex 的草稿推给预览服务
    expect(stub.log.previews[stub.log.previews.length - 1]).toEqual(PRESET_CODEX);
    // 面板标题标出正在看谁
    expect(one(h.screen, '[data-group="appearance"]').textContent).toContain('Codex');
    h.unmount();
  });

  test('部件选择器：改变体 → 更新**当前预览对象**的草稿并刷新预览', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE, CODEX]));
    one(h.screen, '[data-action="next"]').click();

    one(h.screen, '[data-action="preview-appearance"][data-kind="codex"]').click();
    select(h.screen, '[data-role="appearance-part"][data-category="hair"]', 'black');

    expect(h.screen.appearanceOf('codex')?.parts.hair).toBe('black');
    expect(h.screen.appearanceOf('claude-code')).toEqual(PRESET_CLAUDE);
    const last = stub.log.previews[stub.log.previews.length - 1] as { parts: Record<string, unknown> };
    expect(last.parts.hair).toBe('black');
    // 摘要跟着更新
    expect(one(h.screen, '[data-role="appearance-summary"]').textContent).toContain('hair:black');
    h.unmount();
  });

  test('体型选择器：换体型 → 当前预览对象的草稿体型跟着换', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    select(h.screen, '[data-role="body-type"]', 'female');

    expect(h.screen.appearanceOf('claude-code')?.bodyType).toBe('female');
    h.unmount();
  });
});

describe('向导第②步 · 提交（逐 agent 各带各的 appearance）', () => {
  test('提交：每个 character.create 带各自 agent 的 appearance（itemId 格式）', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE, CODEX]));
    one(h.screen, '[data-action="next"]').click();

    // 只改 claude 的头发（codex 保持品牌默认）—— 提交时要能区分"谁改过、谁没改"
    select(h.screen, '[data-role="appearance-part"][data-category="hair"]', 'black');

    h.screen.submit();

    const creates = h.commands.filter((command) => command.type === 'character.create');
    expect(creates).toHaveLength(2);
    if (creates[0]?.type !== 'character.create' || creates[1]?.type !== 'character.create') {
      throw new Error('命令类型不对');
    }
    // claude：改过的部件是纯变体串，其余部件保留 itemId 格式
    expect(creates[0].agentKind).toBe('claude-code');
    expect(creates[0].appearance?.parts.hair).toBe('black');
    expect(creates[0].appearance?.parts.body).toMatchObject({ variant: 'light', itemId: 'heads_human_male' });
    // codex：整套品牌默认原样带走
    expect(creates[1].agentKind).toBe('codex');
    expect(creates[1].appearance).toEqual(PRESET_CODEX);
    h.unmount();
  });

  test('提交：素材一直没就绪 → 草稿为空 → 不带 appearance 字段（老档案照旧合法）', async () => {
    const stub = createStubPort();
    // 素材一直没就绪 → 从头就没有默认形象
    stub.log.ready = false;
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();
    await flush();

    expect(h.screen.appearanceOf('claude-code')).toBeNull();

    h.screen.submit();
    const create = h.commands.find((command) => command.type === 'character.create');
    if (create?.type !== 'character.create') throw new Error('命令类型不对');
    expect(create.appearance).toBeUndefined();
    h.unmount();
  });
});

describe('向导第②步 · 生命周期与降级', () => {
  test('没注入端口：向导照常能走完（只是没有形象功能）', () => {
    const h = mountScreen(null);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    expect(h.screen.step).toBe('identity');
    expect(one(h.screen, '[data-role="appearance-unavailable"]').textContent).toContain('形象预览没接上');
    expect(h.screen.appearanceOf('claude-code')).toBeNull();
    // 没端口时点卡片上的形象按钮也不炸（静默不动）
    one(h.screen, '[data-action="randomize-appearance"][data-kind="claude-code"]').click();
    one(h.screen, '[data-action="reset-appearance"][data-kind="claude-code"]').click();
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

  test('画布宿主跨重渲染存活（重随机 / 切预览不丢画布）', () => {
    const stub = createStubPort();
    const h = mountScreen(stub);
    h.emit(makeState([CLAUDE]));
    one(h.screen, '[data-action="next"]').click();

    const canvasHost = one(h.screen, '[data-role="appearance-canvas"]');
    one(h.screen, '[data-action="randomize-appearance"][data-kind="claude-code"]').click();
    // 换肤会整块重画身份区（含画布宿主的占位）—— 宿主元素不能被换掉
    one(h.screen, '[data-action="reroll"][data-kind="claude-code"]').click();

    // 还是同一个宿主元素（Phaser 的 canvas 挂在它里面）
    expect(one(h.screen, '[data-role="appearance-canvas"]')).toBe(canvasHost);
    h.unmount();
  });
});

// ============================================================================
// 架构护栏：hud ↔ world 的隔离（task_028 的硬约束，task_032 延续）
// ============================================================================

describe('架构护栏 · 向导屏不认识 world', () => {
  const read = (relative: string): string =>
    fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf-8');

  const screenSource = read('hud/screens/onboarding-screen.ts');
  const portSource = read('hud/screens/appearance-preview-port.ts');
  const catalogSource = read('hud/screens/onboarding-catalog.ts');
  const serviceSource = read('app/services/appearance-preview-service.ts');

  test('屏与端口都不 import world / phaser（总线隔离铁律——品牌预设与随机器只能经注入进来）', () => {
    expect(screenSource).not.toMatch(/from '[^']*world\//);
    expect(screenSource).not.toMatch(/from 'phaser'/);
    expect(portSource).not.toMatch(/from '[^']*world\//);
    expect(portSource).not.toMatch(/from 'phaser'/);
    expect(catalogSource).not.toMatch(/from '[^']*world\//);
    // 预设库与随机器只能出现在注释/文档里，不许出现在 import 语句里（护栏看的是依赖边，不是文字）
    expect(catalogSource).not.toMatch(/from '[^']*(brand-presets|appearance-randomizer)/);
  });

  test('预览服务不把 Phaser 拖进依赖图（Phaser 只在游戏工厂那一层 import）', () => {
    expect(serviceSource).not.toMatch(/from 'phaser'/);
    // 但它得认识 world（预设库与随机器在那边）—— 组合根允许，hud 不允许。
    expect(serviceSource).toMatch(/world\/appearance\/brand-presets/);
    expect(serviceSource).toMatch(/world\/appearance\/appearance-randomizer/);
  });
});
