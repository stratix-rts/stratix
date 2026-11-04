/**
 * 集成测试：动效系统（@since v3.8，task_138）。
 * 覆盖三块：
 *   ① 动效 token 层（core 唯一事实源 → HUD CSS 变量，两侧数值一致）；
 *   ② 签名瞬间一：任务完成确认（toast 成功态的对勾 + 脉冲；任务行 running→done 的确认类）；
 *   ③ 降级动效兜底（prefers-reduced-motion: reduce 时全部 animation/transition 归零）。
 * @jest-environment jsdom
 *
 * why 单测断「类与 token」而不是「像素」：jsdom 不渲染样式，
 *   视觉帧由 e2e（playwright）验；这里守的是**契约**（类名 / 变量值 / 一次性语义）。
 */

import {
  MOTION_BEAT_CSS_VARS,
  MOTION_CSS_VARS,
  MOTION_DURATIONS,
  MOTION_EASINGS,
  MOTION_KEYFRAMES,
  MOTION_LOOP_DURATIONS,
  motionTokenValue,
} from '../../core/theme/motion-spec';
import {
  MOTION_CLASS,
  MOTION_COMPONENT_CSS,
  MOTION_REDUCED_CSS,
  MOTION_REDUCED_STYLE_ID,
  MOTION_SKIN_ID,
  MOTION_TOKEN_STYLE_ID,
  MOTION_TOKENS_CSS,
  detectMotionSkin,
  installMotionTokens,
  motionSkinCss,
} from '../theme/motion-tokens';
import { mountToastHost, type StratToastHostElement } from '../components/toast/toast-host';
import {
  MISSION_CONFIRM_TAG,
  mountMissionConfirm,
  type MissionConfirmDeps,
  type StratMissionConfirmElement,
} from '../panels/mission-confirm';
import type { MissionView, WorldState } from '../../core/types';

describe('动效 token：core 事实源 → HUD CSS 变量', () => {
  test('四档时长 / 三档缓动冻结在 core（@since v3.9，task_147 补 instant 档）', () => {
    expect(MOTION_DURATIONS).toEqual({ instant: 60, fast: 120, base: 200, slow: 360 });
    expect(MOTION_EASINGS).toEqual({
      enter: 'ease-out',
      exit: 'ease-in',
      spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
  });

  test('环境循环时长与交互节拍分表（装饰性 infinite 动画不占交互档位）', () => {
    expect(MOTION_LOOP_DURATIONS).toEqual({
      sweep: 2400,
      pulse: 1800,
      scan: 12_000,
      glow: 650,
      caret: 900,
    });
  });

  test('HUD 的 CSS 变量表与 core 数值逐项一致（双 token 体系不漂移）', () => {
    for (const name of Object.values(MOTION_CSS_VARS)) {
      expect(MOTION_TOKENS_CSS).toContain(`${name}: ${motionTokenValue(name)};`);
    }
    for (const name of Object.values(MOTION_BEAT_CSS_VARS)) {
      expect(MOTION_TOKENS_CSS).toContain(`${name}: ${motionTokenValue(name)};`);
    }
    expect(MOTION_TOKENS_CSS).toContain('--srf-motion-instant: 60ms;');
    expect(MOTION_TOKENS_CSS).toContain('--srf-motion-fast: 120ms;');
    expect(MOTION_TOKENS_CSS).toContain('--srf-motion-base: 200ms;');
    expect(MOTION_TOKENS_CSS).toContain('--srf-motion-slow: 360ms;');
  });

  test('交互节拍复合档：时长 + 缓动打包（组件只认这五档）', () => {
    // hover = fast + ease-enter；panel = base + ease-enter；panelExit = base + ease-exit。
    expect(motionTokenValue(MOTION_BEAT_CSS_VARS.hover)).toBe(
      'var(--srf-motion-fast) var(--srf-motion-ease-enter)',
    );
    expect(motionTokenValue(MOTION_BEAT_CSS_VARS.panel)).toBe(
      'var(--srf-motion-base) var(--srf-motion-ease-enter)',
    );
    expect(motionTokenValue(MOTION_BEAT_CSS_VARS.panelExit)).toBe(
      'var(--srf-motion-base) var(--srf-motion-ease-exit)',
    );
    expect(motionTokenValue(MOTION_BEAT_CSS_VARS.tap)).toBe(
      'var(--srf-motion-instant) var(--srf-motion-ease-enter)',
    );
    expect(motionTokenValue(MOTION_BEAT_CSS_VARS.signature)).toBe(
      'var(--srf-motion-slow) var(--srf-motion-ease-spring)',
    );
  });

  test('未知 token 名报错（不静默兜底成错误值）', () => {
    expect(() => motionTokenValue('--srf-motion-nope')).toThrow(/unknown motion token/);
  });

  test('installMotionTokens 幂等注入到文档根（:root 变量跨 shadow root 可见）', () => {
    document.head.innerHTML = '';
    const uninstall = installMotionTokens();
    const first = document.getElementById(MOTION_TOKEN_STYLE_ID);
    expect(first).not.toBeNull();
    expect(first?.textContent).toContain('--srf-motion-base: 200ms;');

    installMotionTokens();
    expect(document.querySelectorAll(`#${MOTION_TOKEN_STYLE_ID}`)).toHaveLength(1);
    // 重复安装仍只有一张（幂等）：第二张把第一张顶掉
    const uninstallLatest = installMotionTokens();
    expect(document.querySelectorAll(`#${MOTION_TOKEN_STYLE_ID}`)).toHaveLength(1);
    // 卸载闭包拔掉的是「它自己那张表」
    uninstallLatest();
    expect(document.getElementById(MOTION_TOKEN_STYLE_ID)).toBeNull();
    uninstall(); // 拔一张已被顶掉的表：不报错（幂等）
  });
});

describe('动效工具类：关键帧 + 降级动效兜底', () => {
  test('关键帧名与 core 冻结的名字一致', () => {
    for (const name of Object.values(MOTION_KEYFRAMES)) {
      expect(MOTION_COMPONENT_CSS).toContain(`@keyframes ${name}`);
    }
  });

  test('工具类都在（入场 / 确认 / 对勾 / 脉冲）', () => {
    for (const cls of Object.values(MOTION_CLASS)) {
      expect(MOTION_COMPONENT_CSS).toContain(`.${cls}`);
    }
  });

  test('prefers-reduced-motion: reduce 下全部动效禁用（animation/transition 归 none）', () => {
    expect(MOTION_COMPONENT_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(MOTION_COMPONENT_CSS).toContain('animation: none !important;');
    expect(MOTION_COMPONENT_CSS).toContain('transition: none !important;');
  });

  test('降级块单独可取（组件自挂用；@since v3.9，task_147）', () => {
    expect(MOTION_REDUCED_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(MOTION_REDUCED_CSS).toContain('animation: none !important;');
    expect(MOTION_REDUCED_CSS).toContain('transition: none !important;');
    // 组件样式表里的降级块与独立导出的是同一块（组件把这一块拼进自己的 <style>）。
    expect(MOTION_COMPONENT_CSS).toContain(MOTION_REDUCED_CSS);
  });

  test('文档级降级通道幂等装上（浅 DOM 的 HUD 样式归它管）', () => {
    document.head.innerHTML = '';
    installMotionTokens();
    const first = document.getElementById(MOTION_REDUCED_STYLE_ID);
    expect(first).not.toBeNull();
    expect(first?.textContent).toContain('prefers-reduced-motion: reduce');
    // 幂等：重复安装仍只有一张
    installMotionTokens();
    expect(document.querySelectorAll(`#${MOTION_REDUCED_STYLE_ID}`)).toHaveLength(1);
  });
});

describe('皮肤运动语言（像素皮走 steps() 重帧感）', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--srf-transition');
  });

  test('现代皮 → 不产出覆盖块（默认缓动原样）', () => {
    expect(motionSkinCss(null)).toBe('');
    expect(detectMotionSkin(document)).toBeNull();
  });

  test('像素皮 → 覆盖块是 steps()，且特异度高于基础表（谁后注入都赢）', () => {
    const css = motionSkinCss(MOTION_SKIN_ID.pixel);
    expect(css).toContain('steps(3, end)');
    expect(css).toContain('steps(2, end)');
    expect(css).toContain('steps(4, end)');
    // `html:root`（0,1,1）必须压过基础表的 `:root`（0,1,0）——
    //   组件每次挂载都重注基础表，同特异度会让基础表按注入顺序覆盖皮肤覆盖块。
    expect(css).toContain('html:root');
  });

  test('探测：--srf-transition 带 steps() → 认出像素皮', () => {
    document.documentElement.style.setProperty('--srf-transition', '120ms steps(2, end)');
    expect(detectMotionSkin(document)).toBe(MOTION_SKIN_ID.pixel);
  });

  test('注入的 token 表在像素皮下带上覆盖块（现代皮下不带）', () => {
    const modern = installMotionTokens();
    expect(document.getElementById(MOTION_TOKEN_STYLE_ID)?.textContent).not.toContain('steps(3, end)');
    modern();

    document.documentElement.style.setProperty('--srf-transition', '120ms steps(2, end)');
    const pixel = installMotionTokens();
    expect(document.getElementById(MOTION_TOKEN_STYLE_ID)?.textContent).toContain('steps(3, end)');
    pixel();
  });
});

describe('签名瞬间一：任务完成确认', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('成功 toast 挂对勾（描边 + 脉冲），失败 / 中性态不挂', () => {
    const { element } = mountToastHost(document.body);
    const host = element as StratToastHostElement;

    host.show('阿尔法 完成任务', 'success');
    const successToast = host.shadowRoot?.querySelector('.toast');
    expect(successToast?.querySelector(`.${MOTION_CLASS.confirm}`)).not.toBeNull();
    expect(successToast?.querySelector(`.${MOTION_CLASS.check}`)).not.toBeNull();
    // 入场类：toast 不是瞬现
    expect(successToast?.classList.contains(MOTION_CLASS.enter)).toBe(true);

    host.show('阿尔法 任务失败', 'danger');
    const dangerToast = host.shadowRoot?.querySelectorAll('.toast')[1];
    expect(dangerToast?.querySelector('.check')).toBeNull();
  });

  test('任务行 running → done 的那一帧挂确认类；之后重画不再重放', () => {
    const subs = new Set<(state: WorldState) => void>();
    const deps: MissionConfirmDeps = {
      dispatch: () => {},
      subscribe: (handler) => {
        subs.add(handler);
        return () => { subs.delete(handler); };
      },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountMissionConfirm(deps, host);
    const panel = host.querySelector(MISSION_CONFIRM_TAG) as StratMissionConfirmElement;

    const mission = (phase: MissionView['phase']): MissionView => ({
      id: 'm-1',
      title: '任务 m-1',
      phase,
      unitIds: [],
      createdAt: 1000,
    });
    const state = (phase: MissionView['phase']): WorldState => ({
      units: [],
      missions: [mission(phase)],
      selection: { unitIds: [], previewUnitIds: [], revision: 0 },
      characters: [],
      notices: [],
      links: [],
      messages: [],
    });

    // 先来一帧 running：此时不该有确认动效
    subs.forEach((handler) => handler(state('running')));
    let row = panel.shadowRoot?.querySelector('[data-mission-row="m-1"]');
    expect(row?.getAttribute('data-confirmed')).toBeNull();

    // running → done：签名瞬间
    subs.forEach((handler) => handler(state('done')));
    row = panel.shadowRoot?.querySelector('[data-mission-row="m-1"]');
    expect(row?.getAttribute('data-confirmed')).toBe('true');
    expect(row?.classList.contains(MOTION_CLASS.confirm)).toBe(true);
    expect(row?.querySelector(`.${MOTION_CLASS.check}`)).not.toBeNull();

    // 之后再变一次别的状态（重画）——确认动效不得重放（否则那行会一直抖）
    subs.forEach((handler) => handler(state('cancelled')));
    row = panel.shadowRoot?.querySelector('[data-mission-row="m-1"]');
    expect(row?.getAttribute('data-confirmed')).toBeNull();
    expect(row?.classList.contains(MOTION_CLASS.confirm)).toBe(false);
  });
});
