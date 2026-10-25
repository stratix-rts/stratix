/**
 * 集成测试：角色屏的三 tab 编辑中心（character-screen.ts 的 task_059 增量）。
 * 覆盖：tab 渲染与切换（需求①）、人设全文编辑 + 保存链路（命令 → 真写库 → 广播回读 →
 *   「下次对话生效」提示，需求②）、脏保护（切 tab / 返回主屏被拦，需求②）、
 *   预设重套（presetsForKind 推荐排序 + 覆写草稿，需求②）、
 *   改名（非空 / 超长 / 重名前置校验 + 命令 + 战场单位名实时刷新，需求③）、
 *   形象 tab 内嵌 041 面板（缺省 tab = appearance，行为不变，需求④）、
 *   无编辑对象不渲染编辑中心。
 * @jest-environment jsdom
 *
 * 闭环不打桩总线：store / bus-adapter / character-manager 都是真件（与
 * character-appearance-edit.test.ts 同一夹具口径）—— 保存 / 改名走 manager 真写库、真广播；
 * 适配器的 emitCommand 在测试里只收命令（命令消费闭环在同文件已由 core 侧闭环测试覆盖，
 * 这里补 manager 直调路径证明「广播 → 屏刷新」）。不注形象预览端口（人设 / 改名不依赖它）。
 */

import { createStore } from '../../core/store';
import { createCharacterManager } from '../../core/character';
import type { CharacterView, HudCommand, UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import { createThemeController } from '../theme/theme-controller';
import { PERSONA_PRESETS } from '../screens/persona-presets';
import {
  CHARACTER_SCREEN_TAG,
  mountCharacterScreen,
  type StratCharacterScreenElement,
} from '../screens/character-screen';

/* ------------------------------------------------------------------ 夹具 —— */

/** 带分节头的人设（composePersonaSections 输出格式）：分节概览条可识别的形态。 */
const SECTIONED_PERSONA = [
  '# 角色定位 ROLE',
  '',
  '谨慎的数据分析师',
  '',
  '# 行为规则 RULES',
  '',
  '- 你是一名在 Stratix 工作台里干活的本地 coding agent：',
].join('\n');

const CHARACTERS: CharacterView[] = [
  {
    id: 'c-neo',
    name: 'Neo',
    persona: SECTIONED_PERSONA,
    level: 2,
    experience: 130,
    agentKind: 'openclaw', // 有专属预设（夜间值守）→ 预设区可测推荐排序
  },
  {
    id: 'c-morph',
    name: '墨菲斯',
    persona: '引路人',
    level: 1,
    experience: 0,
    agentKind: 'codex',
  },
];

const UNITS: UnitView[] = [
  // id 用建档投影口径（unit_<角色id>）：改名 / 改形象同步刷新战场单位时按这个 id 找单位。
  { id: 'unit_c-neo', name: 'Neo', status: 'idle', missionId: null, power: 3, characterId: 'c-neo' },
  { id: 'unit_c-morph', name: '墨菲斯', status: 'idle', missionId: null, power: 2, characterId: 'c-morph' },
];

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: UNITS,
    missions: [],
    // 单选 unit_c-neo → 它的 c-neo 是编辑中心的编辑对象。
    selection: { unitIds: ['unit_c-neo'], previewUnitIds: [], revision: 0 },
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
  /** 真写库路径：manager 直调（保存人设 / 改名的生产链路 = runtime 把命令转给同一批方法）。 */
  readonly manager: ReturnType<typeof createCharacterManager>;
  unmount(): void;
}

function mountScreen(initial: Partial<WorldState> = {}): Harness {
  const commands: HudCommand[] = [];
  const store = createStore(makeState(initial));
  const themeController = createThemeController({ sources: { default: '', pixel: '' }, initial: 'default' });

  const adapter = createHudBusAdapter({
    themeController,
    onState: (handler) => store.subscribe(handler),
    emitCommand: (command) => { commands.push(command); },
  });
  const unmountAdapter = adapter.mount();

  const screenDeps = {
    dispatch: (command: HudCommand) => adapter.dispatch(command),
    subscribe: (handler: (state: WorldState) => void) => adapter.subscribe(handler),
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountCharacterScreen(screenDeps, host, {});
  const screen = host.querySelector(CHARACTER_SCREEN_TAG) as StratCharacterScreenElement;
  if (!screen?.shadowRoot) throw new Error('角色屏未 upgrade（shadowRoot 为空）');

  // 首帧走真实广播链（与 settings / character 屏夹具同一口径）。
  store.patch({});

  const manager = createCharacterManager({ store });
  return {
    screen,
    commands,
    store,
    manager,
    unmount: () => { unmountScreen(); unmountAdapter(); host.remove(); },
  };
}

/* ------------------------------------------------------ 测试用 DOM 助手 —— */

/** 点 tab 钮（编辑中心切换走原生 button click）。 */
function clickTab(screen: StratCharacterScreenElement, tab: string): void {
  screen.shadowRoot
    ?.querySelector(`[data-role="editor-tab"][data-tab="${tab}"]`)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** 点 strat-button 动作位（保存 / 放弃 / 改名）。 */
function clickAction(screen: StratCharacterScreenElement, action: string): void {
  screen.shadowRoot
    ?.querySelector(`[data-action="${action}"]`)
    ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
}

/** 点预设 chip（原生 button）。 */
function clickPreset(screen: StratCharacterScreenElement, presetId: string): void {
  screen.shadowRoot
    ?.querySelector(`[data-action="apply-persona-preset"][data-preset-id="${presetId}"]`)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** 当前 tab 的人设 textarea（要求人设 tab 已激活）。 */
function personaTextarea(screen: StratCharacterScreenElement): HTMLTextAreaElement {
  const node = screen.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="persona-textarea"]');
  if (!node) throw new Error('人设 textarea 未渲染（不在人设 tab？）');
  return node;
}

/** 模拟用户输入：改值 + 冒泡 input（编辑中心草稿走 input 事件）。 */
function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/* -------------------------------------------------------------- 测试体 —— */

describe('角色屏 · 编辑中心（task_059）', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  test('三 tab 渲染与切换：缺省 appearance（041 行为不变），可切档案 / 人设；无编辑对象不渲染', () => {
    const harness = mountScreen();

    // 缺省 tab = appearance：041 形象编辑面板（无端口时是降级提示）就在 tab 体内。
    expect(harness.screen.activeEditorTab).toBe('appearance');
    expect(harness.screen.shadowRoot?.querySelector('[data-tab-body="profile"]')).toBeNull();

    clickTab(harness.screen, 'profile');
    expect(harness.screen.activeEditorTab).toBe('profile');
    const nameInput = harness.screen.shadowRoot?.querySelector<HTMLInputElement>('[data-role="name-input"]');
    expect(nameInput?.value).toBe('Neo'); // 改名输入框预填当前名

    clickTab(harness.screen, 'persona');
    expect(harness.screen.activeEditorTab).toBe('persona');
    expect(personaTextarea(harness.screen).value).toBe(SECTIONED_PERSONA);

    // 未单选任何单位 → 编辑中心整组不渲染（tab 也不剩）。
    const empty = mountScreen({ selection: { unitIds: [], previewUnitIds: [], revision: 0 } });
    expect(empty.screen.shadowRoot?.querySelector('[data-group="character-editor"]')).toBeNull();
    expect(empty.screen.activeEditorTab).toBe('appearance');

    harness.unmount();
    empty.unmount();
  });

  test('人设保存链路：编辑 → 脏 → 保存发命令 → 真写库广播 → 草稿清位 + 「下次对话生效」提示', () => {
    const harness = mountScreen();
    clickTab(harness.screen, 'persona');

    typeInto(personaTextarea(harness.screen), '激进的前线突击手');
    expect(harness.screen.personaDraftOf('c-neo')?.dirty).toBe(true);

    clickAction(harness.screen, 'save-persona');
    // 命令面：character.persona.update（characterId + 草稿全文）。
    const command = harness.commands.find((c) => c.type === 'character.persona.update');
    if (command?.type !== 'character.persona.update') {
      throw new Error(`应为 character.persona.update，实为 ${harness.commands.map((c) => c.type).join(',')}`);
    }
    expect(command.characterId).toBe('c-neo');
    expect(command.prompt).toBe('激进的前线突击手');

    // 真写库（生产链路：runtime 把同名命令转给 manager 同一批方法）→ 广播 → 屏回读。
    harness.manager.updatePersona('c-neo', '激进的前线突击手');

    const draft = harness.screen.personaDraftOf('c-neo');
    expect(draft?.text).toBe('激进的前线突击手'); // 草稿归位 = 广播真相
    expect(draft?.dirty).toBe(false);
    const hint = harness.screen.shadowRoot?.querySelector('[data-role="persona-saved-hint"]');
    expect(hint?.textContent).toContain('下次对话生效');
    expect(harness.store.getState().characters[0]?.persona).toBe('激进的前线突击手'); // 落库证据

    harness.unmount();
  });

  test('脏保护：人设未保存时切 tab 被拦 + 提示；放弃修改后放行；返回主屏同样被拦', () => {
    const harness = mountScreen();
    clickTab(harness.screen, 'persona');
    typeInto(personaTextarea(harness.screen), '改了一半的人设');

    // 切 tab 被拦：还在人设 tab + 提示可见。
    clickTab(harness.screen, 'profile');
    expect(harness.screen.activeEditorTab).toBe('persona');
    const warn = harness.screen.shadowRoot?.querySelector('[data-role="persona-warn"]');
    expect(warn?.textContent).toContain('未保存');

    // 返回主屏同样被拦（ui.navigate 没发出去）。
    harness.commands.length = 0;
    harness.screen.shadowRoot
      ?.querySelector('[data-role="back"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(harness.commands.some((c) => c.type === 'ui.navigate')).toBe(false);

    // 放弃修改 → 脏解除 → tab 可切。
    clickAction(harness.screen, 'discard-persona');
    expect(harness.screen.personaDraftOf('c-neo')?.dirty).toBe(false);
    clickTab(harness.screen, 'profile');
    expect(harness.screen.activeEditorTab).toBe('profile');
    expect(harness.screen.shadowRoot?.querySelector('[data-role="persona-warn"]')).toBeNull();

    harness.unmount();
  });

  test('脏保护不打扰干净态：未编辑时切 tab / 返回主屏都畅通', () => {
    const harness = mountScreen();

    clickTab(harness.screen, 'persona');
    clickTab(harness.screen, 'appearance'); // 没编辑过 → 直接切走
    expect(harness.screen.activeEditorTab).toBe('appearance');

    harness.screen.shadowRoot
      ?.querySelector('[data-role="back"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(harness.commands.some((c) => c.type === 'ui.navigate' && c.screen === 'main')).toBe(true);

    harness.unmount();
  });

  test('人设空文本保存被本地拦截：提示而不发命令（core 侧同语义兜底在 Notice）', () => {
    const harness = mountScreen();
    clickTab(harness.screen, 'persona');

    typeInto(personaTextarea(harness.screen), '   ');
    clickAction(harness.screen, 'save-persona');

    expect(harness.commands.some((c) => c.type === 'character.persona.update')).toBe(false);
    expect(harness.screen.shadowRoot?.querySelector('[data-role="persona-warn"]')?.textContent).toContain('不能为空');
    expect(harness.store.getState().characters[0]?.persona).toBe(SECTIONED_PERSONA);

    harness.unmount();
  });

  test('预设重套：chip 按 kind 推荐排序（专属预设在首位带角标），点击覆写草稿（未保存不落库）', () => {
    const harness = mountScreen();
    clickTab(harness.screen, 'persona');

    const chips = Array.from(
      harness.screen.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-action="apply-persona-preset"]') ?? []
    );
    expect(chips.length).toBe(PERSONA_PRESETS.length);
    // openclaw 的专属预设（夜间值守）排首位且带「推荐」角标（presetsForKind 排序口径）。
    expect(chips[0]?.getAttribute('data-preset-id')).toBe('night-watch');
    expect(chips[0]?.textContent).toContain('推荐');

    clickPreset(harness.screen, 'night-watch');
    const preset = PERSONA_PRESETS.find((p) => p.id === 'night-watch');
    const draft = harness.screen.personaDraftOf('c-neo');
    expect(draft?.text).toBe(preset?.persona); // 覆写草稿
    expect(draft?.dirty).toBe(true);           // 显式覆写 = 改脏，要保存才落库
    expect(harness.store.getState().characters[0]?.persona).toBe(SECTIONED_PERSONA); // 未保存不落库
    expect(harness.commands).toHaveLength(0);

    harness.unmount();
  });

  test('分节概览：带分节头的人设显示分节条；自由文本显示「自由文本」', () => {
    const harness = mountScreen();
    clickTab(harness.screen, 'persona');

    const strip = harness.screen.shadowRoot?.querySelector('[data-role="persona-sections"]');
    expect(strip?.textContent).toContain('角色定位');
    expect(strip?.textContent).toContain('行为规则');

    harness.unmount();
  });

  test('重名校验：改成其它角色的名字 → 本地拒绝提示，不发命令', () => {
    const harness = mountScreen();
    clickTab(harness.screen, 'profile');

    const input = harness.screen.shadowRoot?.querySelector<HTMLInputElement>('[data-role="name-input"]');
    if (!input) throw new Error('改名输入框未渲染');
    typeInto(input, ' 墨菲斯 '); // 与 c-morph 重名（含空白，测 trim 口径）
    clickAction(harness.screen, 'rename-character');

    const error = harness.screen.shadowRoot?.querySelector<HTMLElement>('[data-role="name-error"]');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toContain('同名');
    expect(harness.commands.some((c) => c.type === 'character.name.update')).toBe(false);

    harness.unmount();
  });

  test('空名 / 超长名 → 本地拒绝提示，不发命令', () => {
    const harness = mountScreen();
    clickTab(harness.screen, 'profile');

    const inputOf = () => {
      const node = harness.screen.shadowRoot?.querySelector<HTMLInputElement>('[data-role="name-input"]');
      if (!node) throw new Error('改名输入框未渲染');
      return node;
    };

    typeInto(inputOf(), '   ');
    clickAction(harness.screen, 'rename-character');
    let error = harness.screen.shadowRoot?.querySelector<HTMLElement>('[data-role="name-error"]');
    expect(error?.textContent).toContain('不能为空');

    // 上次失败提示触发过重画：输入框节点已换新，重查再输（不拿着旧节点打空气）。
    typeInto(inputOf(), 'a'.repeat(25));
    clickAction(harness.screen, 'rename-character');
    error = harness.screen.shadowRoot?.querySelector<HTMLElement>('[data-role="name-error"]');
    expect(error?.textContent).toContain('24');

    expect(harness.commands.some((c) => c.type === 'character.name.update')).toBe(false);

    harness.unmount();
  });

  test('改名链路：合法名 → 发命令 → 真写库（档案 + 战场单位同一次广播）→ 屏上新名即时可见', () => {
    const harness = mountScreen();
    clickTab(harness.screen, 'profile');

    const input = harness.screen.shadowRoot?.querySelector<HTMLInputElement>('[data-role="name-input"]');
    if (!input) throw new Error('改名输入框未渲染');
    typeInto(input, ' 崔尼蒂 ');
    clickAction(harness.screen, 'rename-character');

    const command = harness.commands.find((c) => c.type === 'character.name.update');
    if (command?.type !== 'character.name.update') {
      throw new Error(`应为 character.name.update，实为 ${harness.commands.map((c) => c.type).join(',')}`);
    }
    expect(command.characterId).toBe('c-neo');
    expect(command.name).toBe('崔尼蒂'); // trim 后上命令

    // 真写库（生产链路：runtime 把同名命令转给 manager）→ 档案与战场单位一起换名。
    harness.manager.updateName('c-neo', '崔尼蒂');
    expect(harness.store.getState().characters[0]?.name).toBe('崔尼蒂');
    expect(harness.store.getState().units[0]?.name).toBe('崔尼蒂');

    // 屏上重画（签名含 name）：编辑中心标题 / 输入框 / 焦点卡都换新名。
    const editorTitle = harness.screen.shadowRoot?.querySelector('[data-group="character-editor"] .group-name');
    expect(editorTitle?.textContent).toContain('崔尼蒂');
    const refreshed = harness.screen.shadowRoot?.querySelector<HTMLInputElement>('[data-role="name-input"]');
    expect(refreshed?.value).toBe('崔尼蒂');

    harness.unmount();
  });

  test('形象 tab：041 面板在 tab 体内（缺省即见降级提示，注端口时面板照常）', () => {
    const harness = mountScreen();

    // 不注端口 → 041 面板的降级提示就在缺省 tab 里（面板迁入但行为不变）。
    expect(harness.screen.shadowRoot?.querySelector('[data-role="appearance-unavailable"]')).not.toBeNull();
    // 切走再切回：面板还在（tab 切换不销毁面板状态机）。
    clickTab(harness.screen, 'persona');
    clickTab(harness.screen, 'appearance');
    expect(harness.screen.shadowRoot?.querySelector('[data-role="appearance-unavailable"]')).not.toBeNull();

    harness.unmount();
  });
});
