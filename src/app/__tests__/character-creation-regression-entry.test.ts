/**
 * 回归套件：**新建角色流程 V1-V12 矩阵 · 入口与收口段**（@since v3.3，task_228 · CC-03）。
 *
 * 权威定义：docs/DESIGN-character-creation.md §4「验收矩阵 V1-V12」。
 * 本文件覆盖其中**入口与收口**四条：V1 / V2 / V3 / V11；
 * 向导内部那几条（V4-V10 / V12）见 src/hud/__tests__/character-creation-regression-wizard.test.ts。
 *
 * ============ 断言怎么"指认 V 条目" ============
 *   每条用例的标题都以 **V编号** 开头（`V1 …` / `V2 …`），失败时 jest 报出的用例名
 *   直接就是验收矩阵里的那一条 —— 不用回头翻代码猜是哪条挂了。
 *
 * ============ 替身边界 ============
 *   只有主题控制器（不落皮肤）；core 侧走**真的**总线 → runtime → character manager
 *   （建档落库与单位投影是真链路）。装配体见 helpers/creation-assembly.ts。
 *
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

import type { DetectedAgent, WorldState } from '../../core/types';
import {
  COMMAND_PALETTE_TAG,
  mountCommandPalette,
  type StratCommandPaletteElement,
} from '../../hud/components/command-palette/command-palette';
import { registerAppAction, resetAppActions } from '../../hud/lib/app-actions';
import { createOcclusionController } from '../../hud/layers/occlusion';
import { fillTextInput } from '../../hud/__tests__/helpers/shadow-widget';

import { assembleCreationFlow } from './helpers/creation-assembly';

/** 组合根源码（V11 的 toast / 落屏两断言只能落在这里 —— 组合根在 jest 里起不来，见该用例注释）。 */
const MAIN_ENTRY = path.join(__dirname, '..', 'main', 'main-entry.ts');
const mainEntrySource = fs.readFileSync(MAIN_ENTRY, 'utf-8');

/** 已装的 claude-code（可建档）。 */
const CLAUDE_INSTALLED: DetectedAgent = {
  kind: 'claude-code',
  tier: 'T1',
  installed: true,
  status: 'installed',
  version: '1.2.3',
  path: '/usr/bin/claude',
};

/** 一份「0 角色 + 探到 1 个已装 agent」的状态（向导能一路走到确认步）。 */
function stateWithAgent(): Partial<WorldState> {
  return { detectedAgents: [CLAUDE_INSTALLED] };
}

afterEach(() => {
  document.body.innerHTML = '';
  resetAppActions();
});

// ============================================================================
// V1 —— 0 角色，点战场空态「新建角色」→ 向导必挂（无论扫描状态）
// ============================================================================

describe('V1 · 战场空态「新建角色」→ 向导必挂', () => {
  test('V1-1 · 0 角色 + 一个 agent 都还没探到 → 点 CTA 向导照挂（入口处不定生死）', () => {
    const a = assembleCreationFlow();
    expect(a.wizard()).toBeNull();

    a.clickBattlefieldEmptyCta();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('V1-2 · 向导挂上之后扫描仍是 0 结果 → 向导不自己关掉（由扫描步呈现空态，不是入口退场）', () => {
    const a = assembleCreationFlow();
    a.clickBattlefieldEmptyCta();
    expect(a.wizard()).not.toBeNull();

    // 扫描跑完，0 可建档：向导必须**还在**（关掉它 = 用户又回到死胡同）。
    a.pushState({ detectedAgents: [] });

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });
});

// ============================================================================
// V2 —— 0 角色，点顶栏「＋角色」/ ⌘K → 同 V1
// ============================================================================

describe('V2 · 顶栏「＋角色」/ ⌘K → 向导必挂', () => {
  test('V2-1 · 顶栏「＋ 角色」→ 向导挂上', () => {
    const a = assembleCreationFlow();

    a.clickMainTopbarCreate();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('V2-2 · ⌘K → 输「新建角色」→ Enter → 向导挂上（全程无鼠标）', () => {
    const a = assembleCreationFlow();

    // ⌘K 面板里的「新建角色」是**宿主动作**（app-action），由组合根登记（main-entry.ts）。
    const unregister = registerAppAction('open-character-wizard', () => { a.openWizard(); });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmountPalette = mountCommandPalette(
      {
        dispatch: () => undefined,
        subscribe: () => () => undefined,
      },
      host,
      { occlusion: createOcclusionController({ document }) }
    );
    const palette = host.querySelector(COMMAND_PALETTE_TAG) as StratCommandPaletteElement;
    if (!palette?.shadowRoot) throw new Error('命令面板未 upgrade');

    // ⌘K 唤起。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    expect(palette.isOpen).toBe(true);

    // 输两字模糊命中「新建角色」，Enter 执行。
    const search = palette.shadowRoot.querySelector<HTMLInputElement>('[data-role="search"]');
    if (!search) throw new Error('搜索框未渲染');
    search.value = '新建角色';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(palette.visibleCommandIds).toContain('character.new');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(a.wizard()).not.toBeNull();

    unregister();
    unmountPalette();
    a.unmount();
  });
});

// ============================================================================
// V3 —— 0 角色，进角色中心 → 空态有「＋ 新建角色」CTA，点击开向导
// ============================================================================

describe('V3 · 角色中心空态 CTA → 点击开向导', () => {
  test('V3-1 · 0 角色时角色中心空态带主 CTA，且点了真的开向导', () => {
    const a = assembleCreationFlow();

    const screen = a.characterScreen();
    const cta = screen?.shadowRoot?.querySelector(
      '[data-role="cards-empty"] [data-role="create-character-empty"]'
    );
    expect(cta).not.toBeNull();
    expect(cta?.getAttribute('label')).toBe('新建角色');

    a.clickCharacterCenterCta();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });
});

// ============================================================================
// V11 —— 完成建档（沙盒）→ 角色+单位落地、落角色屏、toast「已上场」
// ============================================================================

describe('V11 · 完成建档（沙盒）→ 角色+单位落地 / 落角色屏 / toast', () => {
  test('V11-1 · 走完向导 → 角色落库 + 战场单位同一次投影出来（真 core 链路）', () => {
    const a = assembleCreationFlow(stateWithAgent());
    a.clickBattlefieldEmptyCta();
    const wizard = a.wizardScreen();
    if (!wizard) throw new Error('向导未挂');

    // 扫描 → 起名 → 人设 → 确认。
    wizard.next();
    expect(wizard.step).toBe('identity');
    // 起名：改成回归用例的名字（默认名是 agent 标签，改了才知道落地的是哪个）。
    expect(fillTextInput(wizard.shadowRoot as ShadowRoot, '回归角色')).toBe(true);
    wizard.next();
    expect(wizard.step).toBe('persona');
    // 人设：点「用默认模板」（空人设合法，建档时套默认模板）。
    const defaultBtn = wizard.shadowRoot?.querySelector('[data-action="use-default-template"]');
    expect(defaultBtn).not.toBeNull();
    (defaultBtn as HTMLElement).click();
    wizard.next();
    expect(wizard.step).toBe('confirm');

    wizard.submit();

    // 角色 + 单位：**同一次** setState 里落地（core/character/unit-projection.ts）。
    const state = a.store.getState();
    expect(state.characters).toHaveLength(1);
    expect(state.characters[0].name).toBe('回归角色');
    expect(state.units).toHaveLength(1);
    expect(state.units[0].characterId).toBe(state.characters[0].id);
    a.unmount();
  });

  test('V11-2 · 组合根收口：toast 报「已上场」+ 落角色屏（源码契约断言）', () => {
    // why 是源码契约断言：toast 文案与「落角色屏」这两步住在**组合根**（main-entry.ts 的
    //   onComplete 回调）—— 组合根是 vite build 的装配脚本，在 jest 里起不来
    //   （要 Electron / Phaser / IPC），故按仓内既有口径（src/app/__tests__/v34-main-entry-buttons.test.ts）
    //   读源码守契约：这两行不见了 = 用户建完档得不到反馈。
    expect(mainEntrySource).toMatch(/toastHost\.show\([\s\S]{0,400}已上场/);
    // 落角色屏：完成事件之后用微任务跳（同步跳会被向导自己的 ui.navigate('main') 盖掉）。
    expect(mainEntrySource).toMatch(
      /queueMicrotask\(\(\) => \{[\s\S]{0,200}screen: 'character'/
    );
  });
});
