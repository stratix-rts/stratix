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
  MOTION_CSS_VARS,
  MOTION_DURATIONS,
  MOTION_EASINGS,
  MOTION_KEYFRAMES,
  motionTokenValue,
} from '../../core/theme/motion-spec';
import {
  MOTION_CLASS,
  MOTION_COMPONENT_CSS,
  MOTION_TOKEN_STYLE_ID,
  MOTION_TOKENS_CSS,
  installMotionTokens,
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
  test('三档时长 / 三档缓动冻结在 core', () => {
    expect(MOTION_DURATIONS).toEqual({ fast: 120, base: 200, slow: 360 });
    expect(MOTION_EASINGS).toEqual({
      enter: 'ease-out',
      exit: 'ease-in',
      spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
  });

  test('HUD 的 CSS 变量表与 core 数值逐项一致（双 token 体系不漂移）', () => {
    for (const name of Object.values(MOTION_CSS_VARS)) {
      expect(MOTION_TOKENS_CSS).toContain(`${name}: ${motionTokenValue(name)};`);
    }
    expect(MOTION_TOKENS_CSS).toContain('--srf-motion-fast: 120ms;');
    expect(MOTION_TOKENS_CSS).toContain('--srf-motion-base: 200ms;');
    expect(MOTION_TOKENS_CSS).toContain('--srf-motion-slow: 360ms;');
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
