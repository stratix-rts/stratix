/**
 * 集成测试：角色屏的形象编辑面板（character-screen.ts 的 task_041 增量）。
 * 覆盖：按等级过滤的灰显与角标（需求①）、未解锁类别不可改、保存发 HudCommand、
 *   受限重随机不碰未解锁类别（需求②）、升级后新类别可见（需求③）、
 *   无端口的降级、无外观角色的预设初始化（含素材就绪补一次）、卸载销毁端口。
 * @jest-environment jsdom
 *
 * 闭环不打桩总线：store / bus-adapter / character-manager 都是真件（与 character-screen.test.ts
 * 同一夹具口径）—— 升级走 manager 真写库、真广播；形象预览端口是**注入的桩**
 * （AppearancePreviewPort 本就是给测试注入的契约面，桩数据即夹具，不是 mock 业务数据）。
 * 纯逻辑（等级裁决 / 合并 / 文案）在 appearance-unlock-catalog.test.ts，本文件只测「面板接线」。
 */

import { createStore } from '../../core/store';
import { createCharacterManager } from '../../core/character';
import type { CharacterAppearance, CharacterView, HudCommand, UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import { createThemeController } from '../theme/theme-controller';
import type { AppearanceCategoryInfo, AppearancePreviewPort } from '../screens/appearance-preview-port';
import {
  CHARACTER_SCREEN_TAG,
  mountCharacterScreen,
  type CharacterScreenDeps,
  type StratCharacterScreenElement,
} from '../screens/character-screen';

/* ------------------------------------------------------------------ 夹具 —— */

/** 编辑面板测试用的全量类别清单（词表对拍之外的最小子集：L1 基础 + L3/L5/L12 各一）。 */
const CATEGORIES: readonly AppearanceCategoryInfo[] = [
  { category: 'body', name: '身体（肤色）', variants: ['light', 'dark'] },
  { category: 'hair', name: '头发', variants: ['black', 'blonde'] },
  { category: 'torso', name: '上衣', variants: ['white_shirt'] },
  { category: 'hat', name: '帽子', variants: ['cap'] },
  { category: 'nose', name: '鼻子', variants: ['big'] },
];

/** 桩端口的行为状态（测试里直接改，屏不感知）。 */
interface StubPortState {
  attachedHosts: HTMLElement[];
  previews: CharacterAppearance[];
  destroyed: number;
  roll: CharacterAppearance | null;
  presetSource: (kind: string) => CharacterAppearance | null;
  ready: Promise<void>;
}

function createStubPort(
  initial: Partial<Pick<StubPortState, 'roll' | 'presetSource' | 'ready'>> = {}
): { port: AppearancePreviewPort; state: StubPortState } {
  const state: StubPortState = {
    attachedHosts: [],
    previews: [],
    destroyed: 0,
    roll: null,
    presetSource: () => null,
    ready: Promise.resolve(),
    ...initial,
  };
  const port: AppearancePreviewPort = {
    bodyTypes: ['male', 'female'],
    listCategories: () => CATEGORIES.slice(0, 2),
    // @since v3.20 编辑面板用的全量类别（可选能力 —— 端口没实现时面板退回 listCategories）。
    listAllCategories: () => CATEGORIES,
    whenReady: () => state.ready,
    preset: (kind: string) => state.presetSource(kind),
    randomizeNormal: () => state.roll,
    attach: (host: HTMLElement) => {
      state.attachedHosts.push(host);
    },
    preview: (appearance: CharacterAppearance) => {
      state.previews.push(appearance);
    },
    destroy: () => {
      state.destroyed += 1;
    },
  };
  return { port, state };
}

/**
 * L2 角色（累计经验 130 ≥ L2 的 100、< L3 的 250）：服装（L3）/ 饰品（L5）/ 武装（L8）/ 补全（L12）
 * 全部未解锁。torso / hat 是向导（创建前不受限，032 口径）带进来的高等级部位 —— 编辑路径不许抹掉。
 */
const L2_APPEARANCE: CharacterAppearance = {
  bodyType: 'male',
  parts: { body: 'light', hair: 'black', torso: 'white_shirt', hat: 'cap' },
};

const CHARACTERS: CharacterView[] = [
  {
    id: 'c-neo',
    name: 'Neo',
    persona: '谨慎的数据分析师',
    level: 2,
    experience: 130,
    agentKind: 'codex',
    appearance: L2_APPEARANCE,
  },
];

const UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo-单元', status: 'idle', missionId: null, power: 3, characterId: 'c-neo' },
];

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: UNITS,
    missions: [],
    // 单选 u-neo → 它的 c-neo 成为编辑面板的编辑对象。
    selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 0 },
    characters: CHARACTERS,
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

interface Harness {
  readonly screen: StratCharacterScreenElement;
  readonly commands: HudCommand[];
  readonly store: ReturnType<typeof createStore>;
  /** 真写库路径：经 core/character/manager 加经验（升级广播 = 生产链路）。 */
  grantExperience(characterId: string, amount: number): void;
  unmount(): void;
}

function mountScreen(
  initial: Partial<WorldState> = {},
  port: AppearancePreviewPort | null = null
): Harness {
  const commands: HudCommand[] = [];
  const store = createStore(makeState(initial));
  const themeController = createThemeController({ sources: { default: '', pixel: '' }, initial: 'default' });

  const adapter = createHudBusAdapter({
    themeController,
    onState: (handler) => store.subscribe(handler),
    emitCommand: (command) => { commands.push(command); },
  });
  const unmountAdapter = adapter.mount();

  const screenDeps: CharacterScreenDeps = {
    dispatch: (command) => adapter.dispatch(command),
    subscribe: (handler) => adapter.subscribe(handler),
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountCharacterScreen(screenDeps, host, port ? { appearance: port } : {});
  const screen = host.querySelector(CHARACTER_SCREEN_TAG) as StratCharacterScreenElement;
  if (!screen?.shadowRoot) throw new Error('角色屏未 upgrade（shadowRoot 为空）');

  // 首帧走真实广播链（与 settings / character 屏夹具同一口径）。
  store.patch({});

  const manager = createCharacterManager({ store });
  return {
    screen,
    commands,
    store,
    grantExperience: (characterId, amount) => { manager.grantExperience(characterId, amount); },
    unmount: () => { unmountScreen(); unmountAdapter(); host.remove(); },
  };
}

/** 取编辑面板里某个类别的选择器（.appearance-field[data-category]）。 */
function fieldOf(screen: StratCharacterScreenElement, category: string): HTMLElement | null {
  return screen.shadowRoot?.querySelector<HTMLElement>(
    `[data-group="appearance-edit"] .appearance-field[data-category="${category}"]`
  ) ?? null;
}

function clickAction(screen: StratCharacterScreenElement, action: string): void {
  screen.shadowRoot
    ?.querySelector(`[data-action="${action}"]`)
    ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
}

function changePart(screen: StratCharacterScreenElement, category: string, value: string): void {
  const select = fieldOf(screen, category)?.querySelector<HTMLSelectElement>('select');
  if (!select) throw new Error(`找不到 ${category} 的 select`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/* -------------------------------------------------------------- 测试体 —— */

describe('角色屏 · 形象编辑面板（task_041）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('L2：未解锁类别灰显（disabled + data-locked）并标「Lv.X 解锁」角标；基础类别可编辑', () => {
    const { port } = createStubPort();
    const harness = mountScreen({}, port);

    const torso = fieldOf(harness.screen, 'torso');
    expect(torso?.getAttribute('data-locked')).toBe('true');
    expect(torso?.querySelector('select')?.hasAttribute('disabled')).toBe(true);
    expect(torso?.querySelector('[data-role="lock-badge"]')?.textContent).toContain('Lv.3 解锁');

    expect(fieldOf(harness.screen, 'hat')?.querySelector('[data-role="lock-badge"]')?.textContent).toContain('Lv.5 解锁');
    expect(fieldOf(harness.screen, 'nose')?.querySelector('[data-role="lock-badge"]')?.textContent).toContain('Lv.12 解锁');

    const hair = fieldOf(harness.screen, 'hair');
    expect(hair?.getAttribute('data-locked')).toBe('false');
    expect(hair?.querySelector('select')?.hasAttribute('disabled')).toBe(false);
    expect(hair?.querySelector('[data-role="lock-badge"]')).toBeNull();

    harness.unmount();
  });

  test('改已解锁部件：草稿更新 + 推预览；未保存不发任何命令', () => {
    const { port, state } = createStubPort();
    const harness = mountScreen({}, port);

    changePart(harness.screen, 'hair', 'blonde');

    expect(harness.screen.appearanceDraftOf('c-neo')?.parts.hair).toBe('blonde');
    expect(state.previews.at(-1)?.parts.hair).toBe('blonde');
    expect(harness.commands).toHaveLength(0);

    harness.unmount();
  });

  test('未解锁类别的 select 即使被强改也不进草稿（防御，不信任 disabled）', () => {
    const { port } = createStubPort();
    const harness = mountScreen({}, port);

    const before = harness.screen.appearanceDraftOf('c-neo');
    changePart(harness.screen, 'torso', 'white_shirt');

    expect(harness.screen.appearanceDraftOf('c-neo')).toEqual(before);

    harness.unmount();
  });

  test('保存形象：发 character.appearance.update（characterId + 当前草稿）', () => {
    const { port } = createStubPort();
    const harness = mountScreen({}, port);

    changePart(harness.screen, 'hair', 'blonde');
    clickAction(harness.screen, 'save-appearance');

    expect(harness.commands).toHaveLength(1);
    const command = harness.commands[0];
    if (command.type !== 'character.appearance.update') {
      throw new Error(`应为 character.appearance.update，实为 ${command.type}`);
    }
    expect(command.characterId).toBe('c-neo');
    expect(command.appearance).toEqual({ ...L2_APPEARANCE, parts: { ...L2_APPEARANCE.parts, hair: 'blonde' } });

    harness.unmount();
  });

  test('受限重随机（L2）：roll 的已解锁类别并入，未解锁类别保留草稿现值，体型跟 roll', () => {
    const { port, state } = createStubPort({
      roll: {
        bodyType: 'female',
        parts: { body: 'dark', hair: 'blonde', torso: '别的上衣', hat: '别的帽子', nose: 'big' },
      },
    });
    const harness = mountScreen({}, port);

    clickAction(harness.screen, 'randomize-appearance');

    const draft = harness.screen.appearanceDraftOf('c-neo');
    expect(draft?.bodyType).toBe('female'); // 体型跟 roll
    expect(draft?.parts.body).toBe('dark'); // L1 基础类别跟 roll
    expect(draft?.parts.hair).toBe('blonde');
    expect(draft?.parts.torso).toBe('white_shirt'); // L3 未解锁 → 保留现值
    expect(draft?.parts.hat).toBe('cap'); // L5 未解锁 → 保留现值
    expect(draft?.parts.nose).toBeUndefined(); // L12 未解锁 → roll 的 nose 被裁掉
    // 裁剪后的草稿推给了预览。
    expect(state.previews.at(-1)?.bodyType).toBe('female');

    harness.unmount();
  });

  test('随机抽不出（roll = null）：面板显示错误提示，草稿不动', () => {
    const { port } = createStubPort({ roll: null });
    const harness = mountScreen({}, port);

    const before = harness.screen.appearanceDraftOf('c-neo');
    clickAction(harness.screen, 'randomize-appearance');

    const error = harness.screen.shadowRoot?.querySelector<HTMLElement>('[data-role="appearance-error"]');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toContain('素材还没加载出来');
    expect(harness.screen.appearanceDraftOf('c-neo')).toEqual(before);

    harness.unmount();
  });

  test('升级（真写库：L2 + 120 = 250 → L3）：广播后面板重渲染，torso 不再灰显、角标消失（需求③）', () => {
    const { port } = createStubPort();
    const harness = mountScreen({}, port);

    expect(fieldOf(harness.screen, 'torso')?.getAttribute('data-locked')).toBe('true');

    harness.grantExperience('c-neo', 120); // 累计 250 ≥ L3 的 250 —— 真实升级广播
    expect(harness.store.getState().characters[0]?.level).toBe(3);

    const torso = fieldOf(harness.screen, 'torso');
    expect(torso?.getAttribute('data-locked')).toBe('false');
    expect(torso?.querySelector('select')?.hasAttribute('disabled')).toBe(false);
    expect(torso?.querySelector('[data-role="lock-badge"]')).toBeNull();
    // 未到下一档（L5）的类别照旧灰显 —— 升级只放开自己跨过的那档。
    expect(fieldOf(harness.screen, 'hat')?.getAttribute('data-locked')).toBe('true');
    // 升级前的编辑草稿还在（跨广播不丢）。
    expect(harness.screen.appearanceDraftOf('c-neo')?.parts.torso).toBe('white_shirt');

    harness.unmount();
  });

  test('没有形象的角色：草稿从端口预设初始化（深拷贝，不共享引用）', () => {
    const preset: CharacterAppearance = { bodyType: 'male', parts: { body: 'light', hair: 'black' } };
    const { port } = createStubPort({ presetSource: () => preset });
    const harness = mountScreen(
      {
        characters: [
          { id: 'c-new', name: '新角色', persona: '', level: 1, experience: 0, agentKind: 'claude-code' },
        ],
        units: [{ id: 'u-new', name: '新角色-单元', status: 'idle', missionId: null, power: 1, characterId: 'c-new' }],
        selection: { unitIds: ['u-new'], previewUnitIds: [], revision: 0 },
      },
      port
    );

    const draft = harness.screen.appearanceDraftOf('c-new');
    expect(draft).toEqual(preset);
    expect(draft).not.toBe(preset); // 深拷贝：改草稿不污染端口预设

    harness.unmount();
  });

  test('素材未就绪（预设返 null）：先显示提示，whenReady 后补初始化', async () => {
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((r) => { resolveReady = r; });
    let preset: CharacterAppearance | null = null;
    const { port } = createStubPort({ presetSource: () => preset, ready });
    const harness = mountScreen(
      {
        characters: [
          { id: 'c-new', name: '新角色', persona: '', level: 1, experience: 0, agentKind: 'claude-code' },
        ],
        units: [{ id: 'u-new', name: '新角色-单元', status: 'idle', missionId: null, power: 1, characterId: 'c-new' }],
        selection: { unitIds: ['u-new'], previewUnitIds: [], revision: 0 },
      },
      port
    );

    expect(harness.screen.shadowRoot?.querySelector('[data-role="appearance-loading"]')).not.toBeNull();
    expect(harness.screen.appearanceDraftOf('c-new')).toBeNull();

    preset = { bodyType: 'female', parts: { body: 'dark' } };
    resolveReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.screen.appearanceDraftOf('c-new')).toEqual(preset);
    expect(harness.screen.shadowRoot?.querySelector('[data-role="appearance-loading"]')).toBeNull();

    harness.unmount();
  });

  test('不注入端口：面板降级成提示语，屏照常可用（卡片列表仍在）', () => {
    const harness = mountScreen({}, null);

    expect(harness.screen.shadowRoot?.querySelector('[data-role="appearance-unavailable"]')).not.toBeNull();
    expect(harness.screen.shadowRoot?.querySelectorAll('[data-role="card"]').length).toBeGreaterThan(0);

    harness.unmount();
  });

  test('卸载：销毁端口实例（Phaser 不泄漏），草稿观察口清空', () => {
    const { port, state } = createStubPort();
    const harness = mountScreen({}, port);
    expect(harness.screen.appearanceDraftOf('c-neo')).not.toBeNull();

    harness.unmount();

    expect(state.destroyed).toBe(1);
    expect(harness.screen.appearanceDraftOf('c-neo')).toBeNull();
  });
});
