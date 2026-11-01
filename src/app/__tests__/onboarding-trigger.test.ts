/**
 * 单测：首启判定（app/main/onboarding-trigger.ts）+ 开发期开关读取（app/main/dev-flags.ts）。
 * 覆盖：判定口径（角色为空 / 已装 agent / 强制开关）、开关的构建期与运行时两个来源。
 *
 * 边界说明：判定是纯函数，夹具直接给 characters / detectedAgents 两份数据 ——
 *   真实状态怎么来（core 广播）是接线层的事，不在判定里。
 * @jest-environment jsdom
 */

import type { CharacterView, DetectedAgent } from '../../core/types';

import { countInstalledAgents, shouldStartOnboarding } from '../main/onboarding-trigger';
import { isOnboardingForced } from '../main/dev-flags';

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

const CLAUDE = detected({ kind: 'claude-code', tier: 'T1', installed: true, status: 'installed' });
/** 探到了但没确认安装（超时）—— 不算"已装"。 */
const TIMEOUT = detected({ kind: 'codex', tier: 'T1', installed: false, status: 'timeout' });
/** T2：探到了但还不能建档 —— 仍然算"已装"（引导屏会如实标注"仅探测"）。 */
const GEMINI = detected({ kind: 'gemini', tier: 'T2', installed: true, status: 'installed' });

const CHARACTER: CharacterView = {
  id: 'character_1_1',
  name: 'Neo',
  persona: 'x',
  level: 1,
  experience: 0,
  agentKind: 'claude-code',
  skinId: 'crimson',
};

describe('首启判定', () => {
  test('没有角色 + 探到已装 agent → 该进引导', () => {
    expect(shouldStartOnboarding({ characters: [], detectedAgents: [CLAUDE] })).toBe(true);
  });

  test('没有角色 + 一个都没探到 → 不进引导（别打扰没装 agent 的用户）', () => {
    expect(shouldStartOnboarding({ characters: [], detectedAgents: [] })).toBe(false);
    expect(shouldStartOnboarding({ characters: [], detectedAgents: [TIMEOUT] })).toBe(false);
  });

  test('已经有角色 → 不是首启，不进引导', () => {
    expect(shouldStartOnboarding({ characters: [CHARACTER], detectedAgents: [CLAUDE] })).toBe(false);
  });

  test('T2 的 agent 也算"已装"（能不能建档是引导屏第二步的事）', () => {
    expect(shouldStartOnboarding({ characters: [], detectedAgents: [GEMINI] })).toBe(true);
  });

  test('强制开关：每次都触发（哪怕已经有角色）', () => {
    expect(shouldStartOnboarding({ characters: [CHARACTER], detectedAgents: [CLAUDE], force: true })).toBe(true);
    expect(shouldStartOnboarding({ characters: [], detectedAgents: [], force: true })).toBe(true);
  });

  test('countInstalledAgents 只数确认安装的', () => {
    expect(countInstalledAgents([CLAUDE, TIMEOUT, GEMINI])).toBe(2);
    expect(countInstalledAgents([])).toBe(0);
  });
});

describe('开发期开关（STRATIX_ONBOARDING_FORCE）', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  test('默认关闭（既没有构建期常量也没有运行时环境变量）', () => {
    expect(isOnboardingForced()).toBe(false);
  });

  test('运行时环境变量为 1 → 打开（Electron preload 透传的路径）', () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      env: { STRATIX_ONBOARDING_FORCE: '1' },
    };
    expect(isOnboardingForced()).toBe(true);
  });

  test('运行时环境变量不是 1 → 仍然关闭（只认 1，不认 true / yes）', () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      env: { STRATIX_ONBOARDING_FORCE: 'true' },
    };
    expect(isOnboardingForced()).toBe(false);
  });
});
