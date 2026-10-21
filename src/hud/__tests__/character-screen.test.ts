/**
 * 集成测试：角色屏（hud/screens/character-screen.ts + character-catalog.ts）。
 * 覆盖：WorldState.characters 渲染、单选单位的角色详情、编组内单位↔角色关联、用户数据转义、
 *   经验增长动画钩子（DOM 事件 + 高亮 + 定时器清理）、渲染判重、卸载退订、导航命令，以及纯派生函数。
 * @jest-environment jsdom
 *
 * 闭环那一段不打桩总线：store / bus-adapter 都是真件，经验是经 core/character/manager 真写入的 ——
 * 屏幕上"经验涨了"必须来自 core 的真实投影，不是测试自己改 DOM。
 */

import { createStore } from '../../core/store';
import { createCharacterManager } from '../../core/character';
import type { CharacterView, HudCommand, UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import { createThemeController } from '../theme/theme-controller';

import {
  characterSignature,
  resolveCharacterModel,
  MAX_CHARACTER_CARDS,
  type CharacterScreenModel,
} from '../screens/character-catalog';
import {
  CHARACTER_SCREEN_TAG,
  EXP_GAINED_EVENT,
  EXP_PULSE_MS,
  mountCharacterScreen,
  type CharacterScreenDeps,
  type ExpGainedDetail,
  type StratCharacterScreenElement,
} from '../screens/character-screen';

const CHARACTERS: CharacterView[] = [
  { id: 'c-neo', name: 'Neo', persona: '谨慎的数据分析师', level: 2, experience: 130 },
  { id: 'c-trinity', name: 'Trinity', persona: '', level: 1, experience: 20 },
];

const UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo-单元', status: 'idle', missionId: null, power: 3, characterId: 'c-neo' },
  { id: 'u-trin', name: 'Trinity-单元', status: 'busy', missionId: null, power: 2, characterId: 'c-trinity' },
  { id: 'u-ghost', name: '无档案单元', status: 'idle', missionId: null, power: 1 },
];

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: UNITS,
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: CHARACTERS,
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

interface Harness {
  readonly screen: StratCharacterScreenElement;
  readonly host: HTMLElement;
  readonly commands: HudCommand[];
  readonly store: ReturnType<typeof createStore>;
  /** core 广播一份新状态（走 adapter.subscribe 的真实订阅链）。 */
  emit(state: Partial<WorldState>): void;
  /** 真写库路径：经 core/character/manager 加经验（与生产同一入口）。 */
  grantExperience(characterId: string, amount: number): void;
  screenSubscriberCount(): number;
  unmount(): void;
}

function mountScreen(initial: Partial<WorldState> = {}): Harness {
  const commands: HudCommand[] = [];
  const store = createStore(makeState(initial));
  const themeController = createThemeController({ sources: { default: '', pixel: '' }, initial: 'default' });
  let screenSubscribers = 0;

  const adapter = createHudBusAdapter({
    themeController,
    onState: (handler) => store.subscribe(handler),
    emitCommand: (command) => { commands.push(command); },
  });
  const unmountAdapter = adapter.mount();

  const screenDeps: CharacterScreenDeps = {
    dispatch: (command) => adapter.dispatch(command),
    subscribe: (handler) => {
      screenSubscribers += 1;
      const off = adapter.subscribe(handler);
      return () => { screenSubscribers -= 1; off(); };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountCharacterScreen(screenDeps, host);
  const screen = host.querySelector(CHARACTER_SCREEN_TAG) as StratCharacterScreenElement;
  if (!screen?.shadowRoot) throw new Error('角色屏未 upgrade（shadowRoot 为空）');

  // 首帧走真实广播链：adapter 只在收到 state 时才有快照（与 settings 屏夹具同一口径），
  // 故显式推一次初始状态，而不是绕过订阅直接喂元素。
  store.patch({});

  const manager = createCharacterManager({ store });
  return {
    screen,
    host,
    commands,
    store,
    // patch 而非 setState：同值也强制广播一次（模拟"core 每次状态变更都全量广播"）
    emit: (state) => { store.patch(state); },
    grantExperience: (characterId, amount) => { manager.grantExperience(characterId, amount); },
    screenSubscriberCount: () => screenSubscribers,
    unmount: () => { unmountScreen(); unmountAdapter(); host.remove(); },
  };
}

/** 进 shadow DOM 取文本：走真实渲染结果，不断言数据源。 */
function text(screen: StratCharacterScreenElement, selector: string): string {
  return screen.shadowRoot?.querySelector(selector)?.textContent?.trim() ?? '';
}

function all(screen: StratCharacterScreenElement, selector: string): HTMLElement[] {
  return Array.from(screen.shadowRoot?.querySelectorAll(selector) ?? []);
}

function clickInScreen(screen: StratCharacterScreenElement, selector: string): void {
  const node = screen.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`控件未渲染: ${selector}`);
  node.click();
}

afterEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
});

// ============================================================================
// 1. 纯派生函数（character-catalog）
// ============================================================================

describe('角色屏派生模型', () => {
  test('null 快照渲染成空态：没有编造任何角色', () => {
    const model = resolveCharacterModel(null);
    expect(model.mode).toBe('empty');
    expect(model.cards).toEqual([]);
    expect(model.focus).toBeNull();
  });

  test('单选且已关联 → 详情位是该角色；关联单位名被带上', () => {
    const model = resolveCharacterModel(makeState({ selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 } }));
    expect(model.mode).toBe('single');
    expect(model.focus?.id).toBe('c-neo');
    expect(model.focus?.linkedUnits).toEqual(['Neo-单元']);
  });

  test('单选但未关联角色 → 详情位为 null（不拿别的角色顶替）', () => {
    const model = resolveCharacterModel(makeState({ selection: { unitIds: ['u-ghost'], previewUnitIds: [], revision: 1 } }));
    expect(model.mode).toBe('single');
    expect(model.focus).toBeNull();
  });

  test('characterId 悬空（指向不存在的角色）同样不编数据', () => {
    const units: UnitView[] = [{ ...UNITS[0] as UnitView, characterId: 'c-gone' }];
    const model = resolveCharacterModel(makeState({ units, selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 } }));
    expect(model.focus).toBeNull();
  });

  test('编组：逐个列出单位↔角色，未关联的单位照样在列并计入 unboundUnits', () => {
    const model = resolveCharacterModel(
      makeState({ selection: { unitIds: ['u-neo', 'u-ghost'], previewUnitIds: [], revision: 2 } })
    );
    expect(model.mode).toBe('group');
    expect(model.focus).toBeNull();
    expect(model.links.map((l) => [l.unitName, l.characterName, l.level])).toEqual([
      ['Neo-单元', 'Neo', 2],
      ['无档案单元', null, null],
    ]);
    expect(model.unboundUnits).toBe(1);
  });

  test('成长数值投影：本级进度 / 距下一级 / 满级', () => {
    const [neo] = resolveCharacterModel(makeState()).cards;
    expect(neo?.growth).toMatchObject({ level: 2, experience: 130, intoLevel: 30, levelSpan: 100, toNext: 70, percent: 30 });

    const maxed = resolveCharacterModel(
      makeState({ characters: [{ ...(CHARACTERS[0] as CharacterView), level: 5, experience: 900 }] })
    ).cards[0];
    expect(maxed?.growth).toMatchObject({ maxed: true, toNext: null, percent: 100 });
  });

  test('卡片有上限且如实报溢出数（派生数据必须是有界的）', () => {
    const many: CharacterView[] = Array.from({ length: MAX_CHARACTER_CARDS + 3 }, (_, i) => ({
      id: `c-${i}`,
      name: `角色${i}`,
      persona: '',
      level: 1,
      experience: 0,
    }));
    const model = resolveCharacterModel(makeState({ characters: many }));
    expect(model.cards).toHaveLength(MAX_CHARACTER_CARDS);
    expect(model.cardOverflow).toBe(3);
  });

  test('渲染签名：任务/通知变动不触发本屏重绘，经验与提示词变动要触发', () => {
    const base = makeState();
    expect(characterSignature(base)).toBe(
      characterSignature(makeState({
        missions: [{ id: 'm1', title: '侦察', phase: 'running', unitIds: [], createdAt: 1 }],
        notices: [{ id: 'n1', level: 'info', text: 'hi', createdAt: 1, expiresAt: 9e12 }],
      }))
    );
    expect(characterSignature(base)).not.toBe(
      characterSignature(makeState({
        characters: [{ ...(CHARACTERS[0] as CharacterView), experience: 200, level: 3 }],
      }))
    );
    expect(characterSignature(base)).not.toBe(
      characterSignature(makeState({
        characters: [{ ...(CHARACTERS[0] as CharacterView), persona: '换了一套人设' }],
      }))
    );
  });
});

// ============================================================================
// 2. 渲染：与 WorldState.characters 联动
// ============================================================================

describe('角色屏渲染', () => {
  test('挂载即渲染全部角色卡：等级 / 经验 / 提示词', () => {
    const h = mountScreen();
    const cards = all(h.screen, '[data-role="card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Neo');
    expect(cards[0]?.textContent).toContain('Lv.2');
    expect(cards[0]?.textContent).toContain('距下一级 70');
    expect(cards[0]?.querySelector('[data-role="persona"]')?.textContent).toBe('谨慎的数据分析师');
    h.unmount();
  });

  test('core 广播新状态 → 本屏重渲染（角色改名/升级都跟着变）', () => {
    const h = mountScreen();
    h.emit({ characters: [{ ...(CHARACTERS[0] as CharacterView), name: 'Neo-改名', level: 5, experience: 400 }] });
    const card = h.screen.shadowRoot?.querySelector('[data-role="card"]');
    expect(card?.textContent).toContain('Neo-改名');
    expect(card?.textContent).toContain('已满级');
    h.unmount();
  });

  test('单选单位 → 详情位显示它的角色（验收：单选显示角色详情）', () => {
    const h = mountScreen({ selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 } });
    const focus = h.screen.shadowRoot?.querySelector('[data-group="focus"] [data-role="card"]');
    expect(focus?.getAttribute('data-character-id')).toBe('c-neo');
    expect(focus?.textContent).toContain('关联单位：Neo-单元');
    h.unmount();
  });

  test('单选但未关联角色 → 明说未关联，不显示别人的角色', () => {
    const h = mountScreen({ selection: { unitIds: ['u-ghost'], previewUnitIds: [], revision: 1 } });
    expect(text(h.screen, '[data-role="focus-empty"]')).toBe('该单位未关联角色档案');
    expect(h.screen.shadowRoot?.querySelector('[data-group="focus"] [data-role="card"]')).toBeNull();
    h.unmount();
  });

  test('编组 → 关联行列出每个单位，未关联的标注出来并给提示', () => {
    const h = mountScreen({ selection: { unitIds: ['u-neo', 'u-ghost'], previewUnitIds: [], revision: 1 } });
    const rows = all(h.screen, '[data-unit-id]');
    expect(rows.map((r) => r.getAttribute('data-unit-id'))).toEqual(['u-neo', 'u-ghost']);
    expect(rows[1]?.getAttribute('data-bound')).toBe('false');
    expect(rows[1]?.textContent).toContain('未关联角色');
    expect(text(h.screen, '[data-role="unbound-hint"]')).toBe('编组内有 1 个单位尚未关联角色');
    h.unmount();
  });

  test('一个角色都没有时给空态说明，不编数据', () => {
    const h = mountScreen({ characters: [], selection: { unitIds: [], previewUnitIds: [], revision: 0 } });
    expect(text(h.screen, '[data-role="cards-empty"]')).toContain('尚无角色档案');
    h.unmount();
  });

  test('用户数据（角色名 / 提示词）按文本渲染，不产生 DOM 注入', () => {
    const h = mountScreen({
      characters: [{ id: 'c-x', name: '<img src=x onerror=1>', persona: '<b>注入</b>', level: 1, experience: 0 }],
    });
    const card = h.screen.shadowRoot?.querySelector('[data-role="card"]');
    expect(card?.querySelector('img')).toBeNull();
    expect(card?.querySelector('b')).toBeNull();
    expect(card?.querySelector('[data-role="persona"]')?.textContent).toBe('<b>注入</b>');
    h.unmount();
  });

  test('渲染判重：无关状态变动（任务/通知）不重画本屏', () => {
    const h = mountScreen();
    const body = h.screen.shadowRoot?.querySelector('[data-role="body"]');
    const firstNode = body?.firstChild;
    h.emit({ missions: [{ id: 'm1', title: '侦察', phase: 'running', unitIds: [], createdAt: 1 }] });
    expect(h.screen.shadowRoot?.querySelector('[data-role="body"]')?.firstChild).toBe(firstNode);
    h.unmount();
  });
});

// ============================================================================
// 3. 经验增长动画钩子
// ============================================================================

describe('经验增长钩子（事件驱动占位）', () => {
  test('经验经 core 写入上涨 → 派发 character-exp-gained（detail 含涨幅与升了几级）', () => {
    const h = mountScreen();
    const seen: ExpGainedDetail[] = [];
    h.screen.addEventListener(EXP_GAINED_EVENT, (ev) => seen.push((ev as CustomEvent<ExpGainedDetail>).detail));

    h.grantExperience('c-trinity', 100); // 20 → 120：恰好跨过 100 升 1 级

    expect(seen).toEqual([{ characterId: 'c-trinity', gained: 100, levelUps: 1 }]);
    expect(h.store.getState().characters[1]).toMatchObject({ level: 2, experience: 120 });
    h.unmount();
  });

  test('连升也只发一条事件，levelUps 记跨越级数', () => {
    const h = mountScreen();
    const seen: ExpGainedDetail[] = [];
    h.screen.addEventListener(EXP_GAINED_EVENT, (ev) => seen.push((ev as CustomEvent<ExpGainedDetail>).detail));

    h.grantExperience('c-trinity', 260);

    expect(seen).toEqual([{ characterId: 'c-trinity', gained: 260, levelUps: 2 }]);
    h.unmount();
  });

  test('首次渲染不算增长（挂载瞬间全体"涨经验"是假的）', () => {
    const h = mountScreen();
    const seen: ExpGainedDetail[] = [];
    h.screen.addEventListener(EXP_GAINED_EVENT, (ev) => seen.push((ev as CustomEvent<ExpGainedDetail>).detail));

    h.emit({ selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 } });

    expect(seen).toEqual([]);
    h.unmount();
  });

  test('经验没变（重渲染）不发事件', () => {
    const h = mountScreen();
    const seen: ExpGainedDetail[] = [];
    h.screen.addEventListener(EXP_GAINED_EVENT, (ev) => seen.push((ev as CustomEvent<ExpGainedDetail>).detail));

    h.emit({ notices: [{ id: 'n1', level: 'info', text: 'x', createdAt: 1, expiresAt: 9e12 }] });
    h.emit({ characters: CHARACTERS });

    expect(seen).toEqual([]);
    h.unmount();
  });

  test('经验条高亮：挂上 data-pulse，到期自动摘掉（定时器必须可清理）', () => {
    jest.useFakeTimers();
    const h = mountScreen();

    h.grantExperience('c-trinity', 100);
    const bar = h.screen.shadowRoot?.querySelector('[data-character-id="c-trinity"] [data-role="exp-bar"]');
    expect(bar?.getAttribute('data-pulse')).toBe('true');

    jest.advanceTimersByTime(EXP_PULSE_MS);
    expect(bar?.getAttribute('data-pulse')).toBe('false');
    h.unmount();
  });

  test('卸载即退订 + 清高亮定时器（不留在全局跑）', () => {
    jest.useFakeTimers();
    const h = mountScreen();
    h.grantExperience('c-trinity', 100);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    expect(h.screenSubscriberCount()).toBe(1);

    h.unmount();

    expect(h.screenSubscriberCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ============================================================================
// 4. 交互 → HudCommand
// ============================================================================

describe('交互 → HudCommand', () => {
  test('返回主屏 → ui.navigate main', () => {
    const h = mountScreen();
    clickInScreen(h.screen, '[data-role="back"]');
    expect(h.commands).toEqual([{ type: 'ui.navigate', screen: 'main' }]);
    h.unmount();
  });

  test('打开聊天 → ui.navigate chat（契约把 chat 解释为打开聊天抽屉）', () => {
    const h = mountScreen();
    clickInScreen(h.screen, '[data-role="chat"]');
    expect(h.commands).toEqual([{ type: 'ui.navigate', screen: 'chat' }]);
    h.unmount();
  });

  test('本屏是纯展示：除导航外不发任何业务命令（不改角色数值）', () => {
    const h = mountScreen();
    all(h.screen, '[data-role="card"]').forEach((card) => card.click());
    expect(h.commands).toEqual([]);
    h.unmount();
  });
});

describe('对外形状', () => {
  test('model 与 lastState 随订阅更新', () => {
    const h = mountScreen({ selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 } });
    const model: CharacterScreenModel = h.screen.model;
    expect(model.focus?.id).toBe('c-neo');
    expect(h.screen.lastState?.selection.unitIds).toEqual(['u-neo']);
    h.unmount();
  });
});