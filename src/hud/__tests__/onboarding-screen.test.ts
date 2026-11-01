/**
 * 集成测试：首启向导屏（hud/screens/onboarding-screen.ts + onboarding-catalog.ts）。
 * 覆盖：扫描报告渲染（已装高亮 / tier 标签 / 仅探测标记）、四步流转、名字校验（空 / 超长 / 重复）、
 *   换肤、人设问卷与可编辑预览、提交命令序列与完成事件、用户数据转义、卸载退订。
 * @jest-environment jsdom
 *
 * 边界说明：本屏只与 WorldState.detectedAgents（读）与 character.create / ui.navigate（写）打交道，
 * 所以夹具是**注入的适配器**而不是真总线 —— 屏的行为与总线实现无关，测的就是屏本身。
 */

import type { CharacterAppearance, DetectedAgent, HudCommand, WorldState } from '../../core/types';
import { DETECTABLE_AGENT_KINDS } from '../../core/types';
import { createSkinRandomizer } from '../../core/theme/skin-registry';

import {
  buildPersona,
  cloneAppearance,
  createAppearanceDrafts,
  findDuplicateNames,
  missingPersonaAnswers,
  personaRulesLines,
  resolveBindableKinds,
  resolveScanRows,
  validateAgentName,
  validatePersona,
  PERSONA_QUESTIONS,
} from '../screens/onboarding-catalog';
import { personaPlanFirst, PERSONA_PLAN_FIRST_MARKER } from '../../core/character/persona';
import { PERSONA_PRESETS, presetMatchingKind, presetsForKind } from '../screens/persona-presets';
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_SCREEN_TAG,
  ONBOARDING_SKIPPED_EVENT,
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

const CLAUDE = detected({ kind: 'claude-code', tier: 'T1', installed: true, status: 'installed', version: '1.2.3', path: '/usr/bin/claude' });
const CODEX = detected({ kind: 'codex', tier: 'T1', installed: true, status: 'installed', version: '0.9.0', path: '/usr/bin/codex' });
/** openclaw：有专属预设（夜间值守）的 kind —— 测 kind 推荐与预填（task_044）。 */
const OPENCLAW = detected({ kind: 'openclaw', tier: 'T1', installed: true, status: 'installed', version: '2.1.0' });
/** T2：探到了，但还没适配 —— 不该出现在起名清单里。 */
const GEMINI = detected({ kind: 'gemini', tier: 'T2', installed: true, status: 'installed', version: '2.0.0' });
/** 探测超时且没确认安装 —— 不算"已装"。 */
const TIMEOUT = detected({ kind: 'kimi', tier: 'T1', installed: false, status: 'timeout' });

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

interface Harness {
  readonly screen: StratOnboardingScreenElement;
  readonly commands: HudCommand[];
  /** 推一份新状态（走订阅的真实调用链）。 */
  emit(state: WorldState): void;
  /** 当前订阅者数量（卸载后应为 0）。 */
  subscriberCount(): number;
  unmount(): void;
}

function mountScreen(initial?: WorldState): Harness {
  const commands: HudCommand[] = [];
  // why 用数组而不是单个 handler 变量：TS 的控制流分析会把"只在回调里赋值"的变量收窄成 null，
  // 后面再调用就变成 "never has no call signatures"。数组不参与这种收窄。
  const handlers: ((state: WorldState) => void)[] = [];
  let subscribers = 0;

  const deps: OnboardingScreenDeps = {
    dispatch: (command) => { commands.push(command); },
    subscribe: (next) => {
      subscribers += 1;
      handlers.push(next);
      return () => {
        subscribers -= 1;
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
  const unmountScreen = mountOnboardingScreen(deps, host);
  const screen = host.querySelector(ONBOARDING_SCREEN_TAG) as StratOnboardingScreenElement;
  if (!screen?.shadowRoot) throw new Error('向导屏未 upgrade（shadowRoot 为空）');
  // 皮肤抽签源固定种子 → 测试可复现。
  const randomizer = createSkinRandomizer(42);
  screen.skinSource = () => randomizer.next();

  if (initial) emit(initial);

  return {
    screen,
    commands,
    emit,
    subscriberCount: () => subscribers,
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

function click(screen: StratOnboardingScreenElement, selector: string): void {
  one(screen, selector).click();
}

/** 模拟输入：改值 + 派发 input 事件（走真实的委托链）。 */
function type(screen: StratOnboardingScreenElement, selector: string, value: string): void {
  const field = one(screen, selector) as HTMLInputElement | HTMLTextAreaElement;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function choose(screen: StratOnboardingScreenElement, questionId: string, optionId: string): void {
  const radio = screen.shadowRoot?.querySelector(
    `[data-role="option"][data-question="${questionId}"][value="${optionId}"]`
  ) as HTMLInputElement | null;
  if (!radio) throw new Error(`选项未渲染: ${questionId}/${optionId}`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 扫描步勾选 / 取消勾选一个 kind（task_044）。 */
function toggleImport(screen: StratOnboardingScreenElement, kind: string, checked: boolean): void {
  const box = one(screen, `[data-role="scan-select"][data-kind="${kind}"]`) as HTMLInputElement;
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 切换条选中某个 agent（task_044）。 */
function selectAgent(screen: StratOnboardingScreenElement, kind: string): void {
  click(screen, `[data-action="select-agent"][data-kind="${kind}"]`);
}

/** 答完四题问卷（当前 active agent）。 */
function answerAll(screen: StratOnboardingScreenElement): void {
  choose(screen, 'role', 'builder');
  choose(screen, 'tone', 'terse');
  choose(screen, 'autonomy', 'balanced');
  choose(screen, 'delivery', 'iterative');
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ============================================================================
// 1. 纯派生函数（onboarding-catalog）
// ============================================================================

describe('向导派生逻辑', () => {
  test('扫描报告：已装高亮依据 installed，tier 与结论如实透传', () => {
    const rows = resolveScanRows(makeState([CLAUDE, GEMINI, TIMEOUT]));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: 'claude-code', installed: true, tier: 'T1', status: 'installed', version: '1.2.3' });
    expect(rows[1]).toMatchObject({ kind: 'gemini', installed: true, tier: 'T2' });
    // 探测超时且没确认安装 → 不算已装
    expect(rows[2]).toMatchObject({ kind: 'kimi', installed: false, status: 'timeout' });
  });

  test('可建档名单 = 已装 ∩ AGENT_KINDS（T2 的 gemini 探到了也不进名单）', () => {
    expect(resolveBindableKinds(makeState([CLAUDE, CODEX, GEMINI, TIMEOUT]))).toEqual([
      'claude-code',
      'codex',
    ]);
  });

  test('没有广播 / 没有检测结果 → 空名单（不编数据）', () => {
    expect(resolveScanRows(null)).toEqual([]);
    expect(resolveBindableKinds(null)).toEqual([]);
    expect(resolveScanRows(makeState())).toEqual([]);
  });

  test('名字校验：空 / 超长 / 合法，且长度按码点算', () => {
    expect(validateAgentName('   ')).toMatchObject({ ok: false, code: 'empty-name' });
    expect(validateAgentName('a'.repeat(24))).toMatchObject({ ok: true });
    expect(validateAgentName('a'.repeat(25))).toMatchObject({ ok: false, code: 'name-too-long' });
    // 25 个 emoji = 25 码点（但 50 个 UTF-16 单元）→ 按码点判才是超长
    expect(validateAgentName('😀'.repeat(25))).toMatchObject({ ok: false, code: 'name-too-long' });
    expect(validateAgentName('😀'.repeat(24))).toMatchObject({ ok: true });
  });

  test('重复名字：只报一次重复项', () => {
    expect(findDuplicateNames(['Neo', ' Neo ', 'Trinity'])).toEqual(['Neo']);
    expect(findDuplicateNames(['Neo', 'Trinity'])).toEqual([]);
  });

  test('人设拼装：结构化分节（没答的题整节省略；规则节恒在，core 底线列表化）【task_043 改断言：分节结构替代旧 fragment 前缀串】', () => {
    const persona = buildPersona({ role: 'builder' });
    expect(persona).toContain('# 角色定位 ROLE');
    expect(persona).toContain('编码主力 —— 把需求落成可运行的代码');
    // role 题同时供给使命节
    expect(persona).toContain('# 使命 MISSION');
    expect(persona).toContain('交付可运行、可验证、可维护的代码');
    // 没答的题 → 整节省略
    expect(persona).not.toContain('# 沟通风格 STYLE');
    expect(persona).not.toContain('# 自主程度 AUTONOMY');
    expect(persona).not.toContain('# 交付习惯 DELIVERY');
    // 规则节恒在末尾，core 默认模板四条底线 → 列表行（语义保留，只换排版）
    expect(persona).toContain('# 行为规则 RULES');
    expect(persona).toContain('- 你是一名在 Stratix 工作台里干活的本地 coding agent');
    expect(persona.indexOf('# 行为规则 RULES')).toBeGreaterThan(persona.indexOf('# 角色定位 ROLE'));
    // 一题都没答 → 只剩底线形态
    expect(buildPersona({})).toBe(`# 行为规则 RULES\n\n${personaRulesLines().join('\n')}`);
    expect(missingPersonaAnswers({ role: 'builder' })).toEqual(['tone', 'autonomy', 'delivery']);
    expect(missingPersonaAnswers({})).toHaveLength(PERSONA_QUESTIONS.length);
  });

  test('人设拼装：答全四题 → 六节齐备且分节头格式统一（`# 中文 ENGLISH`）', () => {
    const persona = buildPersona({ role: 'reviewer', tone: 'structured', autonomy: 'balanced', delivery: 'iterative' });
    const headers = persona.split('\n').filter((line) => line.startsWith('# '));
    expect(headers).toEqual([
      '# 角色定位 ROLE',
      '# 使命 MISSION',
      '# 沟通风格 STYLE',
      '# 自主程度 AUTONOMY',
      '# 交付习惯 DELIVERY',
      '# 行为规则 RULES',
    ]);
    // 节间空行：分节头前必是空行（首个除外）
    const lines = persona.split('\n');
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].startsWith('# ')) expect(lines[i - 1]).toBe('');
    }
  });

  test('人设长度校验：超长被拒，空串不算错（core 会套默认模板）', () => {
    expect(validatePersona('')).toMatchObject({ ok: true });
    expect(validatePersona('x'.repeat(32_001))).toMatchObject({ ok: false, code: 'persona-too-long' });
  });
});

// ============================================================================
// 1b. 形象草稿的纯逻辑（@since v3.12，task_032：每 agent 独立形象）
// ============================================================================

describe('向导派生逻辑 · 形象草稿', () => {
  const PRESET: CharacterAppearance = {
    bodyType: 'male',
    parts: {
      body: { variant: 'light', itemId: 'heads_human_male' },
      hair: { variant: 'chestnut', itemId: 'hair_parted' },
      // 旧格式（纯变体串）也要能拷 —— 存档里已有这种形态
      torso: 'orange',
    },
  };

  test('cloneAppearance：深拷贝（顶层与部件值都不是同一份引用），两种部件形态都保留', () => {
    const copy = cloneAppearance(PRESET);
    expect(copy).toEqual(PRESET);
    expect(copy).not.toBe(PRESET);
    expect(copy.parts.body).not.toBe(PRESET.parts.body);
    // 旧格式字符串原样保留
    expect(copy.parts.torso).toBe('orange');
    // 精确格式带 itemId
    expect(copy.parts.hair).toMatchObject({ variant: 'chestnut', itemId: 'hair_parted' });
  });

  test('createAppearanceDrafts：预设命中 → 每个 kind 一份独立深拷贝；预设返 null → 不进表（兑底）', () => {
    const presets: Record<string, CharacterAppearance> = {
      'claude-code': PRESET,
      codex: { bodyType: 'male', parts: { hair: { variant: 'ash', itemId: 'hair_buzzcut' } } },
    };
    // 词表外的 kind（预设源返 null，模拟"素材未就绪"）→ 不进表
    const drafts = createAppearanceDrafts(
      ['claude-code', 'codex', 'kimi'],
      (kind) => presets[kind] ?? null
    );

    expect(drafts.size).toBe(2);
    expect(drafts.get('claude-code')).toEqual(PRESET);
    expect(drafts.get('claude-code')).not.toBe(PRESET); // 独立深拷贝
    expect(drafts.get('codex')?.parts.hair).toMatchObject({ variant: 'ash', itemId: 'hair_buzzcut' });
    expect(drafts.has('kimi')).toBe(false); // 兑底：取不到不编造

    // 两个 kind 命中同一份预设 → 各自独立（改一个不影响另一个）
    const shared = createAppearanceDrafts(
      ['claude-code', 'kimi'],
      () => PRESET
    );
    expect(shared.get('claude-code')).toEqual(shared.get('kimi'));
    expect(shared.get('claude-code')).not.toBe(shared.get('kimi'));
  });
});

// ============================================================================
// 2. 扫描报告（步骤①）
// ============================================================================

describe('① 扫描报告', () => {
  test('挂载即在扫描步；已装行高亮 + tier 标签 + 仅探测标记', () => {
    const h = mountScreen(makeState([CLAUDE, GEMINI, TIMEOUT]));
    expect(h.screen.step).toBe('scan');

    const rows = all(h.screen, '[data-role="scan-row"]');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.getAttribute('data-installed')).toBe('true');
    expect(rows[0]?.querySelector('[data-role="tier"]')?.textContent).toBe('T1 深度适配');
    expect(rows[1]?.querySelector('[data-role="tier"]')?.textContent).toBe('T2 基础适配');
    // T2 不是可建档种类 → 标「仅探测」
    expect(rows[1]?.querySelector('[data-role="only-probe"]')?.textContent).toBe('仅探测');
    expect(rows[2]?.getAttribute('data-installed')).toBe('false');
    h.unmount();
  });

  test('core 广播新状态 → 扫描报告跟着更新', () => {
    const h = mountScreen(makeState([TIMEOUT]));
    expect(all(h.screen, '[data-role="scan-row"]')).toHaveLength(1);

    h.emit(makeState([CLAUDE, CODEX]));
    const rows = all(h.screen, '[data-role="scan-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-kind')).toBe('claude-code');
    h.unmount();
  });

  test('没有任何检测结果 → 空态说明，不编数据', () => {
    const h = mountScreen(makeState([]));
    expect(one(h.screen, '[data-role="scan-empty"]').textContent).toContain('还没探测到本机 agent');
    h.unmount();
  });

  test('扫描进度如实显示：没跑完说"扫描中"，名单跑满说"扫描完成"', () => {
    // @since v3.9（task_026）：检测是逐条推送的，半张名单不能说成"扫完了"。
    const h = mountScreen(makeState([CLAUDE]));
    const status = () => one(h.screen, '[data-role="scan-status"]');
    expect(status().textContent).toContain('扫描中');
    expect(status().getAttribute('data-complete')).toBe('false');
    // 扫描没完时提醒用户：现在继续只会给已探到的 agent 建档。
    expect(one(h.screen, '[data-role="scan-pending"]').textContent).toContain('扫描还没结束');

    const full = DETECTABLE_AGENT_KINDS.map((kind) => detected({ kind, installed: false }));
    h.emit(makeState(full));
    expect(status().textContent).toContain('扫描完成');
    expect(status().getAttribute('data-complete')).toBe('true');
    expect(h.screen.shadowRoot?.querySelector('[data-role="scan-pending"]')).toBeNull();
    h.unmount();
  });
});

// ============================================================================
// 1c. 扫描步 · 勾选导入（@since v3.14，task_044：向导逐个配置化）
// ============================================================================

describe('① 扫描 · 勾选导入（task_044）', () => {
  test('可导入行（已装 ∩ 可建档）带勾选框且默认全选；仅探测 / 未确认安装的行没有勾选框', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX, GEMINI, TIMEOUT]));
    const boxes = all(h.screen, '[data-role="scan-select"]');
    expect(boxes).toHaveLength(2); // gemini（T2）与 kimi（未确认）没有可勾的东西
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(boxes.map((box) => box.getAttribute('data-kind'))).toEqual(['claude-code', 'codex']);
    expect(one(h.screen, '[data-role="scan-selected-summary"]').textContent).toContain('勾选导入 2 / 2');
    h.unmount();
  });

  test('取消勾选的 agent 不进后续步骤、不建档；摘要实时更新', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    toggleImport(h.screen, 'codex', false);
    expect(one(h.screen, '[data-role="scan-selected-summary"]').textContent).toContain('勾选导入 1 / 2');
    expect(h.screen.selectedKinds).toEqual(['claude-code']);

    click(h.screen, '[data-action="next"]'); // → identity
    expect(h.screen.identities.map((item) => item.kind)).toEqual(['claude-code']);
    // 切换条也只有 claude
    expect(all(h.screen, '[data-role="agent-tab"]')).toHaveLength(1);

    click(h.screen, '[data-action="next"]'); // → persona
    answerAll(h.screen);
    click(h.screen, '[data-action="next"]'); // → confirm
    expect(all(h.screen, '[data-role="summary-row"]')).toHaveLength(1); // 确认页只列勾选的
    click(h.screen, '[data-action="submit"]');

    const creates = h.commands.filter((c) => c.type === 'character.create');
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ agentKind: 'claude-code' });
    h.unmount();
  });

  test('一个都不勾（有可导入项时）→ 拦在扫描步给提示；重新勾选后可继续', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    toggleImport(h.screen, 'claude-code', false);
    toggleImport(h.screen, 'codex', false);

    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('scan');
    expect(h.screen.errors['scan-selection']).toContain('至少勾选一个');
    expect(one(h.screen, '[data-role="scan-selection-error"]').textContent).toContain('至少勾选一个');

    // 重新勾上 → 能继续，提示撤掉
    toggleImport(h.screen, 'claude-code', true);
    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('identity');
    expect(h.screen.errors['scan-selection']).toBeUndefined();
    h.unmount();
  });

  test('扫描中途新探到的可导入 kind 默认勾上；用户明确取消过的保持取消', () => {
    const h = mountScreen(makeState([CLAUDE]));
    toggleImport(h.screen, 'claude-code', false); // 用户明确不装 claude

    h.emit(makeState([CLAUDE, CODEX])); // 扫描推进：新探到 codex
    const boxes = all(h.screen, '[data-role="scan-select"]');
    expect(boxes).toHaveLength(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(false); // claude 保持取消
    expect((boxes[1] as HTMLInputElement).checked).toBe(true); // 新探到的默认勾选
    expect(h.screen.selectedKinds).toEqual(['codex']);

    click(h.screen, '[data-action="next"]');
    expect(h.screen.identities.map((item) => item.kind)).toEqual(['codex']);
    h.unmount();
  });
});

// ============================================================================
// 3. 起名与皮肤（步骤②）
// ============================================================================

describe('② 起名与皮肤', () => {
  test('下一步 → 只为可建档的已装 agent 生成起名条目（默认名 = agent 显示名）【task_044 改断言：逐个配置后屏上只渲染当前 agent 的单卡，其余经 identities / 切换条体现】', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX, GEMINI, TIMEOUT]));
    click(h.screen, '[data-action="next"]');

    expect(h.screen.step).toBe('identity');
    // 清单 = 已装 ∩ 可建档（T2 / 未确认安装的不进）
    expect(h.screen.identities.map((item) => item.kind)).toEqual(['claude-code', 'codex']);
    // 屏上只渲染当前 agent 的单卡（默认第一个）；切换条把两个都列出来
    const cards = all(h.screen, '[data-role="identity"]');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute('data-kind')).toBe('claude-code');
    expect((cards[0]?.querySelector('[data-role="name-input"]') as HTMLInputElement).value).toBe('Claude Code');
    expect(cards[0]?.querySelector('[data-role="skin-label"]')?.textContent).toBeTruthy();
    const tabs = all(h.screen, '[data-role="agent-tab"]');
    expect(tabs.map((tab) => tab.getAttribute('data-kind'))).toEqual(['claude-code', 'codex']);
    expect(tabs[0]?.getAttribute('data-active')).toBe('true');
    h.unmount();
  });

  test('名字留空 → 拦在原地并给出提示', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');

    type(h.screen, '[data-role="name-input"]', '   ');
    click(h.screen, '[data-action="next"]');

    expect(h.screen.step).toBe('identity');
    expect(one(h.screen, '[data-role="name-error"]').textContent).toBe('名字不能为空');
    expect(h.screen.errors['name:claude-code']).toBe('名字不能为空');
    h.unmount();
  });

  test('名字超长 → 拦在原地并给出提示', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');

    type(h.screen, '[data-role="name-input"]', 'x'.repeat(25));
    click(h.screen, '[data-action="next"]');

    expect(h.screen.step).toBe('identity');
    expect(one(h.screen, '[data-role="name-error"]').textContent).toContain('不能超过');
    h.unmount();
  });

  test('名字重复 → 拦在原地并给出提示【task_044 改断言：先切换到另一个 agent 再输入名字（逐个配置）】', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    click(h.screen, '[data-action="next"]');

    type(h.screen, '[data-kind="claude-code"][data-role="name-input"]', 'Neo');
    selectAgent(h.screen, 'codex');
    type(h.screen, '[data-kind="codex"][data-role="name-input"]', 'Neo');
    click(h.screen, '[data-action="next"]');

    expect(h.screen.step).toBe('identity');
    expect(h.screen.errors['name:claude-code']).toBe('名字重复了，换一个');
    expect(h.screen.errors['name:codex']).toBe('名字重复了，换一个');
    h.unmount();
  });

  test('改完名字后错误提示自动撤掉', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');
    type(h.screen, '[data-role="name-input"]', '');
    click(h.screen, '[data-action="next"]');
    expect(h.screen.errors['name:claude-code']).toBeTruthy();

    type(h.screen, '[data-role="name-input"]', 'Neo');
    expect(h.screen.errors['name:claude-code']).toBeUndefined();
    h.unmount();
  });

  test('换肤 → 皮肤 id 变化（抽签源可注入 → 结果可复现）', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');
    const before = h.screen.identities[0]?.skinId;

    click(h.screen, '[data-action="reroll"]');
    expect(h.screen.identities[0]?.skinId).not.toBe(before);
    h.unmount();
  });

  test('用户输入的名字按文本渲染，不产生 DOM 注入', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');
    type(h.screen, '[data-role="name-input"]', '<img src=x onerror=1>');
    // 换肤会整块重画身份区 —— 名字此时是走 escapeHtml 拼进 HTML 的
    click(h.screen, '[data-action="reroll"]');

    const input = one(h.screen, '[data-role="name-input"]');
    expect(input.querySelector('img')).toBeNull();
    expect(input.getAttribute('value')).toBe('<img src=x onerror=1>');
    // 名字进了属性值：转义后不可能生成元素节点
    expect(h.screen.shadowRoot?.querySelector('img')).toBeNull();
    expect(h.screen.identities[0]?.name).toBe('<img src=x onerror=1>');
    h.unmount();
  });
});

// ============================================================================
// 4. 人设生成（步骤③）
// ============================================================================

describe('③ 人设生成', () => {
  test('题目没答完 → 拦在原地并逐题提示【task_044 改断言：错误键带上 agent kind（per-agent 问卷）】', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]'); // → identity
    click(h.screen, '[data-action="next"]'); // → persona
    expect(h.screen.step).toBe('persona');

    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('persona');
    expect(h.screen.errors['answer:claude-code:role']).toBe('这一题还没选');
    expect(h.screen.errors['answer:claude-code:delivery']).toBe('这一题还没选');
    h.unmount();
  });

  test('答完题 → 人设预览里出现对应 fragment，并进入确认步', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');
    click(h.screen, '[data-action="next"]');

    choose(h.screen, 'role', 'builder');
    choose(h.screen, 'tone', 'terse');
    choose(h.screen, 'autonomy', 'balanced');
    choose(h.screen, 'delivery', 'iterative');

    const preview = one(h.screen, '[data-role="persona-input"]') as HTMLTextAreaElement;
    expect(preview.value).toContain('# 角色定位 ROLE');
    expect(preview.value).toContain('编码主力');
    expect(preview.value).toContain('# 沟通风格 STYLE');

    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('confirm');
    expect(all(h.screen, '[data-role="summary-row"]')).toHaveLength(1);
    h.unmount();
  });

  test('手动改过的人设不被后续答题覆盖（用户编辑优先）', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');
    click(h.screen, '[data-action="next"]');

    type(h.screen, '[data-role="persona-input"]', '我的人设');
    choose(h.screen, 'role', 'builder');

    expect(h.screen.persona).toBe('我的人设');
    expect((one(h.screen, '[data-role="persona-input"]') as HTMLTextAreaElement).value).toBe('我的人设');
    h.unmount();
  });
});

// ============================================================================
// 4b. 预设库与脏保护（@since v3.13，task_043：人设生成 2.0）
// ============================================================================

describe('③ 人设生成 · 预设库（纯数据）', () => {
  test('预设 6-8 个，id 唯一，每个带说明与 kind 标注', () => {
    expect(PERSONA_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(PERSONA_PRESETS.length).toBeLessThanOrEqual(8);
    expect(new Set(PERSONA_PRESETS.map((preset) => preset.id)).size).toBe(PERSONA_PRESETS.length);
    for (const preset of PERSONA_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(preset.suitableKinds === 'any' || preset.suitableKinds.length > 0).toBe(true);
    }
  });

  test('plan-first 预设（task_049）：存在、带识别标记，且是唯一走审批门的预设', () => {
    const planFirst = PERSONA_PRESETS.find((preset) => preset.id === 'plan-first');
    expect(planFirst).toBeTruthy();
    // 预设路径的识别标记：persona 正文含 PERSONA_PLAN_FIRST_MARKER（两路识别共用一个词）
    expect(personaPlanFirst(planFirst!.persona)).toBe(true);
    expect(planFirst!.persona).toContain(PERSONA_PLAN_FIRST_MARKER);
    // 其余预设都不带 —— 没声明「先计划后执行」的不走门
    for (const preset of PERSONA_PRESETS) {
      if (preset.id === 'plan-first') continue;
      expect(personaPlanFirst(preset.persona)).toBe(false);
    }
  });

  test('每个预设都是完整结构化文本：六节齐备 + core 底线规则列表', () => {
    for (const preset of PERSONA_PRESETS) {
      const headers = preset.persona.split('\n').filter((line) => line.startsWith('# '));
      expect(headers).toEqual([
        '# 角色定位 ROLE',
        '# 使命 MISSION',
        '# 沟通风格 STYLE',
        '# 自主程度 AUTONOMY',
        '# 交付习惯 DELIVERY',
        '# 行为规则 RULES',
      ]);
      // RULES 节与问卷路径同一份底线（core DEFAULT_PERSONA_TEMPLATE 派生，不另抄）；
      // plan-first（task_049）是唯一例外：底线之后追加一行审批门标记
      //（「先出计划，经批准后再执行」—— personaPlanFirst 的识别词），底线一条不少。
      const rulesBlock = [`# 行为规则 RULES`, '', ...personaRulesLines()].join('\n');
      if (preset.id === 'plan-first') {
        expect(preset.persona.endsWith(`${rulesBlock}\n先出计划，经批准后再执行；计划未获批准不动手`)).toBe(true);
      } else {
        expect(preset.persona.endsWith(rulesBlock)).toBe(true);
      }
    }
  });

  test('per-agent 匹配：只有点名 kind 的预设算专属（openclaw → 夜间值守；claude-code → 无）；presetsForKind 推荐排前且不砍选择面【task_044】', () => {
    // 专属命中：openclaw 点名适配夜间值守
    expect(presetMatchingKind('openclaw')?.id).toBe('night-watch');
    // 没被点名的 kind：无专属预设（'any' 通用预设不算「该 agent 的默认」）
    expect(presetMatchingKind('claude-code')).toBeNull();
    expect(presetMatchingKind('codex')).toBeNull();

    // openclaw 的卡片序：夜间值守排首且带推荐标记；其余 any 预设照常列出（一个不少）
    const openclawEntries = presetsForKind('openclaw');
    expect(openclawEntries[0]?.preset.id).toBe('night-watch');
    expect(openclawEntries[0]?.recommended).toBe(true);
    expect(openclawEntries.slice(1).every((entry) => entry.recommended)).toBe(false);
    expect(openclawEntries).toHaveLength(PERSONA_PRESETS.length);

    // claude-code：无推荐，保持库内原序
    const claudeEntries = presetsForKind('claude-code');
    expect(claudeEntries.every((entry) => entry.recommended)).toBe(false);
    expect(claudeEntries.map((entry) => entry.preset.id)).toEqual(PERSONA_PRESETS.map((preset) => preset.id));
  });
});

describe('③ 人设生成 · 预设与脏保护（UI）', () => {
  function toPersonaStep(): Harness {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]'); // → identity
    click(h.screen, '[data-action="next"]'); // → persona
    return h;
  }

  test('预设卡片行渲染：名称 + 说明 + kind 徽标（any → 通用）', () => {
    const h = toPersonaStep();
    const cards = all(h.screen, '[data-role="preset-card"]');
    expect(cards).toHaveLength(PERSONA_PRESETS.length);
    const first = cards[0] as HTMLElement;
    expect(first.querySelector('.preset-name')?.textContent).toBeTruthy();
    expect(first.querySelector('.preset-desc')?.textContent).toBeTruthy();
    // 默认无选中
    expect(cards.every((card) => card.getAttribute('data-selected') === 'false')).toBe(true);
    h.unmount();
  });

  test('点预设 → 问卷清空 + 预览填预设全文 + 标记已用预设；可直接下一步（免答问卷）', () => {
    const h = toPersonaStep();
    choose(h.screen, 'role', 'builder');
    click(h.screen, '[data-preset="architect"]');

    const preset = PERSONA_PRESETS.find((candidate) => candidate.id === 'architect');
    expect(h.screen.personaPresetId).toBe('architect');
    expect(h.screen.persona).toBe(preset?.persona);
    expect((one(h.screen, '[data-role="persona-input"]') as HTMLTextAreaElement).value).toBe(preset?.persona);
    // 问卷被清空：radio 不再选中
    const checked = all(h.screen, '[data-role="option"]').filter(
      (node) => (node as HTMLInputElement).checked
    );
    expect(checked).toHaveLength(0);
    // 标记已用预设
    const badge = one(h.screen, '[data-role="persona-preset-badge"]');
    expect(badge.hasAttribute('hidden')).toBe(false);
    expect(badge.textContent).toContain('已用预设：资深架构师');
    // 卡片选中态
    expect(one(h.screen, '[data-preset="architect"]').getAttribute('data-selected')).toBe('true');

    // 预设路径免答问卷：直接下一步 → 确认页展示预设全文
    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('confirm');
    expect(one(h.screen, '[data-role="persona-preview"]').textContent).toContain('# 角色定位 ROLE');
    h.unmount();
  });

  test('预设态答题 → 切回问卷模式：预设标记撒掉，预览换成问卷结果', () => {
    const h = toPersonaStep();
    click(h.screen, '[data-preset="architect"]');
    expect(h.screen.personaPresetId).toBe('architect');

    choose(h.screen, 'role', 'builder');
    expect(h.screen.personaPresetId).toBeNull();
    // 徽标隐藏、卡片不再选中
    expect(one(h.screen, '[data-role="persona-preset-badge"]').hasAttribute('hidden')).toBe(true);
    expect(one(h.screen, '[data-preset="architect"]').getAttribute('data-selected')).toBe('false');
    // 预览 = 问卷生成结果（此时只答了一题：只有 ROLE/MISSION/RULES）
    const value = (one(h.screen, '[data-role="persona-input"]') as HTMLTextAreaElement).value;
    expect(value).toContain('# 角色定位 ROLE');
    expect(value).not.toContain('# 沟通风格 STYLE');
    expect(value).toContain('# 行为规则 RULES');
    h.unmount();
  });

  test('脏保护：手改后答题不覆盖预览；「按问卷重新生成」显式覆写并清脏', () => {
    const h = toPersonaStep();
    type(h.screen, '[data-role="persona-input"]', '我手改的人设');
    expect(h.screen.personaDirty).toBe(true);
    // 手改 → 重新生成按钮出现
    expect(one(h.screen, '[data-role="regenerate-persona"]').hasAttribute('hidden')).toBe(false);

    choose(h.screen, 'role', 'builder');
    choose(h.screen, 'tone', 'terse');
    // 脏：答题不覆盖
    expect(h.screen.persona).toBe('我手改的人设');

    // 显式重新生成：按当前答卷重写 + 清脏 + 按钮隐藏
    click(h.screen, '[data-action="regenerate-persona"]');
    expect(h.screen.personaDirty).toBe(false);
    expect(one(h.screen, '[data-role="regenerate-persona"]').hasAttribute('hidden')).toBe(true);
    const value = (one(h.screen, '[data-role="persona-input"]') as HTMLTextAreaElement).value;
    expect(value).toContain('# 角色定位 ROLE');
    expect(value).toContain('# 沟通风格 STYLE');
    expect(value).not.toContain('我手改的人设');
    h.unmount();
  });

  test('预设选中视为显式覆写：手改文本被预设替换（清脏）', () => {
    const h = toPersonaStep();
    type(h.screen, '[data-role="persona-input"]', '我手改的人设');
    choose(h.screen, 'role', 'builder');
    expect(h.screen.persona).toBe('我手改的人设');

    click(h.screen, '[data-preset="mentor"]');
    expect(h.screen.personaDirty).toBe(false);
    expect(h.screen.persona).toContain('# 角色定位 ROLE');
    expect(h.screen.persona).toContain('教学陪伴');
    h.unmount();
  });

  test('预设态手改 → 徽标标注已手动修改；答题仍不覆盖（脏优先）', () => {
    const h = toPersonaStep();
    click(h.screen, '[data-preset="architect"]');
    type(h.screen, '[data-role="persona-input"]', '预设 + 我的补充');
    expect(h.screen.personaDirty).toBe(true);
    expect(h.screen.personaPresetId).toBe('architect');
    const badge = one(h.screen, '[data-role="persona-preset-badge"]');
    expect(badge.textContent).toContain('已手动修改');

    // 脏：答题只记答案不覆盖预览，但仍退出预设模式（徽标隐藏）
    choose(h.screen, 'role', 'builder');
    expect(h.screen.persona).toBe('预设 + 我的补充');
    expect(h.screen.personaPresetId).toBeNull();
    expect(badge.hasAttribute('hidden')).toBe(true);
    h.unmount();
  });
});

// ============================================================================
// 5. 确认 → 建档 → 完成（步骤④）
// ============================================================================

// ============================================================================
// 3b. 逐个配置：agent 切换条 + per-agent 人设（@since v3.14，task_044）
// ============================================================================

describe('② 逐个配置 · agent 切换条（task_044）', () => {
  test('identity 步只渲染当前 agent 的单卡；切换条切换后名字独立，改名实时上切换条标题', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    click(h.screen, '[data-action="next"]');

    expect(all(h.screen, '[data-role="identity"]')).toHaveLength(1);
    type(h.screen, '[data-kind="claude-code"][data-role="name-input"]', 'Neo');
    // 改名实时上切换条（轻量刷新，不重画保焦点）
    expect(one(h.screen, '[data-role="agent-tab"][data-kind="claude-code"] [data-role="agent-title"]').textContent)
      .toContain('Neo');

    selectAgent(h.screen, 'codex');
    expect(one(h.screen, '[data-role="identity"]').getAttribute('data-kind')).toBe('codex');
    expect((one(h.screen, '[data-role="name-input"]') as HTMLInputElement).value).toBe('Codex');

    // 切回 claude：名字没丢
    selectAgent(h.screen, 'claude-code');
    expect((one(h.screen, '[data-role="name-input"]') as HTMLInputElement).value).toBe('Neo');
    h.unmount();
  });

  test('「已配置」状态：identity 步名字合法即✓；另一个卡片名字出错时点下一步自动切过去', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    click(h.screen, '[data-action="next"]');

    const claudeTab = () => one(h.screen, '[data-role="agent-tab"][data-kind="claude-code"]');
    const codexTab = () => one(h.screen, '[data-role="agent-tab"][data-kind="codex"]');
    expect(claudeTab().getAttribute('data-done')).toBe('true'); // 默认名合法

    selectAgent(h.screen, 'codex');
    type(h.screen, '[data-kind="codex"][data-role="name-input"]', '   '); // 留空 → 未配置
    expect(codexTab().getAttribute('data-done')).toBe('false');

    selectAgent(h.screen, 'claude-code');
    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('identity'); // 被拦
    // 出错的是 codex 而屏上看的是 claude → 自动切到 codex，错误直接可见
    expect(codexTab().getAttribute('data-active')).toBe('true');
    expect(one(h.screen, '[data-role="name-error"]').textContent).toContain('名字不能为空');
    h.unmount();
  });
});

describe('③ 逐个配置 · per-agent 人设（task_044）', () => {
  test('问卷独立：A 的答案不影响 B；切换条状态跟着变；预设也独立', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    click(h.screen, '[data-action="next"]');
    click(h.screen, '[data-action="next"]'); // → persona（active = claude-code）
    expect(h.screen.step).toBe('persona');

    const claudeTab = () => one(h.screen, '[data-role="agent-tab"][data-kind="claude-code"]');
    const codexTab = () => one(h.screen, '[data-role="agent-tab"][data-kind="codex"]');
    expect(claudeTab().getAttribute('data-done')).toBe('false'); // 初始未配置

    answerAll(h.screen); // claude 的问卷
    expect(claudeTab().getAttribute('data-done')).toBe('true'); // 答完即✓
    expect(codexTab().getAttribute('data-done')).toBe('false');

    // 切到 codex：空问卷 + 空人设 + 提示；claude 的答卷不受影响
    selectAgent(h.screen, 'codex');
    expect(h.screen.personaOf('codex')).toBe('');
    expect(one(h.screen, '[data-role="persona-hint"]').textContent).toContain('答下面的问卷');
    expect(h.screen.personaOf('claude-code')).toContain('编码主力'); // claude 的还在

    click(h.screen, '[data-preset="mentor"]'); // codex 走预设
    expect(h.screen.personaOf('codex')).toContain('教学陪伴');
    expect(codexTab().getAttribute('data-done')).toBe('true');
    // claude 的人设没被 codex 的预设写穿
    expect(h.screen.personaOf('claude-code')).not.toContain('教学陪伴');

    // 两人都配置好 → 直接进确认
    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('confirm');
    h.unmount();
  });

  test('脏保护 per-agent：手改 A 不影响 B 的自动生成（答题继续实时刷新 B）', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    click(h.screen, '[data-action="next"]');
    click(h.screen, '[data-action="next"]'); // → persona（active = claude-code）

    type(h.screen, '[data-role="persona-input"]', '我手改的 claude 人设'); // claude 脏了
    selectAgent(h.screen, 'codex');
    choose(h.screen, 'role', 'builder');
    // codex 没手改 → 预览实时拼装（不受 claude 的脏影响）
    expect(h.screen.personaOf('codex')).toContain('编码主力');

    // 切回 claude：手改文本还在
    selectAgent(h.screen, 'claude-code');
    expect(h.screen.persona).toBe('我手改的 claude 人设');
    expect(h.screen.personaDirty).toBe(true);
    // codex 没被标记脏
    h.unmount();
  });

  test('校验失败自动切到未配置的 agent（错误直接可见）', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    click(h.screen, '[data-action="next"]');
    click(h.screen, '[data-action="next"]'); // → persona（active = claude-code）

    answerAll(h.screen); // 只配了 claude，codex 没碰
    click(h.screen, '[data-action="next"]');

    expect(h.screen.step).toBe('persona'); // 被拦
    // 自动切到 codex（第一个未配置的），错误直接可见
    expect(one(h.screen, '[data-role="agent-tab"][data-kind="codex"]').getAttribute('data-active')).toBe('true');
    expect(h.screen.errors['answer:codex:role']).toBe('这一题还没选');
    expect(one(h.screen, '[data-role="question"][data-question="role"] [data-role="answer-error"]').textContent)
      .toContain('这一题还没选');
    h.unmount();
  });

  test('kind 推荐预设：openclaw 初始预填夜间值守，卡片排首 + 「推荐」角标，免问卷直接下一步', () => {
    const h = mountScreen(makeState([OPENCLAW]));
    click(h.screen, '[data-action="next"]');
    click(h.screen, '[data-action="next"]'); // → persona

    // 初始即预填（专属预设）：免答问卷，切换条直接✓
    expect(h.screen.personaPresetId).toBe('night-watch');
    expect(h.screen.persona).toContain('夜间值守');
    expect(one(h.screen, '[data-role="agent-tab"][data-kind="openclaw"]').getAttribute('data-done')).toBe('true');

    // 卡片序：夜间值守排首 + 推荐角标；any 预设照常在列
    const cards = all(h.screen, '[data-role="preset-card"]');
    expect(cards).toHaveLength(PERSONA_PRESETS.length);
    expect(cards[0]?.getAttribute('data-preset')).toBe('night-watch');
    expect(cards[0]?.querySelector('[data-role="preset-recommend"]')?.textContent).toContain('推荐');
    expect(cards[1]?.querySelector('[data-role="preset-recommend"]')).toBeNull();

    // 预设路径免问卷：直接下一步 → 确认
    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('confirm');
    h.unmount();
  });

  test('无专属预设的 kind（如 claude-code）：初始人设留空 + 提示文案（不预填 any 预设）', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');
    click(h.screen, '[data-action="next"]'); // → persona

    expect(h.screen.persona).toBe('');
    expect(h.screen.personaPresetId).toBeNull();
    expect(one(h.screen, '[data-role="persona-hint"]').textContent).toContain('答下面的问卷');
    // 初始未配置（要答问卷或选预设）
    expect(one(h.screen, '[data-role="agent-tab"][data-kind="claude-code"]').getAttribute('data-done')).toBe('false');
    h.unmount();
  });
});

describe('④ 确认 · 逐 agent 人设预览（task_044）', () => {
  test('确认页每个 agent 一段可折叠人设（分节头列表当摘要）；提交各带各的 persona', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    click(h.screen, '[data-action="next"]'); // → identity
    type(h.screen, '[data-kind="claude-code"][data-role="name-input"]', 'Neo');
    selectAgent(h.screen, 'codex');
    type(h.screen, '[data-kind="codex"][data-role="name-input"]', 'Trinity');
    click(h.screen, '[data-action="next"]'); // → persona（active = codex）
    click(h.screen, '[data-preset="mentor"]'); // codex 先配：预设
    selectAgent(h.screen, 'claude-code');
    answerAll(h.screen); // claude：问卷
    click(h.screen, '[data-action="next"]'); // → confirm

    expect(h.screen.step).toBe('confirm');
    // 每个 agent 一段可折叠人设，摘要 = 分节头列表
    const details = all(h.screen, '[data-role="persona-details"]');
    expect(details).toHaveLength(2);
    expect(details[0]?.getAttribute('data-kind')).toBe('claude-code');
    expect(one(h.screen, '[data-role="persona-summary"]').textContent).toContain('角色定位 ROLE');
    expect(one(h.screen, '[data-role="persona-summary"]').textContent).toContain('Neo');
    // 展开看全文（默认折叠，点开拿正文）
    const codexPreview = one(h.screen, '[data-role="persona-preview"][data-kind="codex"]');
    expect(codexPreview.textContent).toContain('教学陪伴');
    const claudePreview = one(h.screen, '[data-role="persona-preview"][data-kind="claude-code"]');
    expect(claudePreview.textContent).toContain('# 角色定位 ROLE');

    // 提交：各带各的 persona
    click(h.screen, '[data-action="submit"]');
    const creates = h.commands.filter((c) => c.type === 'character.create');
    expect((creates[0] as { persona?: string }).persona).toContain('编码主力');
    expect((creates[1] as { persona?: string }).persona).toContain('教学陪伴');
    h.unmount();
  });
});

describe('④ 确认与提交', () => {
  test('提交：逐个 character.create → 完成事件 → 回主屏【task_044 改断言：先切换 agent 再输入名字（逐个配置）】', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    const seen: OnboardingCompleteDetail[] = [];
    h.screen.addEventListener(ONBOARDING_COMPLETE_EVENT, (ev) => {
      seen.push((ev as CustomEvent<OnboardingCompleteDetail>).detail);
    });

    click(h.screen, '[data-action="next"]'); // → identity
    type(h.screen, '[data-kind="claude-code"][data-role="name-input"]', 'Neo');
    selectAgent(h.screen, 'codex');
    type(h.screen, '[data-kind="codex"][data-role="name-input"]', 'Trinity');
    click(h.screen, '[data-action="next"]'); // → persona（active 延续 identity 步最后选中的 codex）
    selectAgent(h.screen, 'claude-code');
    answerAll(h.screen); // claude-code 的问卷
    selectAgent(h.screen, 'codex');
    click(h.screen, '[data-preset="mentor"]'); // codex 用预设（每人各走各的路径）
    click(h.screen, '[data-action="next"]'); // → confirm
    click(h.screen, '[data-action="submit"]');

    const creates = h.commands.filter((c) => c.type === 'character.create');
    expect(creates).toHaveLength(2);
    expect(creates[0]).toMatchObject({ type: 'character.create', name: 'Neo', agentKind: 'claude-code' });
    expect(creates[1]).toMatchObject({ type: 'character.create', name: 'Trinity', agentKind: 'codex' });
    // 人设随建档一起发，且各带各的（claude = 问卷结果；codex = mentor 预设）
    expect((creates[0] as { persona?: string }).persona).toContain('# 角色定位 ROLE');
    expect((creates[1] as { persona?: string }).persona).toContain('教学陪伴');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.created.map((c) => c.name)).toEqual(['Neo', 'Trinity']);

    // 事件序列：建档命令在前，完成事件在中，导航在最后
    expect(h.commands[h.commands.length - 1]).toEqual({ type: 'ui.navigate', screen: 'main' });
    h.unmount();
  });

  test('重复提交只发一次命令（防重复建档）', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');
    click(h.screen, '[data-action="next"]');
    answerAll(h.screen);
    click(h.screen, '[data-action="next"]');

    h.screen.submit();
    h.screen.submit();

    expect(h.commands.filter((c) => c.type === 'character.create')).toHaveLength(1);
    h.unmount();
  });

  test('跳过引导 → 回主屏，不建档', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="skip"]');
    expect(h.commands).toEqual([{ type: 'ui.navigate', screen: 'main' }]);
    h.unmount();
  });

  test('跳过引导 → 派发 onboarding-skipped 事件（宿主据此收起覆盖层）', () => {
    // @since v3.9（task_026）：覆盖层由 app 层挂载，宿主需要知道"用户跳过了"。
    const h = mountScreen(makeState([CLAUDE]));
    let skipped = 0;
    h.screen.addEventListener(ONBOARDING_SKIPPED_EVENT, () => { skipped += 1; });

    click(h.screen, '[data-action="skip"]');

    expect(skipped).toBe(1);
    h.unmount();
  });

  test('人设预览按文本渲染，不产生 DOM 注入', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]'); // → identity
    click(h.screen, '[data-action="next"]'); // → persona
    type(h.screen, '[data-role="persona-input"]', '<img src=x onerror=1>');
    choose(h.screen, 'role', 'builder');
    choose(h.screen, 'tone', 'terse');
    choose(h.screen, 'autonomy', 'balanced');
    choose(h.screen, 'delivery', 'iterative');
    click(h.screen, '[data-action="next"]'); // → confirm

    const preview = one(h.screen, '[data-role="persona-preview"]');
    expect(preview.querySelector('img')).toBeNull();
    expect(preview.textContent).toContain('<img src=x onerror=1>');
    h.unmount();
  });

  test('可回退：确认 → 人设 → 起名 → 扫描', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]');
    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('persona');

    click(h.screen, '[data-action="back"]');
    expect(h.screen.step).toBe('identity');
    click(h.screen, '[data-action="back"]');
    expect(h.screen.step).toBe('scan');
    // 扫描步是第一步，不能再退
    h.screen.back();
    expect(h.screen.step).toBe('scan');
    h.unmount();
  });
});

// ============================================================================
// 6. 生命周期
// ============================================================================

describe('生命周期', () => {
  test('卸载即退订（不留监听器在全局）', () => {
    const h = mountScreen(makeState([CLAUDE]));
    expect(h.subscriberCount()).toBe(1);
    h.unmount();
    expect(h.subscriberCount()).toBe(0);
  });

  test('步骤条标出当前步', () => {
    const h = mountScreen(makeState([CLAUDE]));
    const steps = all(h.screen, '[data-role="step"]');
    expect(steps).toHaveLength(4);
    expect(steps[0]?.getAttribute('data-state')).toBe('active');

    click(h.screen, '[data-action="next"]');
    expect(all(h.screen, '[data-role="step"]')[0]?.getAttribute('data-state')).toBe('done');
    expect(all(h.screen, '[data-role="step"]')[1]?.getAttribute('data-state')).toBe('active');
    h.unmount();
  });
});
