/**
 * 单测：**画布键盘的归属链**（@since v3.3，task_217 / IX-04）。
 *
 * 覆盖两条验收：
 *   ① 聊天框打字时按 ESC / 字符**不触发画布行为**（镜头不动、仪式不被顺手跳过）；
 *   ② 优先级链 = **仪式播放 > 聊天框焦点 > 镜头归位**（task_079 的 ESC 语义在链尾）。
 *
 * 两层都测：
 *   - 纯函数 `resolveKeyboardOwner`（world/keyboard-priority.ts）—— 规则本身；
 *   - 真场景 `BattlefieldScene` 的 ESC / 任意键处理 —— 规则真的接上了（Phaser 最小桩，
 *     同 instance-ceremony.test.ts 的口径：node 环境跑不起 Phaser，桩只够场景构造）。
 *
 * @jest-environment node
 */

jest.mock('phaser', () => {
  class Scene {
    settings: unknown;
    constructor(config?: unknown) {
      this.settings = config ?? {};
    }
  }
  return {
    __esModule: true,
    default: { Scene, Scenes: { Events: { SHUTDOWN: 'shutdown' } } },
  };
});

import { INPUT_FOCUS_KEY } from '../input-focus';
import { resolveKeyboardOwner } from '../keyboard-priority';
import { BattlefieldScene } from '../scenes/BattlefieldScene';

/** 场景内部形状（只取本单要碰的那几个成员）。 */
interface SceneInternals {
  registry: { get(key: string): unknown };
  nameplate: { active: boolean; skip: jest.Mock } | null;
  view: { clearOvershoot: jest.Mock };
  tweenCameraTo: jest.Mock;
  releaseFollow: jest.Mock;
  releaseDirector: jest.Mock;
  viewport: () => { width: number; height: number };
  onEscape(): void;
  onKeyDown(): void;
}

/**
 * 造一个够用的场景：registry 里塞一个「有 / 无输入焦点」的探针，
 * 镜头相关成员全部打桩（只关心「有没有动」，不关心动成什么样）。
 */
function makeScene(options: { inputFocused?: boolean; ceremonyPlaying?: boolean } = {}): SceneInternals {
  const scene = new BattlefieldScene();
  const internals = scene as unknown as SceneInternals;
  const inputFocused = options.inputFocused === true;
  internals.registry = {
    get: (key: string) => (key === INPUT_FOCUS_KEY ? () => inputFocused : undefined),
  };
  internals.nameplate = { active: options.ceremonyPlaying === true, skip: jest.fn() };
  internals.view = { clearOvershoot: jest.fn() };
  internals.tweenCameraTo = jest.fn();
  internals.releaseFollow = jest.fn();
  internals.releaseDirector = jest.fn();
  internals.viewport = () => ({ width: 1280, height: 720 });
  return internals;
}

describe('归属链：仪式 > 输入焦点 > 画布（task_217 / IX-04）', () => {
  test('规则本身：仪式在演 ⇒ 归仪式（哪怕同时有输入焦点）', () => {
    expect(resolveKeyboardOwner({ ceremonyPlaying: true, inputFocused: false })).toBe('ceremony');
    expect(resolveKeyboardOwner({ ceremonyPlaying: true, inputFocused: true })).toBe('ceremony');
  });

  test('规则本身：没仪式但有输入焦点 ⇒ 归输入框（画布让路）', () => {
    expect(resolveKeyboardOwner({ ceremonyPlaying: false, inputFocused: true })).toBe('input');
  });

  test('规则本身：没仪式也没输入焦点 ⇒ 归画布（ESC = 镜头归位）', () => {
    expect(resolveKeyboardOwner({ ceremonyPlaying: false, inputFocused: false })).toBe('canvas');
  });
});

describe('场景接线：ESC 的归属（task_217 / IX-04）', () => {
  test('验收① 聊天框聚焦时按 ESC：镜头不动、跟随不解除（画布让路）', () => {
    const internals = makeScene({ inputFocused: true });

    internals.onEscape();

    expect(internals.tweenCameraTo).not.toHaveBeenCalled();
    expect(internals.releaseFollow).not.toHaveBeenCalled();
    expect(internals.releaseDirector).not.toHaveBeenCalled();
  });

  test('优先级链① 仪式在演时按 ESC：这次 ESC 归仪式（跳过仪式，不回全景）', () => {
    const internals = makeScene({ ceremonyPlaying: true });

    internals.onEscape();

    expect(internals.nameplate?.skip).toHaveBeenCalledTimes(1);
    expect(internals.tweenCameraTo).not.toHaveBeenCalled();
  });

  test('优先级链① 仪式在演时按任意键：仍被仪式消费（task_187「任意输入即跳到末态」）', () => {
    const internals = makeScene({ ceremonyPlaying: true });

    internals.onKeyDown();

    expect(internals.nameplate?.skip).toHaveBeenCalledTimes(1);
  });

  test('优先级链③ 链尾：无仪式无焦点 ⇒ ESC = 镜头归位（task_079）', () => {
    const internals = makeScene();

    internals.onEscape();

    expect(internals.releaseFollow).toHaveBeenCalledTimes(1);
    expect(internals.tweenCameraTo).toHaveBeenCalledTimes(1);
  });

  test('验收① 聊天框聚焦时按普通字符：不触发任何画布行为（非仪式期画布本就没有字符键位）', () => {
    const internals = makeScene({ inputFocused: true });

    internals.onKeyDown();

    // 非仪式期 ⇒ 仪式不被跳过（画布不吞字符），镜头也不动。
    expect(internals.nameplate?.skip).not.toHaveBeenCalled();
    expect(internals.tweenCameraTo).not.toHaveBeenCalled();
  });
});
