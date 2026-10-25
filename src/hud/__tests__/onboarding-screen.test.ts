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
import { PERSONA_PRESETS } from '../screens/persona-presets';
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
// 3. 起名与皮肤（步骤②）
// ============================================================================

describe('② 起名与皮肤', () => {
  test('下一步 → 只为可建档的已装 agent 生成起名条目（默认名 = agent 显示名）', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX, GEMINI, TIMEOUT]));
    click(h.screen, '[data-action="next"]');

    expect(h.screen.step).toBe('identity');
    const identities = all(h.screen, '[data-role="identity"]');
    expect(identities).toHaveLength(2);
    expect(identities.map((node) => node.getAttribute('data-kind'))).toEqual(['claude-code', 'codex']);
    expect(identities[0]?.querySelector('[data-role="name-input"]')?.getAttribute('value')).toBe('Claude Code');
    expect(identities[0]?.querySelector('[data-role="skin-label"]')?.textContent).toBeTruthy();
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

  test('名字重复 → 拦在原地并给出提示', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    click(h.screen, '[data-action="next"]');

    type(h.screen, '[data-kind="claude-code"][data-role="name-input"]', 'Neo');
    type(h.screen, '[data-kind="codex"][data-role="name-input"]', 'Neo');
    click(h.screen, '[data-action="next"]');

    expect(h.screen.step).toBe('identity');
    expect(h.screen.errors['name:claude-code']).toBe('名字重复了，换一个');
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
  test('题目没答完 → 拦在原地并逐题提示', () => {
    const h = mountScreen(makeState([CLAUDE]));
    click(h.screen, '[data-action="next"]'); // → identity
    click(h.screen, '[data-action="next"]'); // → persona
    expect(h.screen.step).toBe('persona');

    click(h.screen, '[data-action="next"]');
    expect(h.screen.step).toBe('persona');
    expect(h.screen.errors['answer:role']).toBe('这一题还没选');
    expect(h.screen.errors['answer:delivery']).toBe('这一题还没选');
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
      // RULES 节与问卷路径同一份底线（core DEFAULT_PERSONA_TEMPLATE 派生，不另抄）
      const rulesBlock = [`# 行为规则 RULES`, '', ...personaRulesLines()].join('\n');
      expect(preset.persona.endsWith(rulesBlock)).toBe(true);
    }
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

describe('④ 确认与提交', () => {
  test('提交：逐个 character.create → 完成事件 → 回主屏', () => {
    const h = mountScreen(makeState([CLAUDE, CODEX]));
    const seen: OnboardingCompleteDetail[] = [];
    h.screen.addEventListener(ONBOARDING_COMPLETE_EVENT, (ev) => {
      seen.push((ev as CustomEvent<OnboardingCompleteDetail>).detail);
    });

    click(h.screen, '[data-action="next"]'); // → identity
    type(h.screen, '[data-kind="claude-code"][data-role="name-input"]', 'Neo');
    type(h.screen, '[data-kind="codex"][data-role="name-input"]', 'Trinity');
    click(h.screen, '[data-action="next"]'); // → persona
    choose(h.screen, 'role', 'builder');
    choose(h.screen, 'tone', 'terse');
    choose(h.screen, 'autonomy', 'balanced');
    choose(h.screen, 'delivery', 'iterative');
    click(h.screen, '[data-action="next"]'); // → confirm
    click(h.screen, '[data-action="submit"]');

    const creates = h.commands.filter((c) => c.type === 'character.create');
    expect(creates).toHaveLength(2);
    expect(creates[0]).toMatchObject({ type: 'character.create', name: 'Neo', agentKind: 'claude-code' });
    expect(creates[1]).toMatchObject({ type: 'character.create', name: 'Trinity', agentKind: 'codex' });
    // 人设随建档一起发（core 的建档口径：persona 可选，缺省套默认模板）
    expect((creates[0] as { persona?: string }).persona).toContain('# 角色定位 ROLE');

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
    choose(h.screen, 'role', 'builder');
    choose(h.screen, 'tone', 'terse');
    choose(h.screen, 'autonomy', 'balanced');
    choose(h.screen, 'delivery', 'iterative');
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
